// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import archive from '../templates/FrontendWorkshopArchive.html?raw'
import observatory from '../templates/FrontendWorkshopObservatory.html?raw'
import deepSea from '../templates/FrontendWorkshopDeepSea.html?raw'
import {
  createFrontendWorkshopSourceDelivery,
  createFrontendWorkshopGreetingFile,
  readFrontendWorkshopCompanionScripts,
  createFrontendWorkshopSplitGreetingFile,
  createFrontendWorkshopHelperScriptsFile,
} from './FrontendWorkshopSourceDelivery'

describe('Source delivery', () => {
  it('splits inert companion data from opening JSON and exports a TavernHelper script folder', async () => {
    const tag = (name: string) =>
      `<script type="application/json" data-tavern-helper-script>${JSON.stringify({ type: 'script', name, content: `run${name}()`, enabled: true })}</script>`
    const source = `<body><style>h1{color:red}</style><h1>角色</h1><script>animate()</script>${tag('A')}${tag('B')}</body>`
    const read = (file: Blob) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(file)
      })
    const opening = JSON.parse(await read(createFrontendWorkshopSplitGreetingFile(source)))
    expect(opening.first_mes).toContain('<script>animate()</script>')
    expect(opening.first_mes).not.toContain('data-tavern-helper-script')
    expect(opening.first_mes).not.toContain('runA()')
    expect(opening.companion_scripts).toEqual([])
    const scripts = JSON.parse(await read(createFrontendWorkshopHelperScriptsFile(source)))
    expect(scripts).toMatchObject({
      type: 'folder',
      enabled: false,
      scripts: [
        { type: 'script', name: 'A', enabled: false },
        { type: 'script', name: 'B', enabled: false },
      ],
    })
    expect(JSON.parse(await read(createFrontendWorkshopHelperScriptsFile(tag('A')))).type).toBe(
      'script',
    )
  })
  it('saves the full source envelope and exact alternate texts as a portable opening resource', async () => {
    const source =
      '<body><h1>完整前端</h1><script type="application/json" data-tavern-character>{"name":"示例人物","alternate_greetings":[" 第一幕 ","第二幕"]}</script></body>'
    const file = createFrontendWorkshopGreetingFile(source, '我的作品')
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsText(file)
    })
    const value = JSON.parse(text)
    expect(file.name).toBe('我的作品.greeting.json')
    expect(value).toMatchObject({
      format: 'srl-greeting',
      name: '我的作品',
      alternate_greetings: [' 第一幕 ', '第二幕'],
      companion_scripts: [],
    })
    expect(value.first_mes).toContain(source)
    expect(value.spec).toBeUndefined()
    expect(value.description).toBeUndefined()
  })
  it('exports unchanged HTML, Tavern envelope and inert independent script without running it', async () => {
    const content = 'throw new Error("must not execute"); const html = "</script>";'
    const payload = JSON.stringify({
      type: 'script',
      name: '计数器',
      content,
      enabled: true,
    }).replaceAll('<', '\\u003c')
    const source = `<body><h1>仪表</h1><script type="application/json" data-tavern-helper-script>${payload}</script></body>`
    const blob = await createFrontendWorkshopSourceDelivery(source)
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = reject
      reader.readAsArrayBuffer(blob)
    })
    const files = unzipSync(new Uint8Array(bytes))
    expect(strFromU8(files['前端.html']!)).toBe(source)
    expect(strFromU8(files['酒馆开场白.txt']!)).toContain(source)
    expect(JSON.parse(strFromU8(files['配套脚本-1.json']!))).toMatchObject({
      content,
      enabled: false,
    })
  })
  it('rejects malformed companion JSON instead of silently omitting a requested script', () => {
    expect(() =>
      readFrontendWorkshopCompanionScripts(
        '<script type="application/json" data-tavern-helper-script>{oops}</script>',
      ),
    ).toThrow('JSON')
    expect(readFrontendWorkshopCompanionScripts('<script>throw 1</script>')).toEqual([])
  })

  it.each([
    { source: archive, name: '沈知遥', count: 3, text: '第七十三页' },
    { source: deepSea, name: '沈砚潮', count: 4, text: '一千一百二十米' },
  ])(
    'exports $name introduction and $count actual alternate greetings in one importable card',
    async ({ source, name, count, text }) => {
      const blob = await createFrontendWorkshopSourceDelivery(source)
      const bytes = await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(blob)
      })
      const files = unzipSync(new Uint8Array(bytes))
      const card = JSON.parse(strFromU8(files['角色卡.json']!))
      expect(card.spec).toBe('chara_card_v2')
      expect(card.data.name).toBe(name)
      expect(card.data.first_mes).toContain(source)
      expect(card.data.alternate_greetings).toHaveLength(count)
      expect(card.data.alternate_greetings[1]).toContain(text)
      card.data.alternate_greetings.forEach((text: string, index: number) => {
        expect(text.length).toBeGreaterThan(180)
        expect(strFromU8(files[`备用开场白/${index + 1}.txt`]!)).toBe(text)
      })
      expect(strFromU8(files['前端.html']!)).toBe(source)
    },
  )

  it('does not silently omit malformed alternate greetings during export', async () => {
    await expect(
      createFrontendWorkshopSourceDelivery(
        '<script type="application/json" data-tavern-character>{"name":"角色","alternate_greetings":[""]}</script>',
      ),
    ).rejects.toThrow('alternate_greetings')
    await expect(
      createFrontendWorkshopSourceDelivery(
        '<script type="application/json" data-tavern-character>{bad}</script>',
      ),
    ).rejects.toThrow('JSON')
  })

  it('also includes observatory alternate greetings as real character-card data', async () => {
    const blob = await createFrontendWorkshopSourceDelivery(observatory)
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blob)
    })
    const card = JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['角色卡.json']!))
    expect(card.data.alternate_greetings).toHaveLength(3)
    expect(card.data.alternate_greetings[1]).toContain('末班车')
    expect(card.data.first_mes).toContain(observatory)
  })
})
