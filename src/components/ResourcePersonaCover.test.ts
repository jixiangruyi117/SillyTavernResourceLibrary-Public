/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

import ResourceCard from './ResourceCard.vue'
import ResourceListRow from './ResourceListRow.vue'

function personaSummary(): ResourceSummary {
  return {
    id: 'persona',
    type: RESOURCE_TYPE.USER_PERSONA,
    name: 'Alice',
    description: '',
    fileName: 'personas.json',
    mimeType: 'application/json',
    fileSize: 128,
    contentHash: 'persona-hash',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: ['avatar'],
    tags: [],
    metadata: { defaultPersonaAvatarId: 'alice.png' },
    thumbnailBlob: new Blob(['avatar-cover'], { type: 'image/webp' }),
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:persona-cover'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('user persona library covers', () => {
  it('renders the default avatar on the resource grid card', () => {
    const wrapper = mount(ResourceCard, {
      props: { resource: personaSummary(), blurThumbnails: false },
    })

    expect(wrapper.get('.resource-card__preview img').attributes('src')).toBe('blob:persona-cover')
    expect(wrapper.get('.resource-card__preview').attributes('aria-label')).toContain(
      '用户头像封面',
    )
  })

  it('renders the default avatar in list layout', () => {
    const wrapper = mount(ResourceListRow, { props: { resource: personaSummary() } })

    expect(wrapper.get('.resource-row__thumb img').attributes('src')).toBe('blob:persona-cover')
  })
})
