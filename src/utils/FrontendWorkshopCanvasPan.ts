export interface FrontendWorkshopCanvasPanEvent {
  phase: 'start' | 'move' | 'end'
  x: number
  y: number
}

/** Shared by the editor background and the isolated author frame; no author-source mutation. */
export function installFrontendWorkshopCanvasPan(
  view: Window,
  enabled: () => boolean,
  publish: (event: FrontendWorkshopCanvasPanEvent) => void,
  surface?: HTMLElement,
): () => void {
  let pending: { id: number; x: number; y: number; target: Element; active: boolean } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let suppressClick = false
  const finish = () => {
    clearTimeout(timer)
    if (pending?.active) {
      publish({ phase: 'end', x: pending.x, y: pending.y })
      if (pending.target.hasPointerCapture?.(pending.id))
        pending.target.releasePointerCapture(pending.id)
    }
    pending = undefined
  }
  const down = (event: PointerEvent) => {
    if (pending) {
      finish()
      return
    }
    suppressClick = false
    if (!enabled() || event.button !== 0 || event.isPrimary === false) return
    const target = event.composedPath().find((node) => (node as Element)?.nodeType === 1) as
      Element | undefined
    if (
      !target ||
      (surface && !surface.contains(target)) ||
      target.closest(
        'input,textarea,select,[contenteditable="true"],[data-source-transform-handle]',
      )
    )
      return
    pending = { id: event.pointerId, x: event.clientX, y: event.clientY, target, active: false }
    timer = setTimeout(() => {
      if (!pending || !enabled()) {
        finish()
        return
      }
      pending.active = true
      suppressClick = true
      try {
        pending.target.setPointerCapture?.(pending.id)
      } catch {
        /* Pointer may have left the frame. */
      }
      publish({ phase: 'start', x: pending.x, y: pending.y })
    }, 400)
  }
  const move = (event: PointerEvent) => {
    if (!pending || pending.id !== event.pointerId) return
    if (!pending.active) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) finish()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    publish({ phase: 'move', x: event.clientX, y: event.clientY })
  }
  const up = (event: PointerEvent) => {
    if (!pending || pending.id !== event.pointerId) return
    if (pending.active) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    finish()
  }
  const click = (event: MouseEvent) => {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const context = (event: Event) => {
    if (pending) event.preventDefault()
  }
  const touchMove = (event: TouchEvent) => {
    if (pending?.active) event.preventDefault()
  }
  view.addEventListener('pointerdown', down, true)
  view.addEventListener('pointermove', move, true)
  view.addEventListener('pointerup', up, true)
  view.addEventListener('pointercancel', up, true)
  view.addEventListener('click', click, true)
  view.addEventListener('contextmenu', context, true)
  view.addEventListener('touchmove', touchMove, { capture: true, passive: false })
  view.addEventListener('blur', finish)
  return () => {
    finish()
    view.removeEventListener('pointerdown', down, true)
    view.removeEventListener('pointermove', move, true)
    view.removeEventListener('pointerup', up, true)
    view.removeEventListener('pointercancel', up, true)
    view.removeEventListener('click', click, true)
    view.removeEventListener('contextmenu', context, true)
    view.removeEventListener('touchmove', touchMove, true)
    view.removeEventListener('blur', finish)
  }
}
