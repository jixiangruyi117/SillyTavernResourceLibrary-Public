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

  it('requires image comparison before switching between identical PNG packaging variants', async () => {
    const resource: ResourceSummary = {
      id: 'current-card',
      name: '角色卡',
      description: '',
      type: 'characterCard',
      fileName: 'current.png',
      fileSize: 100,
      mimeType: 'image/png',
      contentHash: 'current-hash',
      categoryId: null,
      tags: [],
      metadata: {},
      favorite: false,
      createdAt: 1,
      updatedAt: 1,
    }
    const candidate: ImportVersionCandidate = {
      status: 'versionCandidate',
      fileName: 'incoming.png',
      file: new File(['incoming'], 'incoming.png', { type: 'image/png' }),
      candidates: [
        {
          resource,
          matchedResource: resource,
          matchedHistorical: false,
          matchKind: 'containerVariant',
          score: 100,
          reasons: ['卡内数据完全一致'],
        },
      ],
    }
    const wrapper = mount(VersionImportDialog, {
      props: { candidate, remaining: 1, busy: false },
      global: { stubs: { Teleport: true, VersionDiffDialog: true } },
    })

    const actions = wrapper.find('.version-import-dialog__actions').text()
    expect(actions).toContain('设为不同封装')
    expect(actions).not.toContain('覆盖当前封装')
    expect(actions).not.toContain('绑定并设为当前封装')
    await wrapper.get('.version-import-dialog__compare').trigger('click')
    expect(wrapper.emitted('compare')?.[0]).toEqual(['current-card'])
    wrapper.unmount()
  })

  it('allows retaining two PNGs as different packaging variants', async () => {
    const resource: ResourceSummary = {
      id: 'current-card',
      name: '角色卡',
      description: '',
      type: 'characterCard',
      fileName: 'cover-a.png',
      fileSize: 800,
      mimeType: 'image/png',
      contentHash: 'current-hash',
      categoryId: null,
      tags: [],
      metadata: {},
      favorite: false,
      createdAt: 1,
      updatedAt: 1,
    }
    const candidate: ImportVersionCandidate = {
      status: 'versionCandidate',
      fileName: 'cover-b.png',
      file: new File(['incoming'], 'cover-b.png', { type: 'image/png' }),
      candidates: [
        {
          resource,
          matchedResource: resource,
          matchedHistorical: false,
          matchKind: 'containerVariant',
          score: 100,
          reasons: ['卡内数据完全一致'],
        },
      ],
    }
    const wrapper = mount(VersionImportDialog, {
      props: { candidate, remaining: 1, busy: false },
      global: { stubs: { Teleport: true, VersionDiffDialog: true } },
    })

    const differentPackaging = wrapper
      .findAll('.version-import-dialog__actions button')
      .find((button) => button.text() === '设为不同封装')
    expect(differentPackaging).toBeDefined()
    await differentPackaging!.trigger('click')
    expect(wrapper.emitted('resolve')?.[0]?.[0]).toMatchObject({
      action: 'archive',
      targetId: 'current-card',
    })
    wrapper.unmount()
  })

  it('historical matches offer historical packaging replacement without switching current version', async () => {
    const current: ResourceSummary = {
      id: 'current-card',
      name: '角色卡',
      description: '',
      type: 'characterCard',
      fileName: 'current-v7.4.json',
      fileSize: 400,
      mimeType: 'application/json',
      contentHash: 'current-hash',
      categoryId: null,
      tags: [],
      metadata: {},
      favorite: false,
      createdAt: 1,
      updatedAt: 2,
    }
    const history: ResourceSummary = {
      ...current,
      id: 'history-v7.0',
      versionGroupId: current.id,
      versionLabel: 'V7.0',
      fileName: 'history-v7.0.png',
      mimeType: 'image/png',
      contentHash: 'history-hash',
    }
    const candidate: ImportVersionCandidate = {
      status: 'versionCandidate',
      fileName: 'history-v7.0.json',
      file: new File(['incoming'], 'history-v7.0.json', { type: 'application/json' }),
      candidates: [
        {
          resource: current,
          matchedResource: history,
          matchedHistorical: true,
          matchKind: 'containerVariant',
          score: 100,
          reasons: ['与历史版本的卡内数据完全一致'],
        },
      ],
    }
    const wrapper = mount(VersionImportDialog, {
      props: { candidate, remaining: 1, busy: false },
      global: {
        stubs: {
          Teleport: true,
          VersionDiffDialog: {
            template:
              '<button class="replace-import" @click="$emit(\'replace-import\')">替换</button>',
            emits: ['replace-import'],
          },
        },
      },
    })

    const actions = wrapper.find('.version-import-dialog__actions').text()
    expect(actions).toContain('绑定为历史版本的不同封装')
    expect(actions).toContain('覆盖命中的历史封装')
    expect(actions).not.toContain('设为当前版本')
    expect(actions).not.toContain('设为当前封装')
    await wrapper
      .findAll('.version-import-dialog__actions button')
      .find((button) => button.text() === '覆盖命中的历史封装')!
      .trigger('click')
    expect(wrapper.emitted('resolve')?.[0]?.[0]).toMatchObject({
      action: 'replaceHistory',
      targetId: 'current-card',
    })
    await wrapper.setProps({
      comparison: {
        incoming: {} as never,
        existing: {} as never,
        score: 100,
        reasons: ['与历史版本卡内内容一致'],
        matchedHistorical: true,
      },
    })
    await wrapper.find('.replace-import').trigger('click')
    expect(wrapper.emitted('resolve')?.[1]?.[0]).toMatchObject({
      action: 'replaceHistory',
      targetId: 'current-card',
    })
    wrapper.unmount()
  })
})
