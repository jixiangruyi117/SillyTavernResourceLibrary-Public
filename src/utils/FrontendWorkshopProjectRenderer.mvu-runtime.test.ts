/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import { renderFrontendWorkshopGreetingBundle } from './FrontendWorkshopProjectRenderer'

afterEach(() => {
  document.body.replaceChildren()
  for (const key of ['waitGlobalInitialized', 'getCurrentMessageId', 'Mvu', 'eventOn'] as const)
    delete (globalThis as Record<string, unknown>)[key]
})

function createStateFieldProject() {
  const project = createFrontendWorkshopProject('greeting', 1)
  project.fields = [
    {
      id: 'affection',
      label: '好感度',
      sample: '11',
      path: '角色.好感度',
      kind: 'number',
      source: { provider: 'mvu', path: '角色.好感度' },
    },
  ]
  project.pages[0]!.nodes.push({
    id: 'affection-text',
    kind: 'text',
    label: '好感度',
    contentSource: { kind: 'stateField', fieldId: 'affection' },
    style: {},
    children: [],
  })
  return project
}

function mountDeliveryRuntime() {
  const html = renderFrontendWorkshopGreetingBundle(createStateFieldProject())
    .firstMessage.replace(/^```html\n/, '')
    .replace(/\n```$/, '')
  document.body.innerHTML = html
  const root = document.querySelector<HTMLElement>('[data-srl-behavior-config]')
  const source = document.querySelector('[data-srl-workshop-content-source-runtime]')?.textContent
  if (!root || !source) throw new Error('缺少内容来源运行时 fixture')
  new Function(source)()
  return root as HTMLElement & {
    __srlContentSourceRuntime?: { cleanup?: () => void }
  }
}

describe('FrontendWorkshop delivery MVU runtime optionality', () => {
  it('MVU 永不初始化时不阻塞 sample，并在 root 脱离后仍能清理 runtime', async () => {
    const never = new Promise<void>(() => undefined)
    Object.assign(globalThis as Record<string, unknown>, {
      waitGlobalInitialized: vi.fn(() => never),
      getCurrentMessageId: vi.fn(() => 42),
    })

    const root = mountDeliveryRuntime()
    expect(root.querySelector('[data-srl-state-field-id]')?.textContent).toBe('11')
    expect(root.__srlContentSourceRuntime).toBeTruthy()

    root.remove()
    await vi.waitFor(() => expect(root.__srlContentSourceRuntime).toBeUndefined())
  })

  it('MVU 晚初始化后再读取真实值并订阅更新，销毁时停止订阅', async () => {
    let resolveMvu!: () => void
    const ready = new Promise<void>((resolve) => {
      resolveMvu = resolve
    })
    const listeners = new Set<() => void>()
    const getMvuData = vi.fn(async () => ({ stat_data: { 角色: { 好感度: 67 } } }))
    const stop = vi.fn()
    Object.assign(globalThis as Record<string, unknown>, {
      waitGlobalInitialized: vi.fn(() => ready),
      getCurrentMessageId: vi.fn(() => 42),
      eventOn: vi.fn((_event: unknown, listener: () => void) => {
        listeners.add(listener)
        return {
          stop: () => {
            listeners.delete(listener)
            stop()
          },
        }
      }),
    })

    const root = mountDeliveryRuntime()
    expect(root.querySelector('[data-srl-state-field-id]')?.textContent).toBe('11')

    ;(globalThis as Record<string, unknown>).Mvu = {
      events: { VARIABLE_UPDATE_ENDED: 'mvu-updated' },
      getMvuData,
    }
    resolveMvu()

    await vi.waitFor(() =>
      expect(root.querySelector('[data-srl-state-field-id]')?.textContent).toBe('67'),
    )
    expect(getMvuData).toHaveBeenCalledWith({ type: 'message', message_id: 42 })
    expect(listeners.size).toBe(1)

    root.remove()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(listeners.size).toBe(0)
  })
})
