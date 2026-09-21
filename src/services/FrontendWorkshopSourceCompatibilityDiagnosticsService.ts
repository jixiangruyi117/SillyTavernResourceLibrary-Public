import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { segmentFrontendWorkshopAuthorSource } from '../utils/FrontendWorkshopSourceHtmlSegmentation'
import type { FrontendWorkshopSourceRange } from '../utils/FrontendWorkshopSourceAnalysis'
import type { RenderCompatibilityDiagnostic } from '../utils/RenderCompatibilityRuntime'

export type FrontendWorkshopSourceCompatibilityCategory =
  | 'syntax'
  | 'host-api'
  | 'multi-instance'
  | 'global-selector'
  | 'viewport'
  | 'rerender-cleanup'
  | 'mobile-overflow'
  | 'external-resource'
  | 'external-host'
  | 'module-build'
  | 'lifecycle'
  | 'mvu-optionality'
  | 'runtime'
export type FrontendWorkshopSourceCompatibilitySeverity = 'error' | 'warning' | 'info'
export interface FrontendWorkshopSourceCompatibilityFinding {
  id: string
  category: FrontendWorkshopSourceCompatibilityCategory
  severity: FrontendWorkshopSourceCompatibilitySeverity
  title: string
  message: string
  sourceRange?: FrontendWorkshopSourceRange
}
export interface FrontendWorkshopSourceRuntimeErrorEvidence {
  kind: string
  message: string
}
export interface FrontendWorkshopSourceCompatibilityReport {
  projectId: string
  sourceRevision: number
  sourceCreatedAt: number
  findings: readonly FrontendWorkshopSourceCompatibilityFinding[]
  counts: Readonly<Record<FrontendWorkshopSourceCompatibilitySeverity, number>>
}
export interface FrontendWorkshopSourceRuntimeFixIntent {
  projectId: string
  sourceRevision: number
  sourceCreatedAt: number
  runtimeError: FrontendWorkshopSourceRuntimeErrorEvidence
  diagnostics: readonly FrontendWorkshopSourceCompatibilityFinding[]
}
export interface FrontendWorkshopSourceCompatibilityInput {
  runtimeDiagnostics?: readonly RenderCompatibilityDiagnostic[]
  runtimeErrors?: readonly FrontendWorkshopSourceRuntimeErrorEvidence[]
}
interface PatternCheck {
  category: FrontendWorkshopSourceCompatibilityCategory
  severity: FrontendWorkshopSourceCompatibilitySeverity
  title: string
  message: string
  pattern: RegExp
}

