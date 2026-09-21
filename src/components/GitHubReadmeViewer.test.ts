// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TRUST_MODE,
  RESOURCE_LINK_TYPE,
  type ResourceLink,
} from '../types/Resource'
import GitHubReadmeViewer from './GitHubReadmeViewer.vue'

const link: ResourceLink = {
  id: 'github-link',
  label: '来源仓库',
  url: 'https://github.com/owner/repo',
  type: RESOURCE_LINK_TYPE.GITHUB,
  purpose: RESOURCE_LINK_PURPOSE.REPOSITORY,
  installTarget: RESOURCE_INSTALL_TARGET.NONE,
  trustMode: RESOURCE_LINK_TRUST_MODE.LINK_ONLY,
  github: { owner: 'owner', repo: 'repo' },
  createdAt: 1,
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('srl.preview.allowRemoteResources')
  document.body.innerHTML = ''
})

describe('GitHubReadmeViewer', () => {
  it('reads complete README into a full-page dialog without retaining executable or remote media markup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '# 阅读页\n\n[安全链接](https://example.com)\n\n<img src="https://example.com/image.png">\n<script>window.xss = true</script>',
          ),
      ),
    )
    const wrapper = mount(GitHubReadmeViewer, {
      attachTo: document.body,
      props: { link, title: '示例扩展', defaultBranch: 'main' },
      global: { stubs: { Teleport: false } },
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('阅读页')
    })
    expect(document.body.textContent).not.toContain('翻译为中文')
    expect(document.body.textContent).not.toContain('翻译模型')
    expect(document.body.querySelector('a[href^="https://example.com"]')).not.toBeNull()
    expect(document.body.querySelector('img')).toBeNull()
    expect(document.body.textContent).not.toContain('window.xss')
    wrapper.unmount()
  })

  it('only loads README images when the existing remote-resource setting is enabled', async () => {
    localStorage.setItem('srl.preview.allowRemoteResources', 'true')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# 说明\n\n![封面](./cover.png)')),
    )
    const wrapper = mount(GitHubReadmeViewer, {
      attachTo: document.body,
      props: { link, title: '示例扩展', defaultBranch: 'main' },
      global: { stubs: { Teleport: false } },
    })
    await flushPromises()

    await vi.waitFor(() => {
      const image = document.body.querySelector('img')
      expect(image?.getAttribute('src')).toBe(
        'https://raw.githubusercontent.com/owner/repo/main/cover.png',
      )
      expect(image?.getAttribute('loading')).toBe('lazy')
      expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer')
    })
    wrapper.unmount()
  })

  it('resolves relative README links against the GitHub repository instead of the SRL host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# 说明\n\n[简体中文](README.zh-CN.md)')),
    )
    const wrapper = mount(GitHubReadmeViewer, {
      attachTo: document.body,
      props: { link, title: '示例扩展', defaultBranch: 'main' },
      global: { stubs: { Teleport: false } },
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(
        document.body.querySelector('.github-readme-viewer__document a')?.getAttribute('href'),
      ).toBe('https://github.com/owner/repo/blob/main/README.zh-CN.md')
    })
    wrapper.unmount()
  })
})
