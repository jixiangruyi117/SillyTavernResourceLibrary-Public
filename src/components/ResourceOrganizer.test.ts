/** @vitest-environment jsdom */
import { shallowMount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { RESOURCE_TYPE, type Resource, type ResourceSummary } from '../types/Resource'
import ResourceOrganizer from './ResourceOrganizer.vue'
it('pages thousands of relations and preserves chosen IDs through folder and search filters', async () => {
  const resources: ResourceSummary[] = Array.from({ length: 5000 }, (_, index) => ({
    id: `card-${index}`,
    name: `角色 ${String(index).padStart(4, '0')}`,
    description: '',
    type: [RESOURCE_TYPE.WORLD_BOOK, RESOURCE_TYPE.CHARACTER_CARD, RESOURCE_TYPE.REGEX][index % 3]!,
    fileName: `file-${index}.json`,
    mimeType: 'application/json',
    fileSize: 2,
    contentHash: `hash-${index}`,
    favorite: false,
    categoryId: index % 2 ? null : 'a',
    categoryIds: index === 4999 ? ['a', 'b'] : [],
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  }))
  const current: Resource = {
    ...resources[0]!,
    id: 'current',
    name: '当前资源',
    originalBlob: new Blob(['{}']),
  }
  const wrapper = shallowMount(ResourceOrganizer, {
    props: {
      initialTab: 'relations',
      resource: current,
      resources: [current, ...resources],
      boundResources: [],
      versions: [],
      categories: [
        { id: 'a', name: '常用', color: '', createdAt: 1, updatedAt: 1 },
        { id: 'b', name: '收藏', color: '', createdAt: 1, updatedAt: 1 },
      ],
      busy: false,
    },
    global: { stubs: { Teleport: true } },
  })
  expect(wrapper.findAll('.resource-relation')).toHaveLength(30)
  await wrapper.get('.resource-relations__pagination').findAll('button')[1]!.trigger('click')
  expect(wrapper.get('.resource-relations__pagination').text()).toContain('2 / 167')
  await wrapper.get('select[aria-label="关联资源类型"]').setValue(RESOURCE_TYPE.CHARACTER_CARD)
  expect(wrapper.get('.resource-relations__pagination').text()).toContain('1 / 56')
  expect(wrapper.findAll('.resource-relation')).toHaveLength(30)
  expect(wrapper.findAll('.resource-relations__groups > section')).toHaveLength(1)
  expect(wrapper.get('.resource-relations__groups > section > header').text()).toContain('角色卡')
  await wrapper.get('select[aria-label="关联资源文件夹"]').setValue('b')
  expect(wrapper.findAll('.resource-relation')).toHaveLength(1)
  expect(wrapper.get('.resource-relation').text()).toContain('file-4999.json')
  await wrapper.get('.resource-relation input[type="checkbox"]').setValue(true)
  await wrapper.get('select[aria-label="关联资源类型"]').setValue(RESOURCE_TYPE.WORLD_BOOK)
  expect(wrapper.find('.resource-relation--selected').exists()).toBe(false)
  await wrapper.get('select[aria-label="关联资源类型"]').setValue('all')
  expect(wrapper.get('.resource-relation--selected').text()).toContain('file-4999.json')
  await wrapper.get('select[aria-label="关联资源文件夹"]').setValue('uncategorized')
  expect(wrapper.find('.resource-relation--selected').exists()).toBe(false)
  await wrapper.get('select[aria-label="关联资源文件夹"]').setValue('all')
  expect(wrapper.get('.resource-relation--selected').text()).toContain('file-4999.json')
  await wrapper.get('.resource-relations__search input').setValue('无匹配')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ relatedResourceIds: ['card-4999'] })
  wrapper.unmount()
})
