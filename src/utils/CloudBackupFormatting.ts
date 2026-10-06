import type { CloudBackupMetrics } from '../types/CloudBackup'
export function formatMetricDuration(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} 秒` : `${Math.round(value)} 毫秒`
}

export function formatMetricBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${Math.round(value)} B`
}

export function metricSpeed(metrics: CloudBackupMetrics): string {
  return metrics.uploadedBytes && metrics.totalMs
    ? `任务平均 ${(metrics.uploadedBytes / 1024 / 1024 / (metrics.totalMs / 1_000)).toFixed(1)} MiB/s`
    : '未记录成功上传量'
}

export function formatBytes(value: number): string {
  if (!value) return '未知大小'
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function formatTime(value: number | undefined, currentTime: number): string {
  if (!value) return '尚未成功备份'
  const elapsed = Math.max(0, currentTime - value)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  return `${Math.floor(elapsed / 86_400_000)} 天前`
}
