/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BackupScopeTree from './BackupScopeTree.vue'
import { createDefaultBackupSelection } from '../services/BackupScopeRegistry'
import { RESOURCE_TYPE, type Category, type ResourceSummary } from '../types/Resource'

const categories: Category[] = [
  {
    id: 'folder-a',
    name: '常用',
    color: '#4aa',
    createdAt: 1,
    updatedAt: 1,
  },
]

const resources = [
  {
    id: 'card-a',
    name: '常用角色卡',
    fileName: 'a.png',
    fileSize: 2_000,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    categoryId: 'folder-a',
    categoryIds: ['folder-a'],
    metadata: {},
  },
  {
    id: 'card-b',
    name: '未归档角色卡',
    fileName: 'b.png',
    fileSize: 3_000,
    type: RESOURCE_TYPE.CHARACTER_CARD,
    categoryId: null,
    metadata: {},
  },
  {
    id: 'secret',
    name: '密钥资料',
    fileName: 'secret.json',
    fileSize: 1_000,
    type: RESOURCE_TYPE.SECRET,
    categoryId: null,
    metadata: {},
  },
] as ResourceSummary[]

describe('BackupScopeTree', () => {
  it('在酒馆资源分组内保留文件夹查看入口', async () => {
    const initial = createDefaultBackupSelection(resources, 'local')
    const wrapper = mount(BackupScopeTree, {
      props: {
        resources,
        categories,
        mode: 'local',
        modelValue: { resourceIds: [...initial.resourceIds], scopeIds: [...initial.scopes] },
      },
    })

    expect(wrapper.text()).toContain('按文件夹查看')
    await wrapper.get('button[aria-label="展开角色卡"]').trigger('click')
    const folderButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('常用 1'))
    await folderButton?.trigger('click')
    expect(wrapper.text()).toContain('常用角色卡')
    expect(wrapper.text()).not.toContain('未归档角色卡')
  })

  it('把敏感提示和查看操作放在独立操作行', () => {
    const wrapper = mount(BackupScopeTree, {
      props: {
        resources,
        categories: [],
        mode: 'local',
        modelValue: { resourceIds: [], scopeIds: [] },
      },
    })
    const keyScope = wrapper
      .findAll('.backup-scope-tree__scope')
      .find((scope) => scope.text().includes('密钥'))
    expect(keyScope?.find('.backup-scope-tree__scope-actions em').text()).toContain('需要确认')
    expect(keyScope?.find('.backup-scope-tree__scope-actions button').exists()).toBe(true)
  })

  it('显示云端范围被禁用的具体原因', async () => {
    const wrapper = mount(BackupScopeTree, {
      props: {
        resources,
        categories: [],
        mode: 'cloud',
        modelValue: { resourceIds: [], scopeIds: [] },
        disabledScopeIds: ['extra.communitySources'],
        disabledScopeReasons: { 'extra.communitySources': '先确认 GitHub 仓库为私有' },
      },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('额外资源'))
      ?.trigger('click')
    expect(wrapper.text()).toContain('先确认 GitHub 仓库为私有')
  })
})
