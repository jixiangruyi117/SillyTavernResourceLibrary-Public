/** Feed ZIP entries using central-directory boundaries, never signatures inside APK/ZIP payloads. */
export async function* zipArchiveChunks(file: Blob): AsyncGenerator<Uint8Array> {
  const read = async (offset: number, length: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > file.size)
      throw new Error('ZIP 边界无效')
    return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
  }
  const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const uint64 = (data: DataView, offset: number) => {
    const value = Number(data.getBigUint64(offset, true))
    if (!Number.isSafeInteger(value)) throw new Error('ZIP64 大小超出支持范围')
    return value
  }
  const tailOffset = Math.max(0, file.size - 65557)
  const tail = view(await read(tailOffset, file.size - tailOffset))
  let end = tail.byteLength - 22
  while (end >= 0) {
    if (
      tail.getUint32(end, true) === 0x06054b50 &&
      end + 22 + tail.getUint16(end + 20, true) === tail.byteLength
    )
      break
    end--
  }
  if (end < 0) throw new Error('ZIP 缺少目录')
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true))
    throw new Error('不支持分卷 ZIP')
  let count = tail.getUint16(end + 10, true)
  let directorySize = tail.getUint32(end + 12, true)
  let directoryOffset = tail.getUint32(end + 16, true)
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    const locator = view(await read(tailOffset + end - 20, 20))
    if (
      locator.getUint32(0, true) !== 0x07064b50 ||
      locator.getUint32(4, true) ||
      locator.getUint32(16, true) !== 1
    )
      throw new Error('ZIP64 目录无效')
    const zip64 = view(await read(uint64(locator, 8), 56))
    if (
      zip64.getUint32(0, true) !== 0x06064b50 ||
      zip64.getUint32(16, true) ||
      zip64.getUint32(20, true)
    )
      throw new Error('ZIP64 目录无效')
    count = uint64(zip64, 32)
    directorySize = uint64(zip64, 40)
    directoryOffset = uint64(zip64, 48)
  }
  if (
    count > 100000 ||
    directorySize > 64 * 1024 * 1024 ||
    directoryOffset + directorySize > tailOffset + end
  )
    throw new Error('ZIP 目录超出支持范围')
  // Only bounded metadata is materialized; attachment bytes remain sliced and streamed.
  const directory = await read(directoryOffset, directorySize)
  const data = view(directory)
  let cursor = 0
  let previousEnd = 0
  const entries: Array<{
    offset: number
    compressed: number
    original: number
    crc: number
    method: number
    name: Uint8Array
  }> = []
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directory.length || data.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('ZIP 目录损坏')
    const nameLength = data.getUint16(cursor + 28, true)
    const extraLength = data.getUint16(cursor + 30, true)
    const recordEnd = cursor + 46 + nameLength + extraLength + data.getUint16(cursor + 32, true)
    if (
      recordEnd > directory.length ||
      data.getUint16(cursor + 8, true) & 1 ||
      data.getUint16(cursor + 34, true)
    )
      throw new Error('不支持加密或分卷 ZIP')
    let compressed = data.getUint32(cursor + 20, true)
    let original = data.getUint32(cursor + 24, true)
    let offset = data.getUint32(cursor + 42, true)
    const name = directory.slice(cursor + 46, cursor + 46 + nameLength)
    let extra = cursor + 46 + nameLength
    const extraEnd = extra + extraLength
    while (extra + 4 <= extraEnd) {
      const tag = data.getUint16(extra, true)
      const length = data.getUint16(extra + 2, true)
      if (extra + 4 + length > extraEnd) throw new Error('ZIP 扩展字段损坏')
      if (tag === 1) {
        const values = view(directory.subarray(extra + 4, extra + 4 + length))
        let at = 0
        if (original === 0xffffffff) {
          original = uint64(values, at)
          at += 8
        }
        if (compressed === 0xffffffff) {
          compressed = uint64(values, at)
          at += 8
        }
        if (offset === 0xffffffff) offset = uint64(values, at)
      }
      extra += 4 + length
    }
    if (
      original > 2 * 1024 * 1024 * 1024 ||
      compressed > 2 * 1024 * 1024 * 1024 ||
      offset >= directoryOffset
    )
      throw new Error('ZIP 条目超出支持范围')
    entries.push({
      offset,
      compressed,
      original,
      name,
      crc: data.getUint32(cursor + 16, true),
      method: data.getUint16(cursor + 10, true),
    })
    cursor = recordEnd
  }
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
    const fixed = view(await read(entry.offset, 30))
    if (
      fixed.getUint32(0, true) !== 0x04034b50 ||
      fixed.getUint16(8, true) !== entry.method ||
      entry.offset < previousEnd
    )
      throw new Error('ZIP 本地条目无效')
    const nameLength = fixed.getUint16(26, true)
    const headerSize = 30 + nameLength + fixed.getUint16(28, true)
    const header = await read(entry.offset, headerSize)
    if (
      nameLength !== entry.name.length ||
      entry.name.some((byte, index) => header[30 + index] !== byte)
    )
      throw new Error('ZIP 文件名不一致')
    const headerView = view(header)
    headerView.setUint16(6, headerView.getUint16(6, true) & ~8, true)
    headerView.setUint32(14, entry.crc, true)
    headerView.setUint32(18, entry.compressed, true)
    headerView.setUint32(22, entry.original, true)
    previousEnd = entry.offset + headerSize + entry.compressed
    if (previousEnd > directoryOffset) throw new Error('ZIP 条目越界')
    yield header
    // DEFLATE can expand an input block by roughly 1032x. Bound each decode turn,
    // including highly compressible files, before staging applies backpressure.
    const step = entry.method === 8 ? 4096 : 256 * 1024
    for (let offset = entry.offset + headerSize; offset < previousEnd; offset += step)
      yield await read(offset, Math.min(step, previousEnd - offset))
  }
  // A following directory record also lets fflate finish a trailing zero-byte entry.
  yield directory
}
