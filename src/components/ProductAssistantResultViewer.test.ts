/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import ProductAssistantResultViewer from './ProductAssistantResultViewer.vue'

describe('readable public source receipts', () => {
  const originalModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  beforeAll(() =>
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(),
    }),
  )
  afterAll(() => {
    if (originalModal)
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalModal)
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  })
  it('shows complete source status and escaped code without exposing the transport JSON', async () => {
    const wrapper = mount(ProductAssistantResultViewer)
    try {
      await wrapper.vm.showResult({
        title: '公开资料回执',
        json: JSON.stringify({
          reader: 'https://api.github.com',
          kind: 'file',
          path: 'src/a.ts',
          ref: 'main',
          source: 'https://github.com/example/repo/blob/main/src/a.ts',
          text: 'export const example = "<script>not executable</script>"',
          totalCharacters: 54,
          complete: true,
          sha: 'abc',
        }),
      })
      expect(wrapper.text()).toContain('已读完整文件 · 54 字')
      expect(wrapper.get('.chat-result-path').text()).toBe('src/a.ts')
      expect(wrapper.get('a').attributes('href')).toContain('/blob/main/src/a.ts')
      expect(wrapper.find('script').exists()).toBe(false)
      expect(wrapper.findAll('summary').map((item) => item.text())).toEqual([
        '查看源码',
        '技术详情',
      ])
      expect(wrapper.text()).not.toContain('"reader"')
      expect(wrapper.text()).not.toContain('原始 JSON')
      expect(wrapper.find('.chat-tool-result > pre').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it('keeps reasoning text exact, escapes HTML and clears it on close', async () => {
    const close = vi.fn()
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: close,
    })
    const wrapper = mount(ProductAssistantResultViewer)
    try {
      const text = '  返回的思考\n<img src=x onerror="alert(1)">  '
      await wrapper.vm.showReasoning(text)
      expect(wrapper.get('.chat-reasoning-viewer pre').element.textContent).toBe(text)
      expect(wrapper.find('.chat-reasoning-viewer img').exists()).toBe(false)
      await wrapper.get('[aria-label="关闭思考内容"]').trigger('click')
      expect(close).toHaveBeenCalledOnce()
      await wrapper.get('.chat-reasoning-viewer').trigger('close')
      expect(wrapper.get('.chat-reasoning-viewer pre').text()).toBe('')
      const calls = vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls.length
      await wrapper.vm.showReasoning(' \n ')
      expect(vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls).toHaveLength(calls)
    } finally {
      wrapper.unmount()
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
      else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close
    }
  })
  it('shows the actual directory page and incomplete warning, with no untrusted external link', async () => {
    const wrapper = mount(ProductAssistantResultViewer)
    try {
      await wrapper.vm.showResult({
        title: '公开资料回执',
        json: JSON.stringify({
          reader: 'https://api.github.com',
          kind: 'directory',
          path: '',
          ref: 'main',
          source: 'javascript:alert(1)',
          entries: [
            { path: 'src', type: 'dir' },
            { path: 'README.md', type: 'file' },
          ],
          offset: 20,
          totalEntries: 35,
          nextOffset: 22,
        }),
      })
      expect(wrapper.text()).toContain('仓库根目录')
      expect(wrapper.text().replace(/\s/g, '')).toContain('目录·21～22项/共35项')
      expect(wrapper.text()).toContain('后面还有内容，这次未读完。')
      expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['目录src', '文件README.md'])
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('"entries"')
    } finally {
      wrapper.unmount()
    }
  })
  it('shows filtered counts and a clear empty result without JSON', async () => {
    const wrapper = mount(ProductAssistantResultViewer)
    try {
      await wrapper.vm.showResult({
        title: '公开资料回执',
        json: JSON.stringify({
          reader: 'https://api.github.com',
          kind: 'directory',
          path: 'src/services',
          query: 'tavernbridge',
          directoryTotalEntries: 261,
          totalEntries: 0,
          entries: [],
          complete: true,
          nextOffset: null,
        }),
      })
      expect(wrapper.text()).toContain('筛选：tavernbridge · 全目录 261 项')
      expect(wrapper.text()).toContain('没有匹配文件。')
      expect(wrapper.text()).not.toContain('"query"')
    } finally {
      wrapper.unmount()
    }
  })
})
