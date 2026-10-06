import { ref, type Ref } from 'vue'

export function useStitchColumnResize(mainSide: Ref<'left' | 'right'>) {
  const sourceShare = ref(40)
  const resizingColumns = ref(false)
  function resizeColumns(event: PointerEvent): void {
    if (!resizingColumns.value) return
    const separator = event.currentTarget as HTMLElement
    const bounds = separator.parentElement!.getBoundingClientRect()
    const leftShare = ((event.clientX - bounds.left) / bounds.width) * 100
    sourceShare.value = Math.round(
      Math.max(30, Math.min(60, mainSide.value === 'left' ? 100 - leftShare : leftShare)),
    )
  }
  function startColumnResize(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return
    resizingColumns.value = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function resizeColumnsWithKeyboard(event: KeyboardEvent): void {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    sourceShare.value =
      event.key === 'Home'
        ? 30
        : event.key === 'End'
          ? 60
          : Math.max(
              30,
              Math.min(60, sourceShare.value + direction * (mainSide.value === 'left' ? -2 : 2)),
            )
  }

  return {
    sourceShare,
    resizingColumns,
    resizeColumns,
    startColumnResize,
    resizeColumnsWithKeyboard,
  }
}
