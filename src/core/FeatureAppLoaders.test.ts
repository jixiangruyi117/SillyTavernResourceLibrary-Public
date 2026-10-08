// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=public-app-entry-regression
/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { getFeatureAppLoader } from './FeatureAppLoaders'
import { OFFICIAL_APP_IDS } from '../types/OfficialApp'

vi.mock('../components/OfficialAppGate.vue', () => ({
  default: { props: ['appId'], template: '<div :data-app-id="appId" />' },
}))

describe('Public built-in APP entry consistency', () => {
  it.each(OFFICIAL_APP_IDS)('opens %s through the package loader', async (id) => {
    const { default: component } = await getFeatureAppLoader(id)()
    const wrapper = mount(component)
    expect(wrapper.get('[data-app-id]').attributes('data-app-id')).toBe(id)
    wrapper.unmount()
  })

  it('packages the current workshop and stitch UI and every supported APP', () => {
    const packaging = readFileSync('scripts/OfficialAppPackages.ts', 'utf8')
    const entryBlock = packaging.match(/const entries = \{([\s\S]*?)\n\}/u)![1]!
    const entries = Object.fromEntries(
      [...entryBlock.matchAll(/(\w+): '([^']+)'/gu)].map((match) => [match[1], match[2]]),
    )
    expect(Object.keys(entries).sort()).toEqual([...OFFICIAL_APP_IDS].sort())
    expect(entries.frontendWorkshop).toBe('FrontendWorkshopSourceAiShell.vue')
    expect(entries.stitch).toBe('PresetStitcherApp.vue')
    expect(entries.assistant).toBe('ProductAssistant.vue')
    for (const entry of Object.values(entries))
      expect(readFileSync(`src/components/${entry}`, 'utf8').length).toBeGreaterThan(0)
  })
})
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=public-app-entry-regression
