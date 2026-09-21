import { shallowRef, watch, type Ref } from 'vue'

import { assetStore } from '../core/AppContainer'
import type { ResourceReference } from '../types/Resource'

export function useResourceThumbnail(
  source: () => ResourceReference | undefined,
): Ref<Blob | undefined> {
  const thumbnail = shallowRef<Blob>()
  let generation = 0

  watch(
    () => {
      const resource = source()
      return {
        resource,
        blob: resource?.thumbnailBlob,
        assetId: resource?.thumbnailAssetId,
        contentHash: resource?.contentHash,
      }
    },
    async ({ resource, blob, assetId }) => {
      const currentGeneration = ++generation
      thumbnail.value = blob
      if (!resource || blob instanceof Blob || !assetId) return
      const loaded = await assetStore.getBlob(assetId)
      if (currentGeneration === generation) thumbnail.value = loaded
    },
    { immediate: true },
  )

  return thumbnail
}
