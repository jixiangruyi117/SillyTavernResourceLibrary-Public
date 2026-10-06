/** @vitest-environment jsdom */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { RESOURCE_TYPE, type Resource, type ResourceSummary } from '../types/Resource'
// Resolve this lazily mounted panel before the jsdom test environment tears down.
import './StructuredResourceDetails.vue'
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
  await flushPromises()
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

it('edits a note on one packaging file without affecting its sibling carrier', async () => {
  const current: Resource = {
    id: 'current',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '同一角色',
    description: '',
    fileName: 'card-current.png',
    mimeType: 'image/png',
    fileSize: 3,
    contentHash: 'current-hash',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: [],
    metadata: { card: { data: { name: '同一角色' } } },
    originalBlob: new Blob(['current png'], { type: 'image/png' }),
    createdAt: 1,
    updatedAt: 1,
  }
  const alternate: Resource = {
    ...current,
    id: 'alternate',
    fileName: 'card-alternate.png',
    contentHash: 'alternate-hash',
    originalBlob: new Blob(['alternate png'], { type: 'image/png' }),
    versionGroupId: current.id,
    versionNote: '作者原版立绘',
  }
  const wrapper = shallowMount(ResourceOrganizer, {
    props: {
      initialTab: 'versions',
      resource: current,
      resources: [current],
      boundResources: [],
      versions: [{ resource: current, active: true, carriers: [current, alternate] }],
      categories: [],
      busy: false,
    },
    global: { stubs: { Teleport: true, ResourceVersionCarriers: false } },
  })
  await flushPromises()

  const carriers = wrapper.findAll('.resource-version-carriers > article')
  expect(carriers).toHaveLength(2)
  expect(carriers.every((carrier) => !carrier.get('details').element.open)).toBe(true)
  await carriers[1]!.get('details > summary').trigger('click')
  expect(
    carriers.flatMap((carrier) => carrier.findAll('button').map((button) => button.text())),
  ).toContain('对比图片')
  expect(
    carriers[1]!
      .findAll('button')
      .find((button) => button.text() === '对比图片')!
      .attributes('aria-label'),
  ).toContain('card-alternate.png')
  await carriers[1]!
    .findAll('button')
    .find((button) => button.text() === '备注')!
    .trigger('click')
  const editedCarrier = wrapper.findAll('.resource-version-carriers > article')[1]!
  const editor = editedCarrier.get('.resource-version-carrier__note-editor')
  await editor.get('textarea').setValue('透明底备用立绘')
  await wrapper
    .findAll('.resource-version-carriers > article')[1]!
    .get('.resource-version-carrier__note-editor')
    .findAll('button')
    .find((button) => button.text() === '保存封装备注')!
    .trigger('click')

  expect(wrapper.emitted('updateVersionNote')).toEqual([['alternate', '透明底备用立绘']])
  expect(
    wrapper
      .findAll('.resource-version-carriers > article')[0]!
      .find('.resource-version-carrier__note-editor')
      .exists(),
  ).toBe(false)
  expect(await current.originalBlob.text()).toBe('current png')
  expect(await alternate.originalBlob.text()).toBe('alternate png')
  wrapper.unmount()
})
