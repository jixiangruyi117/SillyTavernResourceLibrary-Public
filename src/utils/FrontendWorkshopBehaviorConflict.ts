import type { FrontendWorkshopBehavior } from '../types/FrontendWorkshopProject'

export interface FrontendWorkshopBehaviorConflict {
  nodeId: string
  trigger: FrontendWorkshopBehavior['trigger']
  behaviorIds: string[]
  message: string
}

/**
 * 同一元素、同一触发器上的 stop 行为会吞掉后续处理；这是保存允许但必须提前告知的冲突。
 */
export function getFrontendWorkshopBehaviorConflicts(
  behaviors: FrontendWorkshopBehavior[],
): FrontendWorkshopBehaviorConflict[] {
  const buckets = new Map<string, FrontendWorkshopBehavior[]>()
  for (const behavior of behaviors) {
    for (const nodeId of behavior.targetNodeIds) {
      const key = `${nodeId}\u0000${behavior.trigger}`
      buckets.set(key, [...(buckets.get(key) ?? []), behavior])
    }
  }
  return Array.from(buckets.entries()).flatMap(([key, matches]) => {
    const stopBehaviors = matches.filter((behavior) => behavior.propagation === 'stop')
    if (matches.length < 2 || !stopBehaviors.length) return []
    const [nodeId, trigger] = key.split('\u0000') as [string, FrontendWorkshopBehavior['trigger']]
    return [
      {
        nodeId,
        trigger,
        behaviorIds: matches.map((behavior) => behavior.id),
        message: `“${matches[0]?.name ?? '行为'}”与 ${matches.length - 1} 个同触发行为竞争；停止传播会按列表顺序阻断后续行为。`,
      },
    ]
  })
}
