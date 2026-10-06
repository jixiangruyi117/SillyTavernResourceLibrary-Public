/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APP_RESUME_STATE_CHANGE_EVENT,
  readAppResumeState,
  writeAppResumeState,
  type AppResumeState,
} from './AppResumeState'

describe('AppResumeState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('persists only bounded navigation fields and never accepts arbitrary secret fields', () => {
    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'project-1', search: '角色' })
    const raw = JSON.parse(localStorage.getItem('srl.appResume.v1') ?? '{}') as Record<
      string,
      unknown
    >
    expect(readAppResumeState()).toMatchObject({
      feature: 'frontendWorkshop',
      projectId: 'project-1',
      search: '角色',
    })
    expect(raw.password).toBeUndefined()
    expect(raw.token).toBeUndefined()
  })

  it('still publishes the same-page state change when localStorage rejects the write', () => {
    const listener = vi.fn<(event: Event) => void>()
    window.addEventListener(APP_RESUME_STATE_CHANGE_EVENT, listener)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    writeAppResumeState({ feature: 'frontendWorkshop', projectId: 'source-project' })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0]?.[0] as CustomEvent<AppResumeState>
    expect(event.detail.feature).toBe('frontendWorkshop')
    expect(event.detail.projectId).toBe('source-project')
    window.removeEventListener(APP_RESUME_STATE_CHANGE_EVENT, listener)
  })
})
