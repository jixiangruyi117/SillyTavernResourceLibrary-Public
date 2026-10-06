/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const api = vi.hoisted(() => ({
  confirm: vi.fn(),
  merge: vi.fn(),
  list: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  resourceService: { mergeDuplicates: api.merge, list: api.list },
}))
vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: api.confirm,
}))
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
    api.merge.mockResolvedValue(1)
  })
  it('shows hidden attachments and merges after a single explicit confirmation', async () => {
    const view = mount(DuplicateCleaner, { props: { resources } })
    expect(view.text()).toContain('人设头像附件')
    await view.get('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(api.merge).toHaveBeenCalledWith('a', ['b'])
    expect(api.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: '清理重复副本', danger: true }),
    )
    expect(api.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      api.merge.mock.invocationCallOrder[0]!,
    )
    expect(api.list).not.toHaveBeenCalled()
    expect(view.emitted('library-changed')).toHaveLength(1)
    view.unmount()
  })
  it('reports merge failure without announcing success', async () => {
    api.merge.mockRejectedValue(new Error('合并失败'))
    const view = mount(DuplicateCleaner, { props: { resources } })
    await view.get('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(api.merge).toHaveBeenCalledOnce()
    expect(view.text()).toContain('合并失败')
    expect(view.emitted('library-changed')).toBeUndefined()
    view.unmount()
  })
  it('cancellation does not delete', async () => {
    api.confirm.mockResolvedValue(false)
    const view = mount(DuplicateCleaner, { props: { resources } })
    await view.get('.duplicate-cleaner__clean').trigger('click')
    await flushPromises()
    expect(api.merge).not.toHaveBeenCalled()
    view.unmount()
  })
  it('does not queue duplicate cleanup clicks while confirmation is pending', async () => {
    let resolve!: (confirmed: boolean) => void
    api.confirm.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done
      }),
    )
    const view = mount(DuplicateCleaner, { props: { resources } })
    const button = view.get('.duplicate-cleaner__clean')
    await button.trigger('click')
    await button.trigger('click')
    const count = api.confirm.mock.calls.length
    resolve(true)
    await flushPromises()
    expect(count).toBe(1)
    expect(api.merge).toHaveBeenCalledOnce()
    expect(view.emitted('library-changed')).toHaveLength(1)
    view.unmount()
  })
})
