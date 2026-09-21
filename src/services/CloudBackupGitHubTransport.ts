import { LEGACY_RELEASE_TAG } from './CloudBackupPolicy'
import type { CloudBackupItem, GitHubBackupConfig } from '../types/CloudBackup'
import { isCapacitorApp } from '../utils/CapacitorDetection'
import { hashCloudBlob } from './CloudArchiveCodec'
import { parseGitHubBundleManifest, type GitHubBundleManifest } from './GitHubBackupBundle'
import {
  decodeStructuredSnapshot,
  encodeStructuredSnapshot,
  isStructuredSnapshotObjectKey,
  structuredSnapshotArchiveName,
  structuredSnapshotName,
  structuredSnapshotParts,
  type CloudObjectPlan,
  type CreatedStructuredSnapshot,
  type StructuredSnapshot,
} from './CloudStructuredSnapshot'
import {
  canUseNativeStructuredSnapshotHandoff,
  isNativeCloudTransferAvailable,
  uploadNativeStructuredSnapshot,
} from './NativeCloudTransfer'
import {
  encodeBase64,
  structuredPartObjectKey,
  structuredPartContainer,
  structuredPartIdentity,
} from './CloudBackupPolicy'
import {
  type GitHubErrorDetail,
  isCloudRequestTimeout,
  mapWithConcurrency,
  githubError,
} from './CloudBackupHttp'
import {
  type CloudBackupTransportContext,
  type GitHubAsset,
  type GitHubRelease,
  type CloudBackupProgressCallback,
  SNAPSHOT_RELEASE_TAG,
  OBJECT_RELEASE_PREFIX,
  GITHUB_OBJECT_CONTAINER_LIMIT,
  GITHUB_ASSET_CONFIRM_ATTEMPTS,
  GITHUB_ASSET_CONFIRM_DELAY_MS,
} from './CloudBackupTransportContext'

export async function githubFetch(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await context.cloudFetch(
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}${path}`,
    {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${secret}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    },
  )
  if (response.ok && (init.method ?? 'GET').toUpperCase() === 'DELETE') {
    const assetId = Number(/\/releases\/assets\/(\d+)/u.exec(path)?.[1] ?? Number.NaN)
    if (Number.isSafeInteger(assetId)) context.activeGitHubInventory?.assets.delete(assetId)
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as GitHubErrorDetail
    throw githubError(response.status, detail, path, init.method ?? 'GET', response.headers)
  }
  return response
}

export async function ensureGitHubInitialCommit(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
): Promise<boolean> {
  const commits = await context.cloudFetch(
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/commits?per_page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${secret}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (commits.ok) return false
  if (commits.status !== 409) {
    const detail = (await commits.json().catch(() => ({}))) as GitHubErrorDetail
    throw githubError(commits.status, detail, '/commits?per_page=1', 'GET', commits.headers)
  }
  await context.githubFetch(config, secret, '/contents/.srl-backup-container', {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Initialize SRL cloud backup container',
      content: encodeBase64(
        'This private repository is initialized for SillyTavern Resource Library backups.\n',
      ),
    }),
  })
  return true
}

export async function getGitHubRelease(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  create: boolean,
  tag = LEGACY_RELEASE_TAG,
): Promise<GitHubRelease | undefined> {
  const releaseUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/releases/tags/${encodeURIComponent(tag)}`
  const requestRelease = (): Promise<Response> =>
    context.cloudFetch(releaseUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${secret}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  let response = await requestRelease()
  let initialized = false
  if (response.ok) return (await response.json()) as GitHubRelease
  // GitHub 对部分完全空白的私有仓库会先把 Release 查询返回为 403。
  // 初始化首个提交后，该查询会正常变成 404（尚无 Release），此时应继续创建而不是把 404 抛出。
  if (response.status === 403 && create) {
    const original = response.clone()
    initialized = await context.ensureGitHubInitialCommit(config, secret)
    if (initialized) {
      response = await requestRelease()
      if (response.ok) return (await response.json()) as GitHubRelease
    } else {
      const detail = (await original.json().catch(() => ({}))) as GitHubErrorDetail
      throw githubError(original.status, detail, `/releases/tags/${tag}`, 'GET', original.headers)
    }
  }
  if (response.status !== 404 || !create) {
    if (response.status === 404 && !create) return undefined
    const detail = (await response.json().catch(() => ({}))) as GitHubErrorDetail
    throw githubError(response.status, detail, `/releases/tags/${tag}`, 'GET', response.headers)
  }
  if (!initialized) await context.ensureGitHubInitialCommit(config, secret)
  const created = await context.githubFetch(config, secret, '/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: tag === SNAPSHOT_RELEASE_TAG ? 'SRL 云备份快照清单' : `SRL 云备份对象 ${tag}`,
      body: '由 SillyTavern Resource Library 自动维护，请勿手动修改附件。',
      prerelease: true,
    }),
  })
  return (await created.json()) as GitHubRelease
}

