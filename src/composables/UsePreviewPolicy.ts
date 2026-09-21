import { onUnmounted, ref } from 'vue'

import { browserStorageService } from '../core/AppContainer'
import { isSafeModeActive } from '../core/SafeStartup'
import type { PreviewPolicy } from '../services/BrowserStorageService'

function safePolicy(value: PreviewPolicy): PreviewPolicy {
  return isSafeModeActive()
    ? {
        allowRemoteResources: false,
        allowScripts: false,
        preloadGreetingResources: false,
        preloadBeautificationResources: false,
      }
    : value
}

export function usePreviewPolicy() {
  const previewPolicy = ref(safePolicy(browserStorageService.getPreviewPolicy()))
  const unsubscribe = browserStorageService.onPreviewPolicyChange((value) => {
    previewPolicy.value = safePolicy(value)
  })
  onUnmounted(unsubscribe)
  return previewPolicy
}
