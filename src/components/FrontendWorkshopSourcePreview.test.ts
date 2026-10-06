/** @vitest-environment jsdom */

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS,
  FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
} from '../utils/FrontendWorkshopSourceRuntime'
import {
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
} from '../utils/RenderCompatibilityRuntime'

const mocks = vi.hoisted(() => ({
  loadPreviewVendorLibsForSource: vi.fn(),
}))

vi.mock('../utils/PreviewVendorLibs', () => ({
  loadPreviewVendorLibsForSource: mocks.loadPreviewVendorLibsForSource,
}))

import FrontendWorkshopSourcePreview from './FrontendWorkshopSourcePreview.vue'
import RichContentPreview from './RichContentPreview.vue'

function sourceDocument(revision = 1, authorSource = '<button id="go">go</button>') {
  const document = createFrontendWorkshopSourceDocument('project-source-preview', authorSource, 100)
  document.revision = revision
  return document
}

function runtimeIdentity(frame: HTMLIFrameElement) {
  const source = frame.getAttribute('srcdoc') ?? ''
  const projectId = source.match(/"projectId":"([^"]+)"/u)?.[1]
  const sourceRevision = Number(source.match(/"sourceRevision":(\d+)/u)?.[1])
  const instanceId = source.match(/"instanceId":"([^"]+)"/u)?.[1]
  const runtimeNonce = source.match(/"runtimeNonce":"([^"]+)"/u)?.[1]
  if (!projectId || !sourceRevision || !instanceId || !runtimeNonce) {
    throw new Error('Source Preview srcdoc missing runtime identity')
  }
  return { projectId, sourceRevision, instanceId, runtimeNonce }
}

function installControlledFrameWindow(frame: HTMLIFrameElement): Window {
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: window })
  return window
}

function dispatchRuntimeMessage(frame: HTMLIFrameElement, data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }))
}

function dispatchCurrentRuntimeMessage(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
): void {
  dispatchRuntimeMessage(frame, {
    protocol: FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
    ...runtimeIdentity(frame),
    ...data,
  })
}

