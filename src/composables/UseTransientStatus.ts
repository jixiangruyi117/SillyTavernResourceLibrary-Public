import { onScopeDispose, ref } from 'vue'

const DEFAULT_TRANSIENT_STATUS_MS = 2_500

/**
 * 统一管理短暂成功提示与需要持续显示的状态。
 *
 * - showTransientStatus: 成功提示，默认 2.5 秒后自动清空。
 * - setStatus: 进行中 / 错误等需要保留的状态；同时取消旧的自动清空计时。
 * - 新提示会先取消旧计时，避免连续操作时前一个 timer 提前清掉后一个提示。
 * - 组件销毁时自动清理 timer，避免残留回调。
 */
export function useTransientStatus(durationMs = DEFAULT_TRANSIENT_STATUS_MS) {
  const statusMessage = ref('')
  let clearTimer: number | undefined

  function cancelScheduledClear(): void {
    if (clearTimer !== undefined) window.clearTimeout(clearTimer)
    clearTimer = undefined
  }

  function clearStatus(): void {
    cancelScheduledClear()
    statusMessage.value = ''
  }

  function setStatus(message: string): void {
    cancelScheduledClear()
    statusMessage.value = message
  }

  function showTransientStatus(message: string, timeoutMs = durationMs): void {
    setStatus(message)
    clearTimer = window.setTimeout(
      () => {
        clearTimer = undefined
        statusMessage.value = ''
      },
      Math.max(0, timeoutMs),
    )
  }

  onScopeDispose(cancelScheduledClear)

  return {
    statusMessage,
    clearStatus,
    setStatus,
    showTransientStatus,
  }
}
