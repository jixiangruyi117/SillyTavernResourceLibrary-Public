/** @vitest-environment jsdom */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RichContentPreview from './RichContentPreview.vue'

vi.mock('../utils/PreviewVendorLibs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/PreviewVendorLibs')>()),
  loadPreviewVendorLibs: vi.fn(async () => ({})),
}))

describe('RichContentPreview trusted runtime document', () => {
  beforeEach(() => {
    localStorage.setItem('srl.preview.allowRemoteResources', 'true')
    localStorage.setItem('srl.preview.allowScripts', 'true')
  })

  afterEach(() => localStorage.clear())

  it('mounts the formal trusted preview directly with srcdoc', async () => {
    const wrapper = mount(RichContentPreview, {
      props: {
        source: '```html\n<body><main id="trusted-frontend">frontend</main></body>\n```',
        title: 'trusted preview',
        runtimeScripts: [{ id: 'script', name: 'script', content: 'window.previewReady = true' }],
        immersive: true,
        bare: true,
        renderShell: 'content',
        sourceKind: 'openingArchive',
      },
    })
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('iframe').exists()).toBe(true))

    const iframe = wrapper.find<HTMLIFrameElement>('iframe')
    const sandbox = iframe.attributes('sandbox') ?? ''
    const srcdoc = iframe.attributes('srcdoc') ?? ''

    expect(sandbox.split(/\s+/)).toContain('allow-scripts')
    expect(sandbox.split(/\s+/)).toContain('allow-same-origin')
    expect(iframe.attributes('src')).toBeUndefined()
    expect(srcdoc).toContain('trusted-frontend')
    expect(srcdoc).toContain('__SRL_RENDER_COMPAT_HOST__')
    expect(srcdoc).not.toContain('SRL_PREVIEW_BOOTSTRAP_READY')
    expect(srcdoc).not.toContain('SRL_PREVIEW_TRANSPORT_READY')
    expect(srcdoc).not.toContain('data:text/html')

    wrapper.unmount()
  })
})
