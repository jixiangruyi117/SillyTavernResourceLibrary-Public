import { mapWithConcurrency } from './CloudBackupHttp'
import type { CloudBackupSnapshotOperationsContext } from './CloudBackupSnapshotOperations'
import type { CloudBackupConfig, CloudBackupItem, CloudBackupProvider } from '../types/CloudBackup'

import {
  LEGACY_RELEASE_TAG,
  normalizeFolder,
  normalizeRetention,
  structuredPartIdentity,
  structuredPartObjectKey,
} from './CloudBackupPolicy'

import {
  OBJECT_RELEASE_PREFIX,
  SNAPSHOT_RELEASE_TAG,
  type GitHubAsset,
  type GitHubRelease,
} from './CloudBackupTransportContext'

import { isStructuredSnapshotObjectKey, structuredSnapshotParts } from './CloudStructuredSnapshot'

export const ORPHAN_CHUNK_GRACE_MS = 24 * 60 * 60 * 1000

export function isVerifiedChunkObjectName(name: string): boolean {
  return /^srl-chunk--sha256-[a-f0-9]{64}$/iu.test(name)
}

export function isVerifiedChunkIdentity(provider: CloudBackupProvider, identity: string): boolean {
  const name =
    provider === 'github'
      ? (identity.split('\u0000').at(-1) ?? '')
      : (identity.split('/').at(-1) ?? '')
  return isVerifiedChunkObjectName(name)
}

export async function listRetentionBackups(
  context: CloudBackupSnapshotOperationsContext,
  config: CloudBackupConfig,
  secret: string,
): Promise<CloudBackupItem[]> {
  if (config.provider === 'github') {
    const [legacy, snapshots] = await Promise.all([
      context.getGitHubRelease(config, secret, false, LEGACY_RELEASE_TAG),
      context.getGitHubRelease(config, secret, false, SNAPSHOT_RELEASE_TAG),
    ])
    const assets = [
      ...(legacy ? await context.listGitHubAssets(config, secret, legacy.id) : []),
      ...(snapshots ? await context.listGitHubAssets(config, secret, snapshots.id) : []),
    ]
    return assets
      .flatMap((asset): CloudBackupItem[] => {
        const createdAt = Date.parse(asset.created_at) || 0
        if (isStructuredSnapshotObjectKey(asset.name))
          return [
            {
              id: String(asset.id),
              objectKey: asset.name,
              size: asset.size,
              createdAt,
              kind: 'githubSnapshot',
            },
          ]
        if (asset.name.endsWith('.srlbundle.json'))
          return [
            {
              id: String(asset.id),
              objectKey: asset.name,
              size: asset.size,
              createdAt,
              kind: 'githubBundle',
            },
          ]
        return /\.zip$/iu.test(asset.name)
          ? [
              {
                id: String(asset.id),
                objectKey: asset.name,
                size: asset.size,
                createdAt,
                kind: 'single',
              },
            ]
          : []
      })
      .sort((left, right) => right.createdAt - left.createdAt)
  }
  return (await context.listWebDavRetentionObjects(config, secret))
    .flatMap((object): CloudBackupItem[] => {
      if (isStructuredSnapshotObjectKey(object.objectKey))
        return [
          {
            id: object.objectKey,
            objectKey: object.objectKey,
            size: object.size,
            createdAt: object.createdAt,
            kind: 'webdavSnapshot',
          },
        ]
      if (object.objectKey.endsWith('.srlbundle.json'))
        return [
          {
            id: object.objectKey,
            objectKey: object.objectKey,
            size: object.size,
            createdAt: object.createdAt,
            kind: 'webdavBundle',
          },
        ]
      return /\.zip$/iu.test(object.objectKey)
        ? [{ ...object, id: object.objectKey, kind: 'single', archiveName: object.objectKey }]
        : []
    })
    .sort((left, right) => right.createdAt - left.createdAt)
}

export async function referencedPartIdentities(
  context: CloudBackupSnapshotOperationsContext,
  config: CloudBackupConfig,
  secret: string,
  backups: CloudBackupItem[],
  cached?: { objectKey: string; snapshot: import('./CloudStructuredSnapshot').StructuredSnapshot },
): Promise<Set<string>> {
  const referenced = new Set<string>()
  await mapWithConcurrency(backups, 3, async (item) => {
    if (item.kind === 'githubSnapshot' || item.kind === 'webdavSnapshot') {
      const snapshot =
        cached?.objectKey === item.objectKey
          ? cached.snapshot
          : config.provider === 'github'
            ? await context.readGitHubStructuredSnapshot(config, secret, item)
            : await context.readWebDavStructuredSnapshot(config, secret, item.objectKey)
      for (const part of structuredSnapshotParts(snapshot))
        referenced.add(
          config.provider === 'github'
            ? structuredPartIdentity(part)
            : structuredPartObjectKey(part),
        )
    } else if (item.kind === 'githubBundle' || item.kind === 'webdavBundle') {
      const manifest =
        config.provider === 'github'
          ? await context.readGitHubBundleManifest(config, secret, item)
          : await context.readWebDavBundleManifest(config, secret, item.objectKey)
      for (const part of manifest.parts)
        referenced.add(
          config.provider === 'github' ? `${LEGACY_RELEASE_TAG}\u0000${part.name}` : part.name,
        )
    }
  })
  return referenced
}

