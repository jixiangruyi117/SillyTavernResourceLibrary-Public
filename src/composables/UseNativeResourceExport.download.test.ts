import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { useConfirmDialogState } from './UseConfirmDialog'
import { useNativeResourceExport } from './UseNativeResourceExport'
import { strFromU8, unzipSync } from 'fflate'
import { PngResourceParser } from '../parser/PngResourceParser'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  download: vi.fn(),
  available: vi.fn(),
  preference: vi.fn(),
  images: vi.fn(),
  categories: vi.fn(),
}))
vi.mock('../core/AppContainer', async () => ({
  resourceService: { get: mocks.get },
  resourceGalleryService: { listExportImages: mocks.images },
  categoryService: { list: mocks.categories },
  exportService: new (await import('../services/ExportService')).ExportService(),
}))
vi.mock('../utils/LibraryFormatting', () => ({ downloadBlob: mocks.download }))
vi.mock('../core/NativeFileExport', () => ({
  isNativeFileExportAvailable: mocks.available,
  getNativeExportPreference: mocks.preference,
  chooseNativeExportDirectory: vi.fn(),
  getNativeExportDirectoryStatus: vi.fn(),
  saveBlobToNativeDestination: vi.fn(),
  setNativeExportPreference: vi.fn(),
}))

const dialog = useConfirmDialogState()
async function exportedCard(blob: Blob) {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const path = Object.keys(entries).find((path) => path.startsWith('files/characterCard/'))!
  return JSON.parse(strFromU8(entries[path]!))
}
function card(modified = true): Resource {
  const data = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: '测试角色', first_mes: '原开场白' },
  }
  const originalBlob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  return {
    id: 'card',
    name: '测试角色',
    description: '',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    fileName: 'card.json',
    mimeType: 'application/json',
    fileSize: originalBlob.size,
    contentHash: 'source-hash',
    favorite: false,
    categoryId: null,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    originalBlob,
    metadata: {
      card: data,
      characterContentEdits: modified
        ? [
            {
              id: 'greeting-edit',
              section: 'greeting',
              operation: 'update',
              targetKey: 'primary',
              label: '开场白修改',
              before: '原开场白',
              after: '修改后的开场白',
              migrateToVersions: false,
              updatedAt: 2,
            },
          ]
        : [],
    },
  }
}

