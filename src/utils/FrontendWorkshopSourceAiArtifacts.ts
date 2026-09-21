import type { FrontendWorkshopSourceComponentDraft } from '../types/FrontendWorkshopSourceComponent'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'

/** Model drafts are proposals, never permission to save, publish, or alter the current project. */
export function readFrontendWorkshopAiComponentDraft(
  value: unknown,
  source: FrontendWorkshopSourceDocument,
): FrontendWorkshopSourceComponentDraft {
  if (!value || typeof value !== 'object') throw new Error('组件草稿需要名称和完整代码')
  const draft = value as Record<string, unknown>
  const code = draft.source as Record<string, unknown> | undefined
  if (
    typeof draft.name !== 'string' ||
    !draft.name.trim() ||
    !code ||
    typeof code.html !== 'string' ||
    !code.html.trim()
  )
    throw new Error('组件草稿缺少名称或 HTML，原作品未改变')
  for (const field of ['css', 'javascript'])
    if (code[field] !== undefined && typeof code[field] !== 'string')
      throw new Error(`组件 ${field} 应为代码文本`)
  const dependencies = draft.dependencies ?? []
  if (
    !Array.isArray(dependencies) ||
    dependencies.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        !['external-resource', 'host-api', 'component'].includes(item.kind) ||
        typeof item.specifier !== 'string' ||
        !item.specifier.trim() ||
        (item.kind === 'external-resource' && !/^https:\/\//iu.test(item.specifier)) ||
        (item.optional !== undefined && typeof item.optional !== 'boolean'),
    )
  )
    throw new Error('组件依赖格式不完整，请让 AI 补齐；素材需要 HTTPS 直链')
  const hostApis = dependencies
    .filter((item) => item.kind === 'host-api')
    .map((item) => item.specifier as string)
  const html = code.html
  const css = typeof code.css === 'string' ? code.css : ''
  const javascript = typeof code.javascript === 'string' ? code.javascript : ''
  return {
    name: draft.name,
    description: typeof draft.description === 'string' ? draft.description : '',
    source: { html, css, javascript },
    root: {
      tagName:
        new DOMParser().parseFromString(html, 'text/html').body.firstElementChild?.localName ??
        'div',
    },
    dependencies: dependencies.map(({ kind, specifier, optional }) => ({
      kind,
      specifier,
      ...(optional === undefined ? {} : { optional }),
    })),
    runtimeRequirements: {
      hostProfile: 'tavern-helper-message',
      requiresJavaScript: Boolean(javascript) || /<script\b|\bon\w+\s*=/iu.test(html),
      requiresNetwork:
        dependencies.some((item) => item.kind === 'external-resource') ||
        /https:\/\//iu.test(html + css + javascript),
      hostApis,
    },
    provenance: { origin: 'ai', projectId: source.projectId, sourceRevision: source.revision },
    sharePolicy: { license: 'private', allowShare: false },
    projectIds: [source.projectId],
  }
}

export const FRONTEND_WORKSHOP_AI_ORGANIZE_PROMPT = [
  '编辑器工具合同：工作模式可以整理图层或提取可复用组件；依据用户本轮真实意图和上下文判断，不按某个关键词强制执行。目标不明确时先用 summary 询问具体区域，edits=[]；方案/问答模式不执行这两类工具。',
  '图层：新建或大幅重做作品时，按用户会一起修改的内容适度分组。仅在已有合适根元素上使用 data-fw-layer="稳定英文数字短横线标识" 和 data-fw-layer-name="中文组名"；同组多个根可共用标识，允许嵌套子组。不要为分组强加容器、改布局或增加脚本。简单作品少分组。用户改名和既有稳定标识优先保留；局部改稿仅维护涉及的组，不重排其他内容。动态生成的根元素可在生成代码中带相同标记。标记只用于编辑器理解，不是酒馆 API。',
  '用户要求整理已有图层时，通过普通 edits 精确修改相关起始标签或动态元素的生成代码；未分组或无法识别的内容仍正常运行，不能因标记不足拒绝创作。隐藏/锁定由编辑器临时控制，不把调试显隐写入最终作品。跨层叠放应检查定位与层叠上下文，不承诺任意拖动都安全。',
  '用户要求把现有区域保存/提取为组件时，输出可选 componentDraft={name,description,source:{html,css,javascript},dependencies:[{kind:"external-resource"|"host-api"|"component",specifier,optional?}]}，edits=[]。源作品保持原样；完整源代码和对话是提取依据。明确区域后才交付草稿，不能把整页复制冒充局部提取。',
  '组件必须收集必要的局部和共享样式、CSS变量、字体、脚本、资源及宿主依赖；隔离通用选择器、全局变量和重复监听，保留交互及响应式，不依赖原页面独有祖先或节点。需要后台脚本时保留既有惰性配套脚本格式并说明安装条件。依赖真实接口但缺资料时先请求 hostReferenceRequests，不生成虚构接口。用户要求头像/文字占位时用可替换的普通 HTML/CSS/SVG 占位，不能编造图片直链。',
  'componentDraft 将展示独立预览，由用户确认名称和保存后进入现有组件库。AI 不得声称已保存、已发布或已验证真实酒馆。后续修改这份草稿时返回完整新版 componentDraft，仍保持 edits=[]；缺失依赖和未验证条件写在 summary/warnings。无需 MCP 或模拟宿主工具。',
  'dependencies 只记录实际依赖；没有外部依赖时填 []。external-resource 的 specifier 必须是实际 HTTPS 素材/库地址；host-api 填真实接口名；component 填实际组件标识。本地字体栈、CSS 变量、原生 DOM 和说明文字不是 external-resource，说明应放 description/warnings。示例：dependencies:[{kind:"external-resource",specifier:"https://example.com/avatar.png"},{kind:"host-api",specifier:"getChatMessages"}]。',
].join('\n')
