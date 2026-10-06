import { describe, expect, it, vi } from 'vitest'
import { qualityGatePlan, runQualityGates } from './Run-QualityGates.mjs'
import { parseAuditArguments } from './Run-IsolatedAudit.mjs'

describe('候选与正式发布共用门禁', () => {
  it('正式门禁保留候选门禁，并补上两引擎外观与详情布局审计', () => {
    const candidate = qualityGatePlan('candidate', 'test-run')
    const release = qualityGatePlan('release', 'test-run')
    for (const step of candidate) expect(release).toContainEqual(step)
    expect(release.filter((step) => step.args.includes('appearance'))).toHaveLength(2)
    const detailSteps = release.filter((step) => step.args.includes('detail-layout'))
    expect(detailSteps.map((step) => parseAuditArguments(step.args.slice(1)).engine)).toEqual([
      'chromium',
      'webkit',
    ])
    expect(
      release.every((step) => !step.args.some((arg) => /deploy|migrate|android:apk/u.test(arg))),
    ).toBe(true)
    for (const step of qualityGatePlan('release', 'r'.repeat(50)).filter(
      (step) => step.kind === 'node',
    ))
      expect(() => parseAuditArguments(step.args.slice(1))).not.toThrow()
  })
  it('首个门禁失败后不执行构建后的步骤，更不继续发布', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('功能漏接'))
    await expect(runQualityGates(qualityGatePlan('candidate', 'failure'), execute)).rejects.toThrow(
      '功能漏接',
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('拒绝不明阶段、运行路径穿越以及接管人工验收端口', () => {
    expect(() => qualityGatePlan('deploy', 'run')).toThrow()
    expect(() => qualityGatePlan('candidate', '../run')).toThrow()
    expect(() => qualityGatePlan('candidate', 'run', 5173)).toThrow()
  })
  it('独立审计强制明确运行名称和端口，不自动换端口', () => {
    expect(() => parseAuditArguments(['--suite', 'appearance'])).toThrow('运行名称')
    expect(() => parseAuditArguments(['--suite', 'appearance', '--run', 'one'])).toThrow('隔离端口')
    expect(
      parseAuditArguments(['--suite', 'appearance', '--run', 'one', '--port', '5181']).port,
    ).toBe(5181)
    expect(() =>
      parseAuditArguments(['--suite', 'toString', '--run', 'one', '--port', '5181']),
    ).toThrow()
  })
})
