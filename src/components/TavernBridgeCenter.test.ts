/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TavernBridgeCenter from './TavernBridgeCenter.vue'
import { resourceService } from '../core/AppContainer'
import type { TavernResourceItem } from '../services/TavernBridgeProtocol'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const writeText = vi.fn(async (_value: string) => undefined)
const bridgeMocks = vi.hoisted(() => ({
  getState: vi.fn(() => ({
    status: 'idle',
    detail: '等待酒馆扩展',
    pairCode: '',
    tavernOrigin: '',
    bridgeVersion: '',
  })),
  hasInvitation: vi.fn(() => false),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  listResources: vi.fn(async (): Promise<TavernResourceItem[]> => []),
  isLocalTavernDirectAvailable: vi.fn(() => false),
  disconnect: vi.fn(),
  sendFiles: vi.fn(async () => ['已接收']),
  pullResources: vi.fn(async () => [
    new File(['{}'], 'personas.json', { type: 'application/json' }),
  ]),
}))

vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: vi.fn() }))
vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getBridgeTransferLog: vi.fn(() => []),
    appendBridgeTransferLog: vi.fn((items: string[]) => items),
  },
  resourceService: { get: vi.fn() },
}))
vi.mock('../services/TavernBridgeService', () => ({
  tavernBridgeService: {
    ...bridgeMocks,
  },
}))

function render() {
  return mount(TavernBridgeCenter, {
    attachTo: document.body,
    props: { resources: [] },
  })
}

function resource(overrides: Partial<ResourceSummary>): ResourceSummary {
  return {
    id: 'local-1',
    type: RESOURCE_TYPE.CHARACTER_CARD,
    name: '本地角色',
    fileName: '本地角色.png',
    metadata: {},
    tags: [],
    ...overrides,
  } as ResourceSummary
}

describe('TavernBridgeCenter 的作者小工具入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMocks.getState.mockReturnValue({
      status: 'idle',
      detail: '等待酒馆扩展',
      pairCode: '',
      tavernOrigin: '',
      bridgeVersion: '',
    })
    bridgeMocks.listResources.mockResolvedValue([])
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('在酒馆互传内容之后提供其他小工具入口，并展示三个已发布项目', async () => {
    const wrapper = render()
    const trigger = wrapper.get('.tavern-bridge-author-tools > button')

    expect(trigger.text()).toBe('查看其他小工具')
    await trigger.trigger('click')

    expect(document.body.textContent).toContain('聊天重载保护器')
    expect(document.body.textContent).toContain('场景切换器')
    expect(document.body.textContent).toContain('角色世界书')
    expect(document.body.textContent).toContain('每个项目独立维护与发布')
  })

  it('角色世界书详情指向可由酒馆直接安装的公开仓库', async () => {
    const wrapper = render()
    await wrapper.get('.tavern-bridge-author-tools > button').trigger('click')
    const characterLorebookButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.author-tools-dialog__list button'),
    ).find((button) => button.parentElement?.textContent?.includes('角色世界书'))
    expect(characterLorebookButton).toBeDefined()
    await characterLorebookButton!.click()
    await flushPromises()

    const repository = 'https://example.invalid/author-tools/character-lorebooks'
    expect(document.body.querySelector(`a[href="${repository}"]`)).not.toBeNull()
    expect(document.body.textContent).toContain('不移动或改写世界书文件')
  })

  it('详情显示准确的 GitHub 地址，并支持一键复制', async () => {
    const wrapper = render()
    await wrapper.get('.tavern-bridge-author-tools > button').trigger('click')
    await document.body
      .querySelectorAll<HTMLButtonElement>('.author-tools-dialog__list button')[0]!
      .click()
    await flushPromises()

    const repository = 'https://example.invalid/author-tools/chat-reload-guard'
    expect(document.body.querySelector(`a[href="${repository}"]`)).not.toBeNull()
    expect(document.body.textContent).toContain('当前已审计支持 SillyTavern 1.18.0。')

    const copyButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.author-tool-detail__actions button'),
    )[0]!
    await copyButton.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(repository)
    expect(copyButton.textContent).toBe('已复制地址')
  })

  it('关闭弹窗后把焦点还给入口按钮', async () => {
    const wrapper = render()
    const trigger = wrapper.get('.tavern-bridge-author-tools > button')
    await trigger.trigger('click')
    await document.body
      .querySelector<HTMLButtonElement>('.author-tools-dialog__header > button')!
      .click()
    await flushPromises()

    expect(document.activeElement).toBe(trigger.element)
  })

  it('重新进入互传页时恢复现有连接并提供手动断开入口', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接酒馆页面扩展',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.24',
    })
    bridgeMocks.listResources.mockResolvedValue([])

    const wrapper = render()
    await flushPromises()

    expect(bridgeMocks.listResources).toHaveBeenCalledTimes(1)
    const disconnectButton = Array.from(wrapper.findAll('button')).find(
      (button) => button.text() === '断开连接',
    )
    expect(disconnectButton).toBeDefined()
    await disconnectButton!.trigger('click')

    expect(bridgeMocks.disconnect).toHaveBeenCalledWith('已手动断开酒馆连接')
  })

  it('双向资源使用紧凑卡片，并可只查看当前已选项', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接酒馆页面扩展',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.27',
    })
    bridgeMocks.listResources.mockResolvedValue([
      {
        id: 'character:one',
        kind: 'character',
        name: '酒馆角色',
        fileName: '角色.png',
        detail: '',
      },
      { id: 'theme:one', kind: 'theme', name: '酒馆主题', fileName: '主题.json', detail: '' },
    ] as TavernResourceItem[])
    const wrapper = mount(TavernBridgeCenter, {
      attachTo: document.body,
      props: {
        resources: [
          resource({}),
          resource({
            id: 'local-2',
            name: '本地主题',
            fileName: '主题.json',
            type: RESOURCE_TYPE.BEAUTIFICATION,
            metadata: { detectedVariant: 'theme' },
          }),
        ],
      },
    })
    await flushPromises()

    expect(wrapper.findAll('.tavern-bridge-resource-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('角色卡')
    await wrapper.findAll('.tavern-bridge-resource-card')[0].trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('只看已选'))!
      .trigger('click')
    expect(wrapper.findAll('.tavern-bridge-resource-card')).toHaveLength(1)

    await wrapper.findAll('.tavern-bridge-tabs button')[1].trigger('click')
    expect(wrapper.findAll('.tavern-bridge-resource-card')).toHaveLength(2)
  })
})

