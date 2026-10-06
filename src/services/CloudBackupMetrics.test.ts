import { describe, expect, it, vi } from 'vitest'

import { CloudBackupMetricsTracker } from './CloudBackupMetrics'

describe('CloudBackupMetricsTracker', () => {
  it('records phase timings and byte/request counters without accepting invalid values', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(37)
      .mockReturnValueOnce(50)
    const tracker = new CloudBackupMetricsTracker(123)
    await tracker.measure('prepareMs', async () => 'ready')
    tracker.add('uploadedBytes', 2048)
    tracker.add('retryCount', 1)
    tracker.add('uploadedBytes', Number.NaN)

    const result = tracker.snapshot(true)
    expect(result.prepareMs).toBe(17)
    expect(result.uploadedBytes).toBe(2048)
    expect(result.retryCount).toBe(1)
    expect(result.totalMs).toBe(40)
    expect(result.completedAt).toEqual(expect.any(Number))
  })
})
