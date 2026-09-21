import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { browserStorageService } from '../core/AppContainer'

/** Owns only the overlay dimensions; never changes the preview viewport or source. */
export function useFrontendWorkshopInspectorDrawer(
  element: Ref<HTMLElement | undefined>,
  hasSelection: () => boolean,
) {
  const saved = browserStorageService.getFrontendWorkshopDrawerSize()
  const bottom = ref(saved.bottom)
  const side = ref(saved.side)
  const collapsed = ref(!hasSelection())
  const desktop = ref(false)
  const extent = ref(600)
  let observer: ResizeObserver | undefined
  let drag: { id: number; axis: 'x' | 'y'; start: number; size: number; moved: boolean } | undefined
  let ignoreClick = false
  const minimum = computed(() => Math.min(desktop.value ? 280 : 180, extent.value * 0.9))
  const size = computed(() =>
    Math.max(
      minimum.value,
      Math.min(extent.value * 0.95, extent.value * (desktop.value ? side.value : bottom.value)),
    ),
  )
  const drawerStyle = computed(() => ({ '--inspector-size': `${size.value}px` }))
  function measure() {
    desktop.value = window.matchMedia?.('(min-width: 48rem)').matches ?? window.innerWidth >= 768
    const bounds = element.value?.parentElement?.getBoundingClientRect()
    extent.value = Math.max(1, (desktop.value ? bounds?.width : bounds?.height) ?? 600)
  }
  function setSize(next: number) {
    const ratio = Math.max(minimum.value, Math.min(extent.value * 0.95, next)) / extent.value
    if (desktop.value) side.value = ratio
    else bottom.value = ratio
  }
  function persist() {
    browserStorageService.setFrontendWorkshopDrawerSize({ bottom: bottom.value, side: side.value })
  }
  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || event.isPrimary === false) return
    measure()
    ignoreClick = false
    drag = {
      id: event.pointerId,
      axis: desktop.value ? 'x' : 'y',
      start: desktop.value ? event.clientX : event.clientY,
      size: collapsed.value ? 24 : size.value,
      moved: false,
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }
  function moveDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return
    const delta = drag.start - (drag.axis === 'x' ? event.clientX : event.clientY)
    if (!drag.moved && Math.abs(delta) < 4) return
    drag.moved = true
    const next = drag.size + delta
    collapsed.value = next < 96
    if (!collapsed.value) setSize(next)
  }
  function endDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return
    ignoreClick = drag.moved
    drag = undefined
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
    persist()
  }
  function toggleDrawer(event: MouseEvent) {
    if (event.detail !== 0 && ignoreClick) {
      ignoreClick = false
      return
    }
    ignoreClick = false
    collapsed.value = !collapsed.value
  }
  function resizeWithKeyboard(event: KeyboardEvent) {
    const enlarge = desktop.value ? 'ArrowLeft' : 'ArrowUp'
    const shrink = desktop.value ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== enlarge && event.key !== shrink) return
    event.preventDefault()
    collapsed.value = false
    setSize(size.value + (event.key === enlarge ? 24 : -24))
    persist()
  }
  onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined' && element.value?.parentElement) {
      observer = new ResizeObserver(measure)
      observer.observe(element.value.parentElement)
    }
    window.addEventListener('resize', measure)
  })
  onUnmounted(() => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
    drag = undefined
  })
  return { collapsed, drawerStyle, startDrag, moveDrag, endDrag, toggleDrawer, resizeWithKeyboard }
}
