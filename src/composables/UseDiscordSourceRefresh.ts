import type { ComputedRef, Ref } from 'vue'
import { communitySourceService } from '../core/CommunitySourceRuntime'
import {
  readDiscordSourceRemote,
  type DiscordSourceRefreshChange,
  type DiscordSourceUncheckableResult,
} from '../services/DiscordSourceRefreshService'
import {
  COMMUNITY_SOURCE_REMOTE_STATE,
  type ResourceCommunitySourceView,
} from '../types/CommunitySource'
import type { RefreshCandidate, RefreshMode } from '../types/DiscordCommunitySourcesView'

interface DiscordSourceRefreshContext {
  detailLoading: Ref<boolean, boolean>
  checkingSourceId: Ref<string, string>
  applyingRefresh: Ref<boolean, boolean>
  refreshController: AbortController | undefined
  refreshError: Ref<string, string>
  refreshCandidate: Ref<RefreshCandidate | undefined>
  selectedRefreshMessageIds: Ref<string[]>
  load: () => Promise<void>
  showTransientStatus: (message: string, timeoutMs?: number) => void
  refreshMode: Ref<RefreshMode>
  refreshCanApply: ComputedRef<boolean>
  historyOpen: Ref<boolean, boolean>
}

export function useDiscordSourceRefresh(getContext: () => DiscordSourceRefreshContext) {
  function uncheckableSourceMessage(result: DiscordSourceUncheckableResult): string {
    if (result.reason === 'bot_access') {
      return 'Discord Bot 未加入这个社区，无法自动检查更新；原帖仍可能正常存在。需要更新时，请在 Discord 中重新对消息执行“保存到资源库”。'
    }
    if (result.reason === 'forbidden') {
      return 'Discord Bot 没有查看频道或读取历史消息的权限，本次检查未完成；原帖仍可能正常存在。'
    }
    return 'Discord Bot 暂时无法完整读取这个帖子，本次检查未完成；未检查的内容不会被标记为删除。'
  }

  async function checkForUpdates(view: ResourceCommunitySourceView): Promise<void> {
    const context = getContext()

    if (
      context.detailLoading.value ||
      context.checkingSourceId.value ||
      context.applyingRefresh.value
    )
      return
    context.refreshController?.abort()
    context.refreshController = new AbortController()
    const controller = context.refreshController
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    context.checkingSourceId.value = view.source.id
    context.refreshError.value = ''
    context.refreshCandidate.value = undefined
    context.selectedRefreshMessageIds.value = []
    try {
      const remote = await readDiscordSourceRemote(view, controller.signal)
      if (remote.state === 'uncheckable') {
        if (remote.reason === 'bot_access') {
          await communitySourceService.recordManualRefresh(view.source.id)
        } else {
          await communitySourceService.clearRemoteAvailability(view.source.id)
        }
        await context.load()
        if (remote.reason !== 'bot_access')
          context.refreshError.value = uncheckableSourceMessage(remote)
        return
      }
      if (remote.state === 'unavailable') {
        await communitySourceService.recordRemoteCheck(
          view.source.id,
          COMMUNITY_SOURCE_REMOTE_STATE.UNAVAILABLE,
          false,
        )
        await context.load()
        return
      }

      await Promise.all([
        communitySourceService.recordRemoteCheck(
          view.source.id,
          COMMUNITY_SOURCE_REMOTE_STATE.AVAILABLE,
          remote.diff.hasChanges,
          remote.diff.hasChanges ? undefined : remote.syncState,
        ),
        remote.diff.hasChanges
          ? Promise.resolve()
          : communitySourceService.recordMessageRemoteCheck(
              view.source.id,
              remote.captures.map((capture) => capture.messageId),
              remote.missingMessageIds,
            ),
      ])
      await context.load()
      if (remote.rateLimited) {
        context.refreshError.value =
          'Discord 暂时限流，本次只完成部分旧消息检查，检查进度已保留，请稍后再次检查。'
      }
      if (!remote.diff.hasChanges) {
        if (!remote.rateLimited) context.showTransientStatus('未发现更新')
        return
      }
      context.refreshCandidate.value = {
        sourceId: view.source.id,
        captures: remote.captures,
        missingMessageIds: remote.missingMessageIds,
        diff: remote.diff,
        syncState: remote.syncState,
      }
      context.selectedRefreshMessageIds.value = remote.diff.changes
        .filter((change) => change.type === 'new')
        .map((change) => change.messageId)
      context.refreshMode.value = 'keep'
    } catch (error) {
      context.refreshError.value =
        error instanceof DOMException && error.name === 'AbortError'
          ? '检查更新超时，请确认 Discord Bridge 和网络可以正常访问。'
          : error instanceof Error
            ? error.message
            : '检查 Discord 来源失败'
    } finally {
      window.clearTimeout(timer)
      if (context.refreshController === controller) context.refreshController = undefined
      context.checkingSourceId.value = ''
    }
  }

  async function applyRefresh(): Promise<void> {
    const context = getContext()

    const candidate = context.refreshCandidate.value
    if (!candidate || context.applyingRefresh.value || !context.refreshCanApply.value) return
    context.applyingRefresh.value = true
    context.refreshError.value = ''
    try {
      const newMessageIds = candidate.diff.changes
        .filter((change) => change.type === 'new')
        .map((change) => change.messageId)
      const onlyDecliningNewMessages = Boolean(
        newMessageIds.length &&
        context.selectedRefreshMessageIds.value.length === 0 &&
        candidate.diff.changedMessages === 0 &&
        candidate.diff.missingMessages === 0 &&
        candidate.diff.restoredMessages === 0 &&
        candidate.diff.sourceMetadataChanges === 0,
      )

      if (onlyDecliningNewMessages) {
        await Promise.all([
          communitySourceService.ignoreRemoteMessages(
            candidate.sourceId,
            newMessageIds,
            candidate.syncState,
          ),
          communitySourceService.recordMessageRemoteCheck(
            candidate.sourceId,
            candidate.captures.map((capture) => capture.messageId),
            candidate.missingMessageIds,
          ),
        ])
        context.refreshCandidate.value = undefined
        context.selectedRefreshMessageIds.value = []
        await context.load()
        context.showTransientStatus('已忽略未勾选的新消息；之后检查不会重复提示')
        return
      }

      await communitySourceService.applyDiscordRefresh(candidate.sourceId, candidate.captures, {
        keepPrevious: context.refreshMode.value === 'keep',
        includeNewMessageIds: context.selectedRefreshMessageIds.value,
        missingMessageIds: candidate.missingMessageIds,
        syncState: candidate.syncState,
      })
      const kept = context.refreshMode.value === 'keep'
      context.refreshCandidate.value = undefined
      context.selectedRefreshMessageIds.value = []
      await context.load()
      context.historyOpen.value = kept
      context.showTransientStatus(kept ? '已更新并保留上一版本' : '已更新并只保留最新版')
    } catch (error) {
      context.refreshError.value = error instanceof Error ? error.message : '应用 Discord 更新失败'
    } finally {
      context.applyingRefresh.value = false
    }
  }

  function cancelRefreshDecision(): void {
    const context = getContext()

    if (context.applyingRefresh.value) return
    context.refreshCandidate.value = undefined
    context.selectedRefreshMessageIds.value = []
  }

  function refreshChangeLabel(change: DiscordSourceRefreshChange): string {
    if (change.type === 'new') return '新增消息'
    if (change.type === 'missing') return '原消息已删除'
    if (change.type === 'restored') return '恢复可访问'
    return '内容已修改'
  }

  function refreshChangeDetails(change: DiscordSourceRefreshChange): string {
    if (change.type === 'missing') return 'Discord 已找不到这条消息，本地副本不会删除。'
    if (change.type === 'restored') return '之前不可访问的消息现在重新可以读取。'
    if (change.type === 'new')
      return change.authorBot ? '新的 Bot / Webhook 消息' : '新的作者或已筛选消息'
    const parts: string[] = []
    if (change.contentChanged) parts.push('正文')
    if (change.embedsChanged) parts.push('Embed')
    if (change.attachmentsChanged) parts.push('附件')
    return parts.length ? `${parts.join('、')}有变化` : '消息内容有变化'
  }
  return {
    uncheckableSourceMessage,
    checkForUpdates,
    applyRefresh,
    cancelRefreshDecision,
    refreshChangeLabel,
    refreshChangeDetails,
  }
}
