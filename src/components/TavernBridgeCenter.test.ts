/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TavernBridgeCenter from './TavernBridgeCenter.vue'
import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
import { resourceService } from '../core/AppContainer'
import { tavernConnectionStore } from '../core/TavernConnectionStore'
import type { TavernResourceItem } from '../services/TavernBridgeProtocol'
import { RESOURCE_TYPE, type ResourceSummary } from '../types/Resource'

const writeText = vi.fn(async (_value: string) => undefined)
const mountedWrappers: Array<{ unmount(): void }> = []
const bridgeMocks = vi.hoisted(() => ({
  getState: vi.fn(() => ({
    status: 'idle',
    detail: '等待酒馆扩展',
    pairCode: '',
    tavernOrigin: '',
    bridgeVersion: '',
  })),
  hasInvitation: vi.fn(() => false),
  canBindDirectory: vi.fn(() => false),
  bindDirectory: vi.fn(async () => undefined),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  listResources: vi.fn(async (): Promise<TavernResourceItem[]> => []),
  isLocalTavernDirectAvailable: vi.fn(() => false),
  disconnect: vi.fn(),
  sendFiles: vi.fn(async () => [{ status: 'created', name: '已接收' }]),
  checkUserAvatarIds: vi.fn(async () => new Set<string>()),
  pullResources: vi.fn(async () => [
    new File(['{}'], 'personas.json', { type: 'application/json' }),
  ]),
}))

vi.mock('../composables/UseConfirmDialog', () => ({
  confirmAction: vi.fn(),
  chooseAction: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  browserStorageService: {
    getBridgeTransferLog: vi.fn(() => []),
    appendBridgeTransferLog: vi.fn((items: string[]) => items),
    getBridgeTransferDraft: vi.fn(() => undefined),
    setBridgeTransferDraft: vi.fn(),
  },
  resourceService: { get: vi.fn() },
}))
vi.mock('../services/TavernBridgeService', () => ({
  tavernBridgeService: {
    ...bridgeMocks,
  },
}))

function render() {
  const wrapper = mount(TavernBridgeCenter, {
    attachTo: document.body,
    props: { resources: [] },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

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

describe('聊天回传确认与默认范围', () => {
  it('sends nothing after cancel, then sends only the original chat to the confirmed avatar by default', async () => {
    vi.clearAllMocks()
    tavernConnectionStore.clearInventory()
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://localhost:8000',
      bridgeVersion: '0.3.36-chat.4',
      capabilities: ['chat-import-v1'],
      transport: 'relay',
    } as ReturnType<typeof bridgeMocks.getState>)
    bridgeMocks.listResources.mockResolvedValue([
      {
        id: 'character:card.png',
        kind: 'character',
        name: '目标角色',
        fileName: 'card.png',
        detail: '',
      },
    ])
    const card = {
      ...resource({ id: 'card', fileName: 'card.png' }),
      originalBlob: new Blob(['card']),
    }
    const chat = {
      ...resource({
        id: 'chat',
        type: RESOURCE_TYPE.CHAT,
        fileName: '雨夜.jsonl',
        relatedResourceIds: ['card'],
      }),
      originalBlob: new Blob(['{"user_name":"User"}\n{"mes":"原文"}']),
    }
    vi.mocked(resourceService.get).mockImplementation(async (id) => (id === 'card' ? card : chat))
    const w = mount(TavernBridgeCenter, {
      props: { resources: [chat, card], initialLocalIds: ['chat'] },
    })
    mountedWrappers.push(w)
    await flushPromises()
    const send = w
      .findAll('.tavern-bridge__sticky-action')
      .find((item) => item.text().includes('发送'))!
    vi.mocked(confirmAction).mockResolvedValueOnce(false)
    await send.trigger('click')
    await flushPromises()
    expect(bridgeMocks.sendFiles).not.toHaveBeenCalled()
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '确认导入聊天记录',
        message: expect.stringContaining('目标角色（card.png）'),
      }),
    )
    vi.mocked(confirmAction).mockResolvedValueOnce(true)
    await send.trigger('click')
    await flushPromises()
    expect(bridgeMocks.sendFiles).toHaveBeenCalledTimes(1)
    expect(bridgeMocks.sendFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'chat', targetName: 'card.png' })],
      'copy',
      expect.any(Function),
    )
  })
})

