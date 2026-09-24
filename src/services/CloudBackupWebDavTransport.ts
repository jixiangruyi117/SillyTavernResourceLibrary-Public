import type { CloudBackupItem, WebDavBackupConfig } from '../types/CloudBackup'
import { hashCloudBlob } from './CloudArchiveCodec'
import { parseGitHubBundleManifest, type GitHubBundleManifest } from './GitHubBackupBundle'
import {
  decodeStructuredSnapshot,
  encodeStructuredSnapshot,
  isStructuredSnapshotObjectKey,
  structuredSnapshotArchiveName,
  structuredSnapshotName,
  structuredSnapshotParts,
  type CreatedStructuredSnapshot,
  type StructuredSnapshot,
} from './CloudStructuredSnapshot'
import {
  canUseNativeStructuredSnapshotHandoff,
  isNativeCloudTransferAvailable,
  uploadNativeStructuredSnapshot,
} from './NativeCloudTransfer'
import {
  normalizeFolder,
  joinUrl,
  basicAuthorization,
  structuredPartObjectKey,
} from './CloudBackupPolicy'
import {
  readCloudResponseText,
  isCloudRequestTimeout,
  mapWithConcurrency,
  cloudHttpError,
} from './CloudBackupHttp'
import {
  type CloudBackupTransportContext,
  type WebDavObject,
  type WebDavVerifyMethod,
  type CloudBackupProgressCallback,
} from './CloudBackupTransportContext'

export async function ensureWebDavFolder(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
): Promise<void> {
  for (const folder of [
    normalizeFolder(config.folder),
    `${normalizeFolder(config.folder)}/objects`,
    `${normalizeFolder(config.folder)}/snapshots`,
  ]) {
    const response = await context.cloudFetch(
      joinUrl(config.baseUrl, folder),
      {
        method: 'MKCOL',
        headers: { Authorization: basicAuthorization(config.username, secret) },
      },
      'webdav',
    )
    if (!response.ok && response.status !== 405) {
      throw cloudHttpError(`WebDAV 无法创建备份文件夹（${response.status}）`, response.status)
    }
  }
}

