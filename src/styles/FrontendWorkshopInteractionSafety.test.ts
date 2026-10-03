/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const layerPanelCss = readFileSync(
  new URL('./FrontendWorkshopLayerPanel.css', import.meta.url),
  'utf8',
)
const sourceSessionCss = readFileSync(
  new URL('./FrontendWorkshopSourceSession.css', import.meta.url),
  'utf8',
)
const componentAudit = readFileSync(
  new URL('../../scripts/FrontendWorkshopComponentInteractionAudit.mjs', import.meta.url),
  'utf8',
)

function readRule(source: string, selector: string, useLastMatch = false): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...source.matchAll(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, 'g'))]
  return (useLastMatch ? matches.at(-1) : matches[0])?.[1] ?? ''
}

describe('frontend workshop interaction safety', () => {
  it('uses real 44px layer header targets without overlapping pseudo hit areas', () => {
    const headerButton = readRule(
      layerPanelCss,
      '.frontend-workbench__layer-popover > header button',
    )
    const headerHitArea = readRule(
      layerPanelCss,
      '.frontend-workbench__layer-popover > header button::before',
    )

    expect(headerButton).toContain('min-width: var(--size-touch)')
    expect(headerButton).toContain('min-height: var(--size-touch)')
    expect(headerHitArea).toContain('content: none')
    expect(headerHitArea).not.toContain('inset: -6px')
  })

  it('keeps source preview horizontal scrolling on the toolbar owner only', () => {
    const toolbarRule = readRule(
      sourceSessionCss,
      '.frontend-workshop-source-session__bar-actions',
      true,
    )
    const historyRule = readRule(
      sourceSessionCss,
      '.frontend-workshop-source-session__bar-actions > .frontend-workshop-source-history-panel',
    )

    expect(toolbarRule).toContain('overflow-x: auto')
    expect(historyRule).toContain('overflow: visible')
    expect(historyRule).not.toContain('overflow-x: auto')
  })

  it('explains why nodes outside the active layer are inert', () => {
    const markerRule = readRule(
      layerPanelCss,
      '.frontend-workbench__canvas-node.is-outside-active-layer::after',
    )

    expect(markerRule).toContain("content: '非当前图层'")
    expect(markerRule).toContain('pointer-events: none')
  })

  it('runs the browser hit-area audit from the component interaction gate', () => {
    expect(componentAudit).toContain("await import('./FrontendWorkshopHitAreaAudit.mjs')")
  })
})
