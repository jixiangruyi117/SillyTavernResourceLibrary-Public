import { describe, expect, it, vi } from 'vitest'

import { JsonResourceParser } from '../parser/JsonResourceParser'
import { PngResourceParser } from '../parser/PngResourceParser'
import { ResourceParserRegistry } from '../parser/ResourceParser'
import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import type { ParsedResource } from '../types/Import'
import {
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TYPE,
  RESOURCE_TYPE,
  toResourceSummary,
  type Resource,
  type ResourceSummary,
} from '../types/Resource'
import { ResourceService } from './ResourceService'
import { GreetingResourceService } from './GreetingResourceService'
import type { GitHubResourceInspection, GitHubResourceInspector } from './GitHubResourceInspector'
import { UserPersonaService } from './UserPersonaService'

class MemoryResourceStorage implements ResourceStorageAdapter {
  private readonly resources = new Map<string, Resource>()
  private readonly versions = new Map<string, Resource>()

  async list(): Promise<Resource[]> {
    return Array.from(this.resources.values())
  }

  async listSummaries(): Promise<ResourceSummary[]> {
    return Array.from(this.resources.values(), toResourceSummary)
  }

  async get(id: string): Promise<Resource | undefined> {
    return this.resources.get(id)
  }

  async getVersion(id: string): Promise<Resource | undefined> {
    return this.versions.get(id)
  }

  async findByHash(contentHash: string): Promise<Resource | undefined> {
    return Array.from(this.resources.values()).find(
      (resource) => resource.contentHash === contentHash,
    )
  }

  async findVersionByHash(contentHash: string): Promise<Resource | undefined> {
    return Array.from(this.versions.values()).find(
      (resource) => resource.contentHash === contentHash,
    )
  }

  async listVersions(resourceId: string): Promise<Resource[]> {
    return Array.from(this.versions.values()).filter(
      (resource) => resource.versionGroupId === resourceId,
    )
  }

  async listAllVersions(): Promise<Resource[]> {
    return Array.from(this.versions.values())
  }

  async listVersionSummaries(): Promise<ResourceSummary[]> {
    return Array.from(this.versions.values(), toResourceSummary)
  }

  async saveVersionSummary(summary: ResourceSummary): Promise<void> {
    const version = this.versions.get(summary.id)
    if (version) this.versions.set(summary.id, { ...version, ...summary })
  }

  async saveVersion(version: Resource): Promise<void> {
    this.versions.set(version.id, version)
  }

  async updateVersion(versionId: string, changes: Partial<Resource>): Promise<void> {
    const version = this.versions.get(versionId)
    if (version) this.versions.set(versionId, { ...version, ...changes })
  }

  async deleteVersion(versionId: string): Promise<void> {
    this.versions.delete(versionId)
  }

  async save(resource: Resource): Promise<void> {
    this.resources.set(resource.id, resource)
  }

  async saveMany(resources: Resource[]): Promise<void> {
    for (const resource of resources) this.resources.set(resource.id, resource)
  }

  async update(id: string, changes: Partial<Resource>): Promise<void> {
    const resource = this.resources.get(id)
    if (resource) this.resources.set(id, { ...resource, ...changes })
  }

  async updateMany(ids: string[], changes: Partial<Resource>): Promise<void> {
    for (const id of ids) await this.update(id, changes)
  }

  async delete(id: string): Promise<void> {
    this.resources.delete(id)
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) this.resources.delete(id)
  }
}

const noLinkInspection: GitHubResourceInspector = async () => undefined

function createService(): ResourceService {
  return createServiceWithStorage().service
}

function createServiceWithStorage(linkInspector: GitHubResourceInspector = noLinkInspection): {
  service: ResourceService
  storage: MemoryResourceStorage
} {
  const storage = new MemoryResourceStorage()
  return {
    service: new ResourceService(
      storage,
      new ResourceParserRegistry([new PngResourceParser(), new JsonResourceParser()]),
      linkInspector,
    ),
    storage,
  }
}

