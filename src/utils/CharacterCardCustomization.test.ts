import { describe, expect, it, vi } from 'vitest'

import { PngResourceParser } from '../parser/PngResourceParser'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import {
  applyCharacterCardOverrides,
  characterRegexKey,
  createCharacterCardArtworkFile,
  createModifiedCharacterResource,
  inspectCharacterReplacementResource,
  readCharacterCardOverrides,
} from './CharacterCardCustomization'
import type { CharacterCardContentEdit } from '../types/CharacterCardContentEdit'

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 'card',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '测试角色',
    description: '',
    fileName: 'card.json',
    mimeType: 'application/json',
    fileSize: 2,
    contentHash: 'old',
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    originalBlob: new Blob(['{}'], { type: 'application/json' }),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('CharacterCardCustomization', () => {
  it('refuses a modified export that would silently drop a conflicting content edit', async () => {
    const card = { data: { character_book: { entries: [{ uid: 1, content: '作者新版' }] } } }
    const edit: CharacterCardContentEdit = {
      id: 'edit',
      section: 'worldBook',
      operation: 'update',
      targetKey: '1',
      label: '正文修改',
      before: { uid: 1, content: '旧正文' },
      after: { uid: 1, content: '我的正文' },
      migrateToVersions: true,
      updatedAt: 1,
    }
    await expect(
      createModifiedCharacterResource(
        resource({ metadata: { card, characterContentEdits: [edit] } }),
        [],
      ),
    ).rejects.toThrow('无法应用')
    expect(card.data.character_book.entries[0]?.content).toBe('作者新版')
  })
  it('rewrites a PNG card using bounded header reads, preserving its pixels', async () => {
    const png = new Blob(
      [
        Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          ),
          (c) => c.charCodeAt(0),
        ),
      ],
      { type: 'image/png' },
    )
    const wholeRead = vi.spyOn(png, 'arrayBuffer').mockRejectedValue(new Error('whole PNG read'))
    const card = {
      name: 'streamed',
      extensions: { regex_scripts: [{ id: 'one', disabled: true }] },
    }
    const output = await createModifiedCharacterResource(
      resource({
        originalBlob: png,
        mimeType: 'image/png',
        fileName: 'card.png',
        fileSize: png.size,
        metadata: { card, characterOverrides: { regexEnabled: { 'id:one': true } } },
      }),
      [],
    )
    expect(wholeRead).not.toHaveBeenCalled()
    const parsed = await new PngResourceParser().parse(new File([output.originalBlob], 'card.png'))
    expect(parsed.metadata.card).toEqual(output.metadata.card)
    expect(await output.originalBlob.slice(0, 56).arrayBuffer()).toEqual(
      await png.slice(0, 56).arrayBuffer(),
    )
  })

  it('reads a clean serializable override layer', () => {
    expect(
      readCharacterCardOverrides({
        characterOverrides: {
          regexEnabled: { 'id:one': true, invalid: 'yes' },
          worldBookResourceId: 'book',
        },
      }),
    ).toEqual({ regexEnabled: { 'id:one': true }, worldBookResourceId: 'book' })
  })

  it('applies regex status and bound content without mutating the source card', () => {
    const source = {
      spec: 'chara_card_v3',
      data: {
        first_mes: '原开场',
        alternate_greetings: [],
        character_book: { name: '原世界书', entries: [] },
        extensions: {
          regex_scripts: [{ id: 'one', scriptName: '规则', disabled: true }],
        },
      },
    }
    const key = characterRegexKey(source.data.extensions.regex_scripts[0]!, 0)
    const result = applyCharacterCardOverrides(
      source,
      {
        regexEnabled: { [key]: true },
        worldBookResourceId: 'book',
        greetingResourceId: 'greeting',
      },
      {
        worldBook: { name: '新世界书', entries: [{ content: '设定' }] },
        greetings: ['新主开场', '新备用'],
      },
    )

    const data = result.data as {
      extensions: { regex_scripts: Array<{ disabled: boolean }> }
      character_book: { name: string }
      alternate_greetings: string[]
    }
    expect(data.extensions.regex_scripts[0]?.disabled).toBe(false)
    expect(data.character_book.name).toBe('新世界书')
    expect(data.alternate_greetings).toEqual(['新备用'])
    expect(source.data.first_mes).toBe('原开场')
  })

  it('exports recorded card-content edits while leaving the stored original bytes untouched', async () => {
    const card = {
      spec: 'chara_card_v3',
      data: { name: '测试角色', first_mes: '原开场', alternate_greetings: [] },
    }
    const originalBlob = new Blob([JSON.stringify(card)], { type: 'application/json' })
    const contentEdit: CharacterCardContentEdit = {
      id: 'greeting-1',
      section: 'greeting',
      operation: 'add',
      targetKey: 'alternate:new-1',
      label: '备用开场白',
      after: '新开场',
      migrateToVersions: true,
      updatedAt: 1,
    }
    const source = resource({
      originalBlob,
      metadata: { card, characterContentEdits: [contentEdit] },
    })

    const modified = await createModifiedCharacterResource(source, [])
    expect(JSON.parse(await modified.originalBlob.text()).data.alternate_greetings).toEqual([
      '新开场',
    ])
    expect(source.originalBlob).toBe(originalBlob)
    expect(source.metadata.characterContentEdits).toEqual([contentEdit])
    expect(modified.metadata.characterContentEdits).toBeUndefined()
  })

  it('detects world books and standalone greetings from related resources', async () => {
    const book = resource({
      id: 'book',
      type: RESOURCE_TYPE.WORLD_BOOK,
      originalBlob: new Blob([JSON.stringify({ name: '书', entries: [{ content: '设定' }] })]),
    })
    const greeting = resource({
      id: 'greeting',
      type: RESOURCE_TYPE.OTHER,
      originalBlob: new Blob([
        JSON.stringify({ first_mes: '你好', alternate_greetings: ['欢迎'] }),
      ]),
    })

    expect((await inspectCharacterReplacementResource(book)).worldBook?.name).toBe('书')
    expect((await inspectCharacterReplacementResource(greeting)).greetings).toEqual([
      '你好',
      '欢迎',
    ])
  })

  it('creates a modified JSON export while preserving the stored original resource', async () => {
    const card = {
      spec: 'chara_card_v3',
      data: {
        name: '测试角色',
        first_mes: '原开场',
        extensions: { regex_scripts: [{ id: 'one', disabled: true }] },
      },
    }
    const originalBlob = new Blob([JSON.stringify(card)], { type: 'application/json' })
    const source = resource({
      originalBlob,
      metadata: {
        card,
        characterOverrides: { regexEnabled: { 'id:one': true } },
      },
    })

    const modified = await createModifiedCharacterResource(source, [])
    expect(
      JSON.parse(await modified.originalBlob.text()).data.extensions.regex_scripts[0].disabled,
    ).toBe(false)
    expect(source.originalBlob).toBe(originalBlob)
    expect(source.metadata.characterOverrides).toBeDefined()
    expect(modified.metadata.characterOverrides).toBeUndefined()
  })

  it('把普通 PNG 卡面生成为可导入酒馆的新封装且保留来源资源', async () => {
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '测试角色', description: '原始设定' },
    }
    const source = resource({ metadata: { card } })
    const binary = atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    )
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const artwork = new File([bytes], '喜欢的卡面.png', { type: 'image/png' })

    const output = await createCharacterCardArtworkFile(source, artwork)
    const parsed = await new PngResourceParser().parse(output)

    expect(parsed.name).toBe('测试角色')
    expect(parsed.description).toBe('原始设定')
    expect(source.originalBlob.type).toBe('application/json')
    expect(output.name).toContain('自定义卡面')
  })
})
