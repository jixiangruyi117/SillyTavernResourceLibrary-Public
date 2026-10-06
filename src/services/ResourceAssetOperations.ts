import type { ResourceParserRegistry } from '../parser/ResourceParser'
import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import { getRelatedResourceIds, RESOURCE_TYPE, type Resource } from '../types/Resource'
import type { CharacterAssetExtractionReport } from '../types/ResourceOperations'
import { normalizeTags } from './ResourceLinkImport'
import { collectEmbeddedAssets } from './ResourceEmbeddedAssets'
import { hashFile } from './HashService'

export class ResourceAssetOperations {
  private readonly storage: ResourceStorageAdapter
  private readonly parserRegistry: ResourceParserRegistry

  constructor(storage: ResourceStorageAdapter, parserRegistry: ResourceParserRegistry) {
    this.storage = storage
    this.parserRegistry = parserRegistry
  }

  async extractEmbeddedAssets(
    source: Resource,
  ): Promise<{ resource: Resource; created: Resource[]; assetCount: number }> {
    const candidates = await collectEmbeddedAssets(source)
    if (!candidates.length) return { resource: source, created: [], assetCount: 0 }

    const now = Date.now()
    const created: Resource[] = []
    const related = new Map<string, Resource>()

    for (const candidate of candidates) {
      const contentHash = await hashFile(candidate.file)
      const duplicate = await this.storage.findByHash(contentHash)
      if (duplicate) {
        related.set(duplicate.id, {
          ...duplicate,
          relatedResourceIds: Array.from(new Set([...getRelatedResourceIds(duplicate), source.id])),
          updatedAt: now,
        })
        continue
      }

      const parsed = await this.parserRegistry.parse(candidate.file)
      const resource: Resource = {
        id: crypto.randomUUID(),
        ...parsed,
        type: candidate.type,
        fileName: candidate.file.name,
        mimeType: 'application/json',
        fileSize: candidate.file.size,
        contentHash,
        favorite: false,
        categoryId: null,
        categoryIds: [],
        relatedResourceIds: [source.id],
        tags: normalizeTags([
          ...(parsed.tags ?? []),
          source.type === RESOURCE_TYPE.PRESET ? '预设配套' : '角色卡配套',
        ]),
        metadata: {
          ...parsed.metadata,
          extractedFromResourceId: source.id,
          extractedFromResourceName: source.name,
          extractedFromResourceType: source.type,
          ...(source.type === RESOURCE_TYPE.CHARACTER_CARD
            ? {
                extractedFromCharacterId: source.id,
                extractedFromCharacterName: source.name,
                regexScope: candidate.kind === 'regex' ? 'character' : undefined,
              }
            : {
                extractedFromPresetId: source.id,
                extractedFromPresetName: source.name,
                regexScope: candidate.kind === 'regex' ? 'preset' : undefined,
              }),
          sourceName: source.name,
          extractedAssetKind: candidate.kind,
        },
        originalBlob: candidate.file,
        createdAt: now,
        updatedAt: now,
      }
      created.push(resource)
      related.set(resource.id, resource)
    }

    const updatedSource: Resource = {
      ...source,
      relatedResourceIds: Array.from(
        new Set([...getRelatedResourceIds(source), ...related.keys()]),
      ),
      updatedAt: now,
    }
    await this.storage.saveMany([updatedSource, ...related.values()])
    return { resource: updatedSource, created, assetCount: candidates.length }
  }

  async extractMany(ids: string[]): Promise<CharacterAssetExtractionReport> {
    const uniqueIds = Array.from(new Set(ids))
    let characterCount = 0
    let presetCount = 0
    let assetCount = 0
    let createdCount = 0

    for (const id of uniqueIds) {
      const resource = await this.storage.get(id)
      if (
        !resource ||
        (resource.type !== RESOURCE_TYPE.CHARACTER_CARD && resource.type !== RESOURCE_TYPE.PRESET)
      )
        continue
      if (resource.type === RESOURCE_TYPE.CHARACTER_CARD) characterCount += 1
      else presetCount += 1
      const extracted = await this.extractEmbeddedAssets(resource)
      assetCount += extracted.assetCount
      createdCount += extracted.created.length
    }

    return {
      selectedCount: uniqueIds.length,
      characterCount,
      presetCount,
      assetCount,
      createdCount,
    }
  }
}
