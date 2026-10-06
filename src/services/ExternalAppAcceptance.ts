export type ExternalAppCheck =
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'text' | 'value'; selector: string; expected: string }
  | { action: 'storage'; key: string; expected: unknown }
  | { action: 'reload' }
export interface AssistantAppTask {
  id: string
  title: string
  implemented: boolean
  checks: ExternalAppCheck[]
  result?: {
    revision: number
    state: 'passed' | 'failed' | 'unverified'
    checked: number
    failedAt?: number
  }
}
/** Declarative probes only, never arbitrary JS or access to the host document/data. */
export function validateAssistantAppPlan(value: unknown): AssistantAppTask[] {
  if (!Array.isArray(value) || !value.length || value.length > 12)
    throw new Error('制作清单需为 1–12 项')
  const ids = new Set<string>()
  return value.map((task) => {
    if (
      !task ||
      typeof task !== 'object' ||
      Object.keys(task).some((key) => !['id', 'title', 'implemented', 'checks'].includes(key)) ||
      typeof task.id !== 'string' ||
      !/^[a-z][\w-]{0,39}$/u.test(task.id) ||
      ids.has(task.id) ||
      typeof task.title !== 'string' ||
      !task.title.trim() ||
      task.title.length > 80 ||
      typeof task.implemented !== 'boolean' ||
      !Array.isArray(task.checks) ||
      task.checks.length > 12
    )
      throw new Error('制作清单格式无效')
    ids.add(task.id)
    const checks = task.checks.map((check: unknown): ExternalAppCheck => {
      if (!check || typeof check !== 'object' || Array.isArray(check))
        throw new Error('验收步骤无效')
      const step = check as Record<string, unknown>
      const keys =
        step.action === 'reload'
          ? ['action']
          : step.action === 'storage'
            ? ['action', 'key', 'expected']
            : step.action === 'fill'
              ? ['action', 'selector', 'value']
              : step.action === 'click'
                ? ['action', 'selector']
                : ['action', 'selector', 'expected']
      if (
        Object.keys(step).some((key) => !keys.includes(key)) ||
        keys.some((key) => !Object.hasOwn(step, key))
      )
        throw new Error('验收步骤字段无效')
      if (!['fill', 'click', 'text', 'value', 'storage', 'reload'].includes(String(step.action)))
        throw new Error('不支持此验收动作')
      if (
        step.action !== 'storage' &&
        step.action !== 'reload' &&
        (typeof step.selector !== 'string' ||
          !/^(?:#[\w-]+|\.[\w-]+|\[data-[\w-]+="[\w-]+"\])$/u.test(step.selector))
      )
        throw new Error('验收只允许 APP 内的 ID、类名或 data 标记')
      if (
        step.action === 'storage' &&
        (typeof step.key !== 'string' ||
          !step.key ||
          step.key.length > 100 ||
          JSON.stringify(step.expected)?.length > 4000)
      )
        throw new Error('验收测试数据过大或无效')
      for (const key of ['value', 'expected'])
        if (
          step.action !== 'storage' &&
          key in step &&
          (typeof step[key] !== 'string' || (step[key] as string).length > 1000)
        )
          throw new Error('验收文字需小于等于 1000 字')
      return structuredClone(step) as ExternalAppCheck
    })
    return { id: task.id, title: task.title.trim(), implemented: task.implemented, checks }
  })
}
export async function runAssistantAppAcceptance(
  tasks: AssistantAppTask[],
  revision: number,
  signal: AbortSignal,
  runtime: {
    reset: () => Promise<void>
    reload: () => Promise<void>
    check: (step: Exclude<ExternalAppCheck, { action: 'reload' }>) => Promise<boolean>
  },
): Promise<AssistantAppTask[]> {
  const results: AssistantAppTask[] = structuredClone(tasks).map((task) => ({
    ...task,
    result: {
      revision,
      state: 'unverified' as 'passed' | 'failed' | 'unverified',
      checked: 0,
      failedAt: undefined as number | undefined,
    },
  }))
  for (const task of results) {
    if (signal.aborted) throw new DOMException('已停止', 'AbortError')
    // A click receipt alone cannot prove behavior. Require an observable assertion.
    if (
      !task.implemented ||
      !task.checks.some((step) => ['text', 'value', 'storage'].includes(step.action))
    ) {
      task.result = { revision, state: 'unverified', checked: 0 }
      continue
    }
    try {
      await runtime.reset()
    } catch (cause) {
      if (signal.aborted) throw cause
      break
    }
    task.result = { revision, state: 'passed', checked: 0 }
    for (const [index, step] of task.checks.entries()) {
      if (signal.aborted) throw new DOMException('已停止', 'AbortError')
      let passed = true
      try {
        if (step.action === 'reload') await runtime.reload()
        else passed = await runtime.check(step)
      } catch (cause) {
        if (signal.aborted) throw cause
        task.result = { revision, state: 'unverified', checked: index }
        return results
      }
      if (!passed) {
        task.result = { revision, state: 'failed', checked: index, failedAt: index + 1 }
        break
      }
      task.result.checked++
    }
  }
  return results
}
