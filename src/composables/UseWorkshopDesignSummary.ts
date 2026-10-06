import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { type StatusField, type WorkshopBlock } from '../utils/FrontendWorkshop'
import { blockOptions, blockSceneOptions } from '../utils/FrontendWorkshopLegacyOptions'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopDesignSummaryContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  'blocks' | 'interactions' | 'imageUrls'
> {
  parsedFields: ComputedRef<StatusField[]>
}

export function useWorkshopDesignSummary(context: WorkshopDesignSummaryContext) {
  const activeBlockSceneId = computed(() => {
    const selected = [...context.blocks.value].sort().join('|')
    return (
      blockSceneOptions.find((scene) => [...scene.blocks].sort().join('|') === selected)?.id ?? ''
    )
  })

  const mobileComplexity = computed(() => {
    const weights: Record<WorkshopBlock, number> = {
      'character-header': 0.9,
      'attribute-grid': 1,
      'relationship-card': 1.1,
      inventory: 1.2,
      'quest-timeline': 1.4,
      'character-tabs': 1.5,
      'long-collapse': 0.6,
      'image-banner': 0.9,
    }
    const score =
      context.blocks.value.reduce((total, block) => total + weights[block], 0) +
      Math.max(0, context.parsedFields.value.length - 4) * 0.18 +
      context.interactions.value.filter((interaction) => interaction !== 'collapsible').length *
        0.35
    const level = score <= 2.8 ? 'light' : score <= 5.2 ? 'medium' : 'high'
    const labels = {
      light: '轻量',
      medium: '中等',
      high: '偏复杂',
    } as const
    const advice: string[] = []
    if (!context.blocks.value.length) advice.push('还未选择积木，AI 会按字段自然排版。')
    if (level === 'high' && !context.blocks.value.includes('long-collapse'))
      advice.push('建议加入“收起次要内容”，减少手机首屏长度。')
    if (context.blocks.value.includes('image-banner') && !context.imageUrls.value.length)
      advice.push('顶部视觉图还缺少 HTTPS 成品图片直链。')
    if (
      context.blocks.value.length >= 4 &&
      context.parsedFields.value.length < context.blocks.value.length * 2
    )
      advice.push('积木多于可分配内容，建议补充字段或减少区域。')
    if (!advice.length)
      advice.push(
        level === 'light'
          ? '适合 320px 手机消息位，通常无需额外折叠。'
          : '建议生成后重点检查 320px 首屏和长文本换行。',
      )
    return { level, label: labels[level], score: Math.round(score * 10) / 10, advice }
  })

  const blockSkeleton = computed(() =>
    context.blocks.value.map((block) => {
      const option = blockOptions.find((item) => item.value === block)!
      const allFields = context.parsedFields.value
      const keywordMatches = (pattern: RegExp) =>
        allFields.filter((field) => pattern.test(`${field.group}.${field.label}`))
      let matches: StatusField[] = []
      if (block === 'character-header')
        matches = keywordMatches(/姓名|名称|身份|职业|状态|角色|称号/i).slice(0, 3)
      else if (block === 'attribute-grid')
        matches = allFields
          .filter((field) => field.kind === 'number' || field.kind === 'percent')
          .slice(0, 6)
      else if (block === 'relationship-card')
        matches = keywordMatches(/关系|好感|信任|羁绊|情绪|亲密/i).slice(0, 4)
      else if (block === 'inventory')
        matches = allFields
          .filter(
            (field) => field.kind === 'tags' || /背包|物品|道具|技能|装备|收藏/i.test(field.label),
          )
          .slice(0, 4)
      else if (block === 'quest-timeline')
        matches = keywordMatches(/任务|剧情|目标|事件|章节|进度/i).slice(0, 5)
      else if (block === 'character-tabs') {
        const groups = Array.from(new Set(allFields.map((field) => field.group))).slice(0, 5)
        return {
          block,
          title: option.title,
          assignment: groups.length ? groups.join(' / ') : '需要至少两个角色分组',
        }
      } else if (block === 'long-collapse')
        matches = allFields
          .filter((field) => field.kind === 'longText')
          .concat(allFields.slice(5))
          .filter(
            (field, index, list) => list.findIndex((item) => item.path === field.path) === index,
          )
          .slice(0, 5)
      else if (block === 'image-banner') {
        return {
          block,
          title: option.title,
          assignment: context.imageUrls.value.length
            ? `${context.imageUrls.value.length} 张批准图片 + 标题兜底`
            : '待添加图片直链',
        }
      }
      if (!matches.length) matches = allFields.slice(0, Math.min(3, allFields.length))
      return {
        block,
        title: option.title,
        assignment: matches.length
          ? matches.map((field) => field.label).join(' / ')
          : '生成前需要先添加字段',
      }
    }),
  )
  return { activeBlockSceneId, mobileComplexity, blockSkeleton }
}