export async function uploadGitHubStructuredBackup(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  snapshot: CreatedStructuredSnapshot,
  onProgress?: CloudBackupProgressCallback,
  respectAutomaticConstraints = false,
): Promise<CloudBackupItem> {
  const snapshotRelease = await context.getGitHubRelease(config, secret, true, SNAPSHOT_RELEASE_TAG)
  if (!snapshotRelease) throw new Error('无法创建 GitHub 快照清单容器')
  const containers: Array<{
    tag: string
    release: GitHubRelease
    assets: Map<string, GitHubAsset>
    assigned: number
  }> = []
  for (let index = 1; index <= 10_000; index += 1) {
    const tag = `${OBJECT_RELEASE_PREFIX}${String(index).padStart(4, '0')}`
    const release = await context.getGitHubRelease(config, secret, false, tag)
    if (!release) break
    containers.push({
      tag,
      release,
      assets: new Map(
        (await context.listGitHubAssets(config, secret, release.id)).map((asset) => [
          asset.name,
          asset,
        ]),
      ),
      assigned: 0,
    })
  }
  const createContainer = async () => {
    const tag = `${OBJECT_RELEASE_PREFIX}${String(containers.length + 1).padStart(4, '0')}`
    const release = await context.getGitHubRelease(config, secret, true, tag)
    if (!release) throw new Error(`无法创建 GitHub 对象容器 ${tag}`)
    const container = { tag, release, assets: new Map<string, GitHubAsset>(), assigned: 0 }
    containers.push(container)
    return container
  }
  if (!containers.length) await createContainer()

  const placements = new Map<
    string,
    { tag: string; releaseId: number; asset?: GitHubAsset; plan: CloudObjectPlan }
  >()
  for (const plan of snapshot.objectPlans) {
    const name = plan.name
    let matched:
      { tag: string; releaseId: number; asset?: GitHubAsset; plan: CloudObjectPlan } | undefined
    for (const container of containers) {
      const asset = container.assets.get(name)
      if (!asset) continue
      if (asset.size !== plan.size) {
        throw new Error(`GitHub 内容寻址对象 ${name} 的远端大小冲突；拒绝覆盖 immutable 对象`)
      }
      matched = { tag: container.tag, releaseId: container.release.id, asset, plan }
      break
    }
    if (!matched) {
      let container = containers.at(-1)!
      if (container.assets.size + container.assigned >= GITHUB_OBJECT_CONTAINER_LIMIT) {
        container = await createContainer()
      }
      container.assigned += 1
      matched = { tag: container.tag, releaseId: container.release.id, plan }
    }
    placements.set(name, matched)
  }
  for (const resource of [...snapshot.snapshot.resources, ...snapshot.snapshot.versions]) {
    for (const part of resource.object.parts) {
      const placement = placements.get(part.name)
      if (!placement) throw new Error(`V3 清单缺少对象定位：${part.name}`)
      part.storage = {
        kind: 'github-release',
        container: placement.tag,
        objectKey: part.name,
      }
    }
  }
  const jobs = [...placements].filter(([, placement]) => !placement.asset)
  onProgress?.(
    `对象级快照复用 ${snapshot.objectPlans.length - jobs.length} 个块；上传 ${jobs.length} 个变更块…`,
  )
  if (isNativeCloudTransferAvailable()) {
    const manifestBlob = await encodeStructuredSnapshot(snapshot.snapshot)
    const name = structuredSnapshotName()
    const nativeObjects = jobs.map(([objectName, placement]) => ({
      name: objectName,
      blob: placement.plan.blob,
      size: placement.plan.size,
      contentType: 'application/octet-stream',
      releaseId: placement.releaseId,
      nativeSource: snapshot.nativeSources.get(objectName),
    }))
    const nativeManifest = {
      name,
      blob: manifestBlob,
      size: manifestBlob.size,
      contentType: 'application/gzip',
      releaseId: snapshotRelease.id,
    }
    if (
      await canUseNativeStructuredSnapshotHandoff({
        objects: nativeObjects,
        manifest: nativeManifest,
      })
    ) {
      onProgress?.('大型对象可直接从 Android 原生对象库读取，正在交给后台任务…')
      const result = await uploadNativeStructuredSnapshot({
        config,
        secret,
        objects: nativeObjects,
        manifest: nativeManifest,
        onProgress,
        respectConstraints: respectAutomaticConstraints,
      })
      context.activeMetrics?.merge(result.metrics)
      context.activeGitHubInventory = undefined
      return {
        id: result.id,
        objectKey: result.name,
        size: snapshot.totalSize,
        createdAt: Date.now(),
        kind: 'githubSnapshot',
        partCount: snapshot.partCount,
        archiveName: structuredSnapshotArchiveName(result.name),
      }
    }
    throw new Error('Android 原生对象来源不完整；已阻止 GitHub 云对象退回 JS Blob 网络')
  }
  const planHash = await hashCloudBlob(
    new Blob([
      JSON.stringify(
        [...placements]
          .map(([objectName, placement]) => [objectName, placement.tag, placement.plan.size])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      ),
    ]),
  )
  const webJob = await context.jobStore.begin('github', planHash, placements.keys())
  for (const [objectName, placement] of placements) {
    if (placement.asset) await context.jobStore.markObject(webJob, objectName, 'verified')
  }
  let completedJobs = 0
  try {
    await mapWithConcurrency(jobs, 3, async ([name, placement]) => {
      const blob = await context.materializeCloudObject(placement.plan)
      let completed = false
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (attempt > 1) context.activeMetrics?.add('retryCount', 1)
        try {
          const uploaded = await context.uploadGitHubAsset(
            config,
            secret,
            placement.releaseId,
            name,
            blob,
            'application/octet-stream',
            undefined,
            1,
          )
          if (await context.confirmGitHubAssetSize(config, secret, uploaded, blob.size)) {
            completed = true
            break
          }
          await context.githubFetch(config, secret, `/releases/assets/${uploaded.id}`, {
            method: 'DELETE',
          })
        } catch {
          // 只重试当前对象；已 verified 对象不会重新进入 jobs。
        }
      }
      if (!completed) {
        await context.jobStore.markObject(webJob, name, 'failed')
        throw new Error(`GitHub 对象块 ${name.slice(-12)} 连续 3 次上传不完整；未提交快照清单`)
      }
      await context.jobStore.markObject(webJob, name, 'verified')
      completedJobs += 1
      onProgress?.(`GitHub 变更块已完成 ${completedJobs} / ${jobs.length}…`)
    })
  } catch (error) {
    await context.jobStore.fail(webJob, error)
    throw error
  }
  try {
    onProgress?.('对象块已完成，正在压缩快照清单…')
    const manifestBlob = await encodeStructuredSnapshot(snapshot.snapshot)
    const name = structuredSnapshotName()
    onProgress?.(`快照清单已压缩为 ${(manifestBlob.size / 1024).toFixed(1)} KiB，正在最后提交…`)
    const manifest = await context.uploadGitHubAsset(
      config,
      secret,
      snapshotRelease.id,
      name,
      manifestBlob,
      'application/gzip',
      `SRL_SNAPSHOT:${snapshot.totalSize}:${snapshot.partCount}`,
      3,
    )
    const confirmedManifest = await context.confirmGitHubAssetSize(
      config,
      secret,
      manifest,
      manifestBlob.size,
    )
    if (!confirmedManifest) {
      await context.githubFetch(config, secret, `/releases/assets/${manifest.id}`, {
        method: 'DELETE',
      })
      throw new Error('GitHub 对象快照清单上传不完整；旧备份没有受到影响')
    }
    await context.jobStore.complete(webJob, name)
    return {
      id: String(confirmedManifest.id),
      objectKey: confirmedManifest.name,
      size: snapshot.totalSize,
      createdAt: Date.parse(confirmedManifest.created_at) || Date.now(),
      kind: 'githubSnapshot',
      partCount: snapshot.partCount,
      archiveName: structuredSnapshotArchiveName(name),
    }
  } catch (error) {
    await context.jobStore.fail(webJob, error)
    throw error
  }
}

