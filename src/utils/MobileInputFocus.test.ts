/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import {
  isElementOccludedByViewport,
  revealMobileInputIfOccluded,
  restorePersonalInputScroll,
} from './MobileInputFocus'

describe('revealMobileInputIfOccluded', () => {
  const viewport = { height: 420, offsetTop: 0 }

  it.each(['automatic', 'manual scroll', 'different field', 'closed dialog'])(
    'restores only untouched personal editor avoidance: %s',
    (change) => {
      const dialog = document.createElement('section')
      dialog.className = 'personal-resource-editor'
      dialog.setAttribute('role', 'dialog')
      const content = document.createElement('div')
      content.style.overflowY = 'auto'
      const input = document.createElement('input')
      const other = document.createElement('input')
      content.append(input, other)
      dialog.append(content)
      document.body.append(dialog)
      Object.defineProperties(content, {
        clientHeight: { value: 250 },
        scrollHeight: { value: 1200 },
      })
      content.scrollTop = 20
      vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 80, 390, 250))
      vi.spyOn(input, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, 440 - content.scrollTop, 390, 44),
      )
      input.focus()
      expect(revealMobileInputIfOccluded(input, viewport)).toBe(true)
      expect(content.scrollTop).toBeGreaterThan(20)
      if (change === 'manual scroll') content.scrollTop += 30
      if (change === 'different field') other.focus()
      if (change === 'closed dialog') dialog.remove()
      const beforeClose = content.scrollTop
      restorePersonalInputScroll()
      expect(content.scrollTop).toBe(change === 'automatic' ? 20 : beforeClose)
      restorePersonalInputScroll()
      expect(content.scrollTop).toBe(change === 'automatic' ? 20 : beforeClose)
      dialog.remove()
    },
  )

  it('焦点已经处于软键盘上方时不重复滚动', () => {
    expect(isElementOccludedByViewport({ top: 120, bottom: 164 }, viewport)).toBe(false)
  })

  it('焦点被软键盘遮住或越过顶部时才请求最近边缘定位', () => {
    const input = document.createElement('input')
    const scrollIntoView = vi.fn()
    input.scrollIntoView = scrollIntoView
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      top: 396,
      bottom: 440,
    } as DOMRect)

    expect(revealMobileInputIfOccluded(input, viewport)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    })
    expect(isElementOccludedByViewport({ top: 0, bottom: 44 }, viewport)).toBe(true)
  })

  it('键盘缩小弹窗后只滚动正文，并且已经可见时不重复补偿', () => {
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    const content = document.createElement('div')
    content.style.overflowY = 'auto'
    const input = document.createElement('textarea')
    content.append(input)
    dialog.append(content)
    document.body.append(dialog)
    Object.defineProperties(content, {
      clientHeight: { value: 264 },
      scrollHeight: { value: 1500 },
    })
    content.scrollTop = 201
    input.scrollIntoView = vi.fn()
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 69, 390, 264))
    vi.spyOn(input, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 642 - content.scrollTop, 390, 154),
    )
    const pannedViewport = { height: 448, offsetTop: 296 }
    try {
      expect(revealMobileInputIfOccluded(input, pannedViewport)).toBe(true)
      expect(input.getBoundingClientRect().bottom).toBe(321)
      const scrollTop = content.scrollTop
      expect(revealMobileInputIfOccluded(input, pannedViewport)).toBe(false)
      expect(content.scrollTop).toBe(scrollTop)
      expect(input.scrollIntoView).not.toHaveBeenCalled()
      expect(document.documentElement.scrollTop).toBe(0)
    } finally {
      dialog.remove()
    }
  })
})
