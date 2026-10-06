/** @vitest-environment jsdom */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppearanceScope } from '../core/AppearanceScopes'

const { readCss, download } = vi.hoisted(() => ({ readCss: vi.fn(), download: vi.fn() }))
vi.mock('../services/AppearanceOriginalCssService', () => ({ readOriginalCss: readCss }))
vi.mock('../utils/LibraryFormatting', () => ({ downloadBlob: download }))
import AppearanceOriginalCssActions from './AppearanceOriginalCssActions.vue'

enableAutoUnmount(afterEach)
const scope: AppearanceScope = {
  value: 'draw',
  title: '抽了么',
  selector: '.draw-stage',
  hint: '',
  appId: 'draw',
}
const parts = ['/* official */\n', '.a { color: red; }\n', '.last { color: green; }']

beforeEach(() => {
  vi.clearAllMocks()
  readCss.mockResolvedValue({ parts })
  download.mockResolvedValue(undefined)
  vi.stubGlobal('ClipboardItem', undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('original CSS actions', () => {
  it('provides copy and export in one group and does not read CSS on mount', () => {
    const wrapper = mount(AppearanceOriginalCssActions, { props: { scope } })
    const buttons = wrapper.get('[role="group"]').findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['复制原始 CSS', '导出原始 CSS'])
    expect(readCss).not.toHaveBeenCalled()
  })

  it('exports large CSS intact without using the clipboard', async () => {
    const largeParts = [...parts, `/* ${'x'.repeat(250_000)} */`, '.end {}']
    readCss.mockResolvedValue({ parts: largeParts })
    const wrapper = mount(AppearanceOriginalCssActions, { props: { scope } })
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    const [blob, filename] = download.mock.calls[0] as [Blob, string]
    expect(blob.type).toBe('text/css;charset=utf-8')
    expect(blob.size).toBe(new Blob(largeParts).size)
    expect(filename).toBe('srl-original-draw.css')
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(wrapper.get('[role="status"]').text()).toContain('已导出')
  })

  it('copies the same original parts, independently of the user preset editor', async () => {
    const wrapper = mount(AppearanceOriginalCssActions)
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(parts.join(''))
    expect(download).not.toHaveBeenCalled()
  })

  it('starts clipboard writing within the tap gesture', async () => {
    let complete!: (value: { parts: string[] }) => void
    readCss.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    vi.stubGlobal(
      'ClipboardItem',
      class {
        items: Record<string, Promise<Blob>>

        constructor(items: Record<string, Promise<Blob>>) {
          this.items = items
        }
      },
    )
    const write = vi.fn(async (items: Array<{ items: Record<string, Promise<Blob>> }>) => {
      await items[0]!.items['text/plain']
    })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    const wrapper = mount(AppearanceOriginalCssActions)
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(write).toHaveBeenCalledTimes(1)
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    complete({ parts })
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('已复制')
  })

  it('prevents repeat requests and captures the selected scope', async () => {
    let complete!: (value: { parts: string[] }) => void
    readCss.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    const wrapper = mount(AppearanceOriginalCssActions, { props: { scope } })
    await wrapper.findAll('button')[1]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    await wrapper.setProps({ scope: { ...scope, value: 'bridge', title: '酒馆互传' } })
    complete({ parts })
    await flushPromises()
    expect(readCss).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0]?.[1]).toBe('srl-original-draw.css')
  })

  it('reports read and download failures without claiming success', async () => {
    readCss.mockRejectedValue(new Error('原始 CSS 文件读取失败'))
    const wrapper = mount(AppearanceOriginalCssActions)
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(download).not.toHaveBeenCalled()
    expect(wrapper.get('[role="status"]').text()).toContain('读取失败')
    readCss.mockResolvedValue({ parts })
    download.mockRejectedValue(new Error('导出失败'))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('导出失败')
  })
})
