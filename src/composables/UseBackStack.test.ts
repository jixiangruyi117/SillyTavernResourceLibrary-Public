import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useBackStack } from './UseBackStack'

describe('useBackStack', () => {
  it('uses the first active entry only', () => {
    const dialog = ref(true)
    const page = ref(true)
    const stack = useBackStack([
      { id: 'dialog', isActive: () => dialog.value, back: () => (dialog.value = false) },
      { id: 'page', isActive: () => page.value, back: () => (page.value = false) },
    ])

    expect(stack.back()).toBe('handled')
    expect(dialog.value).toBe(false)
    expect(page.value).toBe(true)
  })

  it('blocks behind entries when the active entry is busy', () => {
    const stack = useBackStack([
      { id: 'busy', isActive: () => true, canBack: () => false, back: () => undefined },
      { id: 'behind', isActive: () => true, back: () => undefined },
    ])
    expect(stack.back()).toBe('blocked')
  })
})