describe('ResourceService', () => {
  it('saves opening sets and applies them as independent cards or recoverable versions', async () => {
    const { service } = createServiceWithStorage()
    const greetingService = new GreetingResourceService(service)
    const originalCard = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '保留人物',
        description: '完整人设',
        personality: '冷静',
        first_mes: '旧主开场',
        alternate_greetings: ['旧备用'],
        character_book: { entries: [{ content: '世界书' }] },
        extensions: {
          custom: { keep: true },
          tavern_helper: {
            scripts: [
              { type: 'script', id: 'old', name: '原脚本', content: 'old()', enabled: true },
            ],
          },
        },
      },
    }
    await service.importFiles([
      new File([JSON.stringify(originalCard)], '人物.json', { type: 'application/json' }),
    ])
    const character = (await service.list())[0]!
    const file = new File(
      [
        JSON.stringify({
          format: 'srl-greeting',
          version: 1,
          name: '新开场',
          first_mes: '主开场白',
          alternate_greetings: [' 备用一 ', '备用二'],
          companion_scripts: [
            { type: 'script', name: '新脚本', content: 'newScript()', enabled: true },
          ],
        }),
      ],
      '开场.greeting.json',
      { type: 'application/json' },
    )
    const opening = await greetingService.save(file)
    expect(opening.type).toBe(RESOURCE_TYPE.GREETING)
    expect((await greetingService.save(file)).id).toBe(opening.id)
    const repeats = await Promise.all([greetingService.save(file), greetingService.save(file)])
    expect(repeats.map((item) => item.id)).toEqual([opening.id, opening.id])
    const renamed = new File(
      [JSON.stringify({ ...JSON.parse(await file.text()), name: '改名但内容不变' })],
      '改名.json',
      { type: 'application/json' },
    )
    expect((await greetingService.save(renamed)).id).toBe(opening.id)
    expect(
      (await service.list()).filter((item) => item.type === RESOURCE_TYPE.GREETING),
    ).toHaveLength(1)
    await expect(
      greetingService.apply(opening.id, character.id, 'new', character.contentHash),
    ).rejects.toThrow('处理方式')
    const copy = await greetingService.apply(
      opening.id,
      character.id,
      'new',
      character.contentHash,
      { mode: 'add', removeKeys: [] },
    )
    expect(copy.id).not.toBe(character.id)
    expect(await (await service.get(character.id))!.originalBlob.text()).toBe(
      JSON.stringify(originalCard),
    )
    const data = JSON.parse(await copy.originalBlob.text()).data
    expect(data).toMatchObject({
      name: '保留人物',
      description: '完整人设',
      personality: '冷静',
      character_book: originalCard.data.character_book,
      first_mes: '主开场白',
      alternate_greetings: [' 备用一 ', '备用二'],
    })
    expect(data.extensions.custom).toEqual({ keep: true })
    expect(data.extensions.tavern_helper.scripts).toHaveLength(2)
    expect(data.extensions.tavern_helper.scripts[0].enabled).toBe(true)
    expect(data.extensions.tavern_helper.scripts[1].enabled).toBe(false)
    await expect(
      greetingService.apply(opening.id, character.id, 'version', 'stale'),
    ).rejects.toThrow('已更新')
    const version = await greetingService.apply(
      opening.id,
      character.id,
      'version',
      character.contentHash,
      { mode: 'add', removeKeys: [] },
    )
    expect(version.id).toBe(character.id)
    await expect(
      greetingService.apply(opening.id, character.id, 'version', version.contentHash),
    ).rejects.toThrow('已经存在')
    const history = await service.listVersions(character.id)
    const old = history.find((entry) => !entry.active)!
    expect(await old.resource.originalBlob.text()).toBe(JSON.stringify(originalCard))
    await service.activateVersion(character.id, old.resource.id)
    expect(await (await service.get(character.id))!.originalBlob.text()).toBe(
      JSON.stringify(originalCard),
    )
  })
  it.each(Object.values(RESOURCE_TYPE))(
    'stores an independent author note for %s',
    async (type) => {
      const { service, storage } = createServiceWithStorage()
      await service.importFiles([new File(['{"name":"Atlas","entries":{}}'], 'Atlas.json')])
      const original = (await service.list())[0]!
      const resource = { ...original, type, metadata: { ...original.metadata, creator: '原作者' } }
      await storage.save(resource)
      const details = {
        name: resource.name,
        description: '',
        type,
        categoryIds: [],
        relatedResourceIds: [],
        tags: [],
      }
      await service.updateDetails(resource, { ...details, authorNote: '  备注作者  ' })
      let updated = (await service.list())[0]!
      expect(updated.metadata).toMatchObject({ creator: '原作者', authorNote: '备注作者' })
      expect(toResourceSummary(updated).metadata.authorNote).toBe('备注作者')
      expect(updated.originalBlob).toBe(original.originalBlob)
      expect(updated.contentHash).toBe(original.contentHash)
      await service.updateDetails(updated, details)
      updated = (await service.list())[0]!
      expect(updated.metadata.authorNote).toBe('备注作者')
      await expect(
        service.updateDetails(updated, { ...details, authorNote: '长'.repeat(161) }),
      ).rejects.toThrow('160')
      expect((await service.list())[0]!.metadata.authorNote).toBe('备注作者')
      await service.updateDetails(updated, { ...details, authorNote: '  ' })
      expect((await service.list())[0]!.metadata.authorNote).toBeUndefined()
      expect((await service.list())[0]!.metadata.creator).toBe('原作者')
    },
  )
  it('stores validated binary assets without routing them through the character-card parser', async () => {
    const { service } = createServiceWithStorage()
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const parsed = (avatarId: string): ParsedResource => ({
      type: RESOURCE_TYPE.OTHER,
      name: `用户头像 · ${avatarId}`,
      description: '用户人设头像资源',
      tags: ['用户头像'],
      metadata: { assetKind: 'userPersonaAvatar', avatarId },
    })

    const first = await service.importPreparedFile(
      new File([image], 'alice.png', { type: 'image/png' }),
      parsed('alice.png'),
      { allowContentDuplicate: true },
    )
    const second = await service.importPreparedFile(
      new File([image], 'owner.png', { type: 'image/png' }),
      parsed('owner.png'),
      { allowContentDuplicate: true },
    )

    expect(first.status).toBe('imported')
    expect(second.status).toBe('imported')
    expect(await service.list()).toHaveLength(2)
    expect((await service.list()).map((resource) => resource.metadata.avatarId)).toEqual([
      'alice.png',
      'owner.png',
    ])
  })

  it('updates a resource cover without changing its original file', async () => {
    const { service } = createServiceWithStorage()
    const [imported] = await service.importFiles([
      new File(
        [
          JSON.stringify({
            personas: { 'alice.png': 'Alice' },
            persona_descriptions: { 'alice.png': { description: '', position: 0 } },
            default_persona: 'alice.png',
          }),
        ],
        'personas.json',
        { type: 'application/json' },
      ),
    ])
    expect(imported?.status).toBe('imported')
    if (!imported || imported.status !== 'imported') return
    const originalBlob = imported.resource.originalBlob
    const cover = new Blob(['cover'], { type: 'image/webp' })

    const updated = await service.updateThumbnail(imported.resource.id, cover)

    expect(updated.thumbnailBlob).toBe(cover)
    expect(updated.originalBlob).toBe(originalBlob)
  })

  it('detects a likely update and stores both versions under one resource', async () => {
    const { service } = createServiceWithStorage()
    const card = (version: string, description: string) =>
      new File(
        [
          JSON.stringify({
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
              name: '温以礼',
              creator: 'Alice',
              character_version: version,
              description,
              first_mes: '你好。',
            },
          }),
        ],
        `温以礼-v${version}.json`,
        { type: 'application/json' },
      )

    const [initial] = await service.importFiles([card('1.0', '温和安静的医生。')])
    expect(initial?.status).toBe('imported')
    if (!initial || initial.status !== 'imported') return
    await service.setFavorite(initial.resource, true)
    const details = {
      name: initial.resource.name,
      description: initial.resource.description,
      type: initial.resource.type,
      categoryIds: [],
      relatedResourceIds: [],
      tags: [],
    }
    await service.updateDetails((await service.get(initial.resource.id))!, {
      ...details,
      authorNote: '我备注的作者',
    })

    const [candidate] = await service.importFiles([card('2.0', '温和安静的外科医生。')])
    expect(candidate?.status).toBe('versionCandidate')
    if (!candidate || candidate.status !== 'versionCandidate') return
    expect(candidate.candidates[0]?.resource.id).toBe(initial.resource.id)

    const updated = await service.importAsVersion(
      candidate.file,
      initial.resource.id,
      true,
      '修复开场白的作者更新版',
    )
    expect(updated.id).toBe(initial.resource.id)
    expect(updated.versionCount).toBe(2)
    expect(updated.favorite).toBe(true)
    expect(updated.metadata.characterVersion).toBe('2.0')
    expect(updated.metadata.authorNote).toBe('我备注的作者')
    expect(updated.versionNote).toBe('修复开场白的作者更新版')

    let versions = await service.listVersions(initial.resource.id)
    expect(versions).toHaveLength(2)
    const oldVersion = versions.find((version) => !version.active)
    expect(oldVersion?.resource.metadata.characterVersion).toBe('1.0')
    if (!oldVersion) return

    await service.updateVersionNote(initial.resource.id, oldVersion.resource.id, '最初导入的原版')

    const restored = await service.activateVersion(initial.resource.id, oldVersion.resource.id)
    expect(restored.metadata.characterVersion).toBe('1.0')
    expect(restored.metadata.authorNote).toBe('我备注的作者')
    expect(restored.versionNote).toBe('最初导入的原版')
    versions = await service.listVersions(initial.resource.id)
    expect(versions).toHaveLength(2)

    const inactive = versions.find((version) => !version.active)
    if (!inactive) return
    await service.updateDetails(restored, { ...details, authorNote: '' })
    const withoutNote = await service.activateVersion(initial.resource.id, inactive.resource.id)
    expect(withoutNote.metadata.authorNote).toBeUndefined()
    const remaining = (await service.listVersions(initial.resource.id)).find(
      (version) => !version.active,
    )!
    await service.deleteVersion(initial.resource.id, remaining.resource.id)
    expect(await service.listVersions(initial.resource.id)).toHaveLength(1)
  })

  it('覆盖当前版本时不把旧版写入历史', async () => {
    const { service } = createServiceWithStorage()
    const card = (version: string, description: string) =>
      new File(
        [
          JSON.stringify({
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
              name: '覆盖测试卡',
              creator: 'Alice',
              character_version: version,
              description,
              first_mes: '你好。',
            },
          }),
        ],
        `覆盖测试卡-v${version}.json`,
        { type: 'application/json' },
      )

    const [initial] = await service.importFiles([card('1.0', '旧版内容')])
    expect(initial?.status).toBe('imported')
    if (!initial || initial.status !== 'imported') return

    const [candidate] = await service.importFiles([card('2.0', '新版内容')])
    expect(candidate?.status).toBe('versionCandidate')
    if (!candidate || candidate.status !== 'versionCandidate') return

    const updated = await service.importAsVersion(
      candidate.file,
      initial.resource.id,
      true,
      '直接覆盖测试',
      undefined,
      {},
      false,
      false,
    )

    expect(updated.metadata.characterVersion).toBe('2.0')
    expect(await service.listVersions(initial.resource.id)).toHaveLength(1)
  })

  it('把同一语义内容的 v1 JSON 与 v2 封装绑定为一个逻辑版本', async () => {
    const { service } = createServiceWithStorage()
    const data = {
      name: '同一角色',
      description: '完全相同的角色内容',
      personality: '安静',
      scenario: '',
      first_mes: '你好。',
      mes_example: '',
    }
    const [initial] = await service.importFiles([
      new File(
        [JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data })],
        'card-v2.json',
        { type: 'application/json' },
      ),
    ])
    expect(initial.status).toBe('imported')
    if (initial.status !== 'imported') return

    const updated = await service.importAsVersion(
      new File([JSON.stringify(data, null, 2)], 'card-v1.json', {
        type: 'application/json',
      }),
      initial.resource.id,
      false,
      '',
      'container',
    )

    expect(updated.versionCount).toBe(1)
    const versions = await service.listVersions(initial.resource.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.active).toBe(true)
    expect(versions[0]?.carriers?.map((resource) => resource.fileName).sort()).toEqual([
      'card-v1.json',
      'card-v2.json',
    ])
  })

  it('更换卡面生成当前 PNG 封装并把原始 JSON 保留在同一逻辑版本', async () => {
    const { service } = createServiceWithStorage()
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '保留原件', description: '卡面变化不改变角色内容' },
    }
    const [initial] = await service.importFiles([
      new File([JSON.stringify(card)], 'original.json', { type: 'application/json' }),
    ])
    expect(initial.status).toBe('imported')
    if (initial.status !== 'imported') return
    const binary = atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    )
    const artwork = new File(
      [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
      'new-face.png',
      { type: 'image/png' },
    )

    const updated = await service.replaceCharacterCardArtwork(initial.resource.id, artwork)

    expect(updated.fileName).toContain('自定义卡面')
    expect(updated.metadata.artworkVariantKind).toBe('custom')
    expect(updated.versionCount).toBe(1)
    const versions = await service.listVersions(updated.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.carriers?.map((resource) => resource.fileName)).toContain('original.json')
    expect(versions[0]?.carriers?.some((resource) => resource.id === updated.id)).toBe(true)
  })

  it('manually merges an existing same-type resource into version history', async () => {
    const service = createService()
    const first = new File(
      ['{"name":"Atlas","entries":{"a":{"content":"old"}}}'],
      'Atlas-v1.json',
      {
        type: 'application/json',
      },
    )
    const second = new File(
      ['{"name":"Atlas","entries":{"a":{"content":"new"},"b":{"content":"extra"}}}'],
      'Atlas-v2.json',
      { type: 'application/json' },
    )

    const [initial] = await service.importFiles([first])
    const [independent] = await service.importFiles([second], { detectVersions: false })
    expect(initial?.status).toBe('imported')
    expect(independent?.status).toBe('imported')
    if (initial?.status !== 'imported' || independent?.status !== 'imported') return

    const merged = await service.mergeExistingResourceAsVersion(
      initial.resource.id,
      independent.resource.id,
      '手动标记为 v2',
    )

    expect(merged.id).toBe(initial.resource.id)
    expect(merged.versionCount).toBe(2)
    expect(await service.list()).toHaveLength(1)
    const versions = await service.listVersions(initial.resource.id)
    expect(versions).toHaveLength(2)
    const archived = versions.find((version) => !version.active)
    expect(archived?.resource.fileName).toBe('Atlas-v2.json')
    expect(archived?.resource.versionNote).toBe('手动标记为 v2')
  })

  it('imports a valid JSON world book', async () => {
    const service = createService()
    const file = new File(['{"name":"Atlas","entries":{}}'], 'Atlas.json', {
      type: 'application/json',
    })

    const [result] = await service.importFiles([file])

    expect(result?.status).toBe('imported')
    if (result?.status === 'imported') {
      expect(result.resource.name).toBe('Atlas')
      expect(result.resource.type).toBe(RESOURCE_TYPE.WORLD_BOOK)
    }
  })

  it('skips files with duplicate content hashes', async () => {
    const service = createService()
    const first = new File(['{"name":"Atlas"}'], 'Atlas.json', {
      type: 'application/json',
    })
    const second = new File(['{"name":"Atlas"}'], 'Copy.json', {
      type: 'application/json',
    })

    await service.importFiles([first])
    const [result] = await service.importFiles([second])

    expect(result?.status).toBe('duplicate')
    expect(await service.list()).toHaveLength(1)
  })

  it('optionally extracts and binds embedded character world book and regex resources', async () => {
    const service = createService()
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Archivist',
        description: 'Keeper',
        first_mes: 'Welcome.',
        character_book: {
          name: 'Archive Lore',
          entries: [{ uid: 1, keys: ['archive'], content: 'Lore entry' }],
        },
        extensions: {
          regex_scripts: [
            {
              id: 'status-card',
              scriptName: 'Status Card',
              findRegex: '<status>[\\s\\S]*?<\\/status>',
              replaceString: '<div class="status">$1</div>',
            },
          ],
        },
      },
    }

    const [result] = await service.importFiles(
      [new File([JSON.stringify(card)], 'Archivist.json', { type: 'application/json' })],
      { extractCharacterAssets: true },
    )

    expect(result?.status).toBe('imported')
    if (result?.status !== 'imported') return
    expect(result.extractedResources).toHaveLength(2)
    expect(result.extractedResources?.map((resource) => resource.type)).toEqual([
      RESOURCE_TYPE.WORLD_BOOK,
      RESOURCE_TYPE.REGEX,
    ])
    const resources = await service.list()
    expect(resources).toHaveLength(3)
    const character = resources.find((resource) => resource.type === RESOURCE_TYPE.CHARACTER_CARD)
    const extracted = resources.filter((resource) => resource.type !== RESOURCE_TYPE.CHARACTER_CARD)
    expect(character?.relatedResourceIds).toHaveLength(2)
    expect(
      extracted.every((resource) => resource.relatedResourceIds?.includes(character!.id)),
    ).toBe(true)
    expect(extracted.every((resource) => resource.tags.includes('角色卡配套'))).toBe(true)
    expect(extracted[0]?.metadata.extractedFromCharacterId).toBe(character?.id)

    const [duplicate] = await service.importFiles(
      [new File([JSON.stringify(card)], 'Archivist-copy.json', { type: 'application/json' })],
      { extractCharacterAssets: true },
    )
    expect(duplicate).toMatchObject({ status: 'duplicate', extractedResources: [] })
    expect(await service.list()).toHaveLength(3)
  })

  it('manually extracts assets from previously imported character cards', async () => {
    const service = createService()
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Late Split',
        description: 'Imported before extraction was enabled',
        character_book: {
          entries: [{ uid: 1, keys: ['archive'], content: 'Lore entry' }],
        },
        extensions: {
          regex_scripts: [
            {
              scriptName: 'Panel',
              findRegex: '<panel>[\\s\\S]*?<\\/panel>',
              replaceString: '<div>$1</div>',
            },
          ],
        },
      },
    }
    const [imported] = await service.importFiles([
      new File([JSON.stringify(card)], 'Late-Split.json', { type: 'application/json' }),
    ])
    expect(imported?.status).toBe('imported')
    if (imported?.status !== 'imported') return

    const report = await service.extractCharacterAssetsMany([imported.resource.id])
    expect(report).toMatchObject({
      selectedCount: 1,
      characterCount: 1,
      assetCount: 2,
      createdCount: 2,
    })
    const resources = await service.list()
    const character = resources.find((resource) => resource.id === imported.resource.id)
    const extracted = resources.filter((resource) => resource.id !== imported.resource.id)
    expect(character?.relatedResourceIds).toHaveLength(2)
    expect(extracted).toHaveLength(2)
    expect(
      extracted.every((resource) => resource.relatedResourceIds?.includes(character!.id)),
    ).toBe(true)

    const repeated = await service.extractCharacterAssetsMany([imported.resource.id])
    expect(repeated).toMatchObject({ assetCount: 2, createdCount: 0 })
    expect(await service.list()).toHaveLength(3)
  })

  it('extracts embedded Tavern Helper scripts and packaged quick replies when present', async () => {
    const service = createService()
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      qrList: [{ id: 1, label: 'Start', message: '/echo ready' }],
      data: {
        name: 'Automation Card',
        description: 'Carries optional companion data',
        extensions: {
          tavern_helper: {
            scripts: [
              {
                type: 'script',
                id: 'status-panel',
                name: 'Status panel',
                content: 'document.body.dataset.ready = "yes"',
              },
            ],
          },
        },
      },
    }

    const [result] = await service.importFiles(
      [new File([JSON.stringify(card)], 'Automation.json', { type: 'application/json' })],
      { extractCharacterAssets: true },
    )

    expect(result?.status).toBe('imported')
    if (result?.status !== 'imported') return
    expect(result.extractedResources?.map((resource) => resource.type)).toEqual([
      RESOURCE_TYPE.SCRIPT,
      RESOURCE_TYPE.QUICK_REPLY,
    ])
    expect(
      result.extractedResources?.map((resource) => resource.metadata.extractedAssetKind),
    ).toEqual(['script', 'quickReply'])
  })

  it('extracts preset regex as a bound preset-scoped resource', async () => {
    const service = createService()
    const preset = {
      name: 'Writer preset',
      temperature: 0.8,
      top_p: 0.9,
      top_k: 40,
      extensions: {
        regex_scripts: [
          {
            scriptName: 'Panel',
            findRegex: '<panel>(.*?)</panel>',
            replaceString: '<div>$1</div>',
          },
        ],
      },
    }
    const [result] = await service.importFiles(
      [new File([JSON.stringify(preset)], 'Writer.json', { type: 'application/json' })],
      { extractCharacterAssets: true },
    )

    expect(result?.status).toBe('imported')
    if (result?.status !== 'imported') return
    expect(result.extractedResources).toHaveLength(1)
    expect(result.extractedResources?.[0]).toMatchObject({
      type: RESOURCE_TYPE.REGEX,
      tags: ['预设配套'],
      metadata: {
        extractedFromPresetId: result.resource.id,
        extractedFromPresetName: 'Writer preset',
        regexScope: 'preset',
      },
    })
    expect(result.resource.relatedResourceIds).toContain(result.extractedResources?.[0]?.id)
  })

  it('reclassifies an outdated duplicate during import without requiring a reload', async () => {
    const { service, storage } = createServiceWithStorage()
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Archivist',
        description: 'Keeper',
        personality: 'Careful',
        scenario: 'Library',
        first_mes: 'Welcome.',
        mes_example: '{{char}}: Hello',
      },
    }
    const file = new File([JSON.stringify(card)], 'Archivist.json', {
      type: 'application/json',
    })
    await service.importFiles([file])
    const [stored] = await service.list()
    expect(stored).toBeDefined()
    if (!stored) return
    await storage.update(stored.id, {
      type: RESOURCE_TYPE.OTHER,
      metadata: { format: 'json', parserVersion: 2, detectedVariant: 'jsonObject' },
    })

    const [result] = await service.importFiles([file])

    expect(result).toMatchObject({
      status: 'duplicate',
      reclassified: true,
      resource: {
        type: RESOURCE_TYPE.CHARACTER_CARD,
        metadata: { parserVersion: 8, detectedVariant: 'characterCardJson' },
      },
    })
    expect((await service.list())[0]?.type).toBe(RESOURCE_TYPE.CHARACTER_CARD)
  })

  it('reports malformed JSON without writing it', async () => {
    const service = createService()
    const file = new File(['{invalid'], 'Broken.json', { type: 'application/json' })

    const [result] = await service.importFiles([file])

    expect(result?.status).toBe('failed')
    expect(await service.list()).toHaveLength(0)
  })

  it('updates category and normalized tags', async () => {
    const service = createService()
    await service.importFiles([
      new File(['{"name":"Atlas"}'], 'Atlas.json', { type: 'application/json' }),
    ])
    const [resource] = await service.list()
    expect(resource).toBeDefined()
    if (!resource) return

    await service.updateOrganization(
      resource,
      ['favorites', 'lore'],
      [' 世界书 ', '设定', '世界书', ''],
    )

    const [updated] = await service.list()
    expect(updated?.categoryId).toBe('favorites')
    expect(updated?.categoryIds).toEqual(['favorites', 'lore'])
    expect(updated?.tags).toEqual(['世界书', '设定'])
  })

  it('updates the limited third-party APP fields and persists them', async () => {
    const service = createService()
    await service.importFiles([
      new File(['{"name":"Atlas"}'], 'Atlas.json', { type: 'application/json' }),
    ])
    const [resource] = await service.list()
    if (!resource) return

    await service.updateExternalAppResource({
      resourceId: resource.id,
      name: 'Atlas Plus',
      description: '由第三方 APP 整理',
      tags: ['整理过', '整理过'],
      favorite: true,
      categoryIds: ['favorites'],
    })

    const reopened = await service.get(resource.id)
    expect(reopened).toMatchObject({
      name: 'Atlas Plus',
      description: '由第三方 APP 整理',
      tags: ['整理过'],
      favorite: true,
      categoryIds: ['favorites'],
    })
  })

  it('updates private metadata without changing resource content or organization', async () => {
    const service = createService()
    await service.importFiles([new File(['{"name":"Persona"}'], 'Persona.json')])
    const [resource] = await service.list()
    if (!resource) return

    const updated = await service.updateMetadata(resource.id, { cloudBackupExcluded: true })

    expect(updated.metadata.cloudBackupExcluded).toBe(true)
    expect(await updated.originalBlob.text()).toBe('{"name":"Persona"}')
    expect(updated.categoryIds).toEqual([])
  })

  it('updates editable details while preserving the original file', async () => {
    const service = createService()
    await service.importFiles([
      new File(['{"name":"Atlas","entries":{}}'], 'Atlas.json', {
        type: 'application/json',
      }),
    ])
    const [resource] = await service.list()
    expect(resource).toBeDefined()
    if (!resource) return

    await service.updateDetails(resource, {
      name: '  Atlas Pro  ',
      description: '  手动补充说明  ',
      type: RESOURCE_TYPE.PRESET,
      categoryIds: ['favorites', 'lore'],
      relatedResourceIds: [],
      tags: [' 常用 ', '设定', '常用'],
    })

    const [updated] = await service.list()
    expect(updated).toMatchObject({
      name: 'Atlas Pro',
      description: '手动补充说明',
      type: RESOURCE_TYPE.PRESET,
      categoryId: 'favorites',
      categoryIds: ['favorites', 'lore'],
      tags: ['常用', '设定'],
      fileName: 'Atlas.json',
      contentHash: resource.contentHash,
    })
    expect(updated?.originalBlob).toBe(resource.originalBlob)
  })

  it('stores normalized external source links on resource details', async () => {
    const service = createService()
    await service.importFiles([new File(['{"name":"Atlas"}'], 'Atlas.json')])
    const [resource] = await service.list()
    expect(resource).toBeDefined()
    if (!resource) return

    await service.updateDetails(resource, {
      name: resource.name,
      description: resource.description,
      type: resource.type,
      categoryIds: [],
      relatedResourceIds: [],
      tags: resource.tags,
      sourceLinks: [
        {
          id: 'discord-post',
          label: '作者 DC 原帖',
          url: 'discord.gg/example',
          type: RESOURCE_LINK_TYPE.DISCORD,
          note: '发布页',
          createdAt: 10,
        },
        {
          id: 'empty-draft',
          label: '',
          url: '',
          type: RESOURCE_LINK_TYPE.OTHER,
          createdAt: 11,
        },
      ],
    })

    const [updated] = await service.list()
    const sourceLinks = updated?.sourceLinks ?? []
    expect(sourceLinks).toHaveLength(1)
    expect(sourceLinks[0]).toMatchObject({
      id: 'discord-post',
      label: '作者 DC 原帖',
      url: 'https://discord.gg/example',
      type: RESOURCE_LINK_TYPE.DISCORD,
      note: '发布页',
      purpose: RESOURCE_LINK_PURPOSE.SOURCE_POST,
      installTarget: RESOURCE_INSTALL_TARGET.NONE,
      createdAt: 10,
    })
  })

  it('rejects unsafe source link protocols', async () => {
    const service = createService()
    await service.importFiles([new File(['{"name":"Atlas"}'], 'Atlas.json')])
    const [resource] = await service.list()
    expect(resource).toBeDefined()
    if (!resource) return

    await expect(
      service.updateDetails(resource, {
        name: resource.name,
        description: resource.description,
        type: resource.type,
        categoryIds: [],
        relatedResourceIds: [],
        tags: resource.tags,
        sourceLinks: [
          {
            id: 'bad',
            label: '危险链接',
            url: 'javascript:alert(1)',
            type: RESOURCE_LINK_TYPE.OTHER,
            createdAt: 10,
          },
        ],
      }),
    ).rejects.toThrow('资源链接仅支持 http/https 地址')
  })

  it('rejects an empty resource name', async () => {
    const service = createService()
    await service.importFiles([new File(['{"name":"Atlas"}'], 'Atlas.json')])
    const [resource] = await service.list()
    expect(resource).toBeDefined()
    if (!resource) return

    await expect(
      service.updateDetails(resource, {
        name: '   ',
        description: '',
        type: resource.type,
        categoryIds: [],
        relatedResourceIds: [],
        tags: [],
      }),
    ).rejects.toThrow('资源名称不能为空')
  })

  it('applies favorite, category and delete operations to multiple resources', async () => {
    const service = createService()
    await service.importFiles([
      new File(['{"name":"Atlas","entries":{}}'], 'Atlas.json'),
      new File(['{"name":"Notes","entries":{}}'], 'Notes.json'),
    ])
    const ids = (await service.list()).map((resource) => resource.id)

    await service.setFavoriteMany(ids, true)
    await service.moveManyToCategory(ids, 'lore')
    await service.moveManyToCategory(ids, 'characters')
    expect((await service.list()).every((resource) => resource.favorite)).toBe(true)
    expect((await service.list()).every((resource) => resource.categoryId === 'lore')).toBe(true)
    expect(
      (await service.list()).every(
        (resource) =>
          resource.categoryIds?.includes('lore') && resource.categoryIds.includes('characters'),
      ),
    ).toBe(true)

    await service.deleteMany(ids)
    expect(await service.list()).toHaveLength(0)
  })

  it('adds and removes a normalized tag from multiple resources', async () => {
    const service = createService()
    await service.importFiles([
      new File(['{"name":"Atlas","entries":{}}'], 'Atlas.json'),
      new File(['{"name":"Notes","entries":{}}'], 'Notes.json'),
    ])
    const items = await service.list()
    const ids = items.map((resource) => resource.id)

    await service.updateTagsMany(ids, '  同一世界观  ', 'add')
    expect((await service.list()).every((resource) => resource.tags.includes('同一世界观'))).toBe(
      true,
    )

    await service.updateTagsMany([ids[0]!], '同一世界观', 'remove')
    const updated = await service.list()
    expect(updated.find((resource) => resource.id === ids[0])?.tags).not.toContain('同一世界观')
    expect(updated.find((resource) => resource.id === ids[1])?.tags).toContain('同一世界观')
  })

  it('creates symmetric resource relations and cleans them when a resource is deleted', async () => {
    const { service, storage } = createServiceWithStorage()
    await service.importFiles([
      new File(['{"name":"Character","entries":{}}'], 'Character.json'),
      new File(['{"name":"Lore","entries":{}}'], 'Lore.json'),
      new File(['{"name":"Regex","entries":{}}'], 'Regex.json'),
    ])
    const [source, related, untouched] = await service.list()
    expect(source && related && untouched).toBeDefined()
    if (!source || !related || !untouched) return

    const fullListSpy = vi.spyOn(storage, 'list')
    await service.updateDetails(source, {
      name: source.name,
      description: source.description,
      type: source.type,
      categoryIds: [],
      relatedResourceIds: [related.id],
      tags: source.tags,
    })
    expect(fullListSpy).not.toHaveBeenCalled()
    fullListSpy.mockRestore()

    let items = await service.list()
    expect(items.find((item) => item.id === source.id)?.relatedResourceIds).toEqual([related.id])
    expect(items.find((item) => item.id === related.id)?.relatedResourceIds).toContain(source.id)
    expect(items.find((item) => item.id === untouched.id)?.relatedResourceIds).toEqual([])

    const deleteFullListSpy = vi.spyOn(storage, 'list')
    await service.delete(related.id)
    expect(deleteFullListSpy).not.toHaveBeenCalled()
    deleteFullListSpy.mockRestore()

    items = await service.list()
    expect(items.find((item) => item.id === source.id)?.relatedResourceIds).toEqual([])
  })

  it('reclassifies JSON resources imported by the legacy parser', async () => {
    const { service, storage } = createServiceWithStorage()
    const originalBlob = new Blob([
      JSON.stringify({ scriptName: 'Clean', findRegex: 'foo', replaceString: 'bar' }),
    ])
    await storage.save({
      id: 'legacy-json',
      type: RESOURCE_TYPE.WORLD_BOOK,
      name: 'Clean',
      description: '旧版分类',
      fileName: 'Clean.json',
      mimeType: 'application/json',
      fileSize: originalBlob.size,
      contentHash: 'legacy-hash',
      favorite: true,
      categoryId: 'tools',
      tags: ['保留标签'],
      metadata: { format: 'json', parserVersion: 1, authorNote: '升级也保留备注' },
      originalBlob,
      createdAt: 1,
      updatedAt: 1,
    })

    expect(await service.upgradeLegacyJsonResources()).toBe(1)
    const [resource] = await service.list()
    expect(resource?.type).toBe(RESOURCE_TYPE.REGEX)
    expect(resource?.metadata.parserVersion).toBe(8)
    expect(resource?.metadata.authorNote).toBe('升级也保留备注')
    expect(resource?.favorite).toBe(true)
    expect(resource?.categoryId).toBe('tools')
    expect(resource?.tags).toEqual(['保留标签'])
  })

  it('repairs only legacy single global regex names without changing files or user names', async () => {
    const { service, storage } = createServiceWithStorage()
    const script = { scriptName: '清理思维链', findRegex: '/old/g', replaceString: '' }
    const originalBlob = new Blob([JSON.stringify({ global: [script], sourceName: '全局正则' })])
    const base = {
      type: RESOURCE_TYPE.REGEX,
      description: '全局正则，包含 1 条脚本',
      mimeType: 'application/json',
      fileSize: originalBlob.size,
      favorite: true,
      categoryId: 'tools',
      tags: ['保留标签'],
      metadata: {
        format: 'json',
        parserVersion: 8,
        detectedVariant: 'regexCollection',
        regexScope: 'global',
        sourceName: '全局正则',
        itemCount: 1,
      },
      originalBlob,
      createdAt: 1,
      updatedAt: 1,
    }
    await storage.save({
      ...base,
      id: 'legacy',
      name: '全局正则',
      fileName: '清理思维链.json',
      contentHash: 'old',
    })
    await storage.save({
      ...base,
      id: 'renamed',
      name: '我的规则',
      fileName: '自定义.json',
      contentHash: 'renamed',
    })
    await storage.save({
      ...base,
      id: 'generic',
      name: '全局正则',
      fileName: '全局正则.json',
      contentHash: 'generic',
    })

    expect(await service.upgradeLegacyJsonResources()).toBe(1)
    const repaired = await storage.get('legacy')
    expect(repaired).toMatchObject({
      name: '清理思维链',
      fileName: '清理思维链.json',
      contentHash: 'old',
      favorite: true,
      categoryId: 'tools',
      tags: ['保留标签'],
      metadata: { legacyGlobalRegexNameRepaired: true },
    })
    expect(repaired?.originalBlob).toBe(originalBlob)
    expect((await storage.get('renamed'))?.name).toBe('我的规则')
    expect((await storage.get('generic'))?.name).toBe('全局正则')
    expect(await service.upgradeLegacyJsonResources()).toBe(0)
    await storage.update('legacy', { name: '全局正则' })
    expect(await service.upgradeLegacyJsonResources()).toBe(0)
    expect((await storage.get('legacy'))?.name).toBe('全局正则')
  })

  it('upgrades a version 2 JSON character card and merges embedded tags', async () => {
    const { service, storage } = createServiceWithStorage()
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Archivist',
        description: 'A careful keeper.',
        personality: 'Careful',
        scenario: 'Library',
        first_mes: 'Welcome.',
        mes_example: '{{char}}: Hello',
        tags: ['角色卡标签，额外标签', '用户标签'],
      },
    }
    const originalBlob = new Blob([JSON.stringify(card)])
    await storage.save({
      id: 'legacy-card',
      type: RESOURCE_TYPE.OTHER,
      name: 'Archivist',
      description: '未识别的 JSON 资源',
      fileName: 'Archivist.json',
      mimeType: 'application/json',
      fileSize: originalBlob.size,
      contentHash: 'card-hash',
      favorite: false,
      categoryId: null,
      tags: ['用户标签'],
      metadata: { format: 'json', parserVersion: 2, detectedVariant: 'jsonObject' },
      originalBlob,
      createdAt: 1,
      updatedAt: 1,
    })

    expect(await service.upgradeLegacyJsonResources()).toBe(1)
    const [resource] = await service.list()
    expect(resource?.type).toBe(RESOURCE_TYPE.CHARACTER_CARD)
    expect(resource?.tags).toEqual(['用户标签', '角色卡标签', '额外标签'])
    expect(resource?.metadata).toMatchObject({
      parserVersion: 8,
      detectedVariant: 'characterCardJson',
      card,
    })
  })

  it('keeps a manual type correction while upgrading parser metadata', async () => {
    const { service, storage } = createServiceWithStorage()
    const originalBlob = new Blob([JSON.stringify({ title: 'Data', values: [1, 2, 3] })])
    await storage.save({
      id: 'manual-type',
      type: RESOURCE_TYPE.PRESET,
      name: 'Data',
      description: '手动分类',
      fileName: 'Data.json',
      mimeType: 'application/json',
      fileSize: originalBlob.size,
      contentHash: 'manual-hash',
      favorite: false,
      categoryId: null,
      tags: [],
      metadata: { format: 'json', parserVersion: 2, detectedVariant: 'jsonObject' },
      originalBlob,
      createdAt: 1,
      updatedAt: 1,
    })

    await service.upgradeLegacyJsonResources()
    const [resource] = await service.list()
    expect(resource?.type).toBe(RESOURCE_TYPE.PRESET)
    expect(resource?.metadata).toMatchObject({ parserVersion: 8, manualTypeOverride: 'preset' })
  })

  it('没有读取远端内容时不把普通 GitHub 仓库臆断为酒馆扩展', async () => {
    const { service, storage } = createServiceWithStorage()
    const [result] = await service.importLinks([
      'https://github.com/N0VI028/JS-Slash-Runner/tree/v4.8.7',
    ])

    expect(result?.status).toBe('imported')
    if (!result || result.status !== 'imported') return
    expect(result.resource.type).toBe(RESOURCE_TYPE.OTHER)
    expect(result.resource.mimeType).toBe('application/srl-link+json')
    const sourceLinks = result.resource.sourceLinks ?? []
    expect(sourceLinks[0]).toMatchObject({
      type: RESOURCE_LINK_TYPE.GITHUB,
      purpose: RESOURCE_LINK_PURPOSE.REPOSITORY,
      installTarget: RESOURCE_INSTALL_TARGET.NONE,
      versionRef: { kind: 'tag', value: 'v4.8.7' },
    })
    expect(result.resource.metadata.linkImport).toMatchObject({
      url: 'https://github.com/N0VI028/JS-Slash-Runner/tree/v4.8.7',
      safety: {
        linkOnly: true,
        downloadsContent: false,
        installsExtension: false,
        executesScript: false,
      },
    })

    const duplicate = await service.importLinks([
      'https://github.com/N0VI028/JS-Slash-Runner/tree/v4.8.7',
    ])
    expect(duplicate[0]?.status).toBe('duplicate')
    expect(await storage.list()).toHaveLength(1)
  })

  it('读取 GitHub README 与 manifest 后用证据生成名称、说明和扩展分类', async () => {
    const inspection: GitHubResourceInspection = {
      status: 'identified',
      fullName: 'owner/repo',
      name: '真正的酒馆扩展',
      summary: '在酒馆里提供资源整理功能。',
      repositoryDescription: '资源整理工具',
      readmeExcerpt: '这个扩展可以整理资源。',
      readmeHeadings: ['功能', '安装'],
      topics: ['sillytavern'],
      homepage: '',
      author: 'owner',
      defaultBranch: 'main',
      archived: false,
      manifest: {
        displayName: '真正的酒馆扩展',
        description: '在酒馆里提供资源整理功能。',
        version: '1.2.3',
        author: '作者',
        minimumClientVersion: '1.18.0',
        requires: [],
        optional: [],
      },
      installTarget: RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION,
      trustMode: 'metadataSnapshot',
      evidence: ['GitHub 仓库元数据', 'README', 'SillyTavern manifest.json'],
    }
    const { service } = createServiceWithStorage(async () => inspection)

    const [result] = await service.importLinks(['https://github.com/owner/repo'])

    expect(result?.status).toBe('imported')
    if (!result || result.status !== 'imported') return
    expect(result.resource).toMatchObject({
      type: RESOURCE_TYPE.PLUGIN,
      name: '真正的酒馆扩展',
      description: expect.stringContaining('功能说明：在酒馆里提供资源整理功能'),
    })
    expect(result.resource.sourceLinks?.[0]).toMatchObject({
      installTarget: RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION,
      trustMode: 'metadataSnapshot',
    })
    expect(result.resource.metadata.linkImport).toMatchObject({
      inspection: { status: 'identified', manifest: { version: '1.2.3' } },
    })
  })

  it('把 raw js 链接识别为酒馆助手脚本资源', async () => {
    const service = createService()
    const [result] = await service.importLinks([
      'https://raw.githubusercontent.com/owner/repo/main/helper.js',
    ])

    expect(result?.status).toBe('imported')
    if (!result || result.status !== 'imported') return
    expect(result.resource.type).toBe(RESOURCE_TYPE.SCRIPT)
    expect(result.resource.tags).toEqual(
      expect.arrayContaining(['GitHub', '酒馆助手脚本', '可执行内容']),
    )
    const sourceLinks = result.resource.sourceLinks ?? []
    expect(sourceLinks[0]).toMatchObject({
      purpose: RESOURCE_LINK_PURPOSE.RAW_FILE,
      installTarget: RESOURCE_INSTALL_TARGET.TAVERN_HELPER_SCRIPT,
      versionRef: { kind: 'branch', value: 'main' },
    })
  })

  it('把自缝版作为标准预设入库并持久化分类元数据与双向来源关联', async () => {
    const { service } = createServiceWithStorage()
    const preset = (name: string, identifier: string) =>
      new File(
        [
          JSON.stringify({
            name,
            prompts: [{ identifier, name: identifier, role: 'system', content: name }],
            prompt_order: [{ character_id: 100001, order: [{ identifier, enabled: true }] }],
          }),
        ],
        `${name}.json`,
        { type: 'application/json' },
      )
    const [baseResult, sourceResult] = await service.importFiles([
      preset('主预设', 'main'),
      preset('填充预设', 'style'),
    ])
    if (baseResult?.status !== 'imported' || sourceResult?.status !== 'imported') {
      throw new Error('测试预设导入失败')
    }
    const stitchedFrom = [
      {
        kind: 'segment',
        resourceId: sourceResult.resource.id,
        resourceName: sourceResult.resource.name,
        identifier: 'style',
        finalIdentifier: 'style',
        name: 'style',
      },
    ]
    const stitched = await service.importStitchedPreset(preset('我的自缝版', 'stitched-main'), {
      stitchedFrom,
      baseResourceId: baseResult.resource.id,
      relatedResourceIds: [baseResult.resource.id, sourceResult.resource.id],
    })

    const reread = await service.get(stitched.id)
    expect(reread?.type).toBe(RESOURCE_TYPE.PRESET)
    expect(reread?.metadata).toMatchObject({
      stitchedFrom,
      stitchedBaseId: baseResult.resource.id,
    })
    expect(reread?.relatedResourceIds).toEqual(
      expect.arrayContaining([baseResult.resource.id, sourceResult.resource.id]),
    )
    expect((await service.get(baseResult.resource.id))?.relatedResourceIds).toContain(stitched.id)
    expect((await service.get(sourceResult.resource.id))?.relatedResourceIds).toContain(stitched.id)
  })
})

