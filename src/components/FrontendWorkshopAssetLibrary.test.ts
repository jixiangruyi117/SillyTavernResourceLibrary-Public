/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import type { GeneratedImageAlbumPage } from '../types/GeneratedImageAlbum'

const { album, hosting } = vi.hoisted(() => ({
  album: {
    list: vi.fn<() => Promise<GeneratedImageAlbumPage>>(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: [],
      mimeTypes: [],
    })),
    getPreviewBlob: vi.fn(async () => new Blob(['preview'], { type: 'image/png' })),
  },
  hosting: {
    initializeCredentials: vi.fn(async () => undefined),
    getSelfHostedConfiguration: vi.fn(() => undefined),
    uploadBlobSelfHosted: vi.fn(),
  },
}))
vi.mock('../core/ImageAlbumContainer', () => ({
  generatedImageAlbumService: album,
  frontendWorkshopImageHostingService: hosting,
}))
import FrontendWorkshopAssetLibrary from './FrontendWorkshopAssetLibrary.vue'

enableAutoUnmount(afterEach)
describe('FrontendWorkshopAssetLibrary 当前图片选择 Owner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('手动直链校验后只发出插入意图，不建立第二份项目状态', async () => {
    const wrapper = mount(FrontendWorkshopAssetLibrary, {
      props: { project: createFrontendWorkshopProject('greeting') },
    })
    wrapper.vm.open('library', 'workspace')
    await flushPromises()
    await wrapper.get('.frontend-image-picker__tabs button:last-child').trigger('click')
    await wrapper.get('input[type="url"]').setValue('http://img.test/a.png')
    await wrapper.get('.frontend-image-picker__primary').trigger('click')
    expect(wrapper.emitted('insertAsset')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('HTTPS')
    await wrapper.get('input[type="url"]').setValue('https://img.test/a.png')
    await wrapper.get('input[type="text"]').setValue('人物立绘')
    await wrapper.get('.frontend-image-picker__primary').trigger('click')
    expect(wrapper.emitted('insertAsset')).toEqual([
      [expect.objectContaining({ name: '人物立绘', url: 'https://img.test/a.png' })],
    ])
    expect(wrapper.emitted('commitProject')).toBeUndefined()
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('直链标签返回相册时保留输入，再次返回才交给原路由', async () => {
    const wrapper = mount(FrontendWorkshopAssetLibrary, {
      props: { project: createFrontendWorkshopProject('greeting') },
    })
    wrapper.vm.open('hosting', 'workspace')
    await flushPromises()
    await wrapper.get('.frontend-image-picker__tabs button:last-child').trigger('click')
    await wrapper.get('input[type="url"]').setValue('https://img.test/kept.png')
    wrapper.vm.back()
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('.frontend-image-picker__body').exists()).toBe(true)
    await wrapper.get('.frontend-image-picker__tabs button:last-child').trigger('click')
    expect(wrapper.get('input[type="url"]').element).toHaveProperty(
      'value',
      'https://img.test/kept.png',
    )
    wrapper.vm.back()
    await flushPromises()
    wrapper.vm.back()
    await flushPromises()
    expect(wrapper.emitted('close')).toEqual([[]])
    expect(wrapper.find('.frontend-image-picker').exists()).toBe(false)
  })

  it('读取正式生图相册并把已有托管直链交还 Workbench', async () => {
    album.list.mockResolvedValueOnce({
      items: [
        {
          id: 'hosted',
          name: '云端图片',
          source: 'generated',
          category: '',
          mimeType: 'image/png',
          sizeBytes: 1,
          hostedUrl: 'https://img.test/hosted.png',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 18,
      pageCount: 1,
      categories: [],
      mimeTypes: [],
    })
    const wrapper = mount(FrontendWorkshopAssetLibrary, {
      props: { project: createFrontendWorkshopProject('greeting') },
    })
    wrapper.vm.open('library', 'workspace')
    await flushPromises()
    expect(album.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 18 }))
    expect(wrapper.get('.frontend-image-picker__card').text()).toContain('云端图片')
    await wrapper.get('.frontend-image-picker__primary').trigger('click')
    expect(wrapper.emitted('insertAsset')).toEqual([
      [expect.objectContaining({ url: 'https://img.test/hosted.png' })],
    ])
    expect(hosting.uploadBlobSelfHosted).not.toHaveBeenCalled()
  })
})