const PATTERN_CHECKS: readonly PatternCheck[] = [
  {
    category: 'host-api',
    severity: 'info',
    title: '使用宿主 API',
    message:
      '这段代码依赖 SillyTavern / TavernHelper 宿主能力，修复前需要匹配当前 Host Reference。',
    pattern: /\b(?:SillyTavern|TavernHelper)\s*\./gu,
  },
  {
    category: 'multi-instance',
    severity: 'warning',
    title: '可能污染多实例全局状态',
    message:
      '直接写入 window / globalThis 可能让多个预览实例相互覆盖，请改为实例内状态或带命名空间的受控生命周期。',
    pattern: /\b(?:window|globalThis)\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/gu,
  },
  {
    category: 'global-selector',
    severity: 'warning',
    title: '使用全局 DOM selector',
    message: '全局查询可能命中其它消息或预览实例；应从当前组件或当前消息根节点开始查询。',
    pattern: /\bdocument\s*\.\s*(?:querySelector(?:All)?|getElementById)\s*\(/gu,
  },
  {
    category: 'viewport',
    severity: 'warning',
    title: '使用 fixed / viewport 尺寸',
    message: 'fixed、vw 或 vh 可能越过消息容器和移动端 Safe Area，需要真实视口检查。',
    pattern: /(?:position\s*:\s*fixed\b|\b100(?:d|s|l)?v[wh]\b)/giu,
  },
  {
    category: 'viewport',
    severity: 'warning',
    title: '100vh / 100dvh 可能触发自动高度反馈',
    message:
      '当前消息预览会根据内容自动调整 iframe 高度；已在 Chromium、WebKit 与 TavernHelper 4.9.3 对照中观察到 100vh/100dvh 与 auto-height 形成正反馈。Source 不会被自动改写，请避免把整页高度直接绑定到 100vh/100dvh，或在真实宿主中复核布局。',
    pattern: /\b100(?:d)?vh\b/giu,
  },
  {
    category: 'external-resource',
    severity: 'info',
    title: '依赖外部资源',
    message: '外部 URL 会受网络策略、CORS、CSP 与离线模式影响。',
    pattern: /https?:\/\/[^\s"'<>]+/giu,
  },
  {
    category: 'external-resource',
    severity: 'warning',
    title: '使用相对或根相对资源 URL',
    message:
      '相对/根相对 URL 会按 Preview 的 srcdoc/opaque-origin/base 环境解析，可能与真实 TavernHelper 的 Blob/base 行为不同；当前不做静默重写，交付前需要真实宿主对照。',
    pattern:
      /\b(?:src|href)\s*=\s*["'](?:\.{1,2}\/|\/(?!\/))|\bfetch\s*\(\s*["'](?:\.{1,2}\/|\/(?!\/))/giu,
  },
  {
    category: 'external-resource',
    severity: 'warning',
    title: '使用相对模块导入',
    message:
      '相对/根相对模块导入依赖当前文档 URL 与 origin；SRL Preview 与真实 TavernHelper 的解析基址仍需逐项宿主验证，不会自动送入 Browser Source Compiler。',
    pattern:
      /\bimport\s*(?:\(\s*["'](?:\.{1,2}\/|\/(?!\/))|[^;\n]*?\bfrom\s*["'](?:\.{1,2}\/|\/(?!\/)))/giu,
  },
  {
    category: 'external-host',
    severity: 'warning',
    title: '直接访问父级 / 顶层窗口',
    message:
      'Source Preview 运行在 opaque sandbox 中；直接读取 parent/top/opener 的属性可能触发跨源 SecurityError。宿主能力应通过现有 SillyTavern/TavernHelper 受控 adapter 获取，而不是直接读取父页面 DOM、location 或自定义全局。',
    pattern:
      /\b(?:(?:window\s*\.\s*)?(?:parent|top|opener))\s*\.\s*(?!postMessage\b)[A-Za-z_$][\w$]*/giu,
  },
  {
    category: 'external-host',
    severity: 'error',
    title: '需要 Node / 后端宿主',
    message:
      '检测到 Node、SSR、数据库、Electron 或服务端能力；TavernHelper message frontend 不能在浏览器 Preview 中伪造这些能力。',
    pattern:
      /(?:\b(?:import\s+.+?\s+from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:fs|path|net|child_process)(?:\/[^'"]*)?['"]|\b(?:process\.versions\.node|__dirname|__filename|next\/server|electron|prisma|mongoose)\b)/giu,
  },
  {
    category: 'external-host',
    severity: 'error',
    title: '需要 Service Worker 宿主',
    message: 'Service Worker 强依赖不能直接作为 TavernHelper message frontend 运行。',
    pattern: /\bnavigator\.serviceWorker\b|\bServiceWorkerRegistration\b/gu,
  },
  {
    category: 'external-host',
    severity: 'warning',
    title: '依赖外部 WebSocket 服务',
    message: '浏览器 WebSocket 语法可运行，但目标后端必须真实存在；Preview 不伪造服务器。',
    pattern: /\bnew\s+WebSocket\s*\(/gu,
  },
  {
    category: 'module-build',
    severity: 'info',
    title: '可能需要浏览器 Bundle',
    message:
      '检测到 TypeScript / JSX / 模块源码特征；优先复用现有 bundler/esbuild 路径生成浏览器 Source，再进入同一 Runtime。',
    pattern:
      /\binterface\s+[A-Za-z_$]|\btype\s+[A-Za-z_$][\w$]*\s*=|\bimport\s+.+\s+from\s+['"]|<[A-Z][A-Za-z0-9_$]*\s*\/?>/gu,
  },
]

function pushFinding(
  findings: FrontendWorkshopSourceCompatibilityFinding[],
  finding: Omit<FrontendWorkshopSourceCompatibilityFinding, 'id'>,
): void {
  const rangeKey = finding.sourceRange
    ? `${finding.sourceRange.start}-${finding.sourceRange.end}`
    : 'runtime'
  const id = `${finding.category}:${rangeKey}:${finding.title}`
  if (!findings.some((candidate) => candidate.id === id)) findings.push({ id, ...finding })
}
function firstRange(source: string, pattern: RegExp): FrontendWorkshopSourceRange | undefined {
  pattern.lastIndex = 0
  const match = pattern.exec(source)
  pattern.lastIndex = 0
  return match ? { start: match.index, end: match.index + match[0].length } : undefined
}
function addPatternFindings(
  source: string,
  findings: FrontendWorkshopSourceCompatibilityFinding[],
): void {
  for (const check of PATTERN_CHECKS) {
    const sourceRange = firstRange(source, check.pattern)
    if (sourceRange) pushFinding(findings, { ...check, sourceRange })
  }
}
function addCleanupFindings(
  source: string,
  findings: FrontendWorkshopSourceCompatibilityFinding[],
): void {
  const addEventRange = firstRange(source, /\baddEventListener\s*\(/gu)
  if (addEventRange && !/\bremoveEventListener\s*\(/u.test(source))
    pushFinding(findings, {
      category: 'rerender-cleanup',
      severity: 'warning',
      title: '事件监听缺少清理证据',
      message: '检测到 addEventListener，但没有对应 removeEventListener；重复渲染可能叠加监听。',
      sourceRange: addEventRange,
    })
  const intervalRange = firstRange(source, /\bsetInterval\s*\(/gu)
  if (intervalRange && !/\bclearInterval\s*\(/u.test(source))
    pushFinding(findings, {
      category: 'lifecycle',
      severity: 'warning',
      title: '定时器缺少释放证据',
      message: '检测到 setInterval，但没有 clearInterval；页面切换或重新渲染后可能继续运行。',
      sourceRange: intervalRange,
    })
  const observerRange = firstRange(source, /\b(?:MutationObserver|ResizeObserver)\s*\(/gu)
  if (observerRange && !/\.disconnect\s*\(/u.test(source))
    pushFinding(findings, {
      category: 'lifecycle',
      severity: 'warning',
      title: 'Observer 缺少释放证据',
      message: '检测到 Observer，但没有 disconnect；Runtime rebuild 后可能保留旧观察者。',
      sourceRange: observerRange,
    })
}
function addMobileOverflowFindings(
  source: string,
  findings: FrontendWorkshopSourceCompatibilityFinding[],
): void {
  const pattern = /\b(?:min-)?width\s*:\s*(\d{3,})px\b/giu
  for (const match of source.matchAll(pattern)) {
    if (Number(match[1]) <= 430 || match.index === undefined) continue
    pushFinding(findings, {
      category: 'mobile-overflow',
      severity: 'warning',
      title: '固定宽度可能造成移动端横向溢出',
      message: `检测到 ${match[1]}px 宽度，超过本阶段最大移动验收宽度 430px。`,
      sourceRange: { start: match.index, end: match.index + match[0].length },
    })
  }
}
function addMvuOptionalityFinding(
  source: string,
  findings: FrontendWorkshopSourceCompatibilityFinding[],
): void {
  const range = firstRange(source, /\b(?:Mvu|MvuData)\s*(?:\.|\()/gu)
  if (!range) return
  const guarded =
    /typeof\s+(?:window\s*\.\s*)?(?:Mvu|MvuData)\b/u.test(source) ||
    /(?:window\s*\.\s*)?(?:Mvu|MvuData)\s*\?/u.test(source)
  if (!guarded)
    pushFinding(findings, {
      category: 'mvu-optionality',
      severity: 'warning',
      title: 'MVU 被当作必需 Runtime',
      message: 'MVU 在交付环境中是可选能力；调用前必须检测可用性，并为缺失情况保留正常内容。',
      sourceRange: range,
    })
}
function addSyntaxFindings(
  source: FrontendWorkshopSourceDocument,
  findings: FrontendWorkshopSourceCompatibilityFinding[],
): void {
  const segmentation = segmentFrontendWorkshopAuthorSource(source.authorSource)
  for (const unknown of segmentation.unknownSlices)
    pushFinding(findings, {
      category: 'syntax',
      severity: 'info',
      title: 'Source 含 Analyzer 未识别结构',
      message: `检测到 ${unknown.reason}；Analyzer 不会因此禁止 Runtime 执行，精确结构化修改应保持 fail closed。`,
      sourceRange: { ...unknown.range },
    })
}
function addRuntimeEvidence(
  input: FrontendWorkshopSourceCompatibilityInput,
  findings: FrontendWorkshopSourceCompatibilityFinding[],
): void {
  for (const error of input.runtimeErrors ?? []) {
    const message = error.message.trim()
    if (message)
      pushFinding(findings, {
        category: 'runtime',
        severity: 'error',
        title: `Runtime 错误：${error.kind || 'error'}`,
        message,
      })
  }
  for (const diagnostic of input.runtimeDiagnostics ?? []) {
    if (
      diagnostic.implementationStatus === 'IMPLEMENTED' &&
      diagnostic.parityStatus === 'VERIFIED' &&
      !diagnostic.failureReason
    )
      continue
    pushFinding(findings, {
      category: diagnostic.capability.toLowerCase().includes('mvu') ? 'mvu-optionality' : 'runtime',
      severity: diagnostic.failureReason ? 'warning' : 'info',
      title: `Runtime 能力：${diagnostic.capability}`,
      message:
        diagnostic.failureReason ||
        diagnostic.impact ||
        `${diagnostic.implementationStatus} / ${diagnostic.parityStatus}`,
    })
  }
}
export function diagnoseFrontendWorkshopSourceCompatibility(
  source: FrontendWorkshopSourceDocument,
  input: FrontendWorkshopSourceCompatibilityInput = {},
): FrontendWorkshopSourceCompatibilityReport {
  const findings: FrontendWorkshopSourceCompatibilityFinding[] = []
  addSyntaxFindings(source, findings)
  addPatternFindings(source.authorSource, findings)
  addCleanupFindings(source.authorSource, findings)
  addMobileOverflowFindings(source.authorSource, findings)
  addMvuOptionalityFinding(source.authorSource, findings)
  addRuntimeEvidence(input, findings)
  const counts = findings.reduce(
    (value, finding) => ({ ...value, [finding.severity]: value[finding.severity] + 1 }),
    { error: 0, warning: 0, info: 0 },
  )
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    sourceCreatedAt: source.createdAt,
    findings,
    counts,
  }
}