describe('mergeDuplicates', () => {
  function duplicate(id: string, overrides: Partial<Resource> = {}): Resource {
    return {
      id,
      type: RESOURCE_TYPE.WORLD_BOOK,
      name: id,
      description: '',
      fileName: `${id}.json`,
      fileSize: 10,
      mimeType: 'application/json',
      contentHash: 'same-hash',
      categoryId: null,
      categoryIds: [],
      relatedResourceIds: [],
      tags: [],
      favorite: false,
      metadata: {},
      originalBlob: new Blob(['{}']),
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    } as Resource
  }

  it('保留项吸收副本的标签、文件夹、关联与收藏后删除副本', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save(duplicate('keep', { categoryIds: ['f1'], tags: ['甲'] }))
    await storage.save(
      duplicate('dupe', {
        categoryIds: ['f2'],
        tags: ['乙'],
        favorite: true,
        relatedResourceIds: ['partner'],
        updatedAt: 5,
      }),
    )
    await storage.save(duplicate('partner', { contentHash: 'other-hash' }))

    const removed = await service.mergeDuplicates('keep', ['dupe'])

    expect(removed).toBe(1)
    expect(await storage.get('dupe')).toBeUndefined()
    const keeper = await storage.get('keep')
    expect(keeper?.categoryIds).toEqual(['f1', 'f2'])
    expect(keeper?.tags).toEqual(['甲', '乙'])
    expect(keeper?.favorite).toBe(true)
    expect(keeper?.relatedResourceIds).toEqual(['partner'])
  })

  it('内容指纹不一致的资源拒绝清理', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save(duplicate('keep'))
    await storage.save(duplicate('other', { contentHash: 'different' }))

    await expect(service.mergeDuplicates('keep', ['other'])).rejects.toThrow('内容不同')
    expect(await storage.get('other')).toBeDefined()
  })

  it('保留项不存在时报错，空副本列表直接返回 0', async () => {
    const { service, storage } = createServiceWithStorage()
    await expect(service.mergeDuplicates('missing', ['x'])).rejects.toThrow('不存在')
    await storage.save(duplicate('keep'))
    expect(await service.mergeDuplicates('keep', ['keep'])).toBe(0)
  })
})

