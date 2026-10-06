import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import { RESOURCE_TYPE, type Resource, type ResourceSummary } from '../types/Resource'
import { hashFile } from './HashService'

export class ResourceRecognizedFileHashes {
  private readonly storage: ResourceStorageAdapter
  private index?: Map<string, ResourceSummary>
  private indexLoad?: Promise<Map<string, ResourceSummary>>

  constructor(storage: ResourceStorageAdapter) {
    this.storage = storage
  }

  invalidate(): void {
    this.index = undefined
  }

  async findCharacterCardByContentHash(hash: string) {
    const active = await this.storage.findByHash(hash)
    if (active?.type === RESOURCE_TYPE.CHARACTER_CARD) {
      return {
        resource: active,
        matchedHistorical: false,
        matchedFileName: active.fileName,
        matchedBy: 'file' as const,
      }
    }

    const historical = await this.storage.findVersionByHash(hash)
    if (historical?.type === RESOURCE_TYPE.CHARACTER_CARD) {
      return {
        resource: historical.versionGroupId
          ? ((await this.storage.get(historical.versionGroupId)) ?? historical)
          : historical,
        matchedHistorical: Boolean(historical.versionGroupId),
        matchedFileName: historical.fileName,
        matchedBy: 'file' as const,
      }
    }

    const historicalAlias = (await this.getIndex()).get(hash.toLowerCase())
    if (!historicalAlias) return undefined
    const resource = historicalAlias.versionGroupId
      ? ((await this.storage.get(historicalAlias.versionGroupId)) ??
        (await this.storage.getVersion?.(historicalAlias.id)))
      : await this.storage.get(historicalAlias.id)
    return resource
      ? {
          resource,
          matchedHistorical: Boolean(historicalAlias.versionGroupId),
          matchedFileName: historicalAlias.fileName,
          matchedBy: 'recognized-hash' as const,
        }
      : undefined
  }

  async remember(
    file: File,
    matchedResource: ResourceSummary,
    historical: boolean,
  ): Promise<string> {
    const hash = (await hashFile(file)).toLowerCase()
    if (!/^[a-f\d]{64}$/u.test(hash)) throw new Error('导入文件的 SHA-256 校验值无效')
    const resource = historical
      ? await this.storage.getVersion?.(matchedResource.id)
      : await this.storage.get(matchedResource.id)
    if (!resource) throw new Error('用于记忆重复文件的资源已经不存在')
    const known = Array.isArray(resource.metadata.recognizedFileHashes)
      ? resource.metadata.recognizedFileHashes.filter(
          (item): item is string => typeof item === 'string' && /^[a-f\d]{64}$/iu.test(item),
        )
      : []
    if (hash !== resource.contentHash.toLowerCase() && !known.includes(hash)) {
      const metadata = { ...resource.metadata, recognizedFileHashes: [...known, hash] }
      if (historical) await this.storage.updateVersion(resource.id, { metadata })
      else await this.storage.update(resource.id, { metadata })
      this.index?.set(hash, { ...matchedResource, metadata })
    }
    return hash
  }

  private async getIndex(
    knownResources?: ResourceSummary[],
    knownVersions?: ResourceSummary[],
  ): Promise<Map<string, ResourceSummary>> {
    if (this.index) return this.index
    if (!this.indexLoad) {
      this.indexLoad = (async () => {
        const [resources, versions] =
          knownResources && knownVersions
            ? [knownResources, knownVersions]
            : await Promise.all([this.storage.listSummaries(), this.storage.listVersionSummaries()])
        const index = new Map<string, ResourceSummary>()
        for (const resource of [...resources, ...versions]) {
          if (resource.type !== RESOURCE_TYPE.CHARACTER_CARD) continue
          const hashes = resource.metadata.recognizedFileHashes
          if (!Array.isArray(hashes)) continue
          for (const hash of hashes) {
            if (typeof hash === 'string' && /^[a-f\d]{64}$/iu.test(hash)) {
              index.set(hash.toLowerCase(), resource)
            }
          }
        }
        this.index = index
        return index
      })()
    }
    try {
      return await this.indexLoad
    } finally {
      this.indexLoad = undefined
    }
  }
}

export type RecognizedCharacterCardMatch = {
  resource: Resource
  matchedHistorical: boolean
  matchedFileName: string
  matchedBy: 'file' | 'recognized-hash'
}