export async function prune(
  context: CloudBackupSnapshotOperationsContext,
  config: CloudBackupConfig,
  secret: string,
  protectedObjectKey?: string,
  deep = false,
  committedSnapshot?: import('./CloudStructuredSnapshot').StructuredSnapshot,
): Promise<number> {
  const backups = await context.listRetentionBackups(config, secret)
  const normalKept = backups.slice(0, normalizeRetention(config.retention))
  const protectedItem = protectedObjectKey
    ? backups.find((item) => item.objectKey === protectedObjectKey)
    : undefined
  const kept =
    protectedItem && !normalKept.some((item) => item.id === protectedItem.id)
      ? [...normalKept, protectedItem]
      : normalKept
  const keptIds = new Set(kept.map((item) => item.id))
  const removed = backups.filter((item) => !keptIds.has(item.id))

  const orphanScope =
    config.provider === 'github'
      ? `github:${config.owner}/${config.repository}`
      : `webdav:${config.baseUrl.replace(/\/+$/u, '')}/${normalizeFolder(config.folder)}`
  const pending = await context.transportState.jobStore.pendingOrphans(orphanScope)
  if (!deep && !removed.length && !pending.length) return 0
  const cached =
    protectedObjectKey && committedSnapshot
      ? { objectKey: protectedObjectKey, snapshot: committedSnapshot }
      : undefined

  // Only retained and about-to-expire manifests are read during normal automatic maintenance.
  // A malformed one aborts before its snapshot can be deleted.
  const [keptParts, retiredParts] = await Promise.all([
    referencedPartIdentities(context, config, secret, kept, cached),
    referencedPartIdentities(context, config, secret, removed, cached),
  ])

  // 先让超出 retention 的清单退出可见快照集合；只要任一清单删除失败，
  // 本轮就不会继续回收内容对象，避免留下“仍可见但缺对象”的旧快照。
  for (const item of removed) {
    if (config.provider === 'github') {
      await context.githubFetch(config, secret, `/releases/assets/${item.id}`, { method: 'DELETE' })
    } else {
      await context.deleteWebDavObject(config, secret, item.objectKey)
    }
  }

  const now = Date.now()
  const candidates = new Set(
    [...pending, ...retiredParts].filter(
      (part) => !keptParts.has(part) && isVerifiedChunkIdentity(config.provider, part),
    ),
  )

  if (deep && config.provider === 'github') {
    const containers: Array<{ tag: string; release: GitHubRelease }> = []
    const legacy = await context.getGitHubRelease(config, secret, false, LEGACY_RELEASE_TAG)
    if (legacy) containers.push({ tag: LEGACY_RELEASE_TAG, release: legacy })
    for (let index = 1; index <= 10_000; index += 1) {
      const tag = `${OBJECT_RELEASE_PREFIX}${String(index).padStart(4, '0')}`
      const release = await context.getGitHubRelease(config, secret, false, tag)
      if (!release) break
      containers.push({ tag, release })
    }
    const orphanAssets = new Map<string, GitHubAsset>()
    for (const container of containers) {
      for (const asset of await context.listGitHubAssets(config, secret, container.release.id)) {
        const identity = `${container.tag}\u0000${asset.name}`
        if (isVerifiedChunkObjectName(asset.name) && !keptParts.has(identity))
          candidates.add(identity)
      }
    }
    const eligible = await context.transportState.jobStore.eligibleOrphans(
      orphanScope,
      candidates,
      now,
      ORPHAN_CHUNK_GRACE_MS,
    )
    for (const identity of eligible) {
      const asset = orphanAssets.get(identity)
      if (!asset) continue
      await context.githubFetch(config, secret, `/releases/assets/${asset.id}`, {
        method: 'DELETE',
      })
      await context.transportState.jobStore.clearOrphan(orphanScope, identity)
    }
    return removed.length
  }

  if (config.provider === 'github') {
    const eligible = await context.transportState.jobStore.eligibleOrphans(
      orphanScope,
      candidates,
      now,
      ORPHAN_CHUNK_GRACE_MS,
    )
    const assetsByIdentity = new Map<string, GitHubAsset>()
    for (const container of new Set(eligible.map((identity) => identity.split('\u0000', 1)[0]!))) {
      const release = await context.getGitHubRelease(config, secret, false, container)
      if (!release) continue
      for (const asset of await context.listGitHubAssets(config, secret, release.id))
        assetsByIdentity.set(`${container}\u0000${asset.name}`, asset)
    }
    for (const identity of eligible) {
      const asset = assetsByIdentity.get(identity)
      if (asset)
        await context.githubFetch(config, secret, `/releases/assets/${asset.id}`, {
          method: 'DELETE',
        })
      await context.transportState.jobStore.clearOrphan(orphanScope, identity)
    }
    return removed.length
  }

  if (deep) {
    for (const object of await context.listWebDavObjects(config, secret)) {
      const leaf = object.objectKey.split('/').at(-1) ?? ''
      if (isVerifiedChunkObjectName(leaf) && !keptParts.has(object.objectKey))
        candidates.add(object.objectKey)
    }
  }
  const eligible = await context.transportState.jobStore.eligibleOrphans(
    orphanScope,
    candidates,
    now,
    ORPHAN_CHUNK_GRACE_MS,
  )
  for (const objectKey of eligible) {
    await context.deleteWebDavObject(config, secret, objectKey)
    await context.transportState.jobStore.clearOrphan(orphanScope, objectKey)
  }
  return removed.length
}