describe('历史时间线合并', () => {
  function versionResource(id: string, contentHash: string, versionGroupId?: string): Resource {
    return {
      id,
      versionGroupId,
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: id,
      description: '',
      fileName: `${id}.json`,
      mimeType: 'application/json',
      fileSize: 10,
      contentHash,
      favorite: false,
      categoryId: null,
      categoryIds: [],
      relatedResourceIds: [],
      tags: [],
      metadata: {},
      originalBlob: new Blob([id]),
      createdAt: 1,
      updatedAt: 1,
      versionCount: 1,
    }
  }

  it('合并两条时间线时跳过目标组内和来源组内的完全重复文件', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save(versionResource('target', 'target-current'))
    await storage.saveVersion(versionResource('target-history', 'shared-file', 'target'))
    await storage.save(versionResource('source', 'source-current'))
    await storage.saveVersion(versionResource('source-history-a', 'shared-file', 'source'))
    await storage.saveVersion(versionResource('source-history-b', 'source-current', 'source'))

    const merged = await service.mergeExistingResourceAsVersion('target', 'source')
    const versions = await service.listVersions('target')

    expect(versions.map((item) => item.resource.contentHash).sort()).toEqual([
      'shared-file',
      'source-current',
      'target-current',
    ])
    expect(new Set(versions.map((item) => item.resource.contentHash)).size).toBe(versions.length)
    expect(merged.versionCount).toBe(3)
  })

  it('删除历史版本后按数据库实际条数校准版本数量', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save({ ...versionResource('target', 'current'), versionCount: 99 })
    await storage.saveVersion(versionResource('history-a', 'a', 'target'))
    await storage.saveVersion(versionResource('history-b', 'b', 'target'))

    await service.deleteVersion('target', 'history-a')

    expect((await storage.get('target'))?.versionCount).toBe(2)
  })

  it('一次删除多个同指纹历史并重新读取数据库确认已经消失', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save({ ...versionResource('target', 'same-file'), versionCount: 8 })
    await storage.saveVersion(versionResource('history-a', 'same-file', 'target'))
    await storage.saveVersion(versionResource('history-b', 'same-file', 'target'))
    await storage.saveVersion(versionResource('history-c', 'other-file', 'target'))

    const deleted = await service.deleteVersions('target', ['history-a', 'history-b'])
    const remaining = await service.listVersions('target')

    expect(deleted).toBe(2)
    expect(remaining.map((item) => item.resource.id).sort()).toEqual(['history-c', 'target'])
    expect((await storage.get('target'))?.versionCount).toBe(2)
  })
  it('历史归档失败时不覆盖当前版或删除选中的版本', async () => {
    const { service, storage } = createServiceWithStorage()
    const current = versionResource('target', 'current')
    const history = versionResource('history', 'old', 'target')
    await storage.save(current)
    await storage.saveVersion(history)
    vi.spyOn(storage, 'saveVersion').mockRejectedValueOnce(new Error('归档失败'))

    await expect(service.activateVersion('target', 'history')).rejects.toThrow('归档失败')
    expect(await storage.get('target')).toEqual(current)
    expect(await storage.getVersion('history')).toEqual(history)
  })

  it('合并归档失败时保留来源当前版和真实历史', async () => {
    const { service, storage } = createServiceWithStorage()
    const target = versionResource('target', 'target-current')
    const source = versionResource('source', 'source-current')
    const history = versionResource('source-history', 'source-old', 'source')
    await storage.save(target)
    await storage.save(source)
    await storage.saveVersion(history)
    vi.spyOn(storage, 'saveVersion').mockRejectedValueOnce(new Error('归档失败'))

    await expect(service.mergeExistingResourceAsVersion('target', 'source')).rejects.toThrow(
      '归档失败',
    )
    expect(await storage.get('source')).toEqual(source)
    expect(await storage.getVersion('source-history')).toEqual(history)
    expect(await storage.get('target')).toEqual(target)
  })

  it('历史删除未实际落库时报告校验失败并保留原计数', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save({ ...versionResource('target', 'current'), versionCount: 2 })
    await storage.saveVersion(versionResource('history', 'old', 'target'))
    vi.spyOn(storage, 'deleteVersion').mockResolvedValueOnce(undefined)

    await expect(service.deleteVersions('target', ['history'])).rejects.toThrow('删除后校验失败')
    expect(await storage.getVersion('history')).toBeDefined()
    expect((await storage.get('target'))?.versionCount).toBe(2)
  })
})

