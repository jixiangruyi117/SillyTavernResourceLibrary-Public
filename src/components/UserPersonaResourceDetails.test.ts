/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import type { Resource, ResourceSummary } from '../types/Resource'
import type { SillyTavernPersonaBackup } from '../types/UserPersona'
import UserPersonaResourceDetails from './UserPersonaResourceDetails.vue'

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('../core/AppContainer', () => ({ userPersonaService: mocks }))

const source: SillyTavernPersonaBackup = {
  personas: { 'me.png': 'Me' },
  persona_descriptions: {
    'me.png': {
      description: '全局内容',
      connections: [{ type: 'character', id: 'native-character.png' }],
      srl_persona_profile: {
        version: 1,
        sections: [{ id: 'base', name: '基础设定', text: '全局内容' }],
        variants: {
          'detective.png': {
            defaultVersionId: 'v1',
            versions: {
              v1: { name: '初遇', overrides: {}, addition: '第一次相遇。' },
              v2: { name: '重逢', overrides: {}, addition: '多年后重逢。' },
            },
          },
        },
      },
    },
  },
}
const resource = {
  id: 'persona-resource',
  relatedResourceIds: ['detective-resource', 'native-character-resource'],
  type: 'userPersona',
} as unknown as Resource
const detective = {
  id: 'detective-resource',
  type: 'characterCard',
  name: '雨夜侦探',
  fileName: 'detective.png',
  contentHash: 'demo',
} as unknown as ResourceSummary
const nativeCharacter = {
  id: 'native-character-resource',
  type: 'characterCard',
  name: '酒馆原生绑定卡',
  fileName: 'native-character.png',
  contentHash: 'native-demo',
} as unknown as ResourceSummary

describe('UserPersonaResourceDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockResolvedValue({ resource, view: parseSillyTavernPersonaBackup(source) })
  })

  it('keeps role-specific personas under role personas and remains read-only', async () => {
    const wrapper = mount(UserPersonaResourceDetails, {
      props: { resource, relatedResources: [detective, nativeCharacter] },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('酒馆原生绑定')
    expect(wrapper.text()).not.toContain('酒馆原生绑定卡')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('全局人设'))!
      .trigger('click')
    expect(wrapper.text()).toContain('全局内容')
    expect(wrapper.find('textarea').exists()).toBe(false)

    await wrapper.find('button.world-browser__back').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('角色人设'))!
      .trigger('click')
    expect(wrapper.text()).toContain('雨夜侦探')
    expect(wrapper.text()).toContain('已关联资源库角色卡')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('雨夜侦探'))!
      .trigger('click')
    expect(wrapper.text()).toContain('默认版本')
    expect(wrapper.text()).toContain('重逢')
    expect(wrapper.text()).not.toContain('设为默认版本')
    expect(wrapper.text()).not.toContain('增加其他版本')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('重逢'))!
      .trigger('click')
    expect(wrapper.text()).toContain('最终注入提示词')
    expect(wrapper.text()).toContain('全局内容')
    expect(wrapper.text()).toContain('多年后重逢。')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('保存版本')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
