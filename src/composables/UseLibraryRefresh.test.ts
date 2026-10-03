/** @vitest-environment jsdom */
import { computed, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { useLibraryRefresh } from './UseLibraryRefresh'
import type { ResourceSummary } from '../types/Resource'

const reads = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../core/AppContainer', () => ({
  resourceService: { listResourceListSummaries: reads.list },
}))
vi.mock('../core/ResourceReferenceIndex', () => ({ rebuildResourceReferenceIndex: vi.fn() }))

it('only publishes the newest accepted summary read, without reloading original files', async () => {
  let finishOld!: (resources: ResourceSummary[]) => void
  const newest = [{ id: 'new' }] as ResourceSummary[]
  reads.list
    .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
    .mockResolvedValueOnce(newest)
  const resources = ref<ResourceSummary[]>([])
  const context = {
    resources,
    showNotice: vi.fn(),
    managedResources: computed(() => resources.value),
  }
  const refresh = useLibraryRefresh(() => context as never)
  const published = vi.fn()
  window.addEventListener('srl:library-resources-changed', published)
  try {
    const old = refresh.loadResources()
    await refresh.loadResources()
    finishOld([{ id: 'old' }] as ResourceSummary[])
    await old
    expect(resources.value).toEqual(newest)
    expect(published).toHaveBeenCalledOnce()
    expect((published.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(newest)
    expect(reads.list).toHaveBeenCalledTimes(2)
  } finally {
    window.removeEventListener('srl:library-resources-changed', published)
  }
})