describe('TavernBridgeCenter 的作者小工具入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tavernConnectionStore.clearInventory()
    bridgeMocks.getState.mockReturnValue({
      status: 'idle',
      detail: '等待酒馆扩展',
      pairCode: '',
      tavernOrigin: '',
      bridgeVersion: '',
    })
    bridgeMocks.listResources.mockResolvedValue([])
    bridgeMocks.pullResources.mockResolvedValue([
      new File(['{}'], 'personas.json', { type: 'application/json' }),
    ])
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

    const repository = 'https://github.com/jixiangruyi117/SillyTavern-CharacterLorebooks'
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

    const repository = 'https://github.com/jixiangruyi117/SillyTavern-ChatReloadGuard'
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
    await wrapper.get('.tavern-bridge-connection-tools summary').trigger('click')
    await disconnectButton!.trigger('click')

    expect(bridgeMocks.disconnect).toHaveBeenCalledWith('已手动断开酒馆连接')
  })

  it('离开再进入保留上次目录，只有点击刷新目录才重新提取', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.31',
    })
    bridgeMocks.listResources.mockResolvedValue([
      { id: 'theme:one', kind: 'theme', name: '旧快照', fileName: 'one.json', detail: '' },
    ])
    const first = render()
    await flushPromises()
    expect(bridgeMocks.listResources).toHaveBeenCalledTimes(1)
    first.unmount()
    const second = render()
    await flushPromises()
    expect(second.text()).toContain('旧快照')
    expect(bridgeMocks.listResources).toHaveBeenCalledTimes(1)
    expect(
      second.findAll('button').filter((button) => button.text().includes('刷新目录')),
    ).toHaveLength(1)
    await second
      .findAll('button')
      .find((button) => button.text().includes('刷新目录'))!
      .trigger('click')
    await flushPromises()
    expect(bridgeMocks.listResources).toHaveBeenCalledTimes(2)
  })

  it('loads saved chats only on request and retains the other resource inventory', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.36-chat.1',
      capabilities: ['chat-archive-v1'],
    } as ReturnType<typeof bridgeMocks.getState>)
    bridgeMocks.listResources.mockResolvedValue([
      { id: 'theme:one', kind: 'theme', name: '保留主题', fileName: 'one.json', detail: '' },
    ])
    const wrapper = render()
    await flushPromises()
    expect(bridgeMocks.listResources).toHaveBeenCalledTimes(1)
    bridgeMocks.listResources.mockResolvedValue([
      {
        id: 'chat:one',
        kind: 'chat',
        name: '雨夜',
        fileName: '雨夜.srlchat',
        detail: '陆沉 · 随附角色卡',
        sizeLabel: '2.50 MB',
      },
    ])
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '读取聊天记录')!
      .trigger('click')
    await flushPromises()
    expect(bridgeMocks.listResources).toHaveBeenLastCalledWith('chat')
    expect(wrapper.text()).toContain('雨夜')
    expect(wrapper.text()).toContain('随附角色卡')
    expect(wrapper.text()).toContain('2.50 MB')
    expect(tavernConnectionStore.getSnapshot().inventory).toHaveLength(2)
  })

  it('shows explicit avatar choices only for selected personas and gates old Bridge versions', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接酒馆页面扩展',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.30',
    })
    const personaSummary = resource({ type: RESOURCE_TYPE.USER_PERSONA, fileName: 'personas.json' })
    const wrapper = mount(TavernBridgeCenter, {
      attachTo: document.body,
      props: {
        resources: [personaSummary],
        initialKind: 'userPersona',
        initialLocalIds: [personaSummary.id],
      },
    })
    mountedWrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('发送设置')
    expect(wrapper.text()).toContain('默认封面 · 可选')
    expect(
      wrapper
        .find('.tavern-bridge-send-options')
        .element.compareDocumentPosition(wrapper.find('.tavern-bridge-resource-grid').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect((wrapper.find('input[value="none"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('input[value="missing"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('传送封面需要更新酒馆互传扩展')
    expect(bridgeMocks.sendFiles).not.toHaveBeenCalled()
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
    mountedWrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.findAll('.tavern-bridge-resource-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('角色卡')
    await wrapper.findAll('.tavern-bridge-resource-card')[0].trigger('click')
    expect(wrapper.findAll('.tavern-bridge-resource-card')[0].attributes('aria-pressed')).toBe(
      'true',
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('只看已选'))!
      .trigger('click')
    expect(wrapper.findAll('.tavern-bridge-resource-card')).toHaveLength(1)

    await wrapper.findAll('.tavern-bridge-tabs button')[1].trigger('click')
    expect(wrapper.findAll('.tavern-bridge-resource-card')).toHaveLength(2)
    const selectAll = wrapper.findAll('.tavern-bridge-selectbar button')[0]
    expect(selectAll.text()).toBe('全选当前结果')
    await selectAll.trigger('click')
    expect(selectAll.text()).toBe('取消当前全选')
    expect(
      wrapper
        .findAll('.tavern-bridge-resource-card')
        .every((card) => card.attributes('aria-pressed') === 'true'),
    ).toBe(true)
    await selectAll.trigger('click')
    expect(selectAll.text()).toBe('全选当前结果')
  })
})

describe('用户人设共用互传通道', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tavernConnectionStore.clearInventory()
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
    bridgeMocks.pullResources.mockResolvedValue([
      new File(['{}'], 'personas.json', { type: 'application/json' }),
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
    mountedWrappers.push(w)
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
  it('checks the cached default cover and uploads it before the persona only when selected', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.30',
      capabilities: ['persona-avatar-check-v1'],
    } as ReturnType<typeof bridgeMocks.getState>)
    vi.mocked(confirmAction).mockResolvedValue(true)
    const local = resource({
      id: 'persona-local',
      type: RESOURCE_TYPE.USER_PERSONA,
      fileName: 'personas.json',
      relatedResourceIds: ['cover'],
    })
    vi.mocked(resourceService.get).mockImplementation(async (id) =>
      id === 'cover'
        ? ({
            ...resource({ id: 'cover', type: RESOURCE_TYPE.USER_PERSONA }),
            metadata: { assetKind: 'userPersonaAvatar', avatarId: 'one.png' },
            originalBlob: new Blob(['png'], { type: 'image/png' }),
          } as Awaited<ReturnType<typeof resourceService.get>>)
        : ({
            ...local,
            originalBlob: new Blob(
              [
                JSON.stringify({
                  personas: { 'one.png': '本地人设' },
                  persona_descriptions: { 'one.png': { description: '测试' } },
                  default_persona: 'one.png',
                }),
              ],
              { type: 'application/json' },
            ),
            mimeType: 'application/json',
          } as Awaited<ReturnType<typeof resourceService.get>>),
    )
    const w = mount(TavernBridgeCenter, {
      props: { resources: [local], initialLocalIds: [local.id], initialKind: 'userPersona' },
    })
    mountedWrappers.push(w)
    await flushPromises()
    expect(w.find('input[value="missing"]').attributes('disabled')).toBeUndefined()
    expect((w.get('input[value="missing"]').element as HTMLInputElement).checked).toBe(true)
    await w
      .findAll('.tavern-bridge__sticky-action')
      .find((b) => b.text().includes('发送'))!
      .trigger('click')
    await flushPromises()
    expect(bridgeMocks.checkUserAvatarIds).toHaveBeenCalledWith(['one.png'])
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: '核对人设封面传送' }),
    )
    expect(bridgeMocks.sendFiles).toHaveBeenCalledTimes(2)
    const sendCalls = bridgeMocks.sendFiles.mock.calls as unknown as Array<
      [Array<{ kind: string }>, string]
    >
    expect(sendCalls[0]?.[0]?.[0]?.kind).toBe('userAvatar')
    expect(sendCalls[0]?.[1]).toBe('skip')
    expect(sendCalls[1]?.[0]?.[0]?.kind).toBe('userPersona')
    w.unmount()
  })

  it('人设缺少已缓存封面时默认仍发送 JSON，明确显示仅传人设', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.31',
      capabilities: ['persona-avatar-check-v1'],
    } as ReturnType<typeof bridgeMocks.getState>)
    const local = resource({
      id: 'persona-local',
      type: RESOURCE_TYPE.USER_PERSONA,
      fileName: 'personas.json',
    })
    vi.mocked(resourceService.get).mockResolvedValue({
      ...local,
      originalBlob: new Blob(
        [
          JSON.stringify({
            personas: { 'one.png': '本地人设' },
            persona_descriptions: { 'one.png': {} },
          }),
        ],
        { type: 'application/json' },
      ),
      mimeType: 'application/json',
    } as Awaited<ReturnType<typeof resourceService.get>>)
    const w = mount(TavernBridgeCenter, {
      props: { resources: [local], initialLocalIds: [local.id], initialKind: 'userPersona' },
    })
    mountedWrappers.push(w)
    await flushPromises()
    expect((w.get('input[value="missing"]').element as HTMLInputElement).checked).toBe(true)
    await w
      .findAll('.tavern-bridge__sticky-action')
      .find((b) => b.text().includes('发送'))!
      .trigger('click')
    await flushPromises()
    expect(bridgeMocks.sendFiles).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('没有已缓存封面；仅传人设')
  })

  it('发送前核对酒馆内容时锁定发送按钮，防止重复提交', async () => {
    let finishList: ((items: TavernResourceItem[]) => void) | undefined
    const local = resource({
      id: 'persona-local',
      type: RESOURCE_TYPE.USER_PERSONA,
      fileName: 'personas.json',
    })
    vi.mocked(resourceService.get).mockResolvedValue({
      ...local,
      originalBlob: new Blob(
        [
          JSON.stringify({
            personas: { 'one.png': '本地人设' },
            persona_descriptions: { 'one.png': {} },
          }),
        ],
        { type: 'application/json' },
      ),
      mimeType: 'application/json',
    } as Awaited<ReturnType<typeof resourceService.get>>)
    const w = mount(TavernBridgeCenter, {
      props: { resources: [local], initialLocalIds: [local.id], initialKind: 'userPersona' },
    })
    mountedWrappers.push(w)
    await flushPromises()
    bridgeMocks.listResources.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishList = resolve
        }),
    )
    const send = w.findAll('.tavern-bridge__sticky-action').find((b) => b.text().includes('发送'))!
    await send.trigger('click')
    expect(send.attributes('disabled')).toBeDefined()
    await send.trigger('click')
    finishList?.([])
    await flushPromises()
    expect(bridgeMocks.sendFiles).toHaveBeenCalledTimes(1)
  })

  it('同头像键但内容变化时可另存为新的人设，并将缓存封面跟随新键发送', async () => {
    bridgeMocks.getState.mockReturnValue({
      status: 'connected',
      detail: '已连接',
      pairCode: '',
      tavernOrigin: 'http://127.0.0.1:8000',
      bridgeVersion: '0.3.31',
      capabilities: ['persona-avatar-check-v1'],
    } as ReturnType<typeof bridgeMocks.getState>)
    bridgeMocks.listResources.mockResolvedValue([
      {
        id: 'userPersona:one.png',
        kind: 'userPersona',
        name: '旧名',
        fileName: 'personas.json',
        detail: '',
      },
    ])
    bridgeMocks.pullResources.mockResolvedValue([
      new File(
        [
          JSON.stringify({
            personas: { 'one.png': '旧名' },
            persona_descriptions: { 'one.png': { description: '旧内容' } },
          }),
        ],
        'personas.json',
        { type: 'application/json' },
      ),
    ])
    vi.mocked(chooseAction).mockResolvedValue('confirm')
    vi.mocked(confirmAction).mockResolvedValue(true)
    const local = resource({
      id: 'persona-local',
      type: RESOURCE_TYPE.USER_PERSONA,
      fileName: 'personas.json',
      relatedResourceIds: ['cover'],
    })
    vi.mocked(resourceService.get).mockImplementation(async (id) =>
      id === 'cover'
        ? ({
            ...resource({ id: 'cover', type: RESOURCE_TYPE.USER_PERSONA }),
            metadata: { assetKind: 'userPersonaAvatar', avatarId: 'one.png' },
            originalBlob: new Blob(['png'], { type: 'image/png' }),
          } as Awaited<ReturnType<typeof resourceService.get>>)
        : ({
            ...local,
            originalBlob: new Blob(
              [
                JSON.stringify({
                  personas: { 'one.png': '新名' },
                  persona_descriptions: { 'one.png': { description: '新内容' } },
                  default_persona: 'one.png',
                }),
              ],
              { type: 'application/json' },
            ),
            mimeType: 'application/json',
          } as Awaited<ReturnType<typeof resourceService.get>>),
    )
    const w = mount(TavernBridgeCenter, {
      props: { resources: [local], initialLocalIds: [local.id], initialKind: 'userPersona' },
    })
    mountedWrappers.push(w)
    await flushPromises()
    await w
      .findAll('.tavern-bridge__sticky-action')
      .find((b) => b.text().includes('发送'))!
      .trigger('click')
    await flushPromises()
    expect(chooseAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: '酒馆人设已有不同内容' }),
    )
    expect(bridgeMocks.sendFiles).toHaveBeenCalledTimes(2)
    const sendCalls = bridgeMocks.sendFiles.mock.calls as unknown as Array<
      [Array<{ kind: string; targetName?: string; file: File }>, string]
    >
    const avatar = sendCalls[0]![0][0]!
    const persona = sendCalls[1]![0][0]!
    expect(avatar.kind).toBe('userAvatar')
    expect(avatar.targetName).toMatch(/^persona-[a-f0-9-]{36}\.png$/u)
    expect(persona.kind).toBe('userPersona')
    const copied = JSON.parse(await persona.file.text()) as {
      personas: Record<string, string>
      default_persona?: string
    }
    expect(copied.personas[avatar.targetName!]).toBe('新名')
    expect(copied.default_persona).toBeUndefined()
  })

  it('接收进行中仍可点击断开连接', async () => {
    let finishPull: ((files: File[]) => void) | undefined
    bridgeMocks.pullResources.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPull = resolve
        }),
    )
    const w = mount(TavernBridgeCenter, { props: { resources: [], initialKind: 'userPersona' } })
    mountedWrappers.push(w)
    await flushPromises()
    await w.get('.tavern-bridge-resource-card').trigger('click')
    await w
      .findAll('.tavern-bridge__sticky-action')
      .find((b) => b.text().includes('取回'))!
      .trigger('click')
    await flushPromises()
    const disconnect = w.findAll('button').find((button) => button.text() === '断开连接')!
    expect(disconnect.attributes('disabled')).toBeUndefined()
    await disconnect.trigger('click')
    expect(bridgeMocks.disconnect).toHaveBeenCalledWith('已手动断开酒馆连接')
    finishPull?.([])
    await flushPromises()
  })
  it('filters received personas and hands the real file to the existing importer', async () => {
    const w = mount(TavernBridgeCenter, { props: { resources: [], initialKind: 'userPersona' } })
    mountedWrappers.push(w)
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
