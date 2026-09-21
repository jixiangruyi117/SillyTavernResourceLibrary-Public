/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
const { album, hosting } = vi.hoisted(() => ({
  album: {
    list: vi.fn(),
    getPreviewBlob: vi.fn(),
    getOriginalBlob: vi.fn(),
    setHostedUrl: vi.fn(),
  },
  hosting: {
    initializeCredentials: vi.fn(async () => undefined),
    getSelfHostedConfiguration: vi.fn(() => ({
      origin: 'https://img.example/upload',
      token: 'test-token',
      remember: true,
    })),
    uploadBlobSelfHosted: vi.fn(),
  },
}))
vi.mock('../core/ImageAlbumContainer', () => ({
  generatedImageAlbumService: album,
  frontendWorkshopImageHostingService: hosting,
}))
import FrontendWorkshopImagePicker from './FrontendWorkshopImagePicker.vue'
enableAutoUnmount(afterEach)
const item = {
  id: 'one',
  name: '月下庭院',
  source: 'generated',
  category: '背景',
  mimeType: 'image/png',
  sizeBytes: 5,
  createdAt: 1,
  updatedAt: 1,
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  })
  album.list.mockResolvedValue({
    items: [{ ...item, hostedUrl: 'https://img.example/one.png' }],
    total: 1,
    page: 1,
    pageSize: 18,
    pageCount: 1,
    categories: ['背景'],
    mimeTypes: ['image/png'],
  })
  album.getPreviewBlob.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }))
  album.getOriginalBlob.mockResolvedValue(new Blob(['original'], { type: 'image/png' }))
  hosting.uploadBlobSelfHosted.mockResolvedValue({ url: 'https://img.example/new.png' })
  album.setHostedUrl.mockResolvedValue({ ...item, hostedUrl: 'https://img.example/new.png' })
})
describe('FrontendWorkshopImagePicker contract', () => {
  it('consumes SRL theme and four safe-area tokens without a component palette or system theme media query', () => {
    const source = readFileSync(
      new NodeURL('./FrontendWorkshopImagePicker.vue', import.meta.url),
      'utf8',
    )
    expect(source).toContain('src="../styles/FrontendWorkshopImagePicker.css"')
    const css = readFileSync(
      new NodeURL('../styles/FrontendWorkshopImagePicker.css', import.meta.url),
      'utf8',
    )
    expect(css).not.toContain('prefers-color-scheme')
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i)
    expect(css).not.toContain('env(')
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(css.match(new RegExp(`var\\(--safe-${edge}\\)`, 'g'))).toHaveLength(1)
    }
  })
  it('imports existing hosted URLs without fetching originals or uploading again', async () => {
    const wrapper = mount(FrontendWorkshopImagePicker)
    await flushPromises()
    await wrapper.get('.frontend-image-picker__primary').trigger('click')
    expect(wrapper.emitted('insertAsset')).toEqual([
      [expect.objectContaining({ url: 'https://img.example/one.png', name: item.name })],
    ])
    expect(album.getOriginalBlob).not.toHaveBeenCalled()
    expect(hosting.uploadBlobSelfHosted).not.toHaveBeenCalled()
  })
  it('writes a new hosted URL to the album before importing a local image', async () => {
    album.list.mockResolvedValue({
      items: [item],
      total: 1,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: [],
      mimeTypes: [],
    })
    const wrapper = mount(FrontendWorkshopImagePicker)
    await flushPromises()
    await wrapper.get('.frontend-image-picker__primary').trigger('click')
    await flushPromises()
    expect(album.setHostedUrl).toHaveBeenCalledWith(
      'one',
      { url: 'https://img.example/new.png' },
      'self-hosted',
    )
    expect(wrapper.emitted('insertAsset')).toEqual([
      [expect.objectContaining({ url: 'https://img.example/new.png' })],
    ])
    expect(album.getOriginalBlob).toHaveBeenCalledWith('one')
  })
  it('does not import when album hosted URL writeback fails', async () => {
    album.list.mockResolvedValue({
      items: [item],
      total: 1,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: [],
      mimeTypes: [],
    })
    album.setHostedUrl.mockRejectedValueOnce(new Error('writeback failed'))
    const wrapper = mount(FrontendWorkshopImagePicker)
    await flushPromises()
    await wrapper.get('.frontend-image-picker__primary').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('insertAsset')).toBeUndefined()
    expect(wrapper.text()).toContain('writeback failed')
  })
  it('forwards category/type/sort/hosted filters and has no image generation controls', async () => {
    const wrapper = mount(FrontendWorkshopImagePicker)
    await flushPromises()
    for (const [label, value] of [
      ['分类', '背景'],
      ['图片类型', 'image/png'],
      ['排序', 'oldest'],
      ['直链状态', 'local'],
    ]) {
      await wrapper.get(`select[aria-label="${label}"]`).setValue(value)
      await flushPromises()
    }
    expect(album.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: '背景',
        mimeType: 'image/png',
        sort: 'oldest',
        hostedStatus: 'local',
      }),
    )
    expect(wrapper.find('input[type=password]').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
  })
})