describe('用户人设共用互传通道', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.11',
    })
    bridgeMocks.listResources.mockResolvedValue([
      {
        id: 'persona:all',
        kind: 'userPersona',
        name: '酒馆人设',
        fileName: 'personas.json',
        detail: '',
      },
    ])
  })
  it('sends a saved persona as userPersona JSON without uploading cover attachments', async () => {
    const local = resource({
      id: 'persona-local',
      type: RESOURCE_TYPE.USER_PERSONA,
      name: '本地人设',
      fileName: 'personas.json',
      relatedResourceIds: ['private-cover'],
    })
    const json = JSON.stringify({
      personas: { 'one.png': '本地人设' },
      persona_descriptions: { 'one.png': { description: '测试' } },
    })
    vi.mocked(resourceService.get).mockResolvedValue({
      ...local,
      originalBlob: new Blob([json], { type: 'application/json' }),
      mimeType: 'application/json',
    } as Awaited<ReturnType<typeof resourceService.get>>)
    const w = mount(TavernBridgeCenter, {
      props: { resources: [local], initialLocalIds: [local.id], initialKind: 'userPersona' },
    })
    await flushPromises()
    expect(w.text()).toContain('本地人设')
    const send = w.findAll('.tavern-bridge__sticky-action').find((b) => b.text().includes('发送'))
    expect(send).toBeDefined()
    await send!.trigger('click')
    await flushPromises()
    expect(bridgeMocks.sendFiles).toHaveBeenCalledTimes(1)
    const [files, policy] = bridgeMocks.sendFiles.mock.calls[0] as unknown as [
      Array<{ file: File; kind: string }>,
      string,
    ]
    expect(policy).toBe('skip')
    expect(files).toHaveLength(1)
    expect(files[0]!.kind).toBe('userPersona')
    expect(await files[0]!.file.text()).toBe(json)
    w.unmount()
  })
  it('filters received personas and hands the real file to the existing importer', async () => {
    const w = mount(TavernBridgeCenter, { props: { resources: [], initialKind: 'userPersona' } })
    await flushPromises()
    expect(w.findAll('.tavern-bridge-resource-card')).toHaveLength(1)
    await w.get('.tavern-bridge-resource-card').trigger('click')
    const pull = w.findAll('.tavern-bridge__sticky-action').find((b) => b.text().includes('取回'))
    expect(pull).toBeDefined()
    await pull!.trigger('click')
    await flushPromises()
    expect(bridgeMocks.pullResources).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'userPersona' }),
    ])
    expect(w.emitted('import-files')?.[0]?.[0]).toEqual([
      expect.objectContaining({ name: 'personas.json' }),
    ])
    w.unmount()
  })
})