describe('角色卡内容指纹', () => {
  const cardJson = {
    spec: 'chara_card_v2',
    data: { name: '夜航船', description: '描述', first_mes: '你好。' },
  }

  function cardFile(name: string): File {
    return new File([JSON.stringify(cardJson)], name, { type: 'application/json' })
  }

  it('导入角色卡时写入两级内容指纹', async () => {
    const { service, storage } = createServiceWithStorage()
    const [result] = await service.importFiles([cardFile('card.json')])
    expect(result.status).toBe('imported')
    const saved = (await storage.listSummaries())[0]
    expect(typeof saved.metadata.cardContentHash).toBe('string')
    expect(typeof saved.metadata.cardCoreHash).toBe('string')
  })

  it('同一张 JSON 卡即使键顺序和缩进不同也直接判定已存在', async () => {
    const { service } = createServiceWithStorage()
    await service.importFiles([cardFile('card.json')])
    const reordered = new File(
      [JSON.stringify({ data: cardJson.data, spec: cardJson.spec }, null, 2)],
      'card-export.json',
      { type: 'application/json' },
    )
    const [result] = await service.importFiles([reordered])
    expect(result).toMatchObject({
      status: 'duplicate',
      message: expect.stringContaining('卡内数据完全一致'),
    })
    expect(await service.list()).toHaveLength(1)
  })

  it('重新导入与历史版本相同的卡时命中原版本组且不新增版本', async () => {
    const { service } = createServiceWithStorage()
    const [initial] = await service.importFiles([cardFile('card-v1.json')])
    expect(initial.status).toBe('imported')
    if (initial.status !== 'imported') return

    const v2Card = {
      ...cardJson,
      data: { ...cardJson.data, description: '第二版描述' },
    }
    const [candidate] = await service.importFiles([
      new File([JSON.stringify(v2Card)], 'card-v2.json', { type: 'application/json' }),
    ])
    expect(candidate.status).toBe('versionCandidate')
    if (candidate.status !== 'versionCandidate') return
    await service.importAsVersion(candidate.file, initial.resource.id, true, '第二版')

    const reorderedV1 = new File(
      [JSON.stringify({ data: cardJson.data, spec: cardJson.spec }, null, 2)],
      'card-v1-copy.json',
      { type: 'application/json' },
    )
    const [duplicate] = await service.importFiles([reorderedV1])

    expect(duplicate).toMatchObject({
      status: 'duplicate',
      resource: { id: initial.resource.id },
      message: expect.stringContaining('历史版本'),
    })
    expect(await service.listVersions(initial.resource.id)).toHaveLength(2)
  })

  it('backfillCardFingerprints 为存量卡补指纹且只补一次', async () => {
    const { service, storage } = createServiceWithStorage()
    await storage.save({
      id: 'legacy',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '旧卡',
      description: '',
      fileName: 'legacy.png',
      fileSize: 1,
      mimeType: 'image/png',
      contentHash: 'hash-legacy',
      categoryId: null,
      categoryIds: [],
      relatedResourceIds: [],
      tags: [],
      favorite: false,
      metadata: { card: cardJson },
      originalBlob: new Blob(['png']),
      createdAt: 1,
      updatedAt: 1,
    } as Resource)
    await storage.saveVersion({
      id: 'legacy-history',
      versionGroupId: 'legacy',
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: '旧卡历史版',
      description: '',
      fileName: 'legacy-history.png',
      fileSize: 1,
      mimeType: 'image/png',
      contentHash: 'hash-legacy-history',
      categoryId: null,
      categoryIds: [],
      relatedResourceIds: [],
      tags: [],
      favorite: false,
      metadata: { card: cardJson },
      originalBlob: new Blob(['png']),
      createdAt: 1,
      updatedAt: 1,
    } as Resource)

    expect(await service.backfillCardFingerprints()).toBe(2)
    const updated = await storage.get('legacy')
    const [updatedHistory] = await storage.listVersionSummaries()
    expect(typeof updated?.metadata.cardContentHash).toBe('string')
    expect(typeof updatedHistory?.metadata.cardContentHash).toBe('string')
    expect(await service.backfillCardFingerprints()).toBe(0)
  })

  it('清理拆分副本后：溯源卡内嵌数据完好，关联中的失效 id 已移除', async () => {
    const service = createService()
    const card = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Cleanup Target',
        description: 'for extracted-copy cleanup',
        first_mes: 'Hi.',
        character_book: {
          name: 'Cleanup Lore',
          entries: [{ uid: 1, keys: ['a'], content: 'entry' }],
        },
        extensions: {
          regex_scripts: [{ id: 'rx-1', scriptName: 'Rule', findRegex: '/a/', replaceString: 'b' }],
        },
      },
    }
    const [result] = await service.importFiles(
      [new File([JSON.stringify(card)], 'CleanupTarget.json', { type: 'application/json' })],
      { extractCharacterAssets: true },
    )
    expect(result?.status).toBe('imported')
    const before = await service.list()
    const character = before.find((resource) => resource.type === RESOURCE_TYPE.CHARACTER_CARD)!
    const copies = before.filter((resource) => resource.type !== RESOURCE_TYPE.CHARACTER_CARD)
    expect(copies).toHaveLength(2)
    const cardSnapshot = JSON.stringify(character.metadata.card)

    await service.deleteMany(copies.map((resource) => resource.id))

    const after = await service.list()
    expect(after).toHaveLength(1)
    const survivor = after[0]
    // 内嵌数据逐字节不变：删除副本绝不触碰角色卡原数据
    expect(JSON.stringify(survivor.metadata.card)).toBe(cardSnapshot)
    // 关联中指向已删副本的 id 已被清理
    expect(survivor.relatedResourceIds ?? []).toHaveLength(0)
  })

  it('把分别入库的酒馆原生正则与世界书设为双向关联', async () => {
    const service = createService()
    const regexFile = new File(
      [
        JSON.stringify({
          id: 'status-regex',
          scriptName: '状态栏',
          findRegex: '/<StatusPlaceHolder>([\\s\\S]*?)<\\/StatusPlaceHolder>/g',
          replaceString: '<section>$1</section>',
          placement: [2],
          disabled: false,
          markdownOnly: true,
          promptOnly: false,
          runOnEdit: true,
          substituteRegex: 0,
        }),
      ],
      'status.regex.json',
      { type: 'application/json' },
    )
    const worldbookFile = new File(
      [
        JSON.stringify({
          entries: {
            0: {
              uid: 0,
              comment: '状态栏输出协议',
              content: '每次回复输出状态栏。',
              constant: true,
            },
          },
        }),
      ],
      'status.world.json',
      { type: 'application/json' },
    )
    const results = await service.importFiles([regexFile, worldbookFile], {
      detectVersions: false,
    })
    const resources = results.flatMap((result) =>
      result.status === 'imported' ? [result.resource] : [],
    )

    expect(resources).toHaveLength(2)
    await service.linkResources(resources.map((resource) => resource.id))

    const linked = await service.list()
    expect(linked[0]?.relatedResourceIds).toEqual([linked[1]?.id])
    expect(linked[1]?.relatedResourceIds).toEqual([linked[0]?.id])
  })

  it('用户人设保存后保留旧文件、写入当前版并同步世界书与角色卡关系', async () => {
    const { service, storage } = createServiceWithStorage()
    const [personaResult, worldBookResult, characterResult] = await service.importFiles(
      [
        new File(
          [
            JSON.stringify({
              personas: { 'alice.png': 'Alice' },
              persona_descriptions: {
                'alice.png': { description: '旧描述', position: 0, lorebook: '' },
              },
              default_persona: 'alice.png',
            }),
          ],
          'personas_20260801.json',
          { type: 'application/json' },
        ),
        new File(
          [JSON.stringify({ name: 'Alice Lore', entries: { 0: { content: '档案' } } })],
          'Alice Lore.json',
          { type: 'application/json' },
        ),
        new File(
          [
            JSON.stringify({
              spec: 'chara_card_v3',
              spec_version: '3.0',
              data: { name: 'Detective', description: 'Detective' },
            }),
          ],
          'Detective.json',
          { type: 'application/json' },
        ),
      ],
      { detectVersions: false },
    )
    if (
      personaResult?.status !== 'imported' ||
      worldBookResult?.status !== 'imported' ||
      characterResult?.status !== 'imported'
    ) {
      throw new Error('测试资源导入失败')
    }
    const personaService = new UserPersonaService(service)
    const loaded = await personaService.load(personaResult.resource.id)
    const backup = {
      ...loaded.view.raw,
      persona_descriptions: {
        ...loaded.view.raw.persona_descriptions,
        'alice.png': {
          description: '新描述',
          position: 4,
          depth: 2,
          role: 0,
          lorebook: worldBookResult.resource.name,
          connections: [{ type: 'character', id: 'Detective.png' }],
        },
      },
    }

    await personaService.save(
      personaResult.resource.id,
      backup,
      [worldBookResult.resource.id, characterResult.resource.id],
      '用户人设编辑',
      undefined,
      true,
    )

    const current = await service.get(personaResult.resource.id)
    const currentJson = JSON.parse(await current!.originalBlob.text())
    const versions = await storage.listVersions(personaResult.resource.id)
    expect(currentJson.persona_descriptions['alice.png']).toMatchObject({
      description: '新描述',
      lorebook: 'Alice Lore',
      connections: [{ type: 'character', id: 'Detective.png' }],
    })
    expect(
      JSON.parse(await versions[0]!.originalBlob.text()).persona_descriptions['alice.png'],
    ).toMatchObject({ description: '旧描述' })
    expect(current?.relatedResourceIds).toEqual(
      expect.arrayContaining([worldBookResult.resource.id, characterResult.resource.id]),
    )
    expect((await service.get(worldBookResult.resource.id))?.relatedResourceIds).toContain(
      personaResult.resource.id,
    )
    expect((await service.get(characterResult.resource.id))?.relatedResourceIds).toContain(
      personaResult.resource.id,
    )
  })
})