export async function uploadWebDavStructuredBackup(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  snapshot: CreatedStructuredSnapshot,
  onProgress?: CloudBackupProgressCallback,
  respectAutomaticConstraints = false,
): Promise<CloudBackupItem> {
  await context.ensureWebDavFolder(config, secret)
  const existing = new Map(
    (await context.listWebDavObjects(config, secret)).map((item) => [item.objectKey, item]),
  )
  for (const resource of [...snapshot.snapshot.resources, ...snapshot.snapshot.versions]) {
    for (const part of resource.object.parts) {
      part.storage = {
        kind: 'koofr-path',
        container: 'objects',
        objectKey: `objects/${part.name}`,
      }
    }
  }
  for (const plan of snapshot.objectPlans) {
    const name = plan.name
    const present = existing.get(`objects/${name}`)
    if (present && present.size !== plan.size) {
      throw new Error(`Koofr 内容寻址对象 ${name} 的远端大小冲突；拒绝覆盖 immutable 对象`)
    }
  }
  const jobs = snapshot.objectPlans.filter((plan) => !existing.has(`objects/${plan.name}`))
  onProgress?.(
    `Koofr 对象级快照复用 ${snapshot.objectPlans.length - jobs.length} 个块；上传 ${jobs.length} 个变更块…`,
  )
  if (isNativeCloudTransferAvailable()) {
    const manifestBlob = await encodeStructuredSnapshot(snapshot.snapshot)
    const name = structuredSnapshotName()
    const nativeObjects = jobs.map((plan) => ({
      name: `objects/${plan.name}`,
      blob: plan.blob,
      size: plan.size,
      contentType: 'application/octet-stream',
      nativeSource: snapshot.nativeSources.get(plan.name),
    }))
    const nativeManifest = {
      name: `snapshots/${name}`,
      blob: manifestBlob,
      size: manifestBlob.size,
      contentType: 'application/gzip',
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
      context.activeWebDavInventory = undefined
      return {
        id: result.id,
        objectKey: result.name,
        size: snapshot.totalSize,
        createdAt: Date.now(),
        kind: 'webdavSnapshot',
        partCount: snapshot.partCount,
        archiveName: structuredSnapshotArchiveName(result.name.split('/').at(-1) ?? result.name),
      }
    }
    throw new Error('Android 原生对象来源不完整；已阻止 Koofr 云对象退回 JS Blob 网络')
  }
  const planHash = await hashCloudBlob(
    new Blob([
      JSON.stringify(
        snapshot.objectPlans
          .map((plan) => [`objects/${plan.name}`, plan.size])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      ),
    ]),
  )
  const objectKeys = snapshot.objectPlans.map((plan) => `objects/${plan.name}`)
  const planByName = new Map(snapshot.objectPlans.map((plan) => [plan.name, plan]))
  const webJob = await context.jobStore.begin('webdav', planHash, objectKeys)
  for (const objectKey of objectKeys) {
    const present = existing.get(objectKey)
    const name = objectKey.slice('objects/'.length)
    if (present?.size === planByName.get(name)?.size) {
      await context.jobStore.markObject(webJob, objectKey, 'verified')
    }
  }
  let completedJobs = 0
  try {
    await mapWithConcurrency(jobs, 2, async (plan) => {
      const name = plan.name
      const blob = await context.materializeCloudObject(plan)
      const objectKey = `objects/${name}`
      let lastError: Error | undefined
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (attempt > 1) context.activeMetrics?.add('retryCount', 1)
        try {
          await context.uploadWebDavObject(
            config,
            secret,
            objectKey,
            blob,
            'application/octet-stream',
          )
          lastError = undefined
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Koofr 对象块上传失败')
          if (attempt < 3) {
            await new Promise<void>((resolve) => setTimeout(resolve, attempt * 800))
          }
        }
      }
      if (lastError) {
        await context.jobStore.markObject(webJob, objectKey, 'failed')
        throw new Error(`${lastError.message}；未提交对象快照清单`)
      }
      await context.jobStore.markObject(webJob, objectKey, 'verified')
      completedJobs += 1
      onProgress?.(`Koofr 变更块已完成 ${completedJobs} / ${jobs.length}…`)
    })
  } catch (error) {
    await context.jobStore.fail(webJob, error)
    throw error
  }
  try {
    onProgress?.('Koofr 对象块已完成，正在压缩快照清单…')
    const manifestBlob = await encodeStructuredSnapshot(snapshot.snapshot)
    const name = structuredSnapshotName()
    onProgress?.(
      `Koofr 快照清单已压缩为 ${(manifestBlob.size / 1024).toFixed(1)} KiB，正在最后提交…`,
    )
    const manifestKey = `snapshots/${name}`
    await context.uploadWebDavObject(
      config,
      secret,
      manifestKey,
      manifestBlob,
      'application/gzip',
      () => onProgress?.('Koofr 快照清单已写入，正在通过 1 字节范围读取确认远端大小…'),
    )
    await context.jobStore.complete(webJob, manifestKey)
    return {
      id: manifestKey,
      objectKey: manifestKey,
      size: snapshot.totalSize,
      createdAt: Date.now(),
      kind: 'webdavSnapshot',
      partCount: snapshot.partCount,
      archiveName: structuredSnapshotArchiveName(name),
    }
  } catch (error) {
    await context.jobStore.fail(webJob, error)
    throw error
  }
}

export async function uploadWebDavObject(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  objectKey: string,
  blob: Blob,
  contentType = 'application/octet-stream',
  onUploaded?: () => void,
): Promise<void> {
  const objectUrl = joinUrl(config.baseUrl, normalizeFolder(config.folder), objectKey)
  const authorization = basicAuthorization(config.username, secret)
  const response = await context.cloudFetch(
    objectUrl,
    {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
      },
      body: blob,
    },
    'webdav',
  )
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error(
        `WebDAV 服务器拒绝了这次上传（413）：单卷 ${(blob.size / 1024 / 1024).toFixed(1)} MiB 超过了服务商或中间反向代理允许的请求体积。若走本站同源中转，请把服务器 Nginx 的 client_max_body_size 调整为 128m；若为自建 WebDAV，请放宽其上传上限。`,
      )
    }
    throw cloudHttpError(`WebDAV 上传失败（${response.status}）`, response.status)
  }
  onUploaded?.()
  const verifyStarted = typeof performance === 'undefined' ? Date.now() : performance.now()
  try {
    const remoteSize = await context.readWebDavRemoteSize(config, secret, objectUrl)
    await context.verifyWebDavUploadSize(config, secret, objectUrl, blob.size, remoteSize)
    context.activeWebDavInventory?.objects.set(objectKey, {
      objectKey,
      size: blob.size,
      createdAt: Date.now(),
    })
  } finally {
    const verifyFinished = typeof performance === 'undefined' ? Date.now() : performance.now()
    context.activeMetrics?.add('verifyMs', verifyFinished - verifyStarted)
  }
}

