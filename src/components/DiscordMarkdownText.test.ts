// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DiscordMarkdownText from './DiscordMarkdownText.vue'

describe('DiscordMarkdownText', () => {
  it('renders Discord Markdown through Vue text nodes without executing embedded HTML', () => {
    const wrapper = mount(DiscordMarkdownText, {
      props: {
        content:
          '## 标题\n> **重点** 与 `代码`\n[入口](https://example.com)\n<img src=x onerror=alert(1)>',
      },
    })

    expect(wrapper.get('.discord-markdown__line--heading-2').text()).toBe('标题')
    expect(wrapper.get('.discord-markdown__line--quote .is-bold').text()).toBe('重点')
    expect(wrapper.get('.discord-markdown__inline-code').text()).toBe('代码')
    expect(wrapper.get('a').attributes('href')).toBe('https://example.com/')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })
})
