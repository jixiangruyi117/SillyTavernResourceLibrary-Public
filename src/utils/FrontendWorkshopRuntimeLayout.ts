/** Editing evidence collected by the existing preview runtime; no DOM or Source mutations. */
export interface FrontendWorkshopRuntimeLayout {
  translate: string
  scaleX: number
  scaleY: number
  movable: boolean
}

export function readFrontendWorkshopRuntimeLayout(node: Element): FrontendWorkshopRuntimeLayout {
  const style = getComputedStyle(node)
  const result = { translate: style.translate || 'none', scaleX: 1, scaleY: 1, movable: true }
  if (
    node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
    ['inline', 'contents', 'none'].includes(style.display)
  )
    result.movable = false
  // Independent translate composes with the element's existing transform animation.
  // Rotated/perspective ancestors require an inverse 3D projection, not screen-space deltas.
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent)
    if (
      (css.perspective && css.perspective !== 'none') ||
      (css.rotate && !['none', '0deg'].includes(css.rotate))
    )
      result.movable = false
    if (css.transform && css.transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(css.transform)
      if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0)
        result.movable = false
      else {
        result.scaleX *= matrix.a
        result.scaleY *= matrix.d
      }
    }
    const scales = !css.scale || css.scale === 'none' ? [1] : css.scale.split(' ').map(Number)
    if (scales.some((value) => !Number.isFinite(value) || value <= 0)) result.movable = false
    else {
      result.scaleX *= scales[0] ?? 1
      result.scaleY *= scales[1] ?? scales[0] ?? 1
    }
    const zoom = Number.parseFloat(css.zoom) || 1
    result.scaleX *= zoom
    result.scaleY *= zoom
  }
  if (
    node.getAnimations?.().some((animation) => {
      const effect = animation.effect
      return (
        effect instanceof KeyframeEffect &&
        effect.getKeyframes().some((frame) => 'translate' in frame)
      )
    })
  )
    result.movable = false
  function checkRules(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSStyleRule &&
        rule.style.getPropertyPriority('translate') &&
        node.matches(rule.selectorText)
      )
        result.movable = false
      if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue
      if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) continue
      if ('cssRules' in rule) checkRules((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled || (sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches))
      continue
    try {
      checkRules(sheet.cssRules)
    } catch {
      /* Cross-origin sheets cannot be inspected. */
    }
  }
  return result
}
