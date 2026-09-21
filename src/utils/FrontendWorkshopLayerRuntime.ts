import type { FrontendWorkshopLayerView } from './FrontendWorkshopSourceLayers'

/** Editor-only CSS and selection filtering. No author attributes or source are rewritten. */
export function installFrontendWorkshopLayerView(view: Window & typeof globalThis) {
  let state: FrontendWorkshopLayerView = { hidden: [], locked: [] }
  const style = view.document.createElement('style')
  style.setAttribute('data-fw-editor-layer-view', '')
  const valid = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)
  const selector = (id: string) => `[data-fw-layer="${id}"]`
  const clean = (value: unknown): string[] => (Array.isArray(value) ? value.filter(valid) : [])
  const update = (input?: Partial<FrontendWorkshopLayerView>) => {
    state = {
      hidden: clean(input?.hidden),
      locked: clean(input?.locked),
      ...(valid(input?.solo) ? { solo: input.solo } : {}),
    }
    const hidden = new Set(state.hidden)
    if (state.solo) {
      const selected = [...view.document.querySelectorAll(selector(state.solo))]
      if (selected.length) {
        for (const element of view.document.querySelectorAll('[data-fw-layer]')) {
          const id = element.getAttribute('data-fw-layer')
          if (
            valid(id) &&
            !selected.some((root) => element.contains(root) || root.contains(element))
          )
            hidden.add(id)
        }
      }
    }
    style.textContent = [
      ...[...hidden].map((id) => `${selector(id)},${selector(id)} *{visibility:hidden!important}`),
      ...state.locked.map(
        (id) => `${selector(id)},${selector(id)} *{pointer-events:none!important}`,
      ),
    ].join('\n')
    if (!style.isConnected) (view.document.head ?? view.document.documentElement).append(style)
  }
  const selectable = (node: Element) => {
    for (let current: Element | null = node; current; current = current.parentElement) {
      const id = current.getAttribute('data-fw-layer')
      if (id && (state.hidden.includes(id) || state.locked.includes(id))) return false
    }
    return view.getComputedStyle(node).visibility !== 'hidden'
  }
  return { update, selectable, dispose: () => style.remove() }
}
