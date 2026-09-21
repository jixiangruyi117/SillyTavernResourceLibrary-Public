import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { Zip, ZipDeflate, ZipPassThrough, zipSync } from 'fflate'
import { readNovelAiImage } from './NovelAiImageResponse'
import * as capacitor from '../utils/CapacitorDetection'

beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => undefined))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const MIB = 1024 * 1024

function response(body: BodyInit, type = 'application/octet-stream') {
  return new Response(body, {
    headers: {
      'content-type': type,
      'content-disposition': 'attachment; filename="images.zip"',
    },
  })
}
function concat(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

// An independent library generates the real local headers, descriptors and directory.
function streamingZip(
  entries: readonly { name: string; bytes: Uint8Array; stored?: boolean; level?: 0 }[] = [
    { name: 'result', bytes: PNG_BYTES },
  ],
) {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, chunk) => {
    if (error) throw error
    chunks.push(chunk)
  })
  for (const entry of entries) {
    const file = entry.stored
      ? new ZipPassThrough(entry.name)
      : new ZipDeflate(entry.name, { level: entry.level })
    archive.add(file)
    const split = Math.floor(entry.bytes.length / 2)
    file.push(entry.bytes.subarray(0, split), false)
    file.push(entry.bytes.subarray(split), true)
  }
  archive.end()
  return concat(chunks)
}
function expectPng(parsed: Awaited<ReturnType<typeof readNovelAiImage>>, bytes = PNG_BYTES) {
  expect(parsed).toEqual({
    mimeType: 'image/png',
    extension: 'png',
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
  })
}

