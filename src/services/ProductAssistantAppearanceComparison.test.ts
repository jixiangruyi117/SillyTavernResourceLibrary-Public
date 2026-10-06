import { describe, expect, it, vi } from 'vitest'
import { appearanceScopes } from '../core/AppearanceScopes'
import { captureAssistantComparison } from './ProductAssistantAppearanceComparison'
import { captureAssistantPage } from './ProductAssistantScreenshot'
vi.mock('./ProductAssistantScreenshot', () => ({ captureAssistantPage: vi.fn() }))
const scope = appearanceScopes()[0]!
describe('actual appearance comparison around the CSS owner', () => {
  it('captures each side around the single existing write', async () => {
    const order: string[] = []
    vi.mocked(captureAssistantPage).mockImplementation(async () => {
      order.push('capture')
      return {
        id: String(order.length),
        name: '实际截图',
        dataUrl: 'data:image/jpeg;base64,AA',
        result: true,
      }
    })
    const result = await captureAssistantComparison(
      scope,
      new AbortController().signal,
      async () => {
        order.push('write')
      },
    )
    expect(order).toEqual(['capture', 'write', 'capture'])
    expect(result.before?.id).toBe('1')
    expect(result.after?.id).toBe('3')
  })
  it('keeps a successful write visible when after-capture fails, and never writes after cancellation', async () => {
    vi.mocked(captureAssistantPage)
      .mockResolvedValueOnce({
        id: 'before',
        name: '实际截图',
        dataUrl: 'data:image/jpeg;base64,AA',
      })
      .mockRejectedValueOnce(new Error('渲染失败'))
    const apply = vi.fn(async () => {})
    const result = await captureAssistantComparison(scope, new AbortController().signal, apply)
    expect(apply).toHaveBeenCalledOnce()
    expect(result.after).toBeUndefined()
    expect(result.captureError).toContain('渲染失败')
    const controller = new AbortController()
    controller.abort()
    apply.mockClear()
    await expect(captureAssistantComparison(scope, controller.signal, apply)).rejects.toThrow(
      '已停止',
    )
    expect(apply).not.toHaveBeenCalled()
  })
})
