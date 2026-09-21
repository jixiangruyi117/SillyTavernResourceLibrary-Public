// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { installFrontendWorkshopLayerView } from './FrontendWorkshopLayerRuntime'
afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
it('isolates layers, prevents nested selection and restores the original DOM without touching source', () => {
  document.body.innerHTML =
    '<section data-fw-layer="outer"><h1>name</h1><div data-fw-layer="face"><button>头像</button></div></section><aside data-fw-layer="bg">背景</aside>'
  const original = document.body.innerHTML
  const runtime = installFrontendWorkshopLayerView(window)
  runtime.update({ hidden: ['bg'], locked: ['outer'] })
  expect(getComputedStyle(document.querySelector('aside')!).visibility).toBe('hidden')
  expect(runtime.selectable(document.querySelector('button')!)).toBe(false)
  runtime.update({ solo: 'face' })
  expect(getComputedStyle(document.querySelector('aside')!).visibility).toBe('hidden')
  expect(getComputedStyle(document.querySelector('button')!).visibility).toBe('visible')
  expect(runtime.selectable(document.querySelector('button')!)).toBe(true)
  runtime.update({ hidden: ['bad"]body{display:none}'] })
  expect(document.querySelector('[data-fw-editor-layer-view]')!.textContent).toBe('')
  runtime.dispose()
  expect(document.querySelector('[data-fw-editor-layer-view]')).toBeNull()
  expect(document.body.innerHTML).toBe(original)
})