it('records only the selected target of a manual binding and removes its direction on unlink', async () => {
  const service = createService()
  await service.importFiles([
    new File(['{"name":"A"}'], 'a.json'),
    new File(['{"name":"B"}'], 'b.json'),
  ])
  const [a, b] = await service.list()
  const details = {
    name: a!.name,
    description: '',
    type: a!.type,
    tags: [],
    categoryIds: [],
    relatedResourceIds: [b!.id],
  }
  await service.updateDetails(a!, details)
  const updatedA = (await service.get(a!.id))!
  const updatedB = (await service.get(b!.id))!
  expect(updatedA.metadata.manuallyBoundResourceIds).toEqual([b!.id])
  expect(updatedB.metadata.manuallyBoundResourceIds).toBeUndefined()
  expect(updatedB.relatedResourceIds).toContain(a!.id)
  await service.importAsVersion(new File(['{"name":"A edited"}'], 'a-edited.json'), a!.id, true)
  expect((await service.get(a!.id))!.metadata.manuallyBoundResourceIds).toEqual([b!.id])
  const previous = (await service.listVersions(a!.id)).find((version) => !version.active)!
  await service.activateVersion(a!.id, previous.resource.id)
  expect((await service.get(a!.id))!.metadata.manuallyBoundResourceIds).toEqual([b!.id])
  await service.updateDetails(updatedB, { ...details, name: b!.name, relatedResourceIds: [] })
  expect((await service.get(a!.id))!.metadata.manuallyBoundResourceIds).toEqual([])
})