export async function uploadGitHubAsset(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  releaseId: number,
  name: string,
  blob: Blob,
  contentType: string,
  label?: string,
  attempts = 1,
): Promise<GitHubAsset> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) context.activeMetrics?.add('retryCount', 1)
    try {
      const query = new URLSearchParams({ name })
      if (label) query.set('label', label)
      const response = await context.cloudFetch(
        `https://uploads.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/releases/${releaseId}/assets?${query}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${secret}`,
            'Content-Type': contentType,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: blob,
        },
      )
      if (response.ok) {
        const asset = (await response.json()) as GitHubAsset
        context.activeGitHubInventory?.assets.set(asset.id, asset)
        return asset
      }
      const detail = (await response.json().catch(() => ({}))) as GitHubErrorDetail
      if (response.status === 422) {
        const existing = (await context.listGitHubAssets(config, secret, releaseId)).find(
          (asset) => asset.name === name && asset.size === blob.size,
        )
        if (existing) return existing
      }
      lastError = githubError(response.status, detail, 'GitHub 上传失败')
      if (response.status < 500 || attempt === attempts) throw lastError
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('GitHub 上传失败')
      if (attempt === attempts) throw lastError
    }
    await new Promise<void>((resolve) => setTimeout(resolve, attempt * 800))
  }
  throw lastError ?? new Error('GitHub 上传失败')
}

