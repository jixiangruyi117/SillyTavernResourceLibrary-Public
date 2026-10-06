import { describe, expect, it } from 'vitest'
import { Unzip, UnzipInflate, Zip, ZipPassThrough, zipSync } from 'fflate'
import { zipArchiveChunks } from './ZipArchiveStream'
import { stageArchive } from '../services/ArchiveExtraction'
import { MemoryRestoreStagingStore } from '../storage/RestoreStagingStore'

async function collect(file: Blob) {
  const chunks = []
  for await (const chunk of zipArchiveChunks(file)) chunks.push(chunk)
  return chunks
}

describe('ZIP central-directory streaming', () => {
  it('bounds a single inflate callback for highly compressed text', async () => {
    const input = new Uint8Array(16 * 1024 * 1024).fill(65)
    const file = new Blob([new Uint8Array(zipSync({ 'text.txt': input }))])
    let total = 0
    let peak = 0
    const unzip = new Unzip((entry) => {
      entry.ondata = (error, data) => {
        if (error) throw error
        total += data.length
        peak = Math.max(peak, data.length)
      }
      entry.start()
    })
    unzip.register(UnzipInflate)
    for await (const chunk of zipArchiveChunks(file)) unzip.push(chunk, false)
    unzip.push(new Uint8Array(), true)
    expect(total).toBe(input.length)
    expect(peak).toBeLessThan(9 * 1024 * 1024)
  })
  it('reads ZIP64 directory offsets without requiring full-file buffering', async () => {
    const bytes = zipSync({ 'file.txt': new TextEncoder().encode('value') })
    const endOffset = bytes.length - 22
    const end = bytes.slice(endOffset)
    const old = new DataView(end.buffer)
    const record = new Uint8Array(56)
    const zip64 = new DataView(record.buffer)
    zip64.setUint32(0, 0x06064b50, true)
    zip64.setBigUint64(4, 44n, true)
    zip64.setBigUint64(24, 1n, true)
    zip64.setBigUint64(32, 1n, true)
    zip64.setBigUint64(40, BigInt(old.getUint32(12, true)), true)
    zip64.setBigUint64(48, BigInt(old.getUint32(16, true)), true)
    const locator = new Uint8Array(20)
    const locate = new DataView(locator.buffer)
    locate.setUint32(0, 0x07064b50, true)
    locate.setBigUint64(8, BigInt(endOffset), true)
    locate.setUint32(16, 1, true)
    old.setUint16(10, 0xffff, true)
    old.setUint32(12, 0xffffffff, true)
    old.setUint32(16, 0xffffffff, true)
    const staging = new MemoryRestoreStagingStore()
    const job = await stageArchive(
      new File([bytes.slice(0, endOffset), record, locator, end], 'zip64.zip'),
      staging,
    )
    expect(await (await staging.get(job, 'file.txt'))?.blob.text()).toBe('value')
  })
  it('does not treat stored nested ZIP signatures as outer entry boundaries, including trailing empty files', async () => {
    const nested = zipSync({ 'code.js': new TextEncoder().encode('example') }, { level: 0 })
    const parts: BlobPart[] = []
    const zip = new Zip((error, data) => {
      if (error) throw error
      parts.push(new Uint8Array(data))
    })
    for (const [name, content] of [
      ['nested.apk', nested],
      ['empty.txt', new Uint8Array()],
    ] as const) {
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      entry.push(content, true)
    }
    zip.end()
    const staging = new MemoryRestoreStagingStore()
    const job = await stageArchive(new File(parts, 'nested.zip'), staging)
    expect(
      new Uint8Array(await (await staging.get(job, 'nested.apk'))!.blob.arrayBuffer()),
    ).toEqual(nested)
    expect((await staging.get(job, 'empty.txt'))?.size).toBe(0)
  })

  it('reports decompressed bytes while entries are being staged', async () => {
    const content = new Uint8Array(2 * 1024 * 1024)
    for (let index = 0; index < content.length; index++) content[index] = index % 251
    const bytes = zipSync({ 'large.bin': content })
    const updates: Array<{ phase: string; stagedBytes?: number; totalStagedBytes?: number }> = []
    const staging = new MemoryRestoreStagingStore()

    await stageArchive(
      new File([bytes], 'large.zip'),
      staging,
      () => true,
      (progress) => {
        updates.push(progress)
      },
    )

    expect(
      updates.some(
        (progress) =>
          progress.phase === 'staging' &&
          (progress.stagedBytes ?? 0) > 0 &&
          progress.totalStagedBytes === content.length,
      ),
    ).toBe(true)
    expect(updates.at(-1)?.phase).toBe('complete')
  })

  it('rejects truncated or mismatched directory offsets before reading payloads', async () => {
    const bytes = zipSync({ 'file.txt': new TextEncoder().encode('value') })
    await expect(collect(new Blob([bytes.slice(0, -5)]))).rejects.toThrow('ZIP')
    const view = new DataView(bytes.buffer)
    const directory = view.getUint32(bytes.length - 6, true)
    view.setUint32(directory + 42, directory + 1, true)
    await expect(collect(new Blob([bytes]))).rejects.toThrow('ZIP')
  })
})