describe('FrontendWorkshopSourcePreview current runtime', () => {
  it('sends cloneable layer controls instead of Vue proxies to the authenticated frame', async () => {
    const layerView = reactive({ hidden: ['background'], locked: ['character'], solo: 'avatar' })
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument(), layerView },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const postMessage = vi.spyOn(installControlledFrameWindow(frame), 'postMessage')
    dispatchCurrentRuntimeMessage(frame, { type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount })
    await flushPromises()
    const payload = postMessage.mock.calls.find(
      ([message]) => message.type === FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelectionMode,
    )?.[0]
    expect(payload.layerView).toEqual(layerView)
    expect(() => structuredClone(payload)).not.toThrow()
    postMessage.mockRestore()
    wrapper.unmount()
  })
  it('switches real alternate messages through the shared preview without editing the author source', async () => {
    const source = sourceDocument(
      1,
      '<button>目录</button><script type="application/json" data-tavern-character>{"name":"测试角色","alternate_greetings":["第一幕正文","第二幕正文"]}</script>',
    )
    const original = source.authorSource
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: source },
      global: { stubs: { RichContentPreview: true } },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    installControlledFrameWindow(frame)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.greetingNavigate,
      target: 99,
    })
    await flushPromises()
    expect(wrapper.findComponent(RichContentPreview).exists()).toBe(false)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.greetingNavigate,
      target: 2,
    })
    await flushPromises()
    const alternate = wrapper.getComponent(RichContentPreview)
    expect(alternate.props('source')).toBe('第二幕正文')
    expect(alternate.props('greetingContents')).toHaveLength(3)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'FrontendWorkshopSourceTransformOverlay' }).exists()).toBe(
      false,
    )
    alternate.vm.$emit('navigateGreeting', 1)
    await flushPromises()
    expect(wrapper.getComponent(RichContentPreview).props('source')).toBe('第一幕正文')
    await wrapper.setProps({ greetingIndex: 0 })
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.findComponent(RichContentPreview).exists()).toBe(false)
    expect(wrapper.find('nav').exists()).toBe(false)
    expect(source.authorSource).toBe(original)
    expect(source.revision).toBe(1)
    wrapper.unmount()
  })

  it('keeps the viewport frame bounded when the child reports a tall page and can return to content sizing', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument(), sizingMode: 'viewport' },
    })
    await flushPromises()
    let frame = wrapper.get('iframe').element as HTMLIFrameElement
    installControlledFrameWindow(frame)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.height,
      height: 33_554_432,
    })
    await flushPromises()
    expect(frame.style.height).toBe('100%')
    expect(wrapper.emitted('height')?.[0]).toEqual([33_554_432])
    await wrapper.setProps({ sizingMode: 'content' })
    await flushPromises()
    frame = wrapper.get('iframe').element as HTMLIFrameElement
    installControlledFrameWindow(frame)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.height,
      height: 120,
    })
    await flushPromises()
    expect(frame.style.height).toBe('120px')
    wrapper.unmount()
  })
  it('reports authenticated runtime errors to the explicit check entry without injecting diagnostic UI', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    installControlledFrameWindow(frame)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.error,
      kind: 'resource',
      message: 'React CDN failed',
    })
    await flushPromises()
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.emitted('runtimeError')?.at(-1)).toEqual([
      { kind: 'resource', message: 'React CDN failed' },
    ])
    await wrapper.setProps({ sourceDocument: sourceDocument(2) })
    await flushPromises()
    expect(wrapper.text()).not.toContain('React CDN failed')
    wrapper.unmount()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadPreviewVendorLibsForSource.mockResolvedValue(undefined)
  })

  it('loads the shared TavernHelper vendor environment from the exact Author Source before runtime build', async () => {
    const authorSource =
      '<script>const runtimeVue = window["V" + "ue"]; document.body.dataset.ready = String(Boolean(runtimeVue))</script>'
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument(1, authorSource) },
    })
    await flushPromises()

    expect(mocks.loadPreviewVendorLibsForSource).toHaveBeenCalledTimes(1)
    expect(mocks.loadPreviewVendorLibsForSource).toHaveBeenCalledWith(authorSource)
    wrapper.unmount()
  })

  it('surfaces vendor loader failures instead of silently dropping the TavernHelper environment', async () => {
    mocks.loadPreviewVendorLibsForSource.mockRejectedValueOnce(new Error('vendor import failed'))
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()

    expect(wrapper.emitted('runtimeError')?.[0]).toEqual([
      { kind: 'vendor-load', message: 'vendor import failed' },
    ])
    expect(wrapper.find('iframe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not treat iframe load as ready', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    frame.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.attributes('data-source-ready')).toBe('false')
    expect(wrapper.emitted('ready')).toBeUndefined()
    wrapper.unmount()
  })

  it('accepts only the current runtime identity mount handshake', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const identity = runtimeIdentity(frame)
    dispatchRuntimeMessage(frame, {
      protocol: FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount,
      ...identity,
      runtimeNonce: 'stale-nonce',
    })
    expect(wrapper.emitted('ready')).toBeUndefined()
    dispatchCurrentRuntimeMessage(frame, { type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount })
    await flushPromises()
    expect(wrapper.attributes('data-source-ready')).toBe('true')
    expect(wrapper.emitted('ready')).toHaveLength(1)
    wrapper.unmount()
  })

  it('uses runtime height reports without clamping long content', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.height,
      height: 12345.2,
    })
    await flushPromises()
    expect(frame.style.height).toBe('12346px')
    expect(wrapper.emitted('height')?.[0]).toEqual([12346])
    wrapper.unmount()
  })

  it('surfaces runtime errors and shared compatibility diagnostics', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.error,
      kind: 'unhandledrejection',
      message: 'fixture failure',
    })
    dispatchRuntimeMessage(frame, {
      protocol: RENDER_COMPATIBILITY_PROTOCOL,
      type: RENDER_COMPATIBILITY_EVENTS.diagnostic,
      diagnostic: {
        capability: 'mvu',
        implementationStatus: 'UNSUPPORTED',
        parityStatus: 'UNSUPPORTED_HOST_BOUND',
        source: 'capability-boundary',
        callCount: 1,
        failureReason: 'requires a real host',
      },
    })
    await flushPromises()
    expect(wrapper.emitted('runtimeError')?.[0]).toEqual([
      { kind: 'unhandledrejection', message: 'fixture failure' },
    ])
    expect(wrapper.emitted('compatibilityDiagnostic')?.[0]?.[0]).toMatchObject({
      capability: 'mvu',
      implementationStatus: 'UNSUPPORTED',
    })
    wrapper.unmount()
  })

  it('requests snapshots only after ready and emits validated pending snapshots', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument() },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const controlledWindow = installControlledFrameWindow(frame)
    const postMessage = vi.spyOn(controlledWindow, 'postMessage')
    const requestDomSnapshot = (
      wrapper.vm as unknown as { requestDomSnapshot: () => string | undefined }
    ).requestDomSnapshot
    expect(requestDomSnapshot()).toBeUndefined()
    dispatchCurrentRuntimeMessage(frame, { type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount })
    await flushPromises()
    const requestId = requestDomSnapshot()
    expect(requestId).toMatch(/^dom-snapshot-/u)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshotRequest,
        requestId,
      }),
      '*',
    )
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSnapshot,
      requestId,
      snapshotSequence: 1,
      nodes: [
        {
          runtimeNodeId: 'runtime-node-1',
          nodeKind: 'element',
          treeScope: 'document',
          firstSeenSequence: 1,
          tagName: 'button',
        },
      ],
      truncated: false,
    })
    await flushPromises()
    expect(wrapper.emitted('domSnapshot')).toHaveLength(1)
    postMessage.mockRestore()
    wrapper.unmount()
  })

  it('maps authenticated normalized drag positions through the scaled frame bounds', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument(), canvasPanEnabled: true },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    installControlledFrameWindow(frame)
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      left: 80,
      top: 120,
      width: 200,
      height: 400,
    } as DOMRect)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.canvasPan,
      phase: 'start',
      x: 0.5,
      y: 0.25,
    })
    expect(wrapper.emitted('canvasPan')?.[0]).toEqual([{ phase: 'start', x: 180, y: 220 }])
    dispatchRuntimeMessage(frame, {
      protocol: FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
      ...runtimeIdentity(frame),
      runtimeNonce: 'stale',
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.canvasPan,
      phase: 'move',
      x: 0.6,
      y: 0.3,
    })
    await wrapper.setProps({ canvasPanEnabled: false })
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.canvasPan,
      phase: 'start',
      x: 0.5,
      y: 0.25,
    })
    expect(wrapper.emitted('canvasPan')).toHaveLength(1)
    wrapper.unmount()
  })

  it('selection mode forwards exact runtime DOM selections without rebuilding', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument(), selectionMode: false },
    })
    await flushPromises()
    const frame = wrapper.get('iframe').element as HTMLIFrameElement
    const controlledWindow = installControlledFrameWindow(frame)
    const postMessage = vi.spyOn(controlledWindow, 'postMessage')
    dispatchCurrentRuntimeMessage(frame, { type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.mount })
    await flushPromises()
    const firstInstanceId = runtimeIdentity(frame).instanceId
    await wrapper.setProps({ selectionMode: true })
    await flushPromises()
    expect(runtimeIdentity(frame).instanceId).toBe(firstInstanceId)
    dispatchCurrentRuntimeMessage(frame, {
      type: FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS.domSelection,
      runtimeNodeId: 'runtime-node-7',
      treeScope: 'document',
      tagName: 'button',
      elementId: 'go',
      rect: { x: 12, y: 24, width: 120, height: 40 },
    })
    await flushPromises()
    expect(wrapper.emitted('domSelection')?.[0]?.[0]).toMatchObject({
      runtimeNodeId: 'runtime-node-7',
      elementId: 'go',
    })
    postMessage.mockRestore()
    wrapper.unmount()
  })

  it('creates a disposable runtime instance when Source revision changes', async () => {
    const wrapper = mount(FrontendWorkshopSourcePreview, {
      props: { sourceDocument: sourceDocument(1) },
    })
    await flushPromises()
    const firstFrame = wrapper.get('iframe').element as HTMLIFrameElement
    const firstInstance = runtimeIdentity(firstFrame).instanceId
    const firstSrcdoc = firstFrame.getAttribute('srcdoc')
    await wrapper.setProps({ sourceDocument: sourceDocument(2) })
    await flushPromises()
    const secondFrame = wrapper.get('iframe').element as HTMLIFrameElement
    expect(runtimeIdentity(secondFrame).instanceId).not.toBe(firstInstance)
    expect(secondFrame.getAttribute('srcdoc')).not.toBe(firstSrcdoc)
    wrapper.unmount()
  })

  it('does not contain the retired component-asset materialization path', async () => {
    const document = createFrontendWorkshopSourceDocument(
      'project-source-preview',
      '<img src="https://cdn.example.com/a.png">',
      100,
    )
    const wrapper = mount(FrontendWorkshopSourcePreview, { props: { sourceDocument: document } })
    await flushPromises()
    expect(wrapper.get('iframe').attributes('srcdoc')).toContain('https://cdn.example.com/a.png')
    expect(wrapper.get('iframe').attributes('srcdoc')).not.toContain('srl-source-component-assets:')
    wrapper.unmount()
  })
})
