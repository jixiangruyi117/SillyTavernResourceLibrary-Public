/** @vitest-environment jsdom */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyPersonaBackup,
  parseSillyTavernPersonaBackup,
} from '../parser/SillyTavernPersonaBackup'
import { RESOURCE_TYPE, type Resource, type ResourceSummary } from '../types/Resource'
import type { SillyTavernPersonaBackup, UserPersonaDraft } from '../types/UserPersona'
import { dirtyStateRegistry } from '../core/DirtyStateRegistry'
import UserPersonaApp from './UserPersonaApp.vue'
const mocks = vi.hoisted(() => ({
  templates: [] as Array<{ id: string; name: string; description: string }>,
  chooseAction: vi.fn(),
  confirmAction: vi.fn(),
  userPersonaService: {
    load: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
    importFiles: vi.fn(),
    loadAvatarResource: vi.fn(),
    cacheAvatarFile: vi.fn(),
    cacheAvatarFromUrl: vi.fn(),
  },
  resourceService: { importFiles: vi.fn() },
  recycleBinService: { moveToRecycleBin: vi.fn() },
}))
vi.mock('../core/AppContainer', () => ({
  ...mocks,
  assetStore: { getBlob: vi.fn() },
  browserStorageService: {
    getUserPersonaTemplates: () => mocks.templates,
    setUserPersonaTemplates: (items: typeof mocks.templates) => (mocks.templates = items),
  },
}))
vi.mock('../composables/UseConfirmDialog', () => mocks)
vi.mock('../core/PlatformService', () => ({
  platform: { files: { isImagePickerAvailable: async () => false } },
}))
const wrappers: VueWrapper[] = []
function render(resources: ResourceSummary[] = []) {
  const wrapper = mount(UserPersonaApp, {
    props: { resources, categories: [] },
    global: {
      stubs: {
        TavernBridgeCenter: {
          template: '<button class="transfer-back" @click="$emit(\'back\')">返回人设</button>',
          emits: ['back', 'import-files'],
        },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
function summary(id: string, type: ResourceSummary['type'], name = id): ResourceSummary {
  return {
    id,
    name,
    type,
    fileName: `${id}.${type === RESOURCE_TYPE.CHARACTER_CARD ? 'png' : 'json'}`,
    metadata: {},
    tags: [],
    categoryIds: [],
    relatedResourceIds: [],
    sourceLinks: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as ResourceSummary
}
function persona(backup?: SillyTavernPersonaBackup): Resource {
  return {
    ...summary('personas', RESOURCE_TYPE.USER_PERSONA),
    originalBlob: new Blob([JSON.stringify(backup ?? multiBackup)], { type: 'application/json' }),
    relatedResourceIds: ['manual-link'],
  } as Resource
}
const multiBackup: SillyTavernPersonaBackup = {
  personas: { 'a.png': '甲', 'b.png': '乙' },
  persona_descriptions: {
    'a.png': { description: '甲描述', connections: [] },
    'b.png': {
      description: '乙描述',
      title: '乙备注',
      lorebook: 'world',
      connections: [
        { type: 'character', id: 'old.png' },
        { type: 'group', id: 'group-1' },
      ],
      custom: '保留',
    },
  },
  default_persona: 'a.png',
  customRoot: '保留',
}
async function click(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === text)
  expect(button, text).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
async function openSecond(wrapper: VueWrapper) {
  await wrapper.get('.persona-app__list-item').trigger('click')
  await flushPromises()
  await wrapper.get('select').setValue('b.png')
  await flushPromises()
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.templates = []
  mocks.chooseAction.mockImplementation(async (options: { title: string }) =>
    options.title === '保存人设' ? 'confirm' : 'cancel',
  )
  mocks.confirmAction.mockResolvedValue(true)
  mocks.userPersonaService.loadAvatarResource.mockResolvedValue(undefined)
  mocks.userPersonaService.load.mockResolvedValue({
    resource: persona(),
    view: parseSillyTavernPersonaBackup(multiBackup),
  })
  mocks.userPersonaService.save.mockImplementation(
    async (_id: string, backup: SillyTavernPersonaBackup) => {
      mocks.userPersonaService.load.mockResolvedValue({
        resource: persona(backup),
        view: parseSillyTavernPersonaBackup(backup),
      })
      return persona(backup)
    },
  )
  mocks.userPersonaService.create.mockImplementation(async (draft: UserPersonaDraft) => {
    const backup = createEmptyPersonaBackup(draft)
    mocks.userPersonaService.load.mockResolvedValue({
      resource: persona(backup),
      view: parseSillyTavernPersonaBackup(backup),
    })
    return persona(backup)
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:avatar'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})
describe('人设列表和单页编辑', () => {
  it('offers a direct history action and confirms unsaved edits before opening versions', async () => {
    const w = render([persona()])
    await w.get('.persona-app__list-item').trigger('click')
    await flushPromises()
    await w.get('[aria-label="更多人设操作"]').trigger('click')
    expect(document.body.textContent).toContain('查看历史版本')
    expect(document.body.textContent).toContain('发送整份人设文件到酒馆')
    await Array.from(document.querySelectorAll<HTMLButtonElement>('.action-sheet__actions button'))
      .find((button) => button.textContent?.includes('查看历史版本'))!
      .click()
    await flushPromises()
    expect(w.emitted('open-history')?.[0]?.[0]).toMatchObject({ id: 'personas' })

    await w.get('textarea').setValue('未保存的编辑')
    mocks.chooseAction.mockResolvedValueOnce('cancel')
    await w.get('[aria-label="更多人设操作"]').trigger('click')
    await Array.from(document.querySelectorAll<HTMLButtonElement>('.action-sheet__actions button'))
      .find((button) => button.textContent?.includes('查看历史版本'))!
      .click()
    await flushPromises()
    expect(w.emitted('open-history')).toHaveLength(1)
    expect(w.get('textarea').element.value).toBe('未保存的编辑')
  })
  it('offers one creation entry and one transfer entry, with all identity fields on the same page', async () => {
    const w = render()
    expect(w.findAll('button').filter((b) => b.text() === '新建')).toHaveLength(1)
    expect(w.findAll('button').filter((b) => b.text() === '酒馆互传')).toHaveLength(1)
    await click(w, '新建')
    expect(w.find('[name="personaName"]').exists()).toBe(true)
    expect(w.find('[name="personaNote"]').exists()).toBe(true)
    expect(w.find('textarea').exists()).toBe(true)
    expect(w.findAll('.feature-back-button')).toHaveLength(1)
    expect(w.findAll('button').filter((b) => b.text() === '保存')).toHaveLength(1)
    expect(w.find('.persona-app__creation-steps').exists()).toBe(false)
    await w.get('.feature-back-button').trigger('click')
    await flushPromises()
    expect(w.get('.persona-app').attributes('data-page')).toBe('list')
    expect(w.emitted('back')).toBeUndefined()
    await w.get('.feature-back-button').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
  })
  it('inserts both placeholders at the selection and restores the caret', async () => {
    const w = render()
    await click(w, '新建')
    const field = w.get('textarea')
    await field.setValue('前旧后')
    const textarea = field.element as HTMLTextAreaElement
    textarea.setSelectionRange(1, 2)
    await click(w, '{{char}}')
    expect(textarea.value).toBe('前{{char}}后')
    expect(textarea.selectionStart).toBe(9)
    await click(w, '{{user}}')
    expect(textarea.value).toBe('前{{char}}{{user}}后')
  })
  it('saves name, note, description, injection and both bindings to a persona resource', async () => {
    const w = render([
      summary('char', RESOURCE_TYPE.CHARACTER_CARD),
      summary('world', RESOURCE_TYPE.WORLD_BOOK),
    ])
    await click(w, '新建')
    await w.get('[name="personaName"]').setValue('新名字')
    await w.get('[name="personaNote"]').setValue('备注')
    await w.get('textarea').setValue('{{user}} 与 {{char}}')
    await w.get('.persona-app__injection select').setValue(4)
    await w.get('input[type="number"]').setValue(5)
    await w.get('.persona-app__bindings select').setValue('world')
    await w.get('input[type="checkbox"]').setValue(true)
    await click(w, '保存')
    expect(mocks.userPersonaService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '新名字',
        title: '备注',
        description: '{{user}} 与 {{char}}',
        position: 4,
        depth: 5,
        lorebook: 'world',
        connections: [{ type: 'character', id: 'char.png' }],
      }),
      ['world', 'char'],
      null,
    )
    expect(w.text()).toContain('已保存到资源库')
    expect(dirtyStateRegistry.hasDirtyState('user-persona')).toBe(false)
  })
  it('protects dirty drafts on cancel and failed save, then returns to the list after successful save', async () => {
    const w = render()
    await click(w, '新建')
    await w.get('textarea').setValue('未保存描述')
    await w.get('.feature-back-button').trigger('click')
    await flushPromises()
    expect(w.get('textarea').element.value).toBe('未保存描述')
    mocks.chooseAction.mockResolvedValue('confirm')
    await w.get('.feature-back-button').trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('人设名称不能为空')
    expect(w.get('.persona-app').attributes('data-page')).toBe('editor')
    await w.get('[name="personaName"]').setValue('保存人设')
    await w.get('.feature-back-button').trigger('click')
    await flushPromises()
    expect(w.get('.persona-app').attributes('data-page')).toBe('list')
    expect(w.emitted('back')).toBeUndefined()
  })
  it('keeps the selected non-default persona after save and preserves unknown data and other entries', async () => {
    const w = render([persona()])
    await openSecond(w)
    await w.get('[name="personaName"]').setValue('乙改名')
    await click(w, '保存')
    expect(w.get<HTMLInputElement>('[name="personaName"]').element.value).toBe('乙改名')
    expect(w.get('textarea').element.value).toBe('乙描述')
    const saved = mocks.userPersonaService.save.mock.calls[0]![1]
    expect(saved).toMatchObject({
      default_persona: 'a.png',
      customRoot: '保留',
      personas: { 'a.png': '甲', 'b.png': '乙改名' },
      persona_descriptions: { 'b.png': { custom: '保留' } },
    })
    expect(dirtyStateRegistry.hasDirtyState('user-persona')).toBe(false)
  })
  it('clears selected worldbook and char bindings without dropping group or manual links', async () => {
    const w = render([
      persona(),
      summary('old', RESOURCE_TYPE.CHARACTER_CARD),
      summary('world', RESOURCE_TYPE.WORLD_BOOK),
    ])
    await openSecond(w)
    await w.get('.persona-app__bindings select').setValue('')
    await w.get('input[type="checkbox"]').setValue(false)
    await click(w, '保存')
    expect(mocks.userPersonaService.save).toHaveBeenCalledWith(
      'personas',
      expect.objectContaining({
        persona_descriptions: expect.objectContaining({
          'b.png': expect.objectContaining({
            lorebook: '',
            connections: [{ type: 'group', id: 'group-1' }],
          }),
        }),
      }),
      ['manual-link'],
      '编辑用户人设',
      null,
      false,
    )
  })
  it('asks on each changed save, preserves the draft on cancel, and passes the explicit history choice', async () => {
    const w = render([persona()])
    await openSecond(w)
    await w.get('textarea').setValue('少改两个字')
    mocks.chooseAction.mockResolvedValueOnce('cancel')
    await click(w, '保存')
    expect(mocks.userPersonaService.save).not.toHaveBeenCalled()
    expect(w.get('textarea').element.value).toBe('少改两个字')
    expect(dirtyStateRegistry.hasDirtyState('user-persona')).toBe(true)
    mocks.chooseAction.mockResolvedValueOnce('alternative')
    await click(w, '保存')
    expect(mocks.userPersonaService.save.mock.calls[0]?.[5]).toBe(true)
    await w.get('textarea').setValue('再次小改')
    await click(w, '保存')
    expect(mocks.userPersonaService.save.mock.calls[1]?.[5]).toBe(false)
    expect(mocks.chooseAction).toHaveBeenCalledTimes(3)
  })
  it('saves and reuses a template across mounts without silently replacing edited text', async () => {
    const w = render()
    await click(w, '新建')
    await w.get('textarea').setValue('模板正文')
    await click(w, '模板')
    await click(w, '存为模板')
    await w.get('[aria-label="模板名称"]').setValue('我的模板')
    await click(w, '保存模板')
    const second = render()
    await click(second, '新建')
    await click(second, '模板')
    await second.get('[aria-label="人物模板"]').setValue(mocks.templates[0]!.id)
    await click(second, '应用模板')
    expect(second.get('textarea').element.value).toBe('模板正文')
    await second.get('textarea').setValue('保留修改')
    await second.get('[aria-label="人物模板"]').setValue('blank')
    mocks.confirmAction.mockResolvedValueOnce(false)
    await click(second, '应用模板')
    expect(second.get('textarea').element.value).toBe('保留修改')
  })
  it('caches URL images as covers and leaves the JSON free of image sources', async () => {
    const cover = {
      ...summary('cover', RESOURCE_TYPE.OTHER),
      metadata: {
        assetKind: 'userPersonaAvatar',
        avatarId: 'cover.png',
        sourceUrl: 'https://example.com/a.png',
      },
      originalBlob: new Blob(['png']),
    } as Resource
    mocks.userPersonaService.cacheAvatarFromUrl.mockResolvedValue(cover)
    const w = render()
    await click(w, '新建')
    await w.get('[name="personaName"]').setValue('封面测试')
    await w.get('input[type="url"]').setValue('https://example.com/a.png')
    await click(w, '保存')
    expect(mocks.userPersonaService.cacheAvatarFromUrl).toHaveBeenCalled()
    const args = mocks.userPersonaService.create.mock.calls[0]!
    expect(args[1]).toEqual(['cover'])
    expect(args[2]).toEqual(cover)
    expect(JSON.stringify(args[0])).not.toContain('https://')
  })
  it('does not load all persona blobs just to show the list, and can search older saved names', async () => {
    const w = render(
      Array.from({ length: 40 }, (_, i) =>
        summary(String(i), RESOURCE_TYPE.USER_PERSONA, `人设${i}`),
      ),
    )
    expect(w.findAll('.persona-app__list-item')).toHaveLength(30)
    expect(mocks.userPersonaService.load).not.toHaveBeenCalled()
    await w.get('[aria-label="搜索人设"]').setValue('人设39')
    expect(w.findAll('.persona-app__list-item')).toHaveLength(1)
  })
  it('returns from shared transfer to the persona list', async () => {
    const w = render()
    await click(w, '酒馆互传')
    await w.get('.transfer-back').trigger('click')
    await flushPromises()
    expect(w.get('.persona-app').isVisible()).toBe(true)
    expect(w.emitted('back')).toBeUndefined()
  })
  it('surfaces JSON import failures', async () => {
    mocks.userPersonaService.importFiles.mockRejectedValue(new Error('导入失败测试'))
    const w = render()
    const input = w.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['{}'], 'personas.json')] })
    await input.trigger('change')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('导入失败测试')
  })
})
