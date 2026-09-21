const INPUT_VIEWPORT_PADDING = 12

interface ViewportBounds {
  height: number
  offsetTop: number
}

interface ElementBounds {
  top: number
  bottom: number
}

let personalAvoidance:
  | {
      target: HTMLElement
      container: HTMLElement
      before: number
      applied: number
      restorable: boolean
    }
  | undefined

/** Undo only our own personal-editor avoidance, never a user's later scroll or field change. */
export function restorePersonalInputScroll(): void {
  const previous = personalAvoidance
  personalAvoidance = undefined
  if (!previous || !previous.restorable || !previous.target.isConnected) return
  const active = document.activeElement
  if (
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
    active !== previous.target
  )
    return
  const { container } = previous
  const expected = Math.min(
    previous.applied,
    Math.max(0, container.scrollHeight - container.clientHeight),
  )
  if (container.isConnected && Math.abs(container.scrollTop - expected) <= 1)
    container.scrollTop = previous.before
}

/**
 * iOS 打开软键盘时会自行滚动焦点元素。只有元素仍落在视觉视口外时，
 * 才做最小距离补偿，避免与系统滚动和键盘动画叠加。
 */
export function revealMobileInputIfOccluded(
  target: HTMLElement,
  viewport: ViewportBounds,
): boolean {
  const bounds = target.getBoundingClientRect()
  const dialog = target.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')
  if (dialog) {
    // Keep focus scrolling inside its dialog. scrollIntoView also scrolls the
    // document on iOS, and visualViewport.offsetTop is not the dialog's origin.
    let container = target.parentElement
    while (container && dialog.contains(container)) {
      if (
        /(auto|scroll)/.test(getComputedStyle(container).overflowY) &&
        container.scrollHeight > container.clientHeight
      ) {
        const area = container.getBoundingClientRect()
        const top = area.top + INPUT_VIEWPORT_PADDING
        const bottom = area.bottom - INPUT_VIEWPORT_PADDING
        // A field larger than the available area cannot fit at both edges.
        if (bounds.top <= top && bounds.bottom >= bottom) return false
        const delta = bounds.top < top ? bounds.top - top : Math.max(0, bounds.bottom - bottom)
        if (!delta) return false
        if (dialog.matches('.personal-resource-editor')) {
          if (!personalAvoidance) {
            personalAvoidance = {
              target,
              container,
              before: container.scrollTop,
              applied: container.scrollTop,
              restorable: true,
            }
          } else if (
            personalAvoidance.target !== target ||
            personalAvoidance.container !== container ||
            Math.abs(container.scrollTop - personalAvoidance.applied) > 1
          ) {
            personalAvoidance.restorable = false
          }
        }
        container.scrollTop += delta
        if (personalAvoidance?.container === container)
          personalAvoidance.applied = container.scrollTop
        return true
      }
      if (container === dialog) break
      container = container.parentElement
    }
    return false
  }
  if (!isElementOccludedByViewport(bounds, viewport)) return false

  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  return true
}

export function isElementOccludedByViewport(
  element: ElementBounds,
  viewport: ViewportBounds,
): boolean {
  const viewportTop = viewport.offsetTop + INPUT_VIEWPORT_PADDING
  const viewportBottom = viewport.offsetTop + viewport.height - INPUT_VIEWPORT_PADDING
  return element.top < viewportTop || element.bottom > viewportBottom
}
