import { describe, expect, it, vi } from 'vitest'
import { runAssistantAppAcceptance, validateAssistantAppPlan } from './ExternalAppAcceptance'
const plan = () =>
  validateAssistantAppPlan([
    {
      id: 'save',
      title: '保存并重开',
      implemented: true,
      checks: [
        { action: 'fill', selector: '#note', value: '测试' },
        { action: 'click', selector: '#save' },
        { action: 'storage', key: 'note', expected: '测试' },
        { action: 'reload' },
        { action: 'value', selector: '#note', expected: '测试' },
      ],
    },
  ])
describe('declarative APP acceptance', () => {
  it('executes real runtime probes sequentially and only marks the checked revision', async () => {
    const order: string[] = []
    const runtime = {
      reset: async () => {
        order.push('reset')
      },
      reload: async () => {
        order.push('reload')
      },
      check: async (step: { action: string }) => {
        order.push(step.action)
        return true
      },
    }
    const result = await runAssistantAppAcceptance(plan(), 7, new AbortController().signal, runtime)
    expect(order).toEqual(['reset', 'fill', 'click', 'storage', 'reload', 'value'])
    expect(result[0]?.result).toMatchObject({ state: 'passed', checked: 5, revision: 7 })
    expect(plan()[0]?.result).toBeUndefined()
  })
  it('records a failed postcondition and never claims unexecuted/click-only tasks passed', async () => {
    const tasks = [
      ...plan(),
      { id: 'later', title: '待制作', implemented: false, checks: [] },
      {
        id: 'click',
        title: '只有按钮',
        implemented: true,
        checks: [{ action: 'click' as const, selector: '#save' }],
      },
    ]
    const check = vi
      .fn(async () => true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const result = await runAssistantAppAcceptance(tasks, 3, new AbortController().signal, {
      reset: async () => {},
      reload: vi.fn(),
      check,
    })
    expect(result.map((task) => task.result?.state)).toEqual(['failed', 'unverified', 'unverified'])
    expect(result[0]?.result?.failedAt).toBe(3)
    expect(check).toHaveBeenCalledTimes(3)
  })
  it('keeps infrastructure failure unverified and stops cancelled work', async () => {
    const runtime = {
      reset: async () => {},
      reload: async () => {},
      check: vi.fn().mockRejectedValue(new Error('closed')),
    }
    const result = await runAssistantAppAcceptance(plan(), 1, new AbortController().signal, runtime)
    expect(result[0]?.result?.state).toBe('unverified')
    const controller = new AbortController()
    controller.abort()
    await expect(runAssistantAppAcceptance(plan(), 1, controller.signal, runtime)).rejects.toThrow(
      '已停止',
    )
  })
  it('rejects arbitrary scripts, host selectors, fabricated results, duplicate IDs and oversized data', () => {
    const task = plan()[0]!
    for (const checks of [
      [{ action: 'eval', script: 'fetch()' }],
      [{ action: 'click', selector: 'body button' }],
      [{ action: 'storage', key: 'x', expected: 'x'.repeat(4001) }],
    ])
      expect(() => validateAssistantAppPlan([{ ...task, checks }])).toThrow()
    expect(() => validateAssistantAppPlan([{ ...task, result: { state: 'passed' } }])).toThrow()
    expect(() => validateAssistantAppPlan([task, task])).toThrow()
  })
})
