import { onMounted, onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import { assetStore } from '../core/AppContainer'
import type { ResourceReference } from '../types/Resource'

const nearViewport = new Map<Element, () => void>()
let visibilityObserver: IntersectionObserver | undefined
const readQueue: Array<() => Promise<void>> = []
let activeReads = 0
function drainReads(): void {
  while (activeReads < 4 && readQueue.length) {
    const read = readQueue.shift()!
    activeReads++
    void read().finally(() => {
      activeReads--
      drainReads()
    })
  }
}

export function useResourceThumbnail(
  source: () => ResourceReference | undefined,
  host?: Readonly<Ref<Element | null>>,
): Ref<Blob | undefined> {
  const thumbnail = shallowRef<Blob>()
  const ready = shallowRef(!host || typeof IntersectionObserver !== 'function')
  let generation = 0
  let queued: (() => Promise<void>) | undefined
  function cancelQueued(): void {
    generation++
    const index = queued ? readQueue.indexOf(queued) : -1
    if (index >= 0) readQueue.splice(index, 1)
    queued = undefined
  }
  if (host)
    onMounted(() => {
      if (ready.value || !host.value) return
      visibilityObserver ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              nearViewport.get(entry.target)?.()
              nearViewport.delete(entry.target)
              visibilityObserver?.unobserve(entry.target)
            }
        },
        { rootMargin: '300px' },
      )
      nearViewport.set(host.value, () => {
        ready.value = true
      })
      visibilityObserver.observe(host.value)
    })
  onScopeDispose(() => {
    cancelQueued()
    if (host?.value) {
      nearViewport.delete(host.value)
      visibilityObserver?.unobserve(host.value)
    }
    if (!nearViewport.size) {
      visibilityObserver?.disconnect()
      visibilityObserver = undefined
    }
  })

  watch(
    () => {
      const resource = source()
      return {
        resource,
        blob: resource?.thumbnailBlob,
        assetId: resource?.thumbnailAssetId,
        contentHash: resource?.contentHash,
        ready: ready.value,
      }
    },
    ({ resource, blob, assetId, ready }) => {
      cancelQueued()
      const currentGeneration = generation
      if (!ready) return
      thumbnail.value = blob
      if (!resource || blob instanceof Blob || !assetId) return
      queued = async () => {
        if (currentGeneration !== generation) return
        try {
          const loaded = await assetStore.getBlob(assetId)
          if (currentGeneration === generation) thumbnail.value = loaded
        } catch {
          // A missing cover must not prevent browsing or surface as an unhandled app error.
        }
      }
      readQueue.push(queued)
      drainReads()
    },
    { immediate: true },
  )

  return thumbnail
}
