const FRONTEND_MARKERS = ['html>', '<head>', '<body'] as const

export interface RenderCompatibilityFrontendBlocks {
  html: string
  blocks: string[]
}

export function isRenderCompatibilityFrontendPre(value: string): boolean {
  return FRONTEND_MARKERS.some((marker) => value.includes(marker))
}

function viewportMinimum(value: string): string {
  return value.replace(/(\d+(?:\.\d+)?)vh\b/giu, (_token, amount: string) => {
    const ratio = Number(amount) / 100
    return ratio === 1 ? 'var(--TH-viewport-height)' : `calc(var(--TH-viewport-height) * ${ratio})`
  })
}

function mapMinimumHeightDeclarations(css: string): string {
  return css.replace(
    /(min-height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?vh)(?=\s*[;}])/giu,
    (_declaration, prefix: string, value: string) => `${prefix}${viewportMinimum(value)}`,
  )
}

function mapStaticMinimumHeightAssignments(source: string): string {
  const directAssignment = /(\.\s*style\s*\.\s*minHeight\s*=\s*)(["'])(.*?)\2/giu
  const setProperty =
    /(\.\s*style\s*\.\s*setProperty\s*\(\s*["']min-height["']\s*,\s*)(["'])(.*?)\2/giu

  return source
    .replace(
      directAssignment,
      (_assignment, prefix: string, quote: string, value: string) =>
        `${prefix}${quote}${viewportMinimum(value)}${quote}`,
    )
    .replace(
      setProperty,
      (_assignment, prefix: string, quote: string, value: string) =>
        `${prefix}${quote}${viewportMinimum(value)}${quote}`,
    )
}

/**
 * Implements the bounded public TavernHelper 4.9.3 viewport behavior contract.
 * Only numeric `vh` tokens in `min-height` declarations or static minHeight
 * assignments use the explicit host viewport. Other properties and dvh/svh/lvh
 * retain browser-native nested-viewport semantics.
 */
export function mapRenderCompatibilityViewportMinimums(source: string): string {
  const mappedStyles = source
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/giu,
      (_element, opening: string, css: string, closing: string) =>
        `${opening}${mapMinimumHeightDeclarations(css)}${closing}`,
    )
    .replace(
      /(style\s*=\s*)(["'])([\s\S]*?)(\2)/giu,
      (_attribute, prefix: string, quote: string, css: string) =>
        `${prefix}${quote}${mapMinimumHeightDeclarations(`${css};`).replace(/;$/, '')}${quote}`,
    )

  return mapStaticMinimumHeightAssignments(mappedStyles)
}

/**
 * Frontend detection is deliberately a formatted-DOM operation. Language labels,
 * raw source and generic HTML outside a PRE element are not compatibility signals.
 */
export function findRenderCompatibilityFrontendBlocks(
  formattedHtml: string,
): RenderCompatibilityFrontendBlocks {
  if (typeof document === 'undefined') return { html: formattedHtml, blocks: [] }

  const template = document.createElement('template')
  template.innerHTML = formattedHtml
  const blocks: string[] = []

  for (const pre of template.content.querySelectorAll('pre')) {
    const renderedText = pre.textContent ?? ''
    if (!isRenderCompatibilityFrontendPre(renderedText)) continue
    const code = Array.from(pre.querySelectorAll('code'))
      .map((element) => element.textContent ?? '')
      .join('')
    blocks.push(code)

    const existing = pre.parentElement
    if (existing?.matches('[data-srl-render-frontend="true"]')) continue
    const host = document.createElement('div')
    // TH-render is a narrow author-style compatibility shim. SRL owns detection and lifecycle.
    host.className = 'TH-render'
    host.dataset.srlRenderFrontend = 'true'
    pre.before(host)
    host.append(pre)
  }

  const container = document.createElement('div')
  container.append(template.content.cloneNode(true))
  return { html: container.innerHTML, blocks }
}
