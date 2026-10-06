// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopGreetingPatch } from './FrontendWorkshopSourceGreetings'
import { prepareFrontendWorkshopSourcePatch } from './FrontendWorkshopSourcePatch'
import {
  createFrontendWorkshopSourceDelivery,
  readFrontendWorkshopCharacterData,
} from './FrontendWorkshopSourceDelivery'

describe('greeting source writes', () => {
  const code = `<style>h1 { color: red }</style><h1>主开场白</h1>
<script data-tavern-character type="application/json">{
  "name": "人物", "unknown": {"alternate_greetings":["不要改"]},
  "alternate_greetings": [ "重复正文", "重复正文" ], "unknownKey": 1
}</script><script>window.example = true;</script>`
  it('edits only the selected string, preserving duplicate text, unknown data and all other source bytes', () => {
    const source = createFrontendWorkshopSourceDocument('p', code, 1)
    const patch = createFrontendWorkshopGreetingPatch(
      source,
      2,
      '新正文\n{{user}} 和 "角色" </script>',
    )
    const next = prepareFrontendWorkshopSourcePatch(source, patch).authorSource
    expect(next).toBe(
      code.replace('"重复正文" ],', '"新正文\\n{{user}} 和 \\"角色\\" \\u003c/script>" ],'),
    )
    expect(readFrontendWorkshopCharacterData(next)?.alternate_greetings).toEqual([
      '重复正文',
      '新正文\n{{user}} 和 "角色" </script>',
    ])
    expect(() => prepareFrontendWorkshopSourcePatch({ ...source, revision: 2 }, patch)).toThrow(
      /revision/,
    )
  })
  it('exports the modified alternate into both the real character card and the individual text file', async () => {
    const source = createFrontendWorkshopSourceDocument('p', code, 1)
    const next = prepareFrontendWorkshopSourcePatch(
      source,
      createFrontendWorkshopGreetingPatch(source, 1, '新的第一幕'),
    ).authorSource
    const blob = await createFrontendWorkshopSourceDelivery(next)
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = reject
      reader.readAsArrayBuffer(blob)
    })
    const files = unzipSync(bytes)
    expect(JSON.parse(strFromU8(files['角色卡.json']!)).data.alternate_greetings).toEqual([
      '新的第一幕',
      '重复正文',
    ])
    expect(strFromU8(files['备用开场白/1.txt']!)).toBe('新的第一幕')
  })
  it('does not edit character data inside an inactive template', () => {
    const inactive =
      '<template><script type="application/json" data-tavern-character>{"name":"未使用","alternate_greetings":["不要改"]}</script></template>'
    const source = createFrontendWorkshopSourceDocument('p', inactive + code, 1)
    const next = prepareFrontendWorkshopSourcePatch(
      source,
      createFrontendWorkshopGreetingPatch(source, 1, '有效正文'),
    ).authorSource
    expect(next.startsWith(inactive)).toBe(true)
    expect(readFrontendWorkshopCharacterData(next)?.alternate_greetings).toEqual([
      '有效正文',
      '重复正文',
    ])
  })
  it('does not invent missing alternates or accept an empty greeting', () => {
    const source = createFrontendWorkshopSourceDocument('p', code, 1)
    expect(() => createFrontendWorkshopGreetingPatch(source, 3, '正文')).toThrow(/不存在/)
    expect(() => createFrontendWorkshopGreetingPatch(source, 1, ' ')).toThrow(/填写/)
  })
})
