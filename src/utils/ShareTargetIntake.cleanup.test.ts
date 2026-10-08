/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({
  enabled: true,
  listIntakeFiles: vi.fn(),
  removeIntakeFile: vi.fn(),
  removeIntakeReceipts: vi.fn(),
  getPendingShare: vi.fn(),
  cleanupPendingShare: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.enabled, convertFileSrc: (uri: string) => uri },
  registerPlugin: () => native,
}))
import {
  listNativeIntakeFiles,
  removeNativeIntakeFile,
  removeNativeIntakeReceipts,
  takeSharedFileBatch,
} from './ShareTargetIntake'
const file = {
  token: 'manual-0',
  name: '旧附件.json',
  state: '未完成或缺少记录的暂存',
  bytes: 2048,
  modifiedAt: 1,
  fileCount: 2,
  snapshot: 'snapshot',
  protectedReason: '',
}
beforeEach(() => {
  vi.resetAllMocks()
  native.enabled = true
  vi.stubGlobal('caches', undefined)
  native.listIntakeFiles.mockResolvedValue({ entries: [file] })
  native.removeIntakeFile.mockResolvedValue({ removedBytes: 2048 })
})
afterEach(() => vi.unstubAllGlobals())
it('lists read-only and forwards only the selected native identity and fingerprint', async () => {
  expect(await listNativeIntakeFiles()).toEqual([file])
  expect(native.cleanupPendingShare).not.toHaveBeenCalled()
  expect(await removeNativeIntakeFile(file)).toBe(2048)
  expect(native.removeIntakeFile).toHaveBeenCalledWith({
    token: file.token,
    snapshot: file.snapshot,
  })
})
it('explains missing old APK capability and preserves failures and protected entries', async () => {
  native.listIntakeFiles.mockRejectedValue({ code: 'UNIMPLEMENTED' })
  await expect(listNativeIntakeFiles()).rejects.toThrow('新版 APK')
  await expect(
    removeNativeIntakeFile({ ...file, protectedReason: '恢复任务正在保留此文件' }),
  ).rejects.toThrow('恢复任务')
  expect(native.removeIntakeFile).not.toHaveBeenCalled()
  native.removeIntakeFile.mockRejectedValue(new Error('文件已变化'))
  await expect(removeNativeIntakeFile(file)).rejects.toThrow('文件已变化')
})
it('does not delete a file while intake is awaiting its native sidecar', async () => {
  const entry = { ...file, token: 'racing-0' }
  native.getPendingShare.mockResolvedValue({
    files: [
      {
        name: entry.name,
        uri: 'file:///racing-0',
        size: 2048,
        cleanupToken: entry.token,
        nativeCharacterCardResult: { state: 'parsed', parsedResourceUri: 'file:///sidecar' },
      },
    ],
  })
  let resolveFetch!: (value: Response) => void
  const fetching = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
  )
  vi.stubGlobal('fetch', fetching)
  const taking = takeSharedFileBatch()
  await vi.waitFor(() => expect(fetching).toHaveBeenCalledOnce())
  const cleaning = removeNativeIntakeFile(entry)
  resolveFetch(new Response('{}'))
  const batch = await taking
  await expect(cleaning).rejects.toThrow('导入面板正在使用')
  expect(native.removeIntakeFile).not.toHaveBeenCalled()
  native.listIntakeFiles.mockResolvedValue({ entries: [entry] })
  expect((await listNativeIntakeFiles())[0]!.protectedReason).toContain('导入面板')
  await batch.acknowledge()
})

it('clears confirmed receipts in bounded batches without selecting attachments or protected records', async () => {
  const receipts = Array.from({ length: 130 }, (_, index) => ({
    ...file,
    token: `receipt-${index}`,
    receiptOnly: true,
    bytes: 13,
  }))
  native.removeIntakeReceipts.mockImplementation(async ({ items }) => ({
    removedTokens: items.map((item: { token: string }) => item.token),
    removedBytes: items.length * 13,
    skipped: [],
  }))
  const progress = vi.fn(),
    beforeBatch = vi.fn().mockResolvedValue(undefined)
  const result = await removeNativeIntakeReceipts(
    [...receipts, file, { ...file, receiptOnly: true, protectedReason: '正在使用' }],
    { signal: new AbortController().signal, beforeBatch, progress },
  )
  expect(native.removeIntakeReceipts.mock.calls.map(([options]) => options.items.length)).toEqual([
    64, 64, 2,
  ])
  expect(native.removeIntakeReceipts.mock.calls[0]![0].items[0]).toEqual({
    token: 'receipt-0',
    snapshot: 'snapshot',
  })
  expect(result.removedTokens).toHaveLength(130)
  expect(result.removedBytes).toBe(1690)
  expect(progress).toHaveBeenCalledTimes(3)
  expect(native.removeIntakeFile).not.toHaveBeenCalled()
  expect(native.listIntakeFiles).not.toHaveBeenCalled()
})
it('stops at the next batch and never retries a skipped or changed receipt automatically', async () => {
  const controller = new AbortController()
  const receipts = Array.from({ length: 130 }, (_, index) => ({
    ...file,
    token: `stop-${index}`,
    receiptOnly: true,
  }))
  native.removeIntakeReceipts.mockResolvedValue({
    removedTokens: ['stop-0'],
    removedBytes: 13,
    skipped: [{ token: 'stop-1', message: '正在使用，保留' }],
  })
  const result = await removeNativeIntakeReceipts(receipts, {
    signal: controller.signal,
    beforeBatch: async () => {},
    progress: () => controller.abort(),
  })
  expect(native.removeIntakeReceipts).toHaveBeenCalledOnce()
  expect(result.removedTokens).toEqual(['stop-0'])
  expect(result.skipped).toHaveLength(1)
})
