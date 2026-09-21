/** @vitest-environment jsdom */
/// <reference types="node" />

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { afterAll, describe, expect, it } from 'vitest'

import {
  applyCharacterGreetingRegex,
  type CharacterGreetingRegexRule,
} from './CharacterGreetingRegex'
import { buildRichContentPreview, type PreviewRuntimeScript } from './RichContentPreview'

interface PipelineStressMetric {
  scenario: string
  inputSize: number
  p95Ms: number
  maxMs: number
  wallClockMaxMs: number
  details: Record<string, number>
}

const metrics: PipelineStressMetric[] = []

function percentile95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function measureSynchronousCpuMs(run: () => void): { cpuMs: number; wallClockMs: number } {
  const cpuStartedAt = process.cpuUsage()
  const wallStartedAt = performance.now()
  run()
  const cpuUsage = process.cpuUsage(cpuStartedAt)
  return {
    cpuMs: (cpuUsage.user + cpuUsage.system) / 1_000,
    wallClockMs: performance.now() - wallStartedAt,
  }
}

describe('开场白渲染管线压力回归', () => {
  afterAll(async () => {
    const evidencePath = process.env.SRL_RENDER_STRESS_EVIDENCE_PATH
    if (!evidencePath) return
    await mkdir(path.dirname(evidencePath), { recursive: true })
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          environment: 'Vitest + jsdom，结构回归与诊断计时；200ms 长任务门禁由 Chromium 审计执行',
          threshold: { chromiumMaxLongTaskMs: 200 },
          metrics,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  })

  it('13 条长开场白经过 32 条显示正则时保持在单任务预算内', () => {
    const rules: CharacterGreetingRegexRule[] = Array.from({ length: 32 }, (_, index) => ({
      id: `rule-${index}`,
      name: `显示正则 ${index}`,
      find: `/TOKEN_${String(index).padStart(2, '0')}/g`,
      replace: `替换_${index}`,
    }))
    const tokens = rules.map((_, index) => `TOKEN_${String(index).padStart(2, '0')}`).join('|')
    const contents = Array.from(
      { length: 13 },
      (_, index) => `开场白 ${index}\n${tokens}\n${'长正文内容。'.repeat(4_000)}`,
    )

    applyCharacterGreetingRegex(contents, rules, { charName: '审计角色', userName: '测试用户' })
    const wallClockDurations: number[] = []
    const durations = Array.from({ length: 12 }, () => {
      let result = applyCharacterGreetingRegex(contents, rules, {
        charName: '审计角色',
        userName: '测试用户',
      })
      const measurement = measureSynchronousCpuMs(() => {
        result = applyCharacterGreetingRegex(contents, rules, {
          charName: '审计角色',
          userName: '测试用户',
        })
      })
      wallClockDurations.push(measurement.wallClockMs)
      expect(result.contents).toHaveLength(13)
      expect(result.matchedRuleNames).toHaveLength(32)
      expect(result.errors).toEqual([])
      return measurement.cpuMs
    })
    const p95Ms = percentile95(durations)
    const maxMs = Math.max(...durations)

    expect(maxMs).toBeLessThanOrEqual(200)
    metrics.push({
      scenario: '13 greetings × 32 display regexes',
      inputSize: contents.reduce((total, item) => total + item.length, 0),
      p95Ms: rounded(p95Ms),
      maxMs: rounded(maxMs),
      wallClockMaxMs: rounded(Math.max(...wallClockDurations)),
      details: { greetings: contents.length, regexRules: rules.length },
    })
  })

  it('长正文与 8 个助手前端 iframe 可一次构建且保留结构', () => {
    const prose = Array.from(
      { length: 500 },
      (_, index) => `第 ${index} 段：${'移动端长正文与状态记录。'.repeat(12)}`,
    ).join('\n\n')
    const frontendBlocks = Array.from(
      { length: 8 },
      (_, index) =>
        `\`\`\`html\n<!doctype html><html><head><style>body{margin:0}.panel-${index}{padding:12px}</style></head><body><section class="panel-${index}">前端块 ${index}</section></body></html>\n\`\`\``,
    )
    const source = `${prose}\n\n${frontendBlocks.join('\n\n前端块之间的正文仍应保留。\n\n')}\n\n最终正文标记。`
    const runtimeScripts: PreviewRuntimeScript[] = Array.from({ length: 16 }, (_, index) => ({
      id: `script-${String(index).padStart(2, '0')}`,
      name: `助手脚本 ${index}`,
      source: 'character',
      content: `document.body.dataset.script${index} = "ready"`,
    }))
    const build = () =>
      buildRichContentPreview(
        source,
        '压力测试开场白',
        { allowRemoteResources: false, allowScripts: true },
        runtimeScripts,
        { renderShell: 'content', sourceKind: 'openingArchive' },
      )

    build()
    const durations: number[] = []
    const wallClockDurations: number[] = []
    let finalResult = build()
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const measurement = measureSynchronousCpuMs(() => {
        finalResult = build()
      })
      durations.push(measurement.cpuMs)
      wallClockDurations.push(measurement.wallClockMs)
    }
    const p95Ms = percentile95(durations)
    const maxMs = Math.max(...durations)
    const iframeCount = finalResult.document.match(/id="TH-message--0--\d+"/g)?.length ?? 0

    expect(finalResult.hasRichContent).toBe(true)
    expect(finalResult.runtimeScriptCount).toBe(16)
    expect(iframeCount).toBe(8)
    expect(finalResult.document).toContain('最终正文标记')
    expect(finalResult.document).toContain('document.body.dataset.script0')
    metrics.push({
      scenario: 'long prose + TavernHelper frames',
      inputSize: source.length,
      p95Ms: rounded(p95Ms),
      maxMs: rounded(maxMs),
      wallClockMaxMs: rounded(Math.max(...wallClockDurations)),
      details: {
        proseParagraphs: 500,
        helperIframes: iframeCount,
        runtimeScripts: finalResult.runtimeScriptCount,
      },
    })
  }, 15_000)
})
