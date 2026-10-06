import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import type { WorkshopVersion } from '../types/FrontendWorkshopLegacyApp'
import {
  buildWorkshopMvuTurns,
  buildWorkshopStressCases,
  buildWorkshopWorldbook,
  inspectWorkshopSample,
  renderWorkshopInspectablePreview,
  renderWorkshopPreview,
  type WorkshopDataMode,
} from '../utils/FrontendWorkshop'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopPreviewViewContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'currentIndex'
  | 'versions'
  | 'inspectionMode'
  | 'sample'
  | 'previewWidth'
  | 'previewAvatarMode'
  | 'previewShell'
> {
  current: ComputedRef<WorkshopVersion | undefined>
}

export function useWorkshopPreviewView(context: WorkshopPreviewViewContext) {
  const previous = computed<WorkshopVersion | undefined>(() =>
    context.currentIndex.value > 0
      ? context.versions.value[context.currentIndex.value - 1]
      : undefined,
  )

  const previewResult = computed(() => {
    if (!context.current.value) return { html: '', error: '' }
    try {
      return {
        html: context.inspectionMode.value
          ? renderWorkshopInspectablePreview(
              context.current.value.artifact,
              context.sample.value || context.current.value.artifact.sampleOutput,
            )
          : renderWorkshopPreview(
              context.current.value.artifact,
              context.sample.value || context.current.value.artifact.sampleOutput,
            ),
        error: '',
      }
    } catch (cause) {
      return {
        html: '',
        error: cause instanceof Error ? cause.message : '校样数据无法读取',
      }
    }
  })

  const renderedSource = computed(() => previewResult.value.html)

  const sampleIssues = computed(() =>
    context.current.value
      ? inspectWorkshopSample(
          context.current.value.artifact,
          context.sample.value || context.current.value.artifact.sampleOutput,
        )
      : [],
  )

  const blockingSampleIssue = computed(() =>
    sampleIssues.value.find((issue) => issue.severity === 'error'),
  )

  const stressCases = computed(() =>
    context.current.value ? buildWorkshopStressCases(context.current.value.artifact) : [],
  )

  const mvuTurns = computed(() =>
    context.current.value ? buildWorkshopMvuTurns(context.current.value.artifact, 10) : [],
  )

  const previewWidthNote = computed(() => {
    const widthLabel = {
      phone320: '320px 手机视口',
      phone390: '390px 手机视口',
      desktop: '720px 桌面聊天栏',
      fit: '当前可用宽度',
    }[context.previewWidth.value]
    const avatarLabel = context.previewAvatarMode.value === 'hidden' ? '隐藏头像' : '显示头像'
    return context.previewShell.value === 'message'
      ? `${widthLabel}；${avatarLabel}，按 SillyTavern 1.18.0 的同文档消息 DOM、body class、消息内边距与右侧操作留白渲染。`
      : `${widthLabel}；这里只放大检查状态栏自身，不代表它在酒馆消息中的最终可用宽度。`
  })

  const previewStageStyle = computed(() => {
    const width = {
      phone320: '320px',
      phone390: '390px',
      desktop: '720px',
      fit: '100%',
    }[context.previewWidth.value]
    return { width, minWidth: width }
  })

  const regexJson = computed(() =>
    context.current.value ? JSON.stringify(context.current.value.artifact.regex, null, 2) : '',
  )

  const worldbookJson = computed(() =>
    context.current.value
      ? JSON.stringify(buildWorkshopWorldbook(context.current.value.artifact), null, 2)
      : '',
  )

  const currentDataMode = computed<WorkshopDataMode>(() =>
    context.current.value?.artifact.dataMode === 'mvu' ? 'mvu' : 'reply',
  )
  return {
    previous,
    previewResult,
    renderedSource,
    sampleIssues,
    blockingSampleIssue,
    stressCases,
    mvuTurns,
    previewWidthNote,
    previewStageStyle,
    regexJson,
    worldbookJson,
    currentDataMode,
  }
}
