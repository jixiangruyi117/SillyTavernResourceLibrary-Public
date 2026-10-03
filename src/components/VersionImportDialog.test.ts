/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VersionImportDialog from './VersionImportDialog.vue'
import type { ImportVersionCandidate } from '../types/Import'
import type { ResourceSummary } from '../types/Resource'

describe('VersionImportDialog large candidate selection', () => {
  it('finds a target beyond the first three through pagination and folder search, preserving its decision', async () => {
    const candidates = Array.from({ length: 2501 }, (_, index) => {
      const resource: ResourceSummary = {
        id: `card-${index}`,
        name: '同名角色',
        description: '',
        type: 'characterCard',
        fileName: `版本-${index}.json`,
        fileSize: 1,
        mimeType: 'application/json',
        contentHash: `${index}`,
        categoryId: null,
        categoryIds: index % 2 === 0 ? ['folder'] : [],
        tags: [],
        metadata: {},
        favorite: false,
        createdAt: 1,
        updatedAt: 1,
      }
      return {
        resource,
        matchedResource: resource,
        matchedHistorical: false,
        matchKind: 'sameName' as const,
        score: 60,
        reasons: ['仅名称相同，内容可能差异较大，请人工确认'],
      }
    })
    const candidate: ImportVersionCandidate = {
      status: 'versionCandidate',
      fileName: '新版本.json',
      file: new File(['{}'], '新版本.json'),
      candidates,
    }
    const wrapper = mount(VersionImportDialog, {
      props: {
        candidate,
        remaining: 1,
        busy: false,
        categories: [{ id: 'folder', name: '常用', color: '', createdAt: 1, updatedAt: 1 }],
      },
      global: { stubs: { Teleport: true, VersionDiffDialog: true } },
    })
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(10)
    expect(wrapper.text()).toContain('不能证明版本关系')
    expect(wrapper.get('.version-import-dialog__score').text()).toBe('同名')
    await wrapper.findAll('nav button')[1]!.trigger('click')
    expect(wrapper.get('nav').text()).toContain('2 / 251')
    await wrapper.get('select[aria-label="候选文件夹"]').setValue('folder')
    expect(wrapper.get('nav').text()).toContain('1 / 126')
    await wrapper.get('input[type="search"]').setValue('版本-2400')
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1)
    await wrapper.get('input[type="radio"]').setValue(true)
    const archive = wrapper
      .findAll('button')
      .find((button) => button.text() === '加入历史，不切换')!
    await archive.trigger('click')
    expect(wrapper.emitted('resolve')?.[0]?.[0]).toMatchObject({
      action: 'archive',
      targetId: 'card-2400',
    })
    await wrapper.get('input[type="search"]').setValue('不存在')
    expect(wrapper.text()).toContain('已选：同名角色 · 版本-2400.json')
    wrapper.unmount()
  })
})