export async function readWebDavRemoteSize(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  objectUrl: string,
): Promise<number> {
  const authorization = basicAuthorization(config.username, secret)
  const capabilityKey = `${config.baseUrl.replace(/\/+$/u, '')}|${config.username}`
  const readWith = async (method: WebDavVerifyMethod): Promise<number | undefined> => {
    if (method === 'range') {
      const response = await context.cloudFetch(
        objectUrl,
        { headers: { Authorization: authorization, Range: 'bytes=0-0' } },
        'webdav',
      )
      const size = Number(
        /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? Number.NaN,
      )
      await response.body?.cancel().catch(() => undefined)
      return response.status === 206 && Number.isSafeInteger(size) && size >= 0 ? size : undefined
    }
    if (method === 'head') {
      const response = await context.cloudFetch(
        objectUrl,
        { method: 'HEAD', headers: { Authorization: authorization } },
        'webdav',
      )
      const size = Number(response.headers.get('content-length') ?? Number.NaN)
      return response.ok && Number.isSafeInteger(size) && size >= 0 ? size : undefined
    }
    const response = await context.cloudFetch(
      objectUrl,
      { method: 'PROPFIND', headers: { Authorization: authorization, Depth: '0' } },
      'webdav',
    )
    if (!response.ok && response.status !== 207) return undefined
    const document = new DOMParser().parseFromString(
      await readCloudResponseText(response),
      'application/xml',
    )
    const size = Number(
      document.getElementsByTagNameNS('*', 'getcontentlength')[0]?.textContent ?? -1,
    )
    return Number.isSafeInteger(size) && size >= 0 ? size : undefined
  }

  const cached = context.webDavCapabilities.get(capabilityKey)
  if (cached) {
    const size = await readWith(cached.verifyMethod)
    if (size !== undefined) return size
    context.webDavCapabilities.delete(capabilityKey)
  }
  for (const method of ['range', 'head', 'propfind'] as const) {
    const size = await readWith(method)
    if (size === undefined) continue
    context.webDavCapabilities.set(capabilityKey, { verifyMethod: method, probedAt: Date.now() })
    return size
  }
  throw new Error('WebDAV 上传完成，但服务端没有提供可用的大小确认方式；旧备份未清理')
}

export async function verifyWebDavUploadSize(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  objectUrl: string,
  expectedSize: number,
  remoteSize: number,
): Promise<void> {
  if (remoteSize !== expectedSize) {
    await context.cloudFetch(
      objectUrl,
      {
        method: 'DELETE',
        headers: { Authorization: basicAuthorization(config.username, secret) },
      },
      'webdav',
    )
    throw new Error('WebDAV 上传后的文件大小不一致，已删除不完整文件；旧备份没有受到影响')
  }
}

