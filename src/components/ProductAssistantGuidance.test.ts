/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProductAssistantGuidance from './ProductAssistantGuidance.vue'
import {
  assistantGuidance,
  assistantGuidanceAnchor,
  findAssistantGuide,
  startAssistantGuidance,
} from '../core/ProductAssistantGuidance'
afterEach(() => {
  assistantGuidance.value = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})
describe('reviewed feature guidance', () => {
  it('registers a verified Tavern Bridge guide and uses its actual control hint', async () => {
    const guide = findAssistantGuide('tavern-transfer', 'tavernBridge')
    expect(guide?.steps[0]?.target).toBe('tavern-transfer-entry')
    document.body.innerHTML =
      '<button data-assistant-focus="tavern-transfer-entry" data-assistant-focus-text="点这里连接酒馆哦～">连接酒馆</button>'
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 44, 44),
    ] as unknown as DOMRectList)
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const wrapper = mount(ProductAssistantGuidance, { attachTo: document.body })
    try {
      startAssistantGuidance('tavern-transfer', 'tavernBridge')
      await flushPromises()
      expect(assistantGuidanceAnchor.value?.element.textContent).toBe('连接酒馆')
      expect(assistantGuidanceAnchor.value?.text).toBe('点这里连接酒馆哦～')
    } finally {
      wrapper.unmount()
    }
  })
  it('registers the expanded Tavern Bridge installation guide content', () => {
    const guide = findAssistantGuide('tavern-transfer-install', 'tavernBridge')
    expect(guide?.steps[0]?.target).toBe('tavern-transfer-install-content')
    expect(guide?.steps[0]?.text).toContain('安装教程')
  })
  it.each([
    ['data-protection', 'library', 'data-protection-open'],
    ['inbox-connection', 'inbox', 'inbox-connection-settings'],
    ['inbox-post-claim', 'inbox', 'inbox-post-claim'],
    ['inbox-resource-claim', 'inbox', 'inbox-resource-claim'],
    ['inbox-cloud-cleanup', 'inbox', 'inbox-cloud-cleanup'],
  ])('registers the %s guide against its visible action', (id, destination, target) => {
    expect(findAssistantGuide(id, destination)?.steps[0]?.target).toBe(target)
  })
  it.each([
    ['tavern-transfer-install', 'tavernBridge', 'tavern-transfer-install-content'],
    ['discord-oneclick-tutorial', 'inbox', 'discord-oneclick-tutorial-content'],
    ['discord-github-tutorial', 'inbox', 'discord-github-tutorial-content'],
    ['discord-manual-deploy-tutorial', 'inbox', 'discord-manual-deploy-tutorial-content'],
  ])('registers direct tutorial navigation for %s', (id, destination, target) => {
    expect(findAssistantGuide(id, destination)?.steps[0]?.target).toBe(target)
  })
  it('locates the actual native-dialog control without a guidance card', async () => {
    document.body.innerHTML =
      '<dialog open><button data-assistant-focus="import-resource">资源</button></dialog>'
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 44, 44),
    ] as unknown as DOMRectList)
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const wrapper = mount(ProductAssistantGuidance, { attachTo: document.body })
    try {
      startAssistantGuidance('import', 'import')
      await flushPromises()
      expect(document.querySelector('.assistant-guidance')).toBeNull()
      expect(assistantGuidanceAnchor.value?.element).toBe(
        document.querySelector('[data-assistant-focus]'),
      )
      wrapper.unmount()
      expect(document.querySelector('.assistant-guidance')).toBeNull()
      expect(document.querySelector('.assistant-guide-target')).toBeNull()
      expect(assistantGuidanceAnchor.value).toBeUndefined()
    } finally {
      if (wrapper.exists()) wrapper.unmount()
    }
  })
  it('briefly highlights the actual entry without clicks or step cards and expires automatically', async () => {
    vi.useFakeTimers()
    document.body.innerHTML =
      '<button data-assistant-focus="import-resource">资源</button><button data-assistant-focus="import-file">单个资源文件</button>'
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 44, 44),
    ] as unknown as DOMRectList)
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const clicked = vi.fn()
    document.querySelector('button')!.addEventListener('click', clicked)
    const wrapper = mount(ProductAssistantGuidance, { global: { stubs: { teleport: true } } })
    try {
      startAssistantGuidance('import', 'import')
      await flushPromises()
      expect(document.querySelector('.assistant-guide-target')?.textContent).toBe('资源')
      expect(clicked).not.toHaveBeenCalled()
      expect(wrapper.find('aside').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(8000)
      expect(document.querySelector('.assistant-guide-target')).toBeNull()
      expect(assistantGuidance.value).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })
  it('refuses mismatched or unregistered steps', () => {
    expect(() => startAssistantGuidance('import', 'cloud')).toThrow('没有对应')
    expect(() => startAssistantGuidance('login', 'login')).toThrow('没有对应')
  })
})
