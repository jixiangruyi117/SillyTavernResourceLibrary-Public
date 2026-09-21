import { describe, expect, it } from 'vitest'
import { Zip, ZipPassThrough, zipSync } from 'fflate'
import { zipArchiveChunks } from './ZipArchiveStream'
import { stageArchive } from '../services/ArchiveExtraction'
import { MemoryRestoreStagingStore } from '../storage/RestoreStagingStore'

async function collect(file: Blob) {
  const chunks = []
  for await (const chunk of zipArchiveChunks(file)) chunks.push(chunk)
  return chunks
}

describe('ZIP central-directory streaming', () => {
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

  it('rejects truncated or mismatched directory offsets before reading payloads', async () => {
    const bytes = zipSync({ 'file.txt': new TextEncoder().encode('value') })
    await expect(collect(new Blob([bytes.slice(0, -5)]))).rejects.toThrow('ZIP')
    const view = new DataView(bytes.buffer)
    const directory = view.getUint32(bytes.length - 6, true)
    view.setUint32(directory + 42, directory + 1, true)
    await expect(collect(new Blob([bytes]))).rejects.toThrow('ZIP')
  })
})
