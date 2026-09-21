/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { RESOURCE_TYPE, type ResourceSummary, type ResourceType } from '../types/Resource'
import ResourcePicker from './ResourcePicker.vue'

function summary(
  id: string,
  name: string,
  type: ResourceType = RESOURCE_TYPE.PRESET,
): ResourceSummary {
  return {
    id,
    name,
    type,
    description: '',
    fileName: `${name}.json`,
    mimeType: 'application/json',
    fileSize: 12,
    contentHash: id,
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('ResourcePicker', () => {
  it('searches resources and emits a multi-selection change', async () => {
    const wrapper = mount(ResourcePicker, {
      props: {
        resources: [summary('a', '清爽预设'), summary('b', '夜间预设')],
        modelValue: ['a'],
      },
    })
    await wrapper.get('input[type="search"]').setValue('夜间')
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(1)
    await options[0]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual(['a', 'b'])
  })

  it('enforces allowed resource types', () => {
    const wrapper = mount(ResourcePicker, {
      props: {
        resources: [summary('a', '预设'), summary('b', '世界书', RESOURCE_TYPE.WORLD_BOOK)],
        modelValue: [],
        allowedTypes: [RESOURCE_TYPE.WORLD_BOOK],
      },
    })
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('世界书')
  })
})
