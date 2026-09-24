import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import type { TypographyPreset, WorkshopVersion } from '../types/FrontendWorkshopLegacyApp'
import { type FrontendWorkshopArtifact } from '../utils/FrontendWorkshop'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopTypographyViewContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  'titleTypography' | 'bodyTypography'
> {
  typographyOptions: {
    value: TypographyPreset
    label: string
    description: string
    stack: string
  }[]
  current: ComputedRef<WorkshopVersion | undefined>
}

export function useWorkshopTypographyView(context: WorkshopTypographyViewContext) {
  const selectedTitleTypography = computed(() =>
    context.typographyOptions.find((option) => option.value === context.titleTypography.value)!,
  )

  const selectedBodyTypography = computed(() =>
    context.typographyOptions.find((option) => option.value === context.bodyTypography.value)!,
  )

  function typographyStack(preset: TypographyPreset, customFamily: string): string {
    if (preset === 'custom')
      return `"${customFamily}", "PingFang SC", "Microsoft YaHei", sans-serif`
    return (
      context.typographyOptions.find((option) => option.value === preset)?.stack ?? 'var(--font-ui)'
    )
  }

  const selectedTitleStack = computed(() =>
    typographyStack(context.titleTypography.value, 'SRLUserFontTitle'),
  )

  const selectedBodyStack = computed(() =>
    typographyStack(context.bodyTypography.value, 'SRLUserFontBody'),
  )

  const currentCompatibility = computed(() => {
    const compatibility = context.current.value?.artifact.compatibility
    if (context.current.value?.artifact.dataMode === 'mvu') {
      const existingDependencies = compatibility?.dependencies ?? []
      const externalDependencies = existingDependencies.filter(
        (dependency) => dependency === '联网图片' || dependency === '联网字体',
      )
      return {
        levelLabel: externalDependencies.length
          ? '酒馆 + 酒馆助手 + MVU + 提示词模板 + 外部资源'
          : '酒馆 + 酒馆助手 + MVU + 提示词模板',
        dataLabel: compatibility?.dataLabel ?? '已有 MVU 变量',
        persistenceLabel: compatibility?.persistenceLabel ?? '由 MVU 跨回合保存',
        dependencies: [
          'SillyTavern 内置正则',
          '酒馆助手',
          'MVU',
          'ST-Prompt-Template（开启“处理消息内容”）',
          ...externalDependencies,
        ],
        verificationNote: compatibility?.verificationNote?.includes('ST-Prompt-Template')
          ? compatibility.verificationNote
          : '该正则包含 EJS；必须安装并启用 ST-Prompt-Template 的“处理消息内容”，再由酒馆助手读取 MVU 楼层变量。缺少任一依赖时不能按 MVU 成品交付。',
      } satisfies FrontendWorkshopArtifact['compatibility']
    }
    if (compatibility)
      return {
        ...compatibility,
        levelLabel: compatibility.levelLabel ?? '纯酒馆',
      }
    return {
      levelLabel: '纯酒馆',
      dataLabel: '每轮完整状态块',
      persistenceLabel: '依赖 AI 每轮重新输出',
      dependencies: ['SillyTavern 内置正则'],
      verificationNote: '这是旧版生成记录；仍按非 MVU 的完整状态块处理。',
    } satisfies FrontendWorkshopArtifact['compatibility']
  })
  return {
    selectedTitleTypography,
    selectedBodyTypography,
    typographyStack,
    selectedTitleStack,
    selectedBodyStack,
    currentCompatibility,
  }
}