describe('single resource download version choice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.available.mockReturnValue(false)
    mocks.images.mockResolvedValue([])
    mocks.categories.mockResolvedValue([])
    if (dialog.activeDialog.value) dialog.respond('cancel')
  })

  it('offers text-only saved edits and downloads the modified bytes without changing the source', async () => {
    const resource = card()
    const manager = useNativeResourceExport({ showNotice: vi.fn() })
    const pending = manager.handleResourceDownload(resource)
    expect(dialog.activeDialog.value).toMatchObject({
      title: '下载资源',
      confirmLabel: '修改版单文件',
      additionalLabel: '完整修改包',
      alternativeLabel: '下载原版',
      cancelLabel: '取消',
    })
    expect(mocks.download).not.toHaveBeenCalled()
    dialog.respond('additional')
    await pending
    const blob: Blob = mocks.download.mock.calls[0]![0]
    expect((await exportedCard(blob)).data.first_mes).toBe('修改后的开场白')
    expect(mocks.download.mock.calls[0]![1]).toBe('测试角色-修改版.zip')
    expect(JSON.parse(await resource.originalBlob.text()).data.first_mes).toBe('原开场白')
    expect(resource.metadata.characterContentEdits).toHaveLength(1)
  })

  it('downloads the exact imported blob when original is selected', async () => {
    const resource = card()
    const pending = useNativeResourceExport({ showNotice: vi.fn() }).handleResourceDownload(
      resource,
    )
    dialog.respond('alternative')
    await pending
    expect(mocks.download).toHaveBeenCalledWith(resource.originalBlob, resource.fileName)
  })

  it('cancels before preparing a native export or downloading', async () => {
    mocks.available.mockReturnValue(true)
    const manager = useNativeResourceExport({ showNotice: vi.fn() })
    const pending = manager.handleResourceDownload(card())
    dialog.respond('cancel')
    await pending
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.preference).not.toHaveBeenCalled()
    expect(manager.pendingNativeExport.value).toBeUndefined()
  })

  it('resolves a summary through the service before choosing, then prepares the selected native bytes', async () => {
    const resource = card()
    const { originalBlob: _blob, ...summary } = resource
    mocks.get.mockResolvedValue(resource)
    mocks.available.mockReturnValue(true)
    mocks.preference.mockReturnValue('ask')
    const manager = useNativeResourceExport({ showNotice: vi.fn() })
    const pending = manager.handleResourceDownload(summary)
    await vi.waitFor(() => expect(dialog.activeDialog.value?.title).toBe('下载资源'))
    dialog.respond('additional')
    await pending
    expect(mocks.get).toHaveBeenCalledWith('card')
    expect(manager.pendingNativeExport.value?.contentLabel).toBe('完整修改包')
    expect((await exportedCard(manager.pendingNativeExport.value!.blob)).data.first_mes).toBe(
      '修改后的开场白',
    )
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('also offers saved replacement settings without content edits', async () => {
    const resource = card(false)
    resource.metadata.characterOverrides = { regexEnabled: { 'id:regex': false } }
    const pending = useNativeResourceExport({ showNotice: vi.fn() }).handleResourceDownload(
      resource,
    )
    expect(dialog.activeDialog.value?.title).toBe('下载资源')
    dialog.respond('cancel')
    await pending
  })

  it('offers organization-only exports and keeps explicit original requests direct', async () => {
    const manager = useNativeResourceExport({ showNotice: vi.fn() })
    const unchanged = card(false)
    const pending = manager.handleResourceDownload(unchanged)
    expect(dialog.activeDialog.value?.title).toBe('下载资源')
    dialog.respond('alternative')
    await pending
    expect(mocks.download).toHaveBeenCalledWith(unchanged.originalBlob, unchanged.fileName)
    await manager.handleResourceDownload(card(), 'modified')
    expect(dialog.activeDialog.value).toBeUndefined()
    const blob: Blob = mocks.download.mock.calls[1]![0]
    expect((await exportedCard(blob)).data.first_mes).toBe('修改后的开场白')
    await manager.handleResourceDownload(unchanged, 'original')
    expect(dialog.activeDialog.value).toBeUndefined()
  })

  it('reports a content conflict without downloading the original as a substitute', async () => {
    const resource = card()
    resource.metadata.card = { data: { first_mes: '作者新版开场白' } }
    const notice = vi.fn()
    const pending = useNativeResourceExport({ showNotice: notice }).handleResourceDownload(resource)
    dialog.respond('confirm')
    await pending
    expect(mocks.download).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('无法应用'))
  })

  it('downloads PNG directly and does not load unrelated gallery pictures or folders', async () => {
    const pending = useNativeResourceExport({ showNotice: vi.fn() }).handleResourceDownload(card())
    dialog.respond('confirm')
    await pending
    const file: File = mocks.download.mock.calls[0]![0]
    expect(file.name).toBe('测试角色-修改版.png')
    const parsed = await new PngResourceParser().parse(file)
    expect(parsed.metadata.card).toMatchObject({ data: { first_mes: '修改后的开场白' } })
    expect(mocks.images).not.toHaveBeenCalled()
    expect(mocks.categories).not.toHaveBeenCalled()
  })

  it('retains the PNG route and image destination preference on Android', async () => {
    mocks.available.mockReturnValue(true)
    mocks.preference.mockReturnValue('ask')
    const manager = useNativeResourceExport({ showNotice: vi.fn() })
    await manager.handleResourceDownload(card(), 'modifiedFile')
    expect(manager.pendingNativeExport.value).toMatchObject({
      isImage: true,
      contentLabel: '修改版单文件',
      fileName: '测试角色-修改版.png',
    })
    expect(mocks.preference).toHaveBeenCalledWith('image')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('only offers the original and archive for library-specific resources', async () => {
    const pending = useNativeResourceExport({ showNotice: vi.fn() }).handleResourceDownload({
      ...card(),
      type: RESOURCE_TYPE.EXTRA_STORY,
    })
    expect(dialog.activeDialog.value).toMatchObject({
      confirmLabel: '完整修改包',
      alternativeLabel: '下载原版',
    })
    expect(dialog.activeDialog.value?.additionalLabel).toBeUndefined()
    dialog.respond('cancel')
    await pending
  })
})
