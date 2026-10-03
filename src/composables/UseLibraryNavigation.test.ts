/** @vitest-environment jsdom */

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLibraryNavigation } from './UseLibraryNavigation'
import { readAppResumeState } from '../core/AppResumeState'

describe('UseLibraryNavigation notification routes', () => {
  it('opens the cloud feature page for backup notifications without opening restore', async () => {
    const isFeatureHubOpen = ref(false)
    const openRestorePanel = vi.fn()
    const navigation = useLibraryNavigation(() => ({ isFeatureHubOpen, openRestorePanel }) as never)

    await navigation.handleNativeDeepLink(
      new CustomEvent('srl:native-deep-link', { detail: { kind: 'backup' } }),
    )

    expect(isFeatureHubOpen.value).toBe(true)
    expect(sessionStorage.getItem('srl.native.shortcut')).toBe('cloud')
    expect(readAppResumeState()).toMatchObject({ feature: 'featureHub', subpage: 'cloud' })
    expect(openRestorePanel).not.toHaveBeenCalled()
  })

  it('opens the ZIP restore panel only for restore-choice notifications', async () => {
    const isFeatureHubOpen = ref(true)
    const openRestorePanel = vi.fn()
    const navigation = useLibraryNavigation(() => ({ isFeatureHubOpen, openRestorePanel }) as never)

    await navigation.handleNativeDeepLink(
      new CustomEvent('srl:native-deep-link', { detail: { kind: 'restore' } }),
    )

    expect(isFeatureHubOpen.value).toBe(false)
    expect(openRestorePanel).toHaveBeenCalledWith('export', true)
  })
})
