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
})
