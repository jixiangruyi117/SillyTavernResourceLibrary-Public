/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import type { Resource, ResourceSummary } from '../types/Resource'
import type { SillyTavernPersonaBackup } from '../types/UserPersona'
import UserPersonaOverviewBindings from './UserPersonaOverviewBindings.vue'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../core/AppContainer', () => ({ userPersonaService: mocks }))

const resource = { id: 'persona-resource' } as Resource
const source: SillyTavernPersonaBackup = {
  personas: { 'me.png': 'Me' },
  persona_descriptions: {
    'me.png': {
      description: '全局内容',
      connections: [{ type: 'character', id: 'native-character.png' }],
    },
  },
}
const nativeCharacter = {
  id: 'native-character-resource',
  type: 'characterCard',
  name: '原生绑定卡',
  fileName: 'native-character.png',
} as unknown as ResourceSummary

describe('UserPersonaOverviewBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockResolvedValue({ resource, view: parseSillyTavernPersonaBackup(source) })
  })

  it('shows Tavern native character connections in overview as read-only information', async () => {
    const wrapper = mount(UserPersonaOverviewBindings, {
      props: { resource, relatedResources: [nativeCharacter] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('酒馆原生绑定')
    expect(wrapper.text()).toContain('原生绑定卡')
    expect(wrapper.text()).toContain('已关联资源库角色卡')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
