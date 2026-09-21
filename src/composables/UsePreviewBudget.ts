import { onBeforeUnmount, onMounted, ref, watch, type Ref, type WatchSource } from 'vue'

import { previewBudget, type PreviewBudgetLease } from '../core/PreviewBudget'
import { ResourceScope } from '../core/ResourceScope'

let nextPreviewId = 0

export function usePreviewBudget(
  name: string,
  requested: WatchSource<boolean>,
  host?: Readonly<Ref<Element | null | undefined>>,
): { previewEnabled: Ref<boolean> } {
  const previewEnabled = ref(false)
  const scope = new ResourceScope()
  let lease: PreviewBudgetLease | undefined
  let requestedValue = false
  let intersecting = true

  const syncVisibility = () => {
    lease?.setVisible(requestedValue && intersecting && document.visibilityState !== 'hidden')
  }

  watch(
    requested,
    (value) => {
      requestedValue = value
      syncVisibility()
    },
    { immediate: true },
  )

  onMounted(() => {
    nextPreviewId += 1
    lease = previewBudget.register(`${name}:${nextPreviewId}`, {
      suspend: () => (previewEnabled.value = false),
      release: () => (previewEnabled.value = false),
      resume: () => (previewEnabled.value = true),
    })
    if (host?.value && 'IntersectionObserver' in window) {
      intersecting = false
      const observer = scope.observer(
        new IntersectionObserver((entries) => {
          intersecting = entries.some((entry) => entry.isIntersecting)
          syncVisibility()
        }),
      )
      observer.observe(host.value)
    }
    scope.listen(document, 'visibilitychange', syncVisibility)
    syncVisibility()
  })

  onBeforeUnmount(() => {
    lease?.unregister()
    scope.dispose()
  })

  return { previewEnabled }
}
