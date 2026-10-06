/** @vitest-environment jsdom */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SimilarNameGroups from './SimilarNameGroups.vue'
import type { ResourceSummary } from '../types/Resource'

function resource(id: string, name: string): ResourceSummary {
  return {
    id,
    name,
    type: 'characterCard',
    fileName: `${id}.json`,
    tags: [],
    metadata: {},
  } as unknown as ResourceSummary
}

describe('SimilarNameGroups', () => {
  it('允许广泛查找并把所选项交给资源库筛选，不修改资源', async () => {
    const resources = [resource('v1', '资源A v1.0'), resource('v2', '资源A（正式版）')]
    const wrapper = mount(SimilarNameGroups, { props: { resources } })
    await wrapper.get('button[aria-pressed="false"]').trigger('click')
    await wrapper.get('.similar-name-groups__list button').trigger('click')
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)
    await wrapper.get('.similar-name-groups__apply').trigger('click')
    expect(wrapper.emitted('filterResources')?.[0]?.[0]).toHaveLength(1)
    expect(resources).toHaveLength(2)
  })
  it('先列出相似名称组，再允许打开组内资源', async () => {
    const resources = [resource('main', 'A'), resource('extra', 'A（番外）')]
    const wrapper = mount(SimilarNameGroups, { props: { resources } })

    expect(wrapper.text()).toContain('找到 1 组')
    expect(wrapper.text()).not.toContain('没有发现同名或名称相似的资源')
    await wrapper.get('.similar-name-groups__list button').trigger('click')
    expect(wrapper.text()).toContain('A（番外）')
    expect(wrapper.findAll('.similar-name-groups__resources li')).toHaveLength(2)

    await wrapper.findAll('.similar-name-groups__resources button')[1].trigger('click')
    expect(wrapper.emitted('openResource')?.[0]).toEqual([resources[1]])
  })

  it('空库时给出空状态', () => {
    const wrapper = mount(SimilarNameGroups, { props: { resources: [] } })
    expect(wrapper.text()).toContain('没有发现同名或名称相似的资源')
  })

  it('大分组分批显示，跨页仍保留全组选区', async () => {
    const wrapper = mount(SimilarNameGroups, {
      props: { resources: Array.from({ length: 100 }, (_, i) => resource(String(i), '同名卡')) },
    })
    await wrapper.get('.similar-name-groups__list button').trigger('click')
    expect(wrapper.findAll('.similar-name-groups__resources li')).toHaveLength(40)
    await wrapper.get('nav[aria-label="组内资源分页"] button:last-child').trigger('click')
    expect(wrapper.findAll('.similar-name-groups__resources li')).toHaveLength(40)
    await wrapper.get('.similar-name-groups__apply').trigger('click')
    expect(wrapper.emitted('filterResources')?.[0]?.[0]).toHaveLength(100)
  })
})
