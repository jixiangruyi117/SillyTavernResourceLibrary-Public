/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const api = vi.hoisted(() => ({
  confirm: vi.fn(),
  capture: vi.fn(),
  merge: vi.fn(),
  source: vi.fn(),
  categories: vi.fn(),
  list: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  resourceService: { mergeDuplicates: api.merge, list: api.list },
  historyService: { capture: api.capture },
  categoryService: { list: api.categories },
}))
vi.mock('../services/ExportService', () => ({ createResourceArchiveSource: api.source }))
vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: api.confirm }))
import DuplicateCleaner from './DuplicateCleaner.vue'

const resources = [
  {
    id: 'persona',
    type: RESOURCE_TYPE.USER_PERSONA,
    contentHash: 'owner',
    metadata: {},
    relatedResourceIds: ['a', 'b'],
  },
  ...['a', 'b'].map((id) => ({
    id,
    type: RESOURCE_TYPE.OTHER,
    contentHash: 'same',
    name: id,
    fileName: `${id}.png`,
    fileSize: 4,
    updatedAt: 1,
    tags: [],
    metadata: { assetKind: 'userPersonaAvatar', avatarId: 'avatar.png' },
    relatedResourceIds: ['persona'],
  })),
] as ResourceSummary[]

describe('DuplicateCleaner avatar cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.confirm.mockResolvedValue(true)
    api.capture.mockResolvedValue({ id: 'recovery' })
    api.source.mockResolvedValue({ resources: [], versions: [], readResource: vi.fn() })
    api.categories.mockResolvedValue([])
    api.merge.mockResolvedValue(1)
  })
  it('shows hidden attachments and snapshots before the confirmed cleanup', async () => {
    const view = mount(DuplicateCleaner, { props: { resources } })
    expect(view.text()).toContain('人设头像附件')
    await view.get('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(api.merge).toHaveBeenCalledWith('a', ['b'])
    expect(api.capture.mock.invocationCallOrder[0]).toBeLessThan(
      api.merge.mock.invocationCallOrder[0]!,
    )
    expect(api.source).toHaveBeenCalledOnce()
    expect(api.list).not.toHaveBeenCalled()
    expect(view.emitted('library-changed')).toHaveLength(1)
    view.unmount()
  })
  it('does not delete when snapshot creation fails', async () => {
    api.capture.mockRejectedValue(new Error('快照空间不足'))
    const view = mount(DuplicateCleaner, { props: { resources } })
    await view.get('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(api.merge).not.toHaveBeenCalled()
    expect(view.text()).toContain('快照空间不足')
    view.unmount()
  })
  it('cancellation neither snapshots nor deletes', async () => {
    api.confirm.mockResolvedValue(false)
    const view = mount(DuplicateCleaner, { props: { resources } })
    await view.get('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(api.capture).not.toHaveBeenCalled()
    expect(api.merge).not.toHaveBeenCalled()
    view.unmount()
  })
})
