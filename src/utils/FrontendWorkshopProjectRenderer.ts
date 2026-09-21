import { frontendWorkshopBehaviorRuntimeScript } from './FrontendWorkshopBehaviorRuntime'
import type {
  FrontendWorkshopLayoutViewport,
  FrontendWorkshopNode,
  FrontendWorkshopNodePlacement,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import { effectiveSceneConstraint } from './FrontendWorkshopSceneConstraint'
import { readFrontendWorkshopNodePlacement } from './FrontendWorkshopProjectGeometry'
import { safeFrontendWorkshopHotspots } from './FrontendWorkshopHotspotConflicts'

const GRID_COLUMNS = 24
const GRID_ROW_HEIGHT = 8
const VIEWPORT_WIDTHS: Record<FrontendWorkshopLayoutViewport, number> = {
  phone: 390,
  wide: 720,
}

export interface FrontendWorkshopGreetingBundle {
  firstMessage: string
  alternateGreetings: string[]
  greetings: string[]
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function readHttpsUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function safeIdentifier(value: string): string {
  return value.replaceAll(/[^a-z0-9_-]/giu, '').slice(0, 40) || 'node'
}

function readHexColor(value: string | undefined): string | undefined {
  return /^#[0-9a-f]{6}$/iu.test(value ?? '') ? value!.toLowerCase() : undefined
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function readPlacement(
  node: FrontendWorkshopNode,
  viewport: FrontendWorkshopLayoutViewport,
  index: number,
): FrontendWorkshopNodePlacement {
  return readFrontendWorkshopNodePlacement(node, viewport, index)
}

function toGrid(value: FrontendWorkshopNodePlacement, canvasWidth: number) {
  const column = Math.min(
    GRID_COLUMNS,
    Math.max(1, Math.floor((value.x / canvasWidth) * GRID_COLUMNS) + 1),
  )
  const span = Math.min(
    GRID_COLUMNS - column + 1,
    Math.max(1, Math.round((value.width / canvasWidth) * GRID_COLUMNS)),
  )
  return {
    column,
    span,
    row: Math.max(1, Math.floor(value.y / GRID_ROW_HEIGHT) + 1),
    rows: Math.max(1, Math.ceil(value.height / GRID_ROW_HEIGHT)),
    zIndex: value.zIndex,
  }
}

function placementCss(node: FrontendWorkshopNode, index: number, zIndex?: number): string {
  if (!node.layout?.phone && !node.layout?.wide) return ''
  const phone = toGrid(readPlacement(node, 'phone', index), VIEWPORT_WIDTHS.phone)
  const wide = toGrid(readPlacement(node, 'wide', index), VIEWPORT_WIDTHS.wide)
  return [
    `--srl-col:${phone.column}`,
    `--srl-span:${phone.span}`,
    `--srl-row:${phone.row}`,
    `--srl-rows:${phone.rows}`,
    `--srl-z:${zIndex ?? phone.zIndex}`,
    `--srl-wide-col:${wide.column}`,
    `--srl-wide-span:${wide.span}`,
    `--srl-wide-row:${wide.row}`,
    `--srl-wide-rows:${wide.rows}`,
    `--srl-wide-z:${zIndex ?? wide.zIndex}`,
  ].join(';')
}

function spacingCss(
  value: FrontendWorkshopNode['style']['padding'] | FrontendWorkshopNode['style']['margin'],
  property: 'padding' | 'margin',
): string {
  if (!value) return ''
  const min = property === 'padding' ? 0 : -160
  const max = 160
  return `${property}:${clampNumber(value.top, min, max, 0)}px ${clampNumber(value.right, min, max, 0)}px ${clampNumber(value.bottom, min, max, 0)}px ${clampNumber(value.left, min, max, 0)}px`
}

function ordinaryStyleCss(node: FrontendWorkshopNode): string {
  const style = node.style
  const declarations: string[] = []
  const surface = readHexColor(style.surfaceColor)
  const text = readHexColor(style.textColor)
  const borderColor = readHexColor(style.borderColor)
  const shadowColor = readHexColor(style.shadowColor) ?? '#202a25'
  if (surface) declarations.push(`background:${surface}`)
  if (text) declarations.push(`color:${text}`)
  if (style.opacity !== undefined)
    declarations.push(`opacity:${clampNumber(style.opacity, 0, 100, 100) / 100}`)
  if (style.rotation !== undefined)
    declarations.push(`transform:rotate(${clampNumber(style.rotation, -180, 180, 0)}deg)`)
  if (style.cornerRadius !== undefined)
    declarations.push(`border-radius:${clampNumber(style.cornerRadius, 0, 999, 0)}px`)
  if (style.cornerRadii) {
    declarations.push(
      `border-radius:${clampNumber(style.cornerRadii.topLeft, 0, 999, 0)}px ${clampNumber(style.cornerRadii.topRight, 0, 999, 0)}px ${clampNumber(style.cornerRadii.bottomRight, 0, 999, 0)}px ${clampNumber(style.cornerRadii.bottomLeft, 0, 999, 0)}px`,
    )
  }
  if (style.fontSize !== undefined)
    declarations.push(`font-size:${clampNumber(style.fontSize, 8, 128, 16)}px`)
  if (style.fontWeight !== undefined)
    declarations.push(`font-weight:${clampNumber(style.fontWeight, 100, 900, 400)}`)
  if (style.letterSpacing !== undefined)
    declarations.push(`letter-spacing:${clampNumber(style.letterSpacing, -10, 30, 0)}px`)
  if (style.lineHeight !== undefined)
    declarations.push(`line-height:${clampNumber(style.lineHeight, 0.8, 3, 1.6)}`)
  if (style.align === 'center') declarations.push('text-align:center')
  else if (style.align === 'end') declarations.push('text-align:right')
  if (style.borderWidth !== undefined)
    declarations.push(`border-width:${clampNumber(style.borderWidth, 0, 20, 0)}px`)
  if (borderColor) declarations.push(`border-color:${borderColor}`)
  if (style.borderStyle && ['solid', 'dashed', 'dotted', 'double'].includes(style.borderStyle))
    declarations.push(`border-style:${style.borderStyle}`)
  if (
    style.shadowColor ||
    style.shadowOffsetX !== undefined ||
    style.shadowOffsetY !== undefined ||
    style.shadowBlur !== undefined ||
    style.shadowSpread !== undefined
  ) {
    declarations.push(
      `box-shadow:${clampNumber(style.shadowOffsetX, -64, 64, 0)}px ${clampNumber(style.shadowOffsetY, -64, 64, 8)}px ${clampNumber(style.shadowBlur, 0, 128, 24)}px ${clampNumber(style.shadowSpread, -48, 64, 0)}px ${shadowColor}`,
    )
  }
  const padding = spacingCss(style.padding, 'padding')
  const margin = spacingCss(style.margin, 'margin')
  if (padding) declarations.push(padding)
  if (margin) declarations.push(margin)
  return declarations.join(';')
}

interface RenderContext {
  rootId: string
  pageIndexById: Map<string, number>
  fieldSamplesById: Map<string, string>
  variablesById: Map<string, string | number | boolean>
}

function nodeSourceValue(node: FrontendWorkshopNode, context: RenderContext): unknown {
  if (node.contentSource?.kind === 'stateField')
    return context.fieldSamplesById.get(node.contentSource.fieldId) ?? node.text
  if (node.contentSource?.kind === 'variable')
    return context.variablesById.get(node.contentSource.variableId) ?? node.text
  return node.text
}

function nodeAttributes(
  node: FrontendWorkshopNode,
  index: number,
  depth: number,
  effectiveZIndex?: number,
): string {
  const classes = [
    'srl-greeting__node',
    `srl-greeting__node--${node.kind}`,
    depth === 0 && (node.layout?.phone || node.layout?.wide) ? 'is-positioned' : '',
    node.style.imageFit === 'contain' ? 'is-image-contain' : '',
    node.style.imageTone === 'sepia' ? 'is-image-sepia' : '',
    node.style.imageTone === 'mono' ? 'is-image-mono' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const sourceAttributes =
    node.contentSource?.kind === 'variable'
      ? ` data-srl-variable-id="${escapeHtml(node.contentSource.variableId)}"`
      : node.contentSource?.kind === 'stateField'
        ? ` data-srl-state-field-id="${escapeHtml(node.contentSource.fieldId)}"`
        : ''
  const css = [
    ordinaryStyleCss(node),
    depth === 0 ? placementCss(node, index, effectiveZIndex) : '',
  ]
    .filter(Boolean)
    .join(';')
  return `class="${classes}" data-srl-node="${escapeHtml(node.id)}"${sourceAttributes}${css ? ` style="${css}"` : ''}`
}

function renderNode(
  node: FrontendWorkshopNode,
  context: RenderContext,
  path: string,
  depth: number,
  index: number,
  effectiveZIndex?: number,
): string {
  const attributes = nodeAttributes(node, index, depth, effectiveZIndex)
  const sourceValue = nodeSourceValue(node, context)
  const text = escapeHtml(sourceValue ?? '').replaceAll('\n', '<br>')
  const children = node.children
    .filter((child) => !child.hidden)
    .map((child, childIndex) =>
      renderNode(child, context, `${path}-${childIndex}`, depth + 1, childIndex),
    )
    .join('')
  const actionHref = node.action?.kind === 'external' ? readHttpsUrl(node.action.target) : undefined
  const actionPageIndex =
    node.action?.kind === 'page' && node.action.target
      ? context.pageIndexById.get(node.action.target)
      : undefined
  const withAction = (markup: string): string => {
    if (actionHref)
      return `<a class="srl-greeting__action-shell" href="${escapeHtml(actionHref)}" rel="noopener noreferrer">${markup}</a>`
    if (actionPageIndex !== undefined)
      return `<div class="srl-greeting__action-shell" role="button" tabindex="0" data-srl-greeting-target="${actionPageIndex}" onclick="setChatMessages([{message_id:0,swipe_id:${actionPageIndex}}])">${markup}</div>`
    return markup
  }

  if (node.kind === 'block')
    return withAction(
      `<section ${attributes} aria-label="${escapeHtml(node.label)}"><div class="srl-greeting__children">${children}</div></section>`,
    )
  if (node.kind === 'text') {
    const tag =
      node.style.emphasis === 'display' ? 'h1' : node.style.emphasis === 'heading' ? 'h2' : 'p'
    return withAction(`<${tag} ${attributes}>${text || '未填写文字'}</${tag}>`)
  }
  if (node.kind === 'image') {
    const imageUrl = readHttpsUrl(node.imageUrl)
    return withAction(
      imageUrl
        ? `<figure ${attributes}><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(node.label)}"></figure>`
        : `<div ${attributes}>图片链接待填写</div>`,
    )
  }
  if (node.kind === 'divider') return `<hr ${attributes}>`
  if (node.kind === 'control') {
    const control = node.control ?? { type: 'text' as const }
    const controlValue = sourceValue ?? ''
    const variableAttributes = control.variableId
      ? ` data-srl-control="${control.type}" data-srl-variable="${escapeHtml(control.variableId)}"`
      : ` data-srl-control="${control.type}"`
    const placeholder = control.placeholder
      ? ` placeholder="${escapeHtml(control.placeholder)}"`
      : ''
    const required = control.required ? ' required' : ''
    const inputId = `${context.rootId}-${safeIdentifier(node.id)}-${safeIdentifier(path)}`
    if (control.type === 'textarea')
      return `<label ${attributes} for="${inputId}"><span>${escapeHtml(node.label)}</span><textarea id="${inputId}"${variableAttributes}${placeholder}${required}>${escapeHtml(controlValue)}</textarea></label>`
    if (control.type === 'select') {
      const options = (control.options ?? [])
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${String(controlValue) === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
        )
        .join('')
      return `<label ${attributes} for="${inputId}"><span>${escapeHtml(node.label)}</span><select id="${inputId}"${variableAttributes}${required}>${options}</select></label>`
    }
    if (control.type === 'checkbox')
      return `<label ${attributes} for="${inputId}"><input id="${inputId}" type="checkbox"${variableAttributes}${controlValue ? ' checked' : ''}${required}><span>${escapeHtml(node.label)}</span></label>`
    if (control.type === 'radio') {
      const options = (control.options ?? [])
        .map((option, optionIndex) => {
          const optionId = `${inputId}-${optionIndex}`
          return `<label for="${optionId}"><input id="${optionId}" name="${inputId}" type="radio" value="${escapeHtml(option.value)}"${variableAttributes}${String(controlValue) === option.value ? ' checked' : ''}${required}><span>${escapeHtml(option.label)}</span></label>`
        })
        .join('')
      return `<fieldset ${attributes}><legend>${escapeHtml(node.label)}</legend>${options || '<span>请添加选项</span>'}</fieldset>`
    }
    const numberAttributes =
      control.type === 'number'
        ? `${control.min !== undefined ? ` min="${control.min}"` : ''}${control.max !== undefined ? ` max="${control.max}"` : ''}${control.step !== undefined ? ` step="${control.step}"` : ''}`
        : ''
    return `<label ${attributes} for="${inputId}"><span>${escapeHtml(node.label)}</span><input id="${inputId}" type="${control.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(controlValue)}"${variableAttributes}${placeholder}${required}${numberAttributes}></label>`
  }
  return ''
}

function minimumCanvasHeight(
  nodes: FrontendWorkshopNode[],
  viewport: FrontendWorkshopLayoutViewport,
): number {
  return Math.max(
    0,
    ...nodes.map((node, index) => {
      if (!node.layout?.[viewport]) return 0
      const placement = readPlacement(node, viewport, index)
      return placement.y + placement.height + 32
    }),
  )
}

function collectNodeIds(nodes: FrontendWorkshopNode[]): Set<string> {
  const result = new Set<string>()
  const visit = (node: FrontendWorkshopNode): void => {
    result.add(node.id)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

function hasContentSourceBinding(nodes: FrontendWorkshopNode[]): boolean {
  return nodes.some(
    (node) =>
      node.contentSource?.kind === 'variable' ||
      node.contentSource?.kind === 'stateField' ||
      node.kind === 'control' ||
      hasContentSourceBinding(node.children),
  )
}

function compiledBehaviorConfig(
  project: FrontendWorkshopProject,
  nodes: FrontendWorkshopNode[],
): string {
  const nodeIds = collectNodeIds(nodes)
  const behaviors = (project.behaviors ?? [])
    .filter((behavior) => behavior.targetNodeIds.some((nodeId) => nodeIds.has(nodeId)))
    .map((behavior) => ({
      ...behavior,
      targetNodeIds: behavior.targetNodeIds.filter((nodeId) => nodeIds.has(nodeId)),
      actions: behavior.actions.map((action) =>
        action.type === 'openScreen'
          ? {
              type: action.type,
              pageIndex: project.pages.findIndex((page) => page.id === action.pageId),
            }
          : action,
      ),
    }))
    .filter((behavior) => behavior.targetNodeIds.length && behavior.actions.length)
  if (!behaviors.length && !hasContentSourceBinding(nodes)) return ''

  const stateFieldIds = new Set<string>()
  const collectStateFields = (items: FrontendWorkshopNode[]): void => {
    items.forEach((node) => {
      if (node.contentSource?.kind === 'stateField') stateFieldIds.add(node.contentSource.fieldId)
      collectStateFields(node.children)
    })
  }
  collectStateFields(nodes)
  const behaviorIds = new Set(behaviors.map((behavior) => behavior.id))
  const hotspots = safeFrontendWorkshopHotspots(project).filter(
    (hotspot) => nodeIds.has(hotspot.parentNodeId) && behaviorIds.has(hotspot.behaviorId),
  )
  return JSON.stringify({
    behaviors,
    hotspots,
    variables: project.variables ?? [],
    fields: project.fields
      .filter((field) => stateFieldIds.has(field.id))
      .map((field) => ({ id: field.id, sample: field.sample, source: field.source })),
    states: project.states ?? [],
  })
}

export function getFrontendWorkshopProjectCompatibilityIssues(
  project: FrontendWorkshopProject,
): string[] {
  const issues: string[] = []
  if (project.kind !== 'greeting') issues.push('状态栏请使用状态栏兼容编译器交付。')
  const pageIds = new Set(project.pages.map((page) => page.id))
  let visibleCount = 0
  const visit = (nodes: FrontendWorkshopNode[]): void => {
    for (const node of nodes) {
      if (!node.hidden) visibleCount += 1
      if (node.action?.kind === 'page' && (!node.action.target || !pageIds.has(node.action.target)))
        issues.push(`元素“${node.label}”指向不存在的备用开场白。`)
      if (node.kind === 'image' && node.imageUrl && !readHttpsUrl(node.imageUrl))
        issues.push(`图片“${node.label}”不是可直接显示的 HTTPS 链接。`)
      if (
        node.action?.kind === 'external' &&
        node.action.target &&
        !readHttpsUrl(node.action.target)
      )
        issues.push(`链接“${node.label}”不是 HTTPS 链接。`)
      visit(node.children)
    }
  }
  project.pages.forEach((page) => visit(page.nodes))
  if (!visibleCount) issues.push('空白开场白没有可交付内容，请先添加至少一个可见元素。')
  return Array.from(new Set(issues))
}

function storedLayoutCss(nodes: FrontendWorkshopNode[], rootId: string): string {
  const rules: string[] = []
  const visit = (items: FrontendWorkshopNode[]) =>
    items.forEach((node) => {
      const escapedId = node.id.replace(
        /[^a-z0-9_-]/giu,
        (char) => `\\${char.codePointAt(0)!.toString(16)} `,
      )
      const selector = `#${rootId} [data-srl-node="${escapedId}"]`
      for (const viewport of ['phone', 'wide'] as const) {
        const css: string[] = []
        const constraint = effectiveSceneConstraint(node.constraint, viewport)
        if (constraint) {
          css.push(
            `width:${constraint.widthMode === 'fixed' ? `${clampNumber(constraint.widthValue, 1, 4096, 100)}px` : constraint.widthMode === 'percent' ? `${clampNumber(constraint.widthValue, 1, 100, 100)}%` : constraint.widthMode === 'fill' ? '100%' : 'fit-content'}`,
          )
          css.push(
            `height:${constraint.heightMode === 'fixed' ? `${clampNumber(constraint.heightValue, 1, 4096, 100)}px` : constraint.heightMode === 'fill' ? '100%' : 'fit-content'}`,
          )
          for (const [key, property] of [
            ['minWidth', 'min-width'],
            ['maxWidth', 'max-width'],
            ['minHeight', 'min-height'],
            ['maxHeight', 'max-height'],
          ] as const) {
            if (constraint[key] !== undefined)
              css.push(`${property}:${clampNumber(constraint[key], 1, 4000, 1)}px`)
          }
          if (constraint.aspectRatio)
            css.push(`aspect-ratio:${clampNumber(constraint.aspectRatio, 0.01, 100, 1)}`)
          if (constraint.anchor !== 'auto') {
            const anchor = constraint.anchor
            css.push(
              `align-self:${anchor.startsWith('top') ? 'start' : anchor.startsWith('bottom') ? 'end' : 'center'}`,
            )
            css.push(
              `justify-self:${anchor.endsWith('start') ? 'start' : anchor.endsWith('end') ? 'end' : 'center'}`,
            )
          }
          css.push(
            `translate:${clampNumber(constraint.offsetX, -120, 120, 0)}px ${clampNumber(constraint.offsetY, -120, 120, 0)}px`,
          )
        }
        const composition = node.composition
        const childCss = composition
          ? [
              `display:${composition.mode === 'stack' || composition.mode === 'row' ? 'flex' : 'grid'}`,
              `flex-direction:${composition.mode === 'row' ? 'row' : 'column'}`,
              `gap:${clampNumber(composition.gap, 0, 160, 0)}px`,
              `align-items:${['start', 'center', 'end', 'stretch'].includes(composition.align) ? composition.align : 'stretch'}`,
              `justify-content:${['start', 'center', 'end', 'space-between'].includes(composition.justify) ? composition.justify : 'start'}`,
              `grid-template-columns:repeat(${composition.mode === 'overlay' ? 1 : Math.round(clampNumber(viewport === 'wide' ? composition.wideColumns : composition.phoneColumns, 1, 4, 1))},minmax(0,1fr))`,
            ].join(';')
          : ''
        const result = `${css.length ? `${selector}{${css.join(';')}}` : ''}${childCss ? `${selector}>.srl-greeting__children{${childCss}}` : ''}${composition?.mode === 'overlay' ? `${selector}>.srl-greeting__children>*{grid-area:1/1}` : ''}`
        if (result) rules.push(viewport === 'wide' ? `@media(min-width:620px){${result}}` : result)
      }
      visit(node.children)
    })
  visit(nodes)
  return rules.join('\n')
}

export function renderFrontendWorkshopProject(
  project: FrontendWorkshopProject,
  pageId?: string,
): string {
  if (getFrontendWorkshopProjectCompatibilityIssues(project).length) return ''
  const pageIndex = pageId ? project.pages.findIndex((page) => page.id === pageId) : 0
  if (pageIndex < 0) return ''
  const page = project.pages[pageIndex]
  if (!page) return ''
  const rootId = `srl-greeting-${safeIdentifier(project.id).slice(0, 20)}-${pageIndex}`
  const context: RenderContext = {
    rootId,
    pageIndexById: new Map(project.pages.map((item, index) => [item.id, index])),
    fieldSamplesById: new Map(project.fields.map((field) => [field.id, field.sample])),
    variablesById: new Map(
      (project.variables ?? []).map((variable) => [variable.id, variable.value]),
    ),
  }
  const layers = page.layers?.length
    ? page.layers
    : [{ id: `layer-${page.id}`, visible: true, locked: false, name: '默认图层' }]
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]))
  const hiddenLayerIds = new Set(layers.filter((layer) => !layer.visible).map((layer) => layer.id))
  const visibleNodes = page.nodes
    .filter((node) => !node.hidden && (!node.layerId || !hiddenLayerIds.has(node.layerId)))
    .map((node, sourceIndex) => ({
      node,
      sourceIndex,
      layerIndex: layerOrder.get(node.layerId ?? '') ?? 0,
    }))
    .sort((left, right) => {
      if (left.layerIndex !== right.layerIndex) return left.layerIndex - right.layerIndex
      return (
        readPlacement(left.node, 'phone', left.sourceIndex).zIndex -
        readPlacement(right.node, 'phone', right.sourceIndex).zIndex
      )
    })
  const content = visibleNodes
    .map(({ node, sourceIndex, layerIndex }) =>
      renderNode(
        node,
        context,
        String(sourceIndex),
        0,
        sourceIndex,
        layerIndex * 100 + readPlacement(node, 'phone', sourceIndex).zIndex,
      ),
    )
    .join('')
  const renderedNodes = visibleNodes.map((item) => item.node)
  const phoneHeight = minimumCanvasHeight(renderedNodes, 'phone')
  const wideHeight = minimumCanvasHeight(renderedNodes, 'wide')
  const behaviorConfig = compiledBehaviorConfig(project, page.nodes)
  const configAttribute = behaviorConfig
    ? ` data-srl-behavior-config="${escapeHtml(behaviorConfig)}"`
    : ''

  return `<style>
#${rootId}{box-sizing:border-box;width:100%;max-width:100%;color:#1f2925;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei UI",system-ui,sans-serif;line-height:1.65}
#${rootId} *{box-sizing:border-box;min-width:0}
#${rootId} .srl-greeting__page{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));grid-auto-rows:${GRID_ROW_HEIGHT}px;width:100%;max-width:100%;min-height:var(--srl-phone-height);position:relative;isolation:isolate}
#${rootId} .srl-greeting__node{grid-column:1/-1;align-self:start;max-width:100%;margin:0;overflow-wrap:anywhere}
#${rootId} .srl-greeting__node.is-positioned{grid-column:var(--srl-col)/span var(--srl-span);grid-row:var(--srl-row)/span var(--srl-rows);min-height:calc(var(--srl-rows) * ${GRID_ROW_HEIGHT}px);z-index:var(--srl-z)}
#${rootId} .srl-greeting__node--block{padding:1rem;border:1px solid rgba(35,48,42,.14);background:#fffdf7}
#${rootId} .srl-greeting__children{display:grid;gap:.75rem}
#${rootId} .srl-greeting__node--image{position:relative;margin:0;overflow:hidden;background:#eef1ef}
#${rootId} .srl-greeting__node--image img{display:block;width:100%;height:100%;min-height:8rem;object-fit:cover}
#${rootId} .is-image-contain img{object-fit:contain}
#${rootId} .is-image-sepia img{filter:sepia(.78) contrast(.88) brightness(.92)}
#${rootId} .is-image-mono img{filter:grayscale(1) contrast(.9)}
#${rootId} .srl-greeting__node--divider{width:100%;margin:0;border:0;border-top:1px solid rgba(35,48,42,.18)}
#${rootId} .srl-greeting__node--control{display:grid;gap:.4rem}
#${rootId} .srl-greeting__node--control input:not([type=checkbox]):not([type=radio]),#${rootId} .srl-greeting__node--control textarea,#${rootId} .srl-greeting__node--control select{width:100%;border:1px solid rgba(35,48,42,.2);padding:.55rem;background:#fff;color:inherit;font:inherit}
#${rootId} .srl-greeting__action-shell{display:block;min-width:0;color:inherit;text-decoration:none;cursor:pointer}
@media (min-width:620px){#${rootId} .srl-greeting__page{min-height:var(--srl-wide-height)}#${rootId} .srl-greeting__node.is-positioned{grid-column:var(--srl-wide-col)/span var(--srl-wide-span);grid-row:var(--srl-wide-row)/span var(--srl-wide-rows);min-height:calc(var(--srl-wide-rows) * ${GRID_ROW_HEIGHT}px);z-index:var(--srl-wide-z)}}
${storedLayoutCss(page.nodes, rootId)}
</style><section id="${rootId}"${configAttribute}><div class="srl-greeting__page" style="--srl-phone-height:${phoneHeight}px;--srl-wide-height:${wideHeight}px">${content || '<p>空白开场白</p>'}</div></section>`
}

function hasCompiledBehavior(
  project: FrontendWorkshopProject,
  nodes: FrontendWorkshopNode[],
): boolean {
  return Boolean(compiledBehaviorConfig(project, nodes))
}

function tavernContentSourceRuntime(): string {
  return `<script data-srl-workshop-content-source-runtime="1">(()=>{const current=document.currentScript;const root=(current&&current.parentElement&&current.parentElement.querySelector('[data-srl-behavior-config]'))||document.querySelector('[data-srl-behavior-config]');if(!root)return;let config;try{config=JSON.parse(root.dataset.srlBehaviorConfig||'')}catch{return}const runtimeKey='__srlContentSourceRuntime';const previous=root[runtimeKey];if(previous&&typeof previous.cleanup==='function')previous.cleanup();let subscription,observer,disposed=false;const runtimeState={cleanup};root[runtimeKey]=runtimeState;function cleanup(){if(disposed)return;disposed=true;try{if(subscription&&typeof subscription.stop==='function')subscription.stop()}catch{}try{observer&&observer.disconnect()}catch{}root.removeEventListener('srl:variable',handleVariable);if(root[runtimeKey]===runtimeState)delete root[runtimeKey]}const fields=new Map((config.fields||[]).map((field)=>[field.id,field]));const fallback=(node,field)=>{if(field&&field.sample!==undefined)node.textContent=String(field.sample)};function handleVariable(event){const detail=event.detail||{};if(typeof detail.id!=='string')return;root.querySelectorAll('[data-srl-variable-id]').forEach((node)=>{if(node.dataset.srlVariableId===detail.id)node.textContent=detail.value===undefined?'':String(detail.value)})}root.addEventListener('srl:variable',handleVariable);if(typeof MutationObserver==='function'&&document.documentElement){observer=new MutationObserver(()=>{if(!root.isConnected)cleanup()});observer.observe(document.documentElement,{childList:true,subtree:true});if(!root.isConnected){cleanup();return}}window.addEventListener('pagehide',cleanup,{once:true});const read=(value,path)=>{if(!path||typeof path!=='string'||path.length>180)return undefined;let current=value;const parts=path.split('.');if(parts.length>15)return undefined;for(const part of parts){if(!part||part==='__proto__'||part==='constructor'||part==='prototype'||!current||typeof current!=='object'||!Object.prototype.hasOwnProperty.call(current,part))return undefined;try{current=current[part]}catch{return undefined}}return current};const refreshStateFields=async()=>{if(disposed||!root.isConnected)return;const nodes=root.querySelectorAll('[data-srl-state-field-id]');if(!nodes.length)return;try{const messageId=typeof globalThis.getCurrentMessageId==='function'?globalThis.getCurrentMessageId():undefined;const mvu=globalThis.Mvu;if(messageId===undefined||messageId===null||!mvu||typeof mvu.getMvuData!=='function')return;const data=await mvu.getMvuData({type:'message',message_id:messageId});if(disposed||!root.isConnected)return;const statData=data&&(data.stat_data!==undefined?data.stat_data:data.variables&&data.variables.stat_data);if(!statData||typeof statData!=='object')return;nodes.forEach((node)=>{const field=fields.get(node.dataset.srlStateFieldId||'');const value=field&&field.source&&field.source.provider==='mvu'?read(statData,field.source.path):undefined;if(value===undefined)fallback(node,field);else node.textContent=String(value)})}catch{}};const attachMvu=async()=>{try{const wait=globalThis.waitGlobalInitialized;if(typeof wait!=='function')return;await wait('Mvu');if(disposed||!root.isConnected)return;await refreshStateFields();if(disposed||!root.isConnected)return;const mvu=globalThis.Mvu;const event=mvu&&mvu.events&&mvu.events.VARIABLE_UPDATE_ENDED;if(event!==undefined&&typeof globalThis.eventOn==='function')subscription=globalThis.eventOn(event,()=>{void refreshStateFields()})}catch{}};if(root.querySelector('[data-srl-state-field-id]'))void attachMvu()})();</script>`
}

function wrapTavernHelperGreeting(markup: string, includeBehaviorRuntime: boolean): string {
  return `\`\`\`html\n<!doctype html><html><head><meta charset="utf-8"></head><body>${markup}${includeBehaviorRuntime ? `${frontendWorkshopBehaviorRuntimeScript()}${tavernContentSourceRuntime()}` : ''}</body></html>\n\`\`\``
}

export function renderFrontendWorkshopGreetingBundle(
  project: FrontendWorkshopProject,
): FrontendWorkshopGreetingBundle {
  if (getFrontendWorkshopProjectCompatibilityIssues(project).length)
    return { firstMessage: '', alternateGreetings: [], greetings: [] }
  const compiled = project.pages.map((page) => renderFrontendWorkshopProject(project, page.id))
  const greetings = compiled.map((markup, index) => {
    const nodes = project.pages[index]?.nodes ?? []
    const needsBehaviorRuntime = hasCompiledBehavior(project, nodes)
    return project.pages.length > 1 || needsBehaviorRuntime
      ? wrapTavernHelperGreeting(markup, needsBehaviorRuntime)
      : markup
  })
  return {
    firstMessage: greetings[0] ?? '',
    alternateGreetings: greetings.slice(1),
    greetings,
  }
}