export async function confirmGitHubAssetSize(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  uploaded: GitHubAsset,
  expectedSize: number,
): Promise<GitHubAsset | undefined> {
  const verifyStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
  try {
    for (let attempt = 1; attempt <= GITHUB_ASSET_CONFIRM_ATTEMPTS; attempt += 1) {
      const response = await context.githubFetch(config, secret, `/releases/assets/${uploaded.id}`)
      const asset = (await response.json()) as GitHubAsset
      if (asset.id === uploaded.id && asset.size === expectedSize) return asset
      if (attempt < GITHUB_ASSET_CONFIRM_ATTEMPTS) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, attempt * GITHUB_ASSET_CONFIRM_DELAY_MS),
        )
      }
    }
    return undefined
  } finally {
    const verifyFinished = typeof performance === 'undefined' ? Date.now() : performance.now()
    context.activeMetrics?.add('verifyMs', verifyFinished - verifyStarted)
  }
}

export async function listGitHubAssets(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  releaseId: number,
): Promise<GitHubAsset[]> {
  if (context.activeGitHubInventory?.releaseId === releaseId) {
    return [...context.activeGitHubInventory.assets.values()]
  }
  const assets: GitHubAsset[] = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await context.githubFetch(
      config,
      secret,
      `/releases/${releaseId}/assets?per_page=100&page=${page}`,
    )
    const batch = (await response.json()) as GitHubAsset[]
    assets.push(...batch)
    if (batch.length < 100) break
  }
  if (context.activeMetrics) {
    context.activeGitHubInventory = {
      releaseId,
      assets: new Map(assets.map((asset) => [asset.id, asset])),
    }
  }
  return assets
}

export async function readGitHubPartInventory(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  parts: GitHubBundleManifest['parts'],
): Promise<Map<string, GitHubAsset>> {
  const result = new Map<string, GitHubAsset>()
  const containers = new Set(parts.map(structuredPartContainer))
  for (const container of containers) {
    const release = await context.getGitHubRelease(config, secret, false, container)
    if (!release) continue
    for (const asset of await context.listGitHubAssets(config, secret, release.id)) {
      result.set(`${container}\u0000${asset.name}`, asset)
    }
  }
  return result
}

