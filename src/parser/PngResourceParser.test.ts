import { describe, expect, it, vi } from 'vitest'

import { PngResourceParser } from './PngResourceParser'

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function createChunk(type: string, data = new Uint8Array()): Uint8Array {
  const chunk = new Uint8Array(data.length + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(new TextEncoder().encode(type), 4)
  chunk.set(data, 8)
  return chunk
}

function encodeBase64Utf8(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function createTextChunk(keyword: string, text: string): Uint8Array {
  const data = new TextEncoder().encode(`${keyword}\0${text}`)
  return createChunk('tEXt', data)
}

function createPng(textChunks: Array<{ keyword: string; text: string }> = []): File {
  const chunks = textChunks.map((chunk) => createTextChunk(chunk.keyword, chunk.text))
  const bytes = concatenate([PNG_SIGNATURE, ...chunks, createChunk('IEND')])
  return new File([toArrayBuffer(bytes)], 'card.png', { type: 'image/png' })
}

describe('PngResourceParser', () => {
  it('skips image payloads without reading the whole PNG into JavaScript memory', async () => {
    const file = new File(
      [
        PNG_SIGNATURE,
        createChunk('IDAT', new Uint8Array(8 * 1024 * 1024)),
        createTextChunk('ccv3', encodeBase64Utf8({ name: 'large image' })),
        createChunk('IEND'),
      ].map(toArrayBuffer),
      'large.png',
      { type: 'image/png' },
    )
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('whole PNG read'))
    const slice = vi.spyOn(file, 'slice')
    expect((await new PngResourceParser().parse(file)).name).toBe('large image')
    expect(
      Math.max(...slice.mock.calls.map(([start = 0, end = file.size]) => end - start)),
    ).toBeLessThan(1024)
  })
  it('extracts V2 fields and embedded tags from a chara chunk', async () => {
    const parser = new PngResourceParser()
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '林间记录员',
        description: '负责记录森林中发生的一切。',
        tags: ['奇幻', '奇幻', ' 已校对 ', 12],
        creator: 'SRL Tester',
        character_version: '1.2',
      },
    }

    const result = await parser.parse(
      createPng([{ keyword: 'chara', text: encodeBase64Utf8(card) }]),
    )

    expect(result.name).toBe('林间记录员')
    expect(result.description).toBe('负责记录森林中发生的一切。')
    expect(result.tags).toEqual(['奇幻', '已校对'])
    expect(result.metadata.characterCardSpec).toBe('chara_card_v2')
    expect(result.metadata.characterCardSpecVersion).toBe('2.0')
    expect(result.metadata.creator).toBe('SRL Tester')
    expect(result.metadata.characterVersion).toBe('1.2')
  })

  it('prefers ccv3 metadata when both V2 and V3 chunks exist', async () => {
    const parser = new PngResourceParser()
    const v2 = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '旧名称' } }
    const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '新名称' } }

    const result = await parser.parse(
      createPng([
        { keyword: 'chara', text: encodeBase64Utf8(v2) },
        { keyword: 'CCV3', text: encodeBase64Utf8(v3) },
      ]),
    )

    expect(result.name).toBe('新名称')
    expect(result.metadata.characterCardChunk).toBe('ccv3')
    expect(result.metadata.characterCardSpec).toBe('chara_card_v3')
  })

  it('supports legacy V1 fields at the card root', async () => {
    const parser = new PngResourceParser()
    const card = { name: '旧版角色', description: '旧版描述' }

    const result = await parser.parse(
      createPng([{ keyword: 'chara', text: encodeBase64Utf8(card) }]),
    )

    expect(result.name).toBe('旧版角色')
    expect(result.description).toBe('旧版描述')
    expect(result.metadata.characterCardSpec).toBe('tavern_card_v1')
  })

  it('rejects an ordinary PNG without character metadata', async () => {
    const parser = new PngResourceParser()

    await expect(parser.parse(createPng())).rejects.toThrow('未找到 SillyTavern 角色卡元数据')
  })

  it('reports invalid Base64 metadata', async () => {
    const parser = new PngResourceParser()

    await expect(
      parser.parse(createPng([{ keyword: 'chara', text: 'not-valid-@@' }])),
    ).rejects.toThrow('不是有效 Base64')
  })

  it('reports a truncated PNG chunk', async () => {
    const parser = new PngResourceParser()
    const truncated = concatenate([PNG_SIGNATURE, new Uint8Array([0, 0, 0, 20, 116, 69, 88, 116])])
    const file = new File([toArrayBuffer(truncated)], 'broken.png', { type: 'image/png' })

    await expect(parser.parse(file)).rejects.toThrow('PNG 数据块不完整')
  })
})
