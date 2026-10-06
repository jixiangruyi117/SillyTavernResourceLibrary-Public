// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resource } from '../types/Resource'
const mocks = vi.hoisted(() => ({ list: vi.fn(), apply: vi.fn(), get: vi.fn() }))
vi.mock('../core/AppContainer', () => ({
  resourceService: { listSummaries: mocks.list, get: mocks.get },
  greetingResourceService: { apply: mocks.apply },
}))
import GreetingResourceDetails from './GreetingResourceDetails.vue'
const resource = {
  id: 'opening',
  name: '开场',
  originalBlob: {
    text: async () =>
      JSON.stringify({
        format: 'srl-greeting',
        version: 1,
        name: '开场',
        first_mes: '主开场',
        alternate_greetings: ['备用'],
        companion_scripts: [],
      }),
  },
} as Resource
const button = (wrapper: ReturnType<typeof mount>, text: string) =>
  wrapper.findAll('button').find((item) => item.text() === text)!
beforeEach(() => {
  mocks.list.mockResolvedValue([
    { id: 'card', name: '目标人物', type: 'characterCard', contentHash: 'hash' },
  ])
  mocks.apply.mockReset()
})
describe('opening resource application', () => {
  it('requires a script decision and explicit partial replacement selection', async () => {
    const document = JSON.parse(await resource.originalBlob.text())
    document.companion_scripts = [{ type: 'script', id: 'new', name: '新脚本', content: 'new()' }]
    mocks.get.mockResolvedValue({
      contentHash: 'hash',
      metadata: {
        card: {
          data: {
            extensions: {
              tavern_helper: {
                scripts: [
                  { type: 'script', id: 'old', name: '其他功能', content: 'old()', enabled: true },
                ],
              },
            },
          },
        },
      },
    })
    const wrapper = mount(GreetingResourceDetails, {
      props: {
        resource: {
          ...resource,
          originalBlob: { text: async () => JSON.stringify(document) } as Blob,
        },
      },
      global: { stubs: { GreetingPreviewDialog: true } },
    })
    await flushPromises()
    await button(wrapper, '应用到角色卡').trigger('click')
    await flushPromises()
    await wrapper.get('select').setValue('card')
    await flushPromises()
    expect(button(wrapper, '确认应用').attributes('disabled')).toBeDefined()
    await wrapper.get('input[value="replace-selected"]').setValue(true)
    expect(button(wrapper, '确认应用').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    mocks.apply.mockResolvedValue({ name: '新卡' })
    await button(wrapper, '确认应用').trigger('click')
    await flushPromises()
    expect(mocks.apply).toHaveBeenCalledWith('opening', 'card', 'new', 'hash', {
      mode: 'replace-selected',
      removeKeys: ['helper/0'],
    })
  })
  it('keeps content folded and requires explicit card and save mode selection', async () => {
    const wrapper = mount(GreetingResourceDetails, {
      props: { resource },
      global: { stubs: { GreetingPreviewDialog: true } },
    })
    await flushPromises()
    expect(
      wrapper.findAll('details').every((item) => !(item.element as HTMLDetailsElement).open),
    ).toBe(true)
    await button(wrapper, '应用到角色卡').trigger('click')
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(button(wrapper, '确认应用').attributes('disabled')).toBeDefined()
    await wrapper.get('select').setValue('card')
    await wrapper.get('input[value="version"]').setValue(true)
    mocks.apply.mockResolvedValue({ name: '目标人物' })
    await button(wrapper, '确认应用').trigger('click')
    await flushPromises()
    expect(mocks.apply).toHaveBeenCalledWith('opening', 'card', 'version', 'hash', undefined)
    expect(wrapper.get('[role="status"]').text()).toContain('新版本')
  })
  it('clears a target hidden by search and does not apply on cancel', async () => {
    const wrapper = mount(GreetingResourceDetails, {
      props: { resource },
      global: { stubs: { GreetingPreviewDialog: true } },
    })
    await flushPromises()
    await button(wrapper, '应用到角色卡').trigger('click')
    await flushPromises()
    await wrapper.get('select').setValue('card')
    await wrapper.get('input[type="search"]').setValue('另一张卡')
    expect(button(wrapper, '确认应用').attributes('disabled')).toBeDefined()
    await button(wrapper, '取消').trigger('click')
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
