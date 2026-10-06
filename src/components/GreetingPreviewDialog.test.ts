// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import GreetingPreviewDialog from './GreetingPreviewDialog.vue'

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector(`[aria-label="${label}"]`)
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

describe('GreetingPreviewDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('can enter and exit content fullscreen inside the existing preview', async () => {
    mount(GreetingPreviewDialog, {
      attachTo: document.body,
      props: {
        modelValue: 0,
        items: [{ key: 'first', label: '第一条', content: '<p>开场白</p>' }],
      },
      global: {
        stubs: {
          RichContentPreview: { template: '<div class="rich-content-preview">预览</div>' },
        },
      },
    })

    findButtonByLabel('内容全屏').click()
    await Promise.resolve()

    expect(document.body.querySelector('.greeting-preview-overlay')?.classList).toContain(
      'is-content-fullscreen',
    )

    const exit = document.body.querySelector(
      '[aria-label="退出开场白内容全屏"]',
    ) as HTMLButtonElement
    expect(exit).toBeTruthy()
    exit.click()
    await Promise.resolve()

    expect(document.body.querySelector('.greeting-preview-overlay')?.classList).not.toContain(
      'is-content-fullscreen',
    )
  })

  it('pressing Escape in fullscreen only exits content fullscreen without closing the preview', async () => {
    const wrapper = mount(GreetingPreviewDialog, {
      attachTo: document.body,
      props: {
        modelValue: 0,
        items: [{ key: 'first', label: '第一条', content: '开场白' }],
      },
      global: { stubs: { RichContentPreview: true } },
    })

    findButtonByLabel('内容全屏').click()
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.greeting-preview-overlay')).not.toBeNull()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('renders opening archives through content shell without injecting character avatars', async () => {
    const richPreviewProps: Array<Record<string, unknown>> = []
    mount(GreetingPreviewDialog, {
      attachTo: document.body,
      props: {
        modelValue: 0,
        items: [
          {
            key: 'first',
            label: '第一条',
            content:
              '<div class="status-bar-lock">顶部状态栏</div><tavern_status>[余额：20铜币]</tavern_status>正文',
          },
        ],
      },
      global: {
        stubs: {
          RichContentPreview: {
            props: ['source', 'sourceKind', 'renderShell', 'charAvatar'],
            setup(props) {
              richPreviewProps.push(props)
              return {}
            },
            template: '<div class="rich-content-preview">预览</div>',
          },
        },
      },
    })

    await Promise.resolve()

    expect(richPreviewProps[0]?.renderShell).toBe('content')
    expect(richPreviewProps[0]?.sourceKind).toBe('openingArchive')
    expect(richPreviewProps[0]?.source).toContain('顶部状态栏')
    expect(richPreviewProps[0]?.source).toContain('tavern_status')
    expect(richPreviewProps[0]?.charAvatar).toBeUndefined()
  })

  it('switches openings when a Tavern Helper frontend requests swipe_id navigation', async () => {
    const wrapper = mount(GreetingPreviewDialog, {
      attachTo: document.body,
      props: {
        modelValue: 0,
        items: [
          { key: 'first', label: '第一条', content: '第一条正文' },
          { key: 'second', label: '第二条', content: '第二条正文' },
          { key: 'third', label: '第三条', content: '第三条正文' },
        ],
      },
      global: {
        stubs: {
          RichContentPreview: {
            emits: ['navigateGreeting'],
            template:
              '<button class="request-third" @click="$emit(\'navigateGreeting\', 2)">跳转</button>',
          },
        },
      },
    })

    const requestThird = document.body.querySelector('.request-third') as HTMLButtonElement
    expect(requestThird).toBeTruthy()
    requestThird.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:modelValue')).toEqual([[2]])
  })

  it('keeps one preview session mounted while the active opening changes', async () => {
    let mounts = 0
    let unmounts = 0
    const wrapper = mount(GreetingPreviewDialog, {
      attachTo: document.body,
      props: {
        modelValue: 0,
        items: [
          { key: 'first', label: '第一条', content: '第一条正文' },
          { key: 'second', label: '第二条', content: '第二条正文' },
        ],
      },
      global: {
        stubs: {
          RichContentPreview: {
            props: ['source'],
            mounted() {
              mounts += 1
            },
            unmounted() {
              unmounts += 1
            },
            template: '<div class="rich-content-preview">{{ source }}</div>',
          },
        },
      },
    })

    await wrapper.setProps({ modelValue: 1 })

    expect(document.body.querySelector('.rich-content-preview')?.textContent).toBe('第二条正文')
    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
  })
})
