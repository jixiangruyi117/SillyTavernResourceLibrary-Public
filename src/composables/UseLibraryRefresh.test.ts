/** @vitest-environment jsdom */
import { computed, ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { useLibraryRefresh } from './UseLibraryRefresh'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const reads = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../core/LibraryContainer', () => ({
  resourceService: { listResourceListSummaries: reads.list },
}))
vi.mock('../core/ResourceReferenceIndex', () => ({ rebuildResourceReferenceIndex: vi.fn() }))

beforeEach(() => reads.list.mockReset())

function setup(resources = ref<ResourceSummary[]>([])) {
  const showNotice = vi.fn()
  const context = { resources, showNotice, managedResources: computed(() => resources.value) }
  return { resources, showNotice, refresh: useLibraryRefresh(() => context as never) }
}

it.each([1000, 10000])(
  'reuses a complete %i-item committed catalogue without another database read',
  async (size) => {
    const original: ResourceSummary[] = Array.from({ length: size }, (_, index) => ({
      id: `r-${index}`,
      type: RESOURCE_TYPE.CHARACTER_CARD,
      name: `角色${index}`,
      fileName: `${index}.png`,
      mimeType: 'image/png',
      fileSize: index,
      contentHash: String(index).padStart(64, '0'),
      description: '',
      tags: ['保留标签'],
      categoryId: null,
      favorite: index % 2 === 0,
      createdAt: index,
      updatedAt: index,
      metadata: { manuallyBoundResourceIds: ['r-1'] },
    }))
    const { resources, refresh } = setup(ref(original))
    const apply = refresh.prepareResourceRefresh()
    const remaining = original.slice(1)
    await apply(remaining)
    expect(reads.list).not.toHaveBeenCalled()
    expect(resources.value).toHaveLength(size - 1)
    expect(resources.value.map((resource) => resource.id)).toEqual(
      remaining.map((resource) => resource.id),
    )
    expect(resources.value[0]?.metadata).toEqual(remaining[0]?.metadata)
  },
)

it('invalidates an older in-flight read when a committed catalogue is published', async () => {
  let finish!: (resources: ResourceSummary[]) => void
  reads.list.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  const { resources, refresh } = setup()
  const old = refresh.loadResources()
  const apply = refresh.prepareResourceRefresh()
  const committed = [{ id: 'survivor' }] as ResourceSummary[]
  await apply(committed)
  finish([{ id: 'deleted' }] as ResourceSummary[])
  await old
  expect(resources.value).toEqual(committed)
  expect(reads.list).toHaveBeenCalledOnce()
})

it('rereads when a newer refresh starts during deletion, without later reviving an old read', async () => {
  let finish!: (resources: ResourceSummary[]) => void
  const newest = [{ id: 'imported' }] as ResourceSummary[]
  reads.list
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockResolvedValueOnce(newest)
  const { resources, refresh } = setup()
  const apply = refresh.prepareResourceRefresh()
  const overlapping = refresh.loadResources()
  await apply([{ id: 'stale-survivor' }] as ResourceSummary[])
  finish([{ id: 'old' }] as ResourceSummary[])
  await overlapping
  expect(resources.value).toEqual(newest)
  expect(reads.list).toHaveBeenCalledTimes(2)
})

it('rereads after a direct optimistic list replacement, and keeps it if the reread fails', async () => {
  const newest = [{ id: 'updated' }] as ResourceSummary[]
  const { resources, showNotice, refresh } = setup()
  const apply = refresh.prepareResourceRefresh()
  resources.value = newest
  reads.list.mockRejectedValueOnce(new Error('read failed'))
  await expect(apply([{ id: 'stale' }] as ResourceSummary[])).rejects.toThrow('read failed')
  expect(resources.value).toEqual(newest)
  expect(showNotice).toHaveBeenCalledOnce()
})

it('keeps the full-read compatibility path when no committed catalogue is supplied', async () => {
  const newest = [{ id: 'existing' }] as ResourceSummary[]
  reads.list.mockResolvedValueOnce(newest)
  const { resources, refresh } = setup()
  await refresh.prepareResourceRefresh()()
  expect(resources.value).toEqual(newest)
  expect(reads.list).toHaveBeenCalledOnce()
})

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