export async function listWebDavObjects(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  directories: readonly string[] = ['', 'objects', 'snapshots'],
): Promise<WebDavObject[]> {
  const inventoryKey = `${config.baseUrl.replace(/\/+$/u, '')}|${config.username}|${normalizeFolder(config.folder)}`
  if (context.activeWebDavInventory?.key === inventoryKey) {
    return [...context.activeWebDavInventory.objects.values()]
  }
  const objects: WebDavObject[] = []
  for (const directory of directories) {
    const response = await context.cloudFetch(
      joinUrl(config.baseUrl, normalizeFolder(config.folder), directory),
      {
        method: 'PROPFIND',
        headers: { Authorization: basicAuthorization(config.username, secret), Depth: '1' },
      },
      'webdav',
    )
    if (response.status === 404 && directory) continue
    if (!response.ok && response.status !== 207) {
      throw cloudHttpError(`WebDAV 列表读取失败（${response.status}）`, response.status)
    }
    const document = new DOMParser().parseFromString(
      await readCloudResponseText(response),
      'application/xml',
    )
    for (const entry of Array.from(document.getElementsByTagNameNS('*', 'response'))) {
      const href = entry.getElementsByTagNameNS('*', 'href')[0]?.textContent ?? ''
      const name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '')
      if (!name || name === directory || (!directory && ['objects', 'snapshots'].includes(name)))
        continue
      const size = Number(
        entry.getElementsByTagNameNS('*', 'getcontentlength')[0]?.textContent ?? 0,
      )
      const modified = entry.getElementsByTagNameNS('*', 'getlastmodified')[0]?.textContent ?? ''
      objects.push({
        objectKey: directory ? `${directory}/${name}` : name,
        size,
        createdAt: Date.parse(modified) || 0,
      })
    }
  }
  if (context.activeMetrics && directories.length === 3) {
    context.activeWebDavInventory = {
      key: inventoryKey,
      objects: new Map(objects.map((object) => [object.objectKey, object])),
    }
  }
  return objects
}

export async function listWebDav(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  onProgress?: CloudBackupProgressCallback,
): Promise<CloudBackupItem[]> {
  onProgress?.('正在读取 Koofr 远端对象索引…')
  const objects = await context.listWebDavObjects(config, secret)
  const objectByName = new Map(objects.map((object) => [object.objectKey, object]))
  const backups: CloudBackupItem[] = objects
    .filter((item) => /\.zip$/i.test(item.objectKey))
    .map((item) => ({
      id: item.objectKey,
      objectKey: item.objectKey,
      size: item.size,
      createdAt: item.createdAt,
      kind: 'single',
      archiveName: item.objectKey,
    }))
  for (const item of objects.filter((entry) => entry.objectKey.endsWith('.srlbundle.json'))) {
    try {
      const manifest = await context.readWebDavBundleManifest(config, secret, item.objectKey)
      backups.push({
        id: item.objectKey,
        objectKey: item.objectKey,
        size: manifest.totalSize,
        createdAt: item.createdAt || Date.parse(manifest.createdAt) || 0,
        kind: 'webdavBundle',
        partCount: manifest.parts.length,
        archiveName: manifest.fileName,
      })
    } catch {
      // A missing or invalid manifest is never exposed as a restorable backup.
    }
  }
  const snapshotObjects = objects.filter((entry) => isStructuredSnapshotObjectKey(entry.objectKey))
  let checkedSnapshots = 0
  if (snapshotObjects.length) {
    onProgress?.(`已读取 ${objects.length} 个远端对象，正在校验 ${snapshotObjects.length} 份快照…`)
  }
  await mapWithConcurrency(snapshotObjects, 2, async (item) => {
    try {
      const snapshot = await context.readWebDavStructuredSnapshot(config, secret, item.objectKey)
      const parts = structuredSnapshotParts(snapshot)
      if (
        parts.some((part) => objectByName.get(structuredPartObjectKey(part))?.size !== part.size)
      ) {
        return
      }
      backups.push({
        id: item.objectKey,
        objectKey: item.objectKey,
        size: [...snapshot.resources, ...snapshot.versions].reduce(
          (total, resource) => total + resource.fileSize,
          0,
        ),
        createdAt: item.createdAt || Date.parse(snapshot.createdAt) || 0,
        kind: 'webdavSnapshot',
        partCount: parts.length,
        archiveName: structuredSnapshotArchiveName(item.objectKey),
      })
    } catch (error) {
      if (isCloudRequestTimeout(error)) throw error
      // Invalid or incomplete snapshots are never exposed as restorable backups.
    } finally {
      checkedSnapshots += 1
      onProgress?.(`正在校验云端快照 ${checkedSnapshots} / ${snapshotObjects.length}…`)
    }
  })
  return backups.sort((left, right) => right.createdAt - left.createdAt)
}

export async function readWebDavBundleManifest(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  objectKey: string,
): Promise<GitHubBundleManifest> {
  const response = await context.cloudFetch(
    joinUrl(config.baseUrl, normalizeFolder(config.folder), objectKey),
    { headers: { Authorization: basicAuthorization(config.username, secret) } },
    'webdav',
  )
  if (!response.ok) {
    throw cloudHttpError(`WebDAV 分包清单读取失败（${response.status}）`, response.status)
  }
  return parseGitHubBundleManifest(await response.json())
}

