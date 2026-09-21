/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SRL_BACK_REQUEST_EVENT } from '../composables/UseBackStack'

const { albumService, hostingService } = vi.hoisted(() => ({
  albumService: {
    list: vi.fn(),
    getPreviewBlob: vi.fn(async () => new Blob(['thumb'], { type: 'image/webp' })),
    getOriginalBlob: vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
    importFile: vi.fn(),
    updateDetails: vi.fn(),
    setHostedUrl: vi.fn(),
    delete: vi.fn(),
  },
  hostingService: {
    getSelfHostedConfiguration: vi.fn(() => null),
    saveSelfHostedConfiguration: vi.fn((value) => value),
    status: vi.fn(async () => ({
      configured: true,
      membership: { registered: true, disabled: false, termsAccepted: true },
      capacity: { uploadEnabled: true },
    })),
    uploadBlobSelfHosted: vi.fn(),
  },
}))

vi.mock('../core/ImageAlbumContainer', () => ({
  generatedImageAlbumService: albumService,
  frontendWorkshopImageHostingService: hostingService,
}))

vi.mock('../core/NativeFileExport', () => ({
  isNativeFileExportAvailable: vi.fn(() => false),
  saveBlobToNativeDestination: vi.fn(),
}))

vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: vi.fn(async () => true),
}))

import GeneratedImageAlbumApp from './GeneratedImageAlbumApp.vue'

enableAutoUnmount(afterEach)

describe('GeneratedImageAlbumApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL: vi.fn(),
    })
    albumService.list.mockResolvedValue({
      items: [
        {
          id: 'one',
          name: '月下庭院',
          source: 'generated',
          category: '背景',
          mimeType: 'image/png',
          sizeBytes: 5,
          hostedUrl: 'https://img.example/one.png',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: ['背景'],
      mimeTypes: ['image/png'],
    })
  })

  it('loads only page previews and exposes URL, category, phone-save and delete actions', async () => {
    const wrapper = mount(GeneratedImageAlbumApp, { attachTo: document.body })
    await flushPromises()

    expect(albumService.getPreviewBlob).toHaveBeenCalledWith('one')
    expect(albumService.getOriginalBlob).not.toHaveBeenCalled()
    await wrapper.get('.generated-album__grid > button').trigger('click')
    await flushPromises()

    expect(albumService.getOriginalBlob).toHaveBeenCalledWith('one')
    const detail = document.body.querySelector<HTMLElement>('.generated-album__detail')
    expect(detail?.querySelector('.generated-album__url')?.textContent).toContain(
      'https://img.example/one.png',
    )
    expect(detail?.querySelector('.generated-album__actions')?.textContent).toContain('存手机')
    expect(detail?.querySelector('.generated-album__actions')?.textContent).toContain('删除')
    detail?.querySelector<HTMLButtonElement>('.generated-album__actions .is-danger')?.click()
    await flushPromises()
    expect(albumService.delete).toHaveBeenCalledWith('one')
  })

  it('adds hosted/local badges to the original cards and combines status with existing filters', async () => {
    const originalPage = await albumService.list()
    albumService.list.mockResolvedValue({
      ...originalPage,
      items: [originalPage.items[0], { ...originalPage.items[0], id: 'two', hostedUrl: undefined }],
      total: 2,
    })
    const wrapper = mount(GeneratedImageAlbumApp)
    await flushPromises()

    expect(wrapper.findAll('.generated-album__thumb i').map((badge) => badge.text())).toEqual([
      '已有直链',
      '仅本地',
    ])
    expect(wrapper.findAll('.generated-album__grid > button')).toHaveLength(2)
    expect(wrapper.findAll('.generated-album__filters select')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('生成直链并导入')
    expect(albumService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ hostedStatus: 'all' }),
    )
    await wrapper.get('[aria-label="自定义分类"]').setValue('背景')
    await flushPromises()
    await wrapper.get('[aria-label="图片类型"]').setValue('image/png')
    await flushPromises()
    await wrapper.get('[aria-label="保存时间排序"]').setValue('oldest')
    await flushPromises()
    for (const hostedStatus of ['hosted', 'local', 'all']) {
      await wrapper.get('[aria-label="相册设置"]').trigger('click')
      await flushPromises()
      const label = { hosted: '已有直链', local: '仅本地', all: '全部' }[hostedStatus]
      const action = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>(
          '.generated-album__status-options button',
        ),
      ).find((button) => button.querySelector('span')?.textContent === label)
      expect(action).toBeDefined()
      action!.click()
      await flushPromises()
      expect(wrapper.get('[aria-label="相册设置"]').attributes('aria-expanded')).toBe('false')
      expect(albumService.list).toHaveBeenLastCalledWith({
        search: '',
        mimeType: 'image/png',
        category: '背景',
        sort: 'oldest',
        hostedStatus,
        page: 1,
        pageSize: 18,
      })
    }
  })

  it('keeps settings focus inside the dialog and closes without leaving the album', async () => {
    const wrapper = mount(GeneratedImageAlbumApp, { attachTo: document.body })
    await flushPromises()
    const trigger = wrapper.get<HTMLButtonElement>('[aria-label="相册设置"]')
    for (const method of ['escape', 'backdrop', 'back']) {
      await trigger.trigger('click')
      await flushPromises()
      const dialog = document.body.querySelector<HTMLElement>('.generated-album__settings')!
      const buttons = dialog.querySelectorAll<HTMLButtonElement>('button')
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(document.activeElement).toBe(buttons[0])
      buttons[0]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
      expect(document.activeElement).toBe(buttons[buttons.length - 1])
      buttons[buttons.length - 1]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
      expect(document.activeElement).toBe(buttons[0])
      if (method === 'escape') {
        buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      } else if (method === 'backdrop') {
        document.body.querySelector<HTMLElement>('.generated-album__settings-backdrop')!.click()
      } else {
        const detail = { handled: false }
        document.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
        if (!detail.handled)
          window.dispatchEvent(new CustomEvent(SRL_BACK_REQUEST_EVENT, { detail }))
        expect(detail.handled).toBe(true)
      }
      await flushPromises()
      expect(document.body.querySelector('.generated-album__settings')).toBeNull()
      expect(document.activeElement).toBe(trigger.element)
      expect(wrapper.emitted('back')).toBeUndefined()
    }
  })

  it('uses a modal inspector and restores focus after Escape', async () => {
    const wrapper = mount(GeneratedImageAlbumApp, { attachTo: document.body })
    await flushPromises()

    const card = wrapper.get<HTMLButtonElement>('.generated-album__grid > button')
    card.element.focus()
    await card.trigger('click')
    await flushPromises()

    expect(document.body.querySelector('.generated-album__detail[role="dialog"]')).not.toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭图片详情')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(document.body.querySelector('.generated-album__detail')).toBeNull()
    expect(document.activeElement).toBe(card.element)
  })
})
