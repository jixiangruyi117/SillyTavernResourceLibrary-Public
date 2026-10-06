<script lang="ts">
import { defineComponent, computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { assistantGuidance, assistantGuidanceAnchor } from '../core/ProductAssistantGuidance'
import { isAssistantAuthenticationVisible } from '../core/ProductAssistantViewContext'
export default defineComponent({
  setup() {
    const step = computed(() => assistantGuidance.value?.steps[0])
    let target: HTMLElement | undefined
    let observer: MutationObserver | undefined
    let expiry: ReturnType<typeof setTimeout> | undefined
    let revision = 0
    let alive = true
    function release() {
      if (expiry) clearTimeout(expiry)
      expiry = undefined
      target?.classList.remove('assistant-guide-target')
      target = undefined
      assistantGuidanceAnchor.value = undefined
      observer?.disconnect()
      observer = undefined
    }
    function resolve() {
      if (isAssistantAuthenticationVisible()) {
        close()
        return
      }
      if (target?.isConnected && target.getClientRects().length) {
        return
      }
      target?.classList.remove('assistant-guide-target')
      target = Array.from(document.querySelectorAll<HTMLElement>('[data-assistant-focus]')).find(
        (element) =>
          element.dataset.assistantFocus === step.value?.target &&
          element.getClientRects().length > 0,
      )
      if (!target) assistantGuidanceAnchor.value = undefined
      if (target) {
        target.classList.add('assistant-guide-target')
        target.scrollIntoView({ block: 'center', behavior: 'instant' })
        assistantGuidanceAnchor.value = {
          element: target,
          text: target.dataset.assistantFocusText || step.value?.text || '',
        }
        if (!expiry) expiry = setTimeout(close, 8000)
      }
    }
    async function locate() {
      const current = ++revision
      release()
      await nextTick()
      if (!alive || current !== revision || !assistantGuidance.value) return
      resolve()
      if (!assistantGuidance.value) return
      // Lazy pages and user-opened sections mount through the existing router. No polling/click automation.
      observer = new MutationObserver(resolve)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'style', 'hidden'],
      })
    }
    function close() {
      revision++
      release()
      assistantGuidance.value = undefined
    }
    watch(
      assistantGuidance,
      () => {
        void locate()
      },
      { immediate: true },
    )
    onBeforeUnmount(() => {
      alive = false
      revision++
      release()
    })
    return () => null
  },
})
</script>
<style src="../styles/ProductAssistantGuidance.css"></style>