it('lets persona saves replace current content while retaining only explicitly requested history', async () => {
  const { service, storage } = createServiceWithStorage()
  const personas = new UserPersonaService(service)
  const backup = {
    personas: { 'test.png': '版本选择测试' },
    persona_descriptions: { 'test.png': { description: '初稿' } },
    default_persona: 'test.png',
  }
  const [result] = await service.importFiles([new File([JSON.stringify(backup)], 'persona.json')])
  if (result?.status !== 'imported') throw new Error('测试导入失败')
  const id = result.resource.id
  await service.setFavorite(result.resource, true)
  backup.persona_descriptions['test.png'].description = '小改'
  await personas.save(id, backup, [])
  expect(await storage.listVersions(id)).toHaveLength(0)
  expect((await service.get(id))?.versionCount).toBe(1)
  backup.persona_descriptions['test.png'].description = '正式稿'
  await personas.save(id, backup, [], '主动保留', undefined, true)
  const [history] = await storage.listVersions(id)
  expect(
    JSON.parse(await history!.originalBlob.text()).persona_descriptions['test.png'].description,
  ).toBe('小改')
  backup.persona_descriptions['test.png'].description = '正式稿纠字'
  await personas.save(id, backup, [])
  expect((await storage.listVersions(id)).map((v) => v.id)).toEqual([history!.id])
  const current = (await service.get(id))!
  expect(current.versionCount).toBe(2)
  expect(current.favorite).toBe(true)
  expect(
    JSON.parse(await current.originalBlob.text()).persona_descriptions['test.png'].description,
  ).toBe('正式稿纠字')
})
