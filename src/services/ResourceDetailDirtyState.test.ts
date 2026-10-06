import { describe, expect, it } from 'vitest'
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import { hasResourceDetailDraftChanges } from './ResourceDetailDirtyState'

function createResource(patch: Partial<Resource> = {}): Resource {
  return {
    id: 'resource-1',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '角色名',
    description: '角色简介',
    fileName: '角色.png',
    mimeType: 'image/png',
    fileSize: 12,
    contentHash: 'hash',
    favorite: false,
    categoryId: null,
    categoryIds: [],
    relatedResourceIds: [],
    tags: ['奇幻', '角色'],
    sourceLinks: [],
    metadata: { card: { name: '角色名' } },
    originalBlob: new Blob(),
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function createDraft(resource: Resource) {
  return {
    name: resource.name,
    authorNote: '',
    description: resource.description,
    type: resource.type,
    categoryIds: resource.categoryIds ?? [],
    relatedResourceIds: resource.relatedResourceIds ?? [],
    tags: resource.tags,
    sourceLinks: resource.sourceLinks,
    characterOverrides: {},
    characterContentEdits: [],
  }
}

describe('hasResourceDetailDraftChanges', () => {
  it('does not mark legacy whitespace and duplicate tags as edits on open', () => {
    const resource = createResource({
      name: '  角色名  ',
      description: '  角色简介\n',
      tags: [' 奇幻 ', '角色', '奇幻'],
    })
    const draft = createDraft(resource)
    draft.name = resource.name.trim()
    draft.description = resource.description.trim()
    draft.tags = ['奇幻', '角色']

    expect(hasResourceDetailDraftChanges(draft, resource)).toBe(false)
  })

  it('still marks actual content changes as dirty', () => {
    const resource = createResource()
    const draft = createDraft(resource)
    draft.description = '改过的简介'

    expect(hasResourceDetailDraftChanges(draft, resource)).toBe(true)
  })

  it('ignores JSON object key order when comparing overrides', () => {
    const resource = createResource({
      metadata: {
        card: { name: '角色名' },
        characterOverrides: { regexEnabled: { second: false, first: true } },
      },
    })
    const draft = createDraft(resource)
    draft.characterOverrides = { regexEnabled: { first: true, second: false } }

    expect(hasResourceDetailDraftChanges(draft, resource)).toBe(false)
  })
})