describe('NovelAI response parser', () => {
  it('does not hash or log successful ZIP responses in production', async () => {
    vi.stubEnv('DEV', false)
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
    expectPng(await readNovelAiImage(response(streamingZip())))
    expect(digest).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
  })
  it('keeps compact APK ZIP errors without envelope dumps, hashing or library causes', async () => {
    vi.stubEnv('DEV', false)
    vi.spyOn(capacitor, 'getCapacitorPlatform').mockReturnValue('android')
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest')
    const bytes = streamingZip().subarray(0, -22)
    const failure = await readNovelAiImage(
      response(bytes, 'binary/octet-stream'),
      'capacitor-original-fetch',
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected ZIP diagnostic')
    expect(failure.message).toMatch(/NovelAI ZIP 解压失败.*runtime=capacitor-android;/u)
    expect(failure.message).toContain('transport=capacitor-original-fetch')
    expect(failure.message).toContain('stage=zip-extract')
    expect(failure.message).toContain('content-type=binary/octet-stream')
    expect(failure.message).toContain('content-disposition=attachment; filename="images.zip"')
    expect(failure.message).toContain(`byteLength=${bytes.length}`)
    expect(failure.message).toContain('magic=50 4b 03 04')
    expect(failure.message.match(/byteLength=/gu)).toHaveLength(1)
    expect(failure.message.length).toBeLessThan(400)
    expect(failure.message).not.toMatch(
      /tail=|Sha256|EOCD|localHeaderFlags|DataDescriptor|centralDirectory|central-directory|zipStage|result|End of data/u,
    )
    expect(digest).not.toHaveBeenCalled()
    expect(failure.cause).toBeUndefined()
  })
  it('reads an ordinary zipSync PNG using JSZip', async () => {
    const load = vi.spyOn(JSZip, 'loadAsync')
    expectPng(await readNovelAiImage(response(zipSync({ 'image.png': PNG_BYTES }))))
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('detects images by magic bytes without a filename extension', async () => {
    expectPng(await readNovelAiImage(response(zipSync({ result: PNG_BYTES }))))
  })
  it.each([false, true])('reads real data descriptors (stored=%s)', async (stored) => {
    const zip = streamingZip([{ name: 'result', bytes: PNG_BYTES, stored }])
    const view = new DataView(zip.buffer)
    expect(view.getUint16(6, true) & 8).toBe(8)
    expect(view.getUint32(18, true)).toBe(0)
    expect(view.getUint32(22, true)).toBe(0)
    expectPng(await readNovelAiImage(response(zip, 'binary/octet-stream')))
  })
  it.each([0x08074b50, 0x04034b50, 0x02014b50])(
    'does not mistake embedded ZIP signature %i for a descriptor boundary',
    async (signature) => {
      // Level zero DEFLATE embeds these bytes literally in a valid compressed block.
      const data = new Uint8Array(4096)
      data.set(PNG_BYTES)
      new DataView(data.buffer).setUint32(100, signature, true)
      const zip = streamingZip([{ name: 'result', bytes: data, level: 0 }])
      const view = new DataView(zip.buffer)
      const start = 30 + view.getUint16(26, true) + view.getUint16(28, true)
      const embedded = zip.findIndex(
        (_, index) =>
          index >= start && index < start + 200 && view.getUint32(index, true) === signature,
      )
      expect(embedded).toBeGreaterThan(start)
      expectPng(await readNovelAiImage(response(zip)), data)
    },
  )
  it('skips metadata and directories and returns the first magic-matched image', async () => {
    const zip = zipSync({
      'folder/': new Uint8Array(),
      'misleading.png': new TextEncoder().encode('private metadata'),
      'empty.png': new Uint8Array(),
      result: PNG_BYTES,
      second: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    })
    expectPng(await readNovelAiImage(response(zip)))
  })
  it.each([
    ['jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    ['webp', new TextEncoder().encode('RIFF0000WEBP')],
  ] as const)('recognizes %s magic despite misleading filenames', async (format, bytes) => {
    const parsed = await readNovelAiImage(response(streamingZip([{ name: 'fake.png', bytes }])))
    expect(parsed.extension).toBe(format)
    expect(parsed.dataUrl).toBe(
      `data:image/${format};base64,${Buffer.from(bytes).toString('base64')}`,
    )
  })
  it.each([
    ['empty archive', {}],
    ['empty image', { 'image.png': new Uint8Array() }],
    ['metadata only', { 'private-name.png': new TextEncoder().encode('private-content-secret') }],
  ])('rejects %s without treating extensions as image evidence', async (_, files) => {
    const failure = await readNovelAiImage(response(zipSync(files))).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected ZIP diagnostic')
    expect(failure.message).toContain('压缩包中没有可识别图片')
    expect(failure.message).toContain(`entries=${Object.keys(files).length}`)
    expect(failure.message).toContain('byteLength=')
    for (const secret of ['private-name', 'private-content', 'zipStage']) {
      expect(failure.message).not.toContain(secret)
    }
    expect(failure.message).not.toContain('70 72 69 76')
  })
  it('does not use entry paths as filesystem output paths', async () => {
    expectPng(await readNovelAiImage(response(zipSync({ '../../image.png': PNG_BYTES }))))
  })
  it('reads ordinary filename and extra fields through JSZip', async () => {
    const zip = zipSync({
      'metadata.json': new TextEncoder().encode('{}'),
      result: [PNG_BYTES, { extra: { 0xcafe: new Uint8Array([1, 2, 3]) } }],
    })
    expectPng(await readNovelAiImage(response(zip)))
  })
  it.each(['encrypted', 'unsupported method'] as const)('rejects %s ZIP entries', async (kind) => {
    const zip = zipSync({ 'private-name': PNG_BYTES })
    const view = new DataView(zip.buffer)
    const directory = view.getUint32(zip.length - 6, true)
    expect(view.getUint32(directory, true)).toBe(0x02014b50)
    if (kind === 'encrypted') {
      view.setUint16(6, 1, true)
      view.setUint16(directory + 8, 1, true)
    } else {
      view.setUint16(8, 99, true)
      view.setUint16(directory + 10, 99, true)
    }
    await expect(readNovelAiImage(response(zip))).rejects.toThrow('NovelAI ZIP 解压失败')
  })
  it('rejects damaged ZIP structure with a safe response fingerprint', async () => {
    const zip = streamingZip()
    await expect(readNovelAiImage(response(zip.subarray(0, zip.length - 30)))).rejects.toThrow(
      /NovelAI ZIP 解压失败.*byteLength=.*magic=50 4b 03 04/u,
    )
  })
  it('rejects damaged deflate even if an earlier entry contained an image', async () => {
    const zip = zipSync({ first: PNG_BYTES, bad: PNG_BYTES })
    const view = new DataView(zip.buffer)
    const firstData = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    const secondHeader = firstData + view.getUint32(18, true)
    expect(view.getUint32(secondHeader, true)).toBe(0x04034b50)
    const secondData =
      secondHeader +
      30 +
      view.getUint16(secondHeader + 26, true) +
      view.getUint16(secondHeader + 28, true)
    zip[secondData] = 0x07 // Reserved DEFLATE BTYPE=3.
    await expect(readNovelAiImage(response(zip))).rejects.toThrow('NovelAI ZIP 解压失败')
  })
  it('does not expose private decoder errors or causes', async () => {
    vi.spyOn(JSZip, 'loadAsync').mockRejectedValueOnce(new Error('private prompt token filename'))
    const failure = await readNovelAiImage(response(zipSync({ result: PNG_BYTES }))).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected ZIP diagnostic')
    expect(failure.message).toContain('NovelAI ZIP 解压失败')
    expect(failure.message).toContain('stage=zip-extract')
    expect(failure.message).not.toContain('private')
    expect(failure.cause).toBeUndefined()
  })
  it('limits entry count including directories', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`folder-${index}/`, new Uint8Array()]),
    )
    await expect(readNovelAiImage(response(zipSync(entries)))).rejects.toThrow('条目数量超出上限')
  })
  it('rejects actual per-entry output beyond 32 MiB instead of accepting an earlier PNG', async () => {
    const zip = zipSync({ first: PNG_BYTES, oversized: new Uint8Array(33 * MIB) })
    await expect(readNovelAiImage(response(zip))).rejects.toThrow('解压大小超出上限')
  })
  it('limits total decompressed output to 64 MiB', async () => {
    const bytes = new Uint8Array(24 * MIB)
    await expect(
      readNovelAiImage(response(zipSync({ a: bytes, b: bytes, c: bytes }))),
    ).rejects.toThrow('解压大小超出上限')
  })
  it('limits actual output even when the ZIP lies about uncompressed size', async () => {
    const zip = zipSync({ oversized: new Uint8Array(33 * MIB) })
    const view = new DataView(zip.buffer)
    // Mutate a library-produced fixture, never parse ZIP headers in the production service.
    const directory = view.getUint32(zip.length - 6, true)
    expect(view.getUint32(directory, true)).toBe(0x02014b50)
    view.setUint32(22, 1, true)
    view.setUint32(directory + 24, 1, true)
    await expect(readNovelAiImage(response(zip))).rejects.toThrow('解压大小超出上限')
  })
  it('reads raw PNG regardless of MIME without ZIP extraction', async () => {
    const load = vi.spyOn(JSZip, 'loadAsync')
    expectPng(await readNovelAiImage(response(PNG_BYTES)))
    expect(load).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
  })
  it.each([4, 1024])('bounds unknown response magic to 16 bytes (length=%i)', async (length) => {
    const bytes = new Uint8Array(length).fill(1)
    const failure = await readNovelAiImage(response(bytes), 'browser-fetch').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected response diagnostic')
    expect(failure.message).toContain('runtime=web; transport=browser-fetch')
    expect(failure.message).toContain('content-type=application/octet-stream')
    expect(failure.message).toContain(`byteLength=${length}`)
    expect(failure.message.match(/magic=([^;]+)/u)?.[1]).toBe(
      Array(Math.min(length, 16)).fill('01').join(' '),
    )
    expect(failure.message).toContain('stage=response-parse')
  })
  it('rejects an empty response', async () => {
    await expect(readNovelAiImage(response(new Uint8Array()))).rejects.toThrow(
      'NovelAI 返回了空图片',
    )
  })
  it.each([
    ['application/json', JSON.stringify({ image: 'aW1hZ2U=' })],
    ['application/json', JSON.stringify({ images: [{ image: 'aW1hZ2U=' }] })],
    ['text/event-stream', 'data: {"progress":1}\n\ndata: {"image":"aW1hZ2U="}\n\ndata: [DONE]\n\n'],
  ])('preserves %s parsing without ZIP extraction', async (type, body) => {
    const load = vi.spyOn(JSZip, 'loadAsync')
    expect((await readNovelAiImage(response(body, type))).dataUrl).toBe(
      'data:image/png;base64,aW1hZ2U=',
    )
    expect(load).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
  })
})
