import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('uses the shared theme owner for every activity-panel surface, progress and status color', () => {
  const css = readFileSync(new URL('../styles/ProjectActivityCenter.css', import.meta.url), 'utf8')
  expect(css).not.toMatch(/var\(--(?:ink|surface|accent|muted)(?:,|\))/)
  for (const token of [
    'color-ink',
    'color-surface',
    'color-accent',
    'color-ink-soft',
    'color-on-accent',
    'color-danger',
    'color-warning',
    'color-line',
  ]) {
    expect(css).toContain(`var(--${token})`)
  }
})
