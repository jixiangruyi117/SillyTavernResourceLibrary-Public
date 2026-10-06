/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import VersionDiffDialog from './VersionDiffDialog.vue'

function card(id: string, description: string, fileName: string): Resource {
  return {
    id,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '同一角色',
    description,
    fileName,
    mimeType: 'image/png',
    fileSize: 3,
    contentHash: id,
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {
      card: {
        spec: 'chara_card_v2',
        data: {
          name: '同一角色',
          description,
          first_mes: '这一行没有变化',
        },
      },
    },
    originalBlob: new Blob(['png'], { type: 'image/png' }),
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('VersionDiffDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses two columns and omits unchanged lines', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        digest: async (_algorithm: string, source: BufferSource): Promise<ArrayBuffer> => {
          const bytes = new Uint8Array(
            source instanceof ArrayBuffer ? source : source.buffer,
            source instanceof ArrayBuffer ? 0 : source.byteOffset,
            source instanceof ArrayBuffer ? source.byteLength : source.byteLength,
          )
          let hash = 2166136261
          for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
          const digest = new Uint8Array(32)
          new DataView(digest.buffer).setUint32(0, hash >>> 0)
          return digest.buffer
        },
      },
    })
    const wrapper = mount(VersionDiffDialog, {
      props: {
        other: card('old', '相同行\n旧内容\n结尾相同', '历史版.png'),
        current: card('new', '相同行\n新内容\n结尾相同', '当前版.png'),
      },
    })
    await flushPromises()

    await vi.waitFor(() => expect(wrapper.find('.version-diff__columns').exists()).toBe(true))
    const columns = wrapper.find('.version-diff__columns')
    expect(columns.find('[data-side="old"]').text()).toContain('旧内容')
    expect(columns.find('[data-side="new"]').text()).toContain('新内容')
    expect(columns.text()).not.toContain('相同行')
    expect(columns.text()).not.toContain('结尾相同')
    expect(wrapper.text()).toContain('只列出实际变化的内容')
  })

  it('角色卡内容完全一致时仍并排显示两个 PNG 卡面', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mount(VersionDiffDialog, {
      props: {
        other: card('old', '相同描述', '历史版.png'),
        current: card('new', '相同描述', '当前版.png'),
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('卡内数据完全一致')
    const images = wrapper.findAll('.version-diff__image-columns img')
    expect(images).toHaveLength(2)
    expect(images[0]?.attributes('src')).toBe('blob:old')
    expect(images[1]?.attributes('src')).toBe('blob:new')
    expect(images[0]?.attributes('alt')).toContain('历史版.png')
    expect(images[1]?.attributes('alt')).toContain('当前版.png')
  })

  it('导入候选的两张 PNG 卡面供用户确认相同时可标记已有资源', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mount(VersionDiffDialog, {
      props: {
        other: card('old', '相同描述', '已有.png'),
        current: card('new', '相同描述', '待导入.png'),
        mode: 'import-candidate',
        allowMarkExisting: true,
      },
    })
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text() === '资源库已有该资源')
    expect(button).toBeDefined()
    await button!.trigger('click')
    expect(wrapper.emitted('mark-existing')).toHaveLength(1)
  })

  it('历史版本 PNG 对比可选择保留旧封装并新增不同封面', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mount(VersionDiffDialog, {
      props: {
        other: card('old', '相同描述', '历史封面.png'),
        current: card('new', '相同描述', '新封面.png'),
        mode: 'import-candidate',
        allowMarkExisting: true,
        allowArchiveImport: true,
        allowReplaceImport: true,
        matchDetails: { score: 100, reasons: ['角色卡数据一致'], matchedHistorical: true },
      },
    })
    await flushPromises()

    const action = wrapper
      .findAll('button')
      .find((item) => item.text() === '绑定为历史版本的不同封装')
    expect(action).toBeDefined()
    await action!.trigger('click')
    expect(wrapper.emitted('archive-import')).toHaveLength(1)
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain(
      '绑定并设为当前封装',
    )
  })

  it('当前版本 PNG 对比可把新封面设为当前封装', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mount(VersionDiffDialog, {
      props: {
        other: card('old', '相同描述', '当前封面.png'),
        current: card('new', '相同描述', '新封面.png'),
        mode: 'import-candidate',
        allowActivateImport: true,
        matchDetails: { score: 100, reasons: ['角色卡数据一致'], matchedHistorical: false },
      },
    })
    await flushPromises()

    const action = wrapper.findAll('button').find((item) => item.text() === '绑定并设为当前封装')
    expect(action).toBeDefined()
    await action!.trigger('click')
    expect(wrapper.emitted('activate-import')).toHaveLength(1)
  })

  it('同版本封装比较使用封装 A/B 标签', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValueOnce('blob:a').mockReturnValueOnce('blob:b'),
      revokeObjectURL: vi.fn(),
    })
    const wrapper = mount(VersionDiffDialog, {
      props: {
        other: card('a', '相同描述', '封装A.png'),
        current: card('b', '相同描述', '封装B.png'),
        mode: 'carrier-pair',
      },
    })
    await flushPromises()
    await vi.waitFor(() =>
      expect(wrapper.findAll('.version-diff__image-columns img')).toHaveLength(2),
    )

    expect(wrapper.get('h3').text()).toBe('封装图片对比')
    expect(wrapper.text()).toContain('封装 A · 封装A.png')
    expect(wrapper.text()).toContain('封装 B · 封装B.png')
  })
})