export async function readWebDavStructuredSnapshot(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  objectKey: string,
): Promise<StructuredSnapshot> {
  const response = await context.cloudFetch(
    joinUrl(config.baseUrl, normalizeFolder(config.folder), objectKey),
    { headers: { Authorization: basicAuthorization(config.username, secret) } },
    'webdav',
  )
  if (!response.ok) {
    throw cloudHttpError(`Koofr 对象快照清单读取失败（${response.status}）`, response.status)
  }
  return decodeStructuredSnapshot(await context.readResponseBlob(response))
}

export function createWebDavObjectReader(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
): (object: GitHubBundleManifest) => Promise<Blob> {
  const partCache = new Map<string, Promise<Blob>>()
  return async (object) => {
    const blobs: Blob[] = []
    for (const part of object.parts) {
      const storedSize = part.storedSize ?? part.size
      const objectKey = structuredPartObjectKey(part)
      let stored = partCache.get(objectKey)
      if (!stored) {
        // Keep at most one V3-sized part, never the entire downloaded library.
        partCache.clear()
        stored = context
          .cloudFetch(
            joinUrl(config.baseUrl, normalizeFolder(config.folder), objectKey),
            { headers: { Authorization: basicAuthorization(config.username, secret) } },
            'webdav',
          )
          .then(async (response) => {
            if (!response.ok) throw new Error(`Koofr 对象缺少分块：${objectKey}`)
            const blob = await context.readResponseBlob(response)
            if (blob.size !== storedSize || (await hashCloudBlob(blob)) !== part.sha256)
              throw new Error(`Koofr 对象分块校验失败：${objectKey}`)
            return blob
          })
        if (storedSize <= 32 * 1024 * 1024) partCache.set(objectKey, stored)
      }
      const storedBlob = await stored
      const blob = storedBlob.slice(part.offset ?? 0, (part.offset ?? 0) + part.size)
      if (blob.size !== part.size) throw new Error(`Koofr 对象分块校验失败：${part.name}`)
      blobs.push(blob)
    }
    const result = new Blob(blobs, { type: 'application/octet-stream' })
    if (result.size !== object.totalSize || (await hashCloudBlob(result)) !== object.totalSha256)
      throw new Error(`Koofr 对象完整性校验失败：${object.fileName}`)
    return result
  }
}

export async function downloadWebDavBundle(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  item: CloudBackupItem,
): Promise<Blob> {
  const manifest = await context.readWebDavBundleManifest(config, secret, item.objectKey)
  const blobs: Blob[] = []
  for (const [index, part] of manifest.parts.entries()) {
    const response = await context.cloudFetch(
      joinUrl(config.baseUrl, normalizeFolder(config.folder), part.name),
      { headers: { Authorization: basicAuthorization(config.username, secret) } },
      'webdav',
    )
    if (!response.ok) throw new Error(`Koofr 备份缺少第 ${index + 1} 卷`)
    const partBlob = await context.readResponseBlob(response, part.size)
    if (partBlob.size !== part.size || (await hashCloudBlob(partBlob)) !== part.sha256) {
      throw new Error(`Koofr 第 ${index + 1} 卷校验失败`)
    }
    blobs.push(partBlob)
  }
  const restored = new Blob(blobs, { type: 'application/octet-stream' })
  if (
    restored.size !== manifest.totalSize ||
    (await hashCloudBlob(restored)) !== manifest.totalSha256
  ) {
    throw new Error('Koofr 分包合并后的完整性校验失败')
  }
  return restored
}

export async function deleteWebDavObject(
  context: CloudBackupTransportContext,
  config: WebDavBackupConfig,
  secret: string,
  objectKey: string,
): Promise<void> {
  const response = await context.cloudFetch(
    joinUrl(config.baseUrl, normalizeFolder(config.folder), objectKey),
    {
      method: 'DELETE',
      headers: { Authorization: basicAuthorization(config.username, secret) },
    },
    'webdav',
  )
  if (!response.ok && response.status !== 404) {
    throw cloudHttpError(`WebDAV 删除远端文件失败（${response.status}）`, response.status)
  }
  context.activeWebDavInventory?.objects.delete(objectKey)
}
