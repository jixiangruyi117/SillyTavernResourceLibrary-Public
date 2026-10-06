/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'

import { FeatureAppUsageStore } from './FeatureAppUsageStore'

describe('FeatureAppUsageStore', () => {
  afterEach(() => localStorage.clear())

  it('keeps pinned apps stable and recent apps newest-first without duplicates', () => {
    const store = new FeatureAppUsageStore()
    store.togglePinned('builtIn:cloud')
    store.markOpened('builtIn:cloud')
    store.markOpened('builtIn:draw')
    store.markOpened('builtIn:cloud')

    expect(store.read()).toEqual({
      pinned: ['builtIn:cloud'],
      recent: ['builtIn:cloud', 'builtIn:draw'],
    })
    expect(store.togglePinned('builtIn:cloud').pinned).toEqual([])
  })
})