export async function listGitHub(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  onProgress?: CloudBackupProgressCallback,
): Promise<CloudBackupItem[]> {
  const legacyRelease = await context.getGitHubRelease(config, secret, false, LEGACY_RELEASE_TAG)
  const snapshotRelease = await context.getGitHubRelease(
    config,
    secret,
    false,
    SNAPSHOT_RELEASE_TAG,
  )
  if (!legacyRelease && !snapshotRelease) return []
  onProgress?.('正在读取 GitHub 远端对象索引…')
  const legacyAssets = legacyRelease
    ? await context.listGitHubAssets(config, secret, legacyRelease.id)
    : []
  const snapshotAssets = snapshotRelease
    ? await context.listGitHubAssets(config, secret, snapshotRelease.id)
    : []
  const backups = legacyAssets
    .filter((asset) => /\.zip$/i.test(asset.name) || asset.name.endsWith('.srlbundle.json'))
    .map((asset): CloudBackupItem => ({
      id: String(asset.id),
      objectKey: asset.name,
      size: /\.srlbundle\.json$/i.test(asset.name)
        ? Number(/^SRL_BUNDLE:(\d+):(\d+)$/.exec(asset.label ?? '')?.[1] ?? asset.size)
        : asset.size,
      createdAt: Date.parse(asset.created_at) || 0,
      kind: asset.name.endsWith('.srlbundle.json') ? 'githubBundle' : 'single',
      partCount: /\.srlbundle\.json$/i.test(asset.name)
        ? Number(/^SRL_BUNDLE:(\d+):(\d+)$/.exec(asset.label ?? '')?.[2] ?? 0)
        : undefined,
      archiveName: asset.name.endsWith('.srlbundle.json')
        ? asset.name.replace(/\.srlbundle\.json$/i, '')
        : asset.name,
    }))
  const manifests = [...snapshotAssets, ...legacyAssets].filter((entry) =>
    isStructuredSnapshotObjectKey(entry.name),
  )
  let checkedSnapshots = 0
  if (manifests.length) {
    onProgress?.(`正在校验 ${manifests.length} 份快照及其对象定位…`)
  }
  await mapWithConcurrency(manifests, isCapacitorApp() ? 3 : 2, async (asset) => {
    try {
      const snapshot = await context.readGitHubStructuredSnapshot(config, secret, {
        id: String(asset.id),
        objectKey: asset.name,
        size: asset.size,
        createdAt: Date.parse(asset.created_at) || 0,
        kind: 'githubSnapshot',
      })
      const parts = structuredSnapshotParts(snapshot)
      const inventory = await context.readGitHubPartInventory(config, secret, parts)
      if (parts.some((part) => inventory.get(structuredPartIdentity(part))?.size !== part.size)) {
        return
      }
      backups.push({
        id: String(asset.id),
        objectKey: asset.name,
        size: [...snapshot.resources, ...snapshot.versions].reduce(
          (total, resource) => total + resource.fileSize,
          0,
        ),
        createdAt: Date.parse(asset.created_at) || Date.parse(snapshot.createdAt) || 0,
        kind: 'githubSnapshot',
        partCount: parts.length,
        archiveName: structuredSnapshotArchiveName(asset.name),
      })
    } catch (error) {
      if (isCloudRequestTimeout(error)) throw error
      // 清单损坏或对象块不完整时不暴露为可恢复备份。
    } finally {
      checkedSnapshots += 1
      onProgress?.(`正在校验云端快照 ${checkedSnapshots} / ${manifests.length}…`)
    }
  })
  return backups.sort((left, right) => right.createdAt - left.createdAt)
}

export async function readGitHubBundleManifest(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  item: CloudBackupItem,
): Promise<GitHubBundleManifest> {
  const response = await context.githubFetch(config, secret, `/releases/assets/${item.id}`, {
    headers: { Accept: 'application/octet-stream' },
  })
  return parseGitHubBundleManifest(await response.json())
}

