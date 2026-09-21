import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useOverlayStack } from './UseOverlayStack'

describe('useOverlayStack', () => {
  it('closes only the most recently opened overlay', async () => {
    const first = ref(false)
    const second = ref(false)
    const stack = useOverlayStack([
      { id: 'first', isOpen: () => first.value, close: () => (first.value = false) },
      { id: 'second', isOpen: () => second.value, close: () => (second.value = false) },
    ])
    first.value = true
    second.value = true
    await Promise.resolve()

    expect(stack.topId.value).toBe('second')
    expect(stack.closeTop()).toBe('closed')
    expect(first.value).toBe(true)
    expect(second.value).toBe(false)
  })

  it('reports a blocked top overlay without closing something behind it', async () => {
    const behind = ref(true)
    const locked = ref(false)
    const stack = useOverlayStack([
      { id: 'behind', isOpen: () => behind.value, close: () => (behind.value = false) },
      {
        id: 'locked',
        isOpen: () => locked.value,
        close: () => (locked.value = false),
        canClose: () => false,
      },
    ])
    locked.value = true
    await Promise.resolve()

    expect(stack.closeTop()).toBe('blocked')
    expect(locked.value).toBe(true)
    expect(behind.value).toBe(true)
  })
})
