import type { CloudBackupMetrics } from '../types/CloudBackup'

export type CloudBackupDurationMetric =
  | 'prepareMs'
  | 'hashMs'
  | 'objectBuildMs'
  | 'bridgeEncodeMs'
  | 'bridgeTransferMs'
  | 'nativeDiskMs'
  | 'networkMs'
  | 'verifyMs'
  | 'maintenanceMs'

export type CloudBackupCountMetric =
  | 'localReadBytes'
  | 'hashedBytes'
  | 'bridgeBytes'
  | 'uploadedBytes'
  | 'httpRequestCount'
  | 'retryCount'

const durationKeys: CloudBackupDurationMetric[] = [
  'prepareMs',
  'hashMs',
  'objectBuildMs',
  'bridgeEncodeMs',
  'bridgeTransferMs',
  'nativeDiskMs',
  'networkMs',
  'verifyMs',
  'maintenanceMs',
]

const countKeys: CloudBackupCountMetric[] = [
  'localReadBytes',
  'hashedBytes',
  'bridgeBytes',
  'uploadedBytes',
  'httpRequestCount',
  'retryCount',
]

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export class CloudBackupMetricsTracker {
  private readonly startedClock = now()
  private readonly metrics: CloudBackupMetrics

  constructor(startedAt = Date.now()) {
    this.metrics = {
      startedAt,
      totalMs: 0,
      prepareMs: 0,
      hashMs: 0,
      objectBuildMs: 0,
      bridgeEncodeMs: 0,
      bridgeTransferMs: 0,
      nativeDiskMs: 0,
      networkMs: 0,
      verifyMs: 0,
      maintenanceMs: 0,
      localReadBytes: 0,
      hashedBytes: 0,
      bridgeBytes: 0,
      uploadedBytes: 0,
      httpRequestCount: 0,
      retryCount: 0,
    }
  }

  add(metric: CloudBackupDurationMetric | CloudBackupCountMetric, value: number): void {
    if (!Number.isFinite(value) || value <= 0) return
    this.metrics[metric] += value
  }

  merge(value?: Partial<CloudBackupMetrics>): void {
    if (!value) return
    for (const key of durationKeys) this.add(key, Number(value[key] ?? 0))
    for (const key of countKeys) this.add(key, Number(value[key] ?? 0))
  }

  async measure<T>(metric: CloudBackupDurationMetric, task: () => Promise<T>): Promise<T> {
    const started = now()
    try {
      return await task()
    } finally {
      this.add(metric, now() - started)
    }
  }

  snapshot(complete = false): CloudBackupMetrics {
    const completedAt = complete ? Date.now() : undefined
    return {
      ...this.metrics,
      ...(completedAt === undefined ? {} : { completedAt }),
      totalMs: Math.max(0, now() - this.startedClock),
    }
  }
}