export async function readGitHubStructuredSnapshot(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  item: CloudBackupItem,
): Promise<StructuredSnapshot> {
  const response = await context.githubFetch(config, secret, `/releases/assets/${item.id}`, {
    headers: { Accept: 'application/octet-stream' },
  })
  return decodeStructuredSnapshot(await context.readResponseBlob(response))
}

export async function createGitHubObjectReader(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
): Promise<(object: GitHubBundleManifest) => Promise<Blob>> {
  const inventories = new Map<string, Promise<Map<string, GitHubAsset>>>()
  const inventory = (container: string) => {
    let pending = inventories.get(container)
    if (!pending) {
      pending = context.getGitHubRelease(config, secret, false, container).then(async (release) => {
        if (!release) throw new Error(`GitHub 对象容器不存在：${container}`)
        return new Map(
          (await context.listGitHubAssets(config, secret, release.id)).map((asset) => [
            asset.name,
            asset,
          ]),
        )
      })
      inventories.set(container, pending)
    }
    return pending
  }
  const partCache = new Map<string, Promise<Blob>>()
  return async (object) => {
    const blobs: Blob[] = []
    for (const part of object.parts) {
      const container = structuredPartContainer(part)
      const objectKey = structuredPartObjectKey(part)
      const asset = (await inventory(container)).get(objectKey)
      const storedSize = part.storedSize ?? part.size
      if (!asset || asset.size !== storedSize)
        throw new Error(`GitHub 对象缺少分块：${container}/${objectKey}`)
      const cacheKey = `${container}\u0000${objectKey}`
      let stored = partCache.get(cacheKey)
      if (!stored) {
        // Keep at most one V3-sized part, never the entire downloaded library.
        partCache.clear()
        stored = context
          .githubFetch(config, secret, `/releases/assets/${asset.id}`, {
            headers: { Accept: 'application/octet-stream' },
          })
          .then(async (response) => {
            const blob = await context.readResponseBlob(response, storedSize)
            if (blob.size !== storedSize || (await hashCloudBlob(blob)) !== part.sha256)
              throw new Error(`GitHub 对象分块校验失败：${container}/${objectKey}`)
            return blob
          })
        if (storedSize <= 32 * 1024 * 1024) partCache.set(cacheKey, stored)
      }
      const storedBlob = await stored
      const blob = storedBlob.slice(part.offset ?? 0, (part.offset ?? 0) + part.size)
      if (blob.size !== part.size) throw new Error(`GitHub 对象分块校验失败：${part.name}`)
      blobs.push(blob)
    }
    const result = new Blob(blobs, { type: 'application/octet-stream' })
    if (result.size !== object.totalSize || (await hashCloudBlob(result)) !== object.totalSha256)
      throw new Error(`GitHub 对象完整性校验失败：${object.fileName}`)
    return result
  }
}

export async function downloadGitHubBundle(
  context: CloudBackupTransportContext,
  config: GitHubBackupConfig,
  secret: string,
  item: CloudBackupItem,
): Promise<Blob> {
  const manifest = await context.readGitHubBundleManifest(config, secret, item)
  const release = await context.getGitHubRelease(config, secret, false)
  if (!release) throw new Error('GitHub 分包所在的备份容器不存在')
  const assets = await context.listGitHubAssets(config, secret, release.id)
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const blobs: Blob[] = []
  for (const [index, part] of manifest.parts.entries()) {
    const asset = byName.get(part.name)
    if (!asset || asset.size !== part.size) throw new Error(`GitHub 备份缺少第 ${index + 1} 卷`)
    const response = await context.githubFetch(config, secret, `/releases/assets/${asset.id}`, {
      headers: { Accept: 'application/octet-stream' },
    })
    const blob = await context.readResponseBlob(response, part.size)
    if (blob.size !== part.size || (await hashCloudBlob(blob)) !== part.sha256) {
      throw new Error(`GitHub 第 ${index + 1} 卷校验失败`)
    }
    blobs.push(blob)
  }
  const restored = new Blob(blobs, { type: 'application/octet-stream' })
  if (
    restored.size !== manifest.totalSize ||
    (await hashCloudBlob(restored)) !== manifest.totalSha256
  ) {
    throw new Error('GitHub 分包合并后的完整性校验失败')
  }
  return restored
}
