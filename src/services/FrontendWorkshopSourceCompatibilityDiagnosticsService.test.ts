import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { diagnoseFrontendWorkshopSourceCompatibility } from './FrontendWorkshopSourceCompatibilityDiagnosticsService'

describe('FrontendWorkshopSourceCompatibilityDiagnosticsService', () => {
  it('按当前 authoritative Source revision 汇总 S10 静态与真实 Runtime 证据', () => {
    const source = createFrontendWorkshopSourceDocument(
      'project',
      `<style>.panel { position: fixed; min-width: 720px; }</style>
<script>
window.sharedState = {};
document.querySelector('.panel');
addEventListener('resize', render);
setInterval(render, 1000);
Mvu.getMvuData();
TavernHelper.getChatMessages('0');
fetch('https://cdn.example.com/data.json');
</script>`,
      100,
    )
    const report = diagnoseFrontendWorkshopSourceCompatibility(source, {
      runtimeErrors: [{ kind: 'script', message: 'render is not defined' }],
      runtimeDiagnostics: [
        {
          capability: 'mvu-opening',
          implementationStatus: 'PARTIAL',
          parityStatus: 'UNVERIFIED',
          source: 'runtime',
          callCount: 1,
          impact: '只支持有限 opening subset',
        },
      ],
    })

    expect(report).toMatchObject({ projectId: 'project', sourceRevision: 1, sourceCreatedAt: 100 })
    expect(new Set(report.findings.map((finding) => finding.category))).toEqual(
      new Set([
        'host-api',
        'multi-instance',
        'global-selector',
        'viewport',
        'rerender-cleanup',
        'mobile-overflow',
        'external-resource',
        'lifecycle',
        'mvu-optionality',
        'runtime',
      ]),
    )
    expect(report.counts.error).toBe(1)
    expect(report.findings.find((finding) => finding.category === 'mobile-overflow')).toMatchObject(
      {
        sourceRange: expect.objectContaining({
          start: expect.any(Number),
          end: expect.any(Number),
        }),
      },
    )
  })

  it('不会把带清理和 optional guard 的局部实现误报成生命周期缺口', () => {
    const source = createFrontendWorkshopSourceDocument(
      'project',
      `<div class="panel">ok</div><script>
const root = document.currentScript?.closest('.panel');
const listener = () => {};
root?.addEventListener('click', listener);
root?.removeEventListener('click', listener);
const timer = setInterval(listener, 1000);
clearInterval(timer);
if (typeof Mvu !== 'undefined') Mvu.getMvuData();
</script>`,
      100,
    )

    const report = diagnoseFrontendWorkshopSourceCompatibility(source)
    expect(report.findings.map((finding) => finding.category)).not.toContain('rerender-cleanup')
    expect(report.findings.map((finding) => finding.category)).not.toContain('lifecycle')
    expect(report.findings.map((finding) => finding.category)).not.toContain('mvu-optionality')
    expect(report.counts.error).toBe(0)
  })

  it('把 tolerant segmentation 的 unknown slice 作为精确编辑 fail-closed 提示', () => {
    const source = createFrontendWorkshopSourceDocument('project', '<div title="broken></div>', 100)
    const report = diagnoseFrontendWorkshopSourceCompatibility(source)

    expect(report.findings).toContainEqual(
      expect.objectContaining({ category: 'syntax', severity: 'info' }),
    )
    expect(report.counts.error).toBe(0)
  })

  it('明确提示相对资源、相对模块与 opaque sandbox 跨 frame 访问风险', () => {
    const source = createFrontendWorkshopSourceDocument(
      'project',
      `<img src="./asset.png">
<link rel="stylesheet" href="/theme.css">
<script type="module">
import('./feature.js');
fetch('../data.json');
window.parent.document.querySelector('#chat');
top.location.href;
</script>`,
      100,
    )

    const report = diagnoseFrontendWorkshopSourceCompatibility(source)
    const titles = report.findings.map((finding) => finding.title)

    expect(titles).toContain('使用相对或根相对资源 URL')
    expect(titles).toContain('使用相对模块导入')
    expect(titles).toContain('直接访问父级 / 顶层窗口')
    expect(
      report.findings.find((finding) => finding.title === '使用相对或根相对资源 URL'),
    ).toMatchObject({ category: 'external-resource', severity: 'warning' })
    expect(
      report.findings.find((finding) => finding.title === '直接访问父级 / 顶层窗口'),
    ).toMatchObject({ category: 'external-host', severity: 'warning' })
  })

  it('把已复现的 100vh/100dvh auto-height feedback 与普通 viewport 警告区分开', () => {
    const source = createFrontendWorkshopSourceDocument(
      'project',
      '<style>.page{min-height:100vh}.dialog{height:100dvh}</style>',
      100,
    )

    const report = diagnoseFrontendWorkshopSourceCompatibility(source)
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        category: 'viewport',
        severity: 'warning',
        title: '100vh / 100dvh 可能触发自动高度反馈',
      }),
    )
  })

  it('允许仅通过 postMessage 与父 frame 通信而不误报直接读取', () => {
    const source = createFrontendWorkshopSourceDocument(
      'project',
      '<script>window.parent.postMessage({ type: "ping" }, "*"); parent.postMessage("pong", "*")</script>',
      100,
    )

    const report = diagnoseFrontendWorkshopSourceCompatibility(source)
    expect(report.findings.map((finding) => finding.title)).not.toContain('直接访问父级 / 顶层窗口')
  })
})
