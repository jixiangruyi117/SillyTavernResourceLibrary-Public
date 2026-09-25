import { computeWorkerPool } from '../core/ComputeWorkerPool'
import createDOMPurify from 'dompurify'
import { parse, stringify } from '@adobe/css-tools'
import { mapRenderCompatibilityViewportMinimums } from '../utils/RenderCompatibilityFrontend'
import {
  extractCharacterGreetingRegexRules,
  getCharacterGreetingRegexPreviewTimeoutMs,
  type CharacterGreetingRegexRule,
  type CharacterGreetingRegexResult,
} from '../utils/CharacterGreetingRegex'
import {
  formatSillyTavernCoreMessage,
  formatSillyTavernMessage,
} from '../utils/SillyTavernMessageFormatter'
import { isRecord } from '../utils/UnknownValue'
import { extractPreviewCss } from '../utils/PreviewSafety'
import type { ChatReadPage } from './ChatReaderService'
import type { ArchivedMessageSnapshot } from '../utils/RenderCompatibilityRuntime'
import {
  buildArchivedChatFrontendDocument,
  archivedPanelThemeCss,
} from '../utils/RichContentPreview'
import { detectVendorLibNeeds, loadPreviewVendorLibs } from '../utils/PreviewVendorLibs'

export function selectChatReply(entry: ChatReadPage['messages'][number], selected: unknown) {
  if (selected === undefined) return entry
  const replies = entry.message.swipes
  if (
    !Number.isSafeInteger(selected) ||
    !Array.isArray(replies) ||
    Number(selected) < 0 ||
    Number(selected) >= replies.length ||
    typeof replies[Number(selected)] !== 'string'
  )
    throw new Error(`第 ${entry.index + 1} 楼的备用回复不存在`)
  if (Number(selected) === (Number(entry.message.swipe_id) || 0)) return entry
  const info = Array.isArray(entry.message.swipe_info)
    ? entry.message.swipe_info[Number(selected)]
    : undefined
  const extra = isRecord(info) && isRecord(info.extra) ? info.extra : {}
  return {
    ...entry,
    message: {
      ...entry.message,
      mes: replies[Number(selected)] as string,
      swipe_id: Number(selected),
      extra,
    },
  }
}

/** Keep chat selectors and theme variables; application panels never enter the reader shadow root. */
export function chatReaderCss(source: string, theme: Record<string, unknown> = {}): string {
  const ast = parse(extractPreviewCss(source, { allowExternalResources: true }))
  const visit = (rules: NonNullable<typeof ast.stylesheet>['rules']): typeof rules =>
    rules.filter((rule) => {
      if (rule.type === 'import' || rule.type === 'charset') return false
      if ('selectors' in rule && Array.isArray(rule.selectors)) {
        const rootsOnly = rule.selectors.every((s) =>
          /^(?:html|body|:root|#bg1|#chat)$/.test(s.trim()),
        )
        rule.selectors = rule.selectors.flatMap((selector) => {
          if (/:host|::slotted/.test(selector)) return []
          if (/^(?:html|body|:root|#bg1|#chat)$/.test(selector.trim())) return ['#chat']
          const match =
            /#chat\b|\.(?:mes|mes_block|mes_text|mesAvatarWrapper|name_text|ch_name|avatar)\b/.exec(
              selector,
            )
          if (!match && /^(?:p|q|em|strong|a|img|pre|code)(?=[\s.:#[>+~]|$)/.test(selector.trim()))
            return ['#chat .mes_text ' + selector]
          return match ? [selector.slice(match.index)] : []
        })
        if (!rule.selectors.length) return false
        if (rootsOnly && 'declarations' in rule && Array.isArray(rule.declarations))
          rule.declarations = rule.declarations.filter(
            (d) =>
              'property' in d &&
              (d.property.startsWith('--') ||
                /^(?:background(?:-.+)?|font-family)$/.test(d.property)),
          )
      }
      if ('rules' in rule && Array.isArray(rule.rules)) rule.rules = visit(rule.rules)
      return true
    })
  if (ast.stylesheet) ast.stylesheet.rules = visit(ast.stylesheet.rules)
  const colors: Record<string, string> = {
    main_text_color: '--SmartThemeBodyColor',
    italics_text_color: '--SmartThemeEmColor',
    quote_text_color: '--SmartThemeQuoteColor',
    chat_tint_color: '--SmartThemeChatTintColor',
    user_mes_blur_tint_color: '--SmartThemeUserMesBlurTintColor',
    bot_mes_blur_tint_color: '--SmartThemeBotMesBlurTintColor',
    border_color: '--SmartThemeBorderColor',
  }
  const variables = Object.entries(colors).flatMap(([key, variable]) => {
    if (typeof theme[key] !== 'string' || theme[key].length > 128) return []
    const style = document.createElement('span').style
    style.color = theme[key]
    return style.color ? [`${variable}:${style.color}`] : []
  })
  const defaults = variables.length
    ? `#chat{${variables.join(';')};color:var(--SmartThemeBodyColor,inherit);background:var(--SmartThemeChatTintColor,transparent)}#chat em{color:var(--SmartThemeEmColor,inherit)}#chat q{color:var(--SmartThemeQuoteColor,inherit)}#chat .mes[is_user="true"]{background:var(--SmartThemeUserMesBlurTintColor,transparent)}#chat .mes[is_user="false"]{background:var(--SmartThemeBotMesBlurTintColor,transparent)}`
    : ''
  const css = defaults + stringify(ast)
  if (css.length > 30000) throw new Error('聊天区域 CSS 超过 30000 字符，请先精简')
  return css
}

/** Only font faces leave the reading shadow root; imported UI styles never reach APP controls. */
export async function chatReaderFonts(source: string, remote: boolean) {
  const fonts: string[] = []
  const errors: string[] = []
  const visited = new Set<string>()
  const collect = async (css: string, depth: number) => {
    const ast = parse(extractPreviewCss(css, { allowExternalResources: remote }))
    for (const rule of ast.stylesheet?.rules || []) {
      if (rule.type === 'font-face')
        fonts.push(stringify({ ...ast, stylesheet: { ...ast.stylesheet, rules: [rule] } }))
      if (rule.type !== 'import' || !remote || depth >= 2) continue
      const match =
        /(?:url\(\s*)?["'](https:\/\/[^"']+)["']/.exec(rule.import) ||
        /url\(\s*(https:\/\/[^\s)]+)\s*\)/.exec(rule.import)
      const url = match?.[1]
      if (!url || visited.has(url) || visited.size >= 4) continue
      visited.add(url)
      try {
        const { readPreviewStylesheet } = await import('../utils/PreviewResourcePreloader')
        await collect(await readPreviewStylesheet(url), depth + 1)
      } catch {
        errors.push('外部字体样式未能加载，暂用后备字体')
      }
    }
  }
  await collect(source, 0)
  return { css: fonts.join('\n').slice(0, 200_000), errors }
}

/** Undefined means missing; an explicitly saved empty object is still a snapshot. */
export function savedChatVariables(entry: ChatReadPage['messages'][number]) {
  const m = entry.message
  const swipe = Number.isSafeInteger(m.swipe_id) ? Number(m.swipe_id) : 0
  const variables = isRecord(m.variables) || Array.isArray(m.variables) ? m.variables : {}
  const data = variables[String(swipe) as keyof typeof variables]
  return isRecord(data) ? data : undefined
}

export function archivedChatSnapshot(
  entry: ChatReadPage['messages'][number],
  total: number,
): ArchivedMessageSnapshot {
  const m = entry.message
  const swipe = Number.isSafeInteger(m.swipe_id) ? Number(m.swipe_id) : 0
  const data = savedChatVariables(entry)
  return {
    message_id: entry.index,
    last_message_id: total - 1,
    name: m.name,
    role: m.is_system ? 'system' : m.is_user ? 'user' : 'assistant',
    is_hidden: Boolean(m.is_system),
    message: m.mes,
    data: isRecord(data) ? data : {},
    extra: isRecord(m.extra) ? m.extra : {},
    swipe_id: swipe,
  }
}

export async function interactiveChatFrontend(
  source: string,
  remote: boolean,
  snapshot: ArchivedMessageSnapshot,
  blendColor?: string,
  colorScheme?: 'light' | 'dark',
  panelTheme?: 'paper' | 'green' | 'night',
) {
  const libs = await loadPreviewVendorLibs(detectVendorLibNeeds(source))
  return buildArchivedChatFrontendDocument(
    source,
    { allowScripts: true, allowRemoteResources: remote },
    libs,
    snapshot,
    blendColor,
    colorScheme,
    panelTheme,
  )
}

export interface ChatRenderOptions {
  regex?: boolean
  remote?: boolean
  userName?: string
  extraRules?: unknown[]
  presetRules?: unknown[]
  regexContext?: { characterEnabled?: boolean; presetEnabled?: boolean; presetName?: string }
  ruleOverrides?: Record<string, boolean>
}
export interface ChatRenderInput {
  source: string
  rules: CharacterGreetingRegexRule[]
  context: { charName?: string; userName?: string }
}

export function chatRegexRules(card: Record<string, unknown>, options: ChatRenderOptions) {
  const data = isRecord(card.data) ? card.data : card
  const extensions = isRecord(data.extensions) ? data.extensions : {}
  const groups = [
    { scope: 'global', label: '全局', rules: options.extraRules ?? [], enabled: true },
    {
      scope: 'preset',
      label: '预设',
      rules: options.presetRules ?? [],
      enabled: options.regexContext?.presetEnabled !== false,
    },
    {
      scope: 'character',
      label: '角色卡',
      rules: Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : [],
      enabled: options.regexContext?.characterEnabled !== false,
    },
  ]
  return groups.flatMap((group) =>
    group.rules.flatMap((rule, index) => {
      if (
        !isRecord(rule) ||
        !(
          rule.markdownOnly === true ||
          rule.markdown_only === true ||
          (isRecord(rule.destination) && rule.destination.display === true)
        )
      )
        return []
      const key = `${group.scope}:${String(rule.id ?? index)}`
      const defaultEnabled = group.enabled && rule.disabled !== true && rule.enabled !== false
      const enabled =
        typeof options.ruleOverrides?.[key] === 'boolean'
          ? options.ruleOverrides[key]!
          : defaultEnabled
      return [
        {
          key,
          scope: group.scope,
          label: group.label,
          name: String(rule.scriptName || rule.script_name || rule.name || `正则 ${index + 1}`),
          enabled,
          defaultEnabled,
          rule: { ...rule, disabled: !enabled, enabled },
        },
      ]
    }),
  )
}

/** Match shared switches by rule content and scope, never by a positional ID from another chat. */
export async function chatRegexProfileRules(
  card: Record<string, unknown>,
  options: ChatRenderOptions,
  profile: Record<string, unknown> = {},
) {
  const { hashBytes } = await import('./HashService')
  const encoder = new TextEncoder()
  const result = []
  for (const { rule, ...item } of chatRegexRules(card, options)) {
    const source = Object.fromEntries(
      Object.entries(rule)
        .filter(([key]) => !['enabled', 'disabled'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    )
    const signature = item.scope + ':' + (await hashBytes(encoder.encode(JSON.stringify(source))))
    const enabled =
      typeof profile[signature] === 'boolean' ? (profile[signature] as boolean) : item.enabled
    result.push({ ...item, signature, enabled })
  }
  return result
}

export function chatRenderInput(
  entry: ChatReadPage['messages'][number],
  card: Record<string, unknown>,
  options: ChatRenderOptions,
): ChatRenderInput {
  const message = entry.message
  const extra = isRecord(message.extra) ? message.extra : {}
  let source =
    typeof extra.display_text === 'string' && extra.display_text ? extra.display_text : message.mes
  const context = { charName: message.name, userName: options.userName }
  // ST 1.18.0 only substitutes the opening during display. Never replay dynamic macros in history.
  if (entry.index === 0 && !message.is_user && !message.is_system) {
    if (options.userName)
      source = source.replace(/{{\s*user\s*}}|<USER>/gi, () => options.userName!)
    source = source.replace(/{{\s*char\s*}}|<CHAR>|<BOT>/gi, () => message.name)
  }
  const placement = message.is_user ? 1 : extra.type === 'narrator' ? 3 : 2
  const scripts = chatRegexRules(card, options).map((item) => item.rule)
  return {
    source,
    context,
    rules:
      options.regex !== false && !message.is_system
        ? extractCharacterGreetingRegexRules(scripts, {
            placement,
            depth: entry.depth,
            displayOnly: true,
          })
        : [],
  }
}

async function executeChatInputs(
  inputs: ChatRenderInput[],
): Promise<CharacterGreetingRegexResult[]> {
  if (!inputs.some((input) => input.rules.length))
    return inputs.map((input) => ({
      contents: [input.source],
      errors: [],
      matchedRuleNames: [],
      preservedBodyIndexes: [],
    }))
  if (typeof Worker === 'undefined')
    throw new Error('当前环境无法启动后台正则，请关闭显示正则后阅读')
  return computeWorkerPool.run(
    'regex-safety',
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/ChatReaderRegexWorker.ts', import.meta.url), {
          type: 'module',
        })
        const finish = () => {
          window.clearTimeout(deadline)
          worker.terminate()
        }
        const deadline = window.setTimeout(
          () => {
            finish()
            reject(new Error('显示正则超时，请关闭正则或修正规则后阅读'))
          },
          getCharacterGreetingRegexPreviewTimeoutMs(
            inputs.map((i) => i.source),
            inputs.flatMap((i) => i.rules),
          ),
        )
        worker.onmessage = (event: MessageEvent<CharacterGreetingRegexResult[]>) => {
          finish()
          resolve(event.data)
        }
        worker.onerror = () => {
          finish()
          reject(new Error('显示正则执行失败'))
        }
        worker.onmessageerror = () => {
          finish()
          reject(new Error('显示正则传输失败'))
        }
        try {
          worker.postMessage(inputs)
        } catch (error) {
          finish()
          reject(error)
        }
      }),
  )
}

// Cache only the pure regex projection; permissions, resources, media and script documents stay live.
const regexCache = new Map<string, { value: CharacterGreetingRegexResult; bytes: number }>()
const regexPending = new Map<string, Promise<CharacterGreetingRegexResult>>()
let regexCacheBytes = 0
const REGEX_CACHE_BYTES = 4 * 1024 * 1024
export async function transformChatInputs(
  inputs: ChatRenderInput[],
): Promise<CharacterGreetingRegexResult[]> {
  const keys = inputs.map((input) => JSON.stringify(input))
  const missing = [...new Set(keys.filter((key) => !regexCache.has(key) && !regexPending.has(key)))]
  if (missing.length) {
    const task = executeChatInputs(missing.map((key) => inputs[keys.indexOf(key)]!))
    missing.forEach((key, index) =>
      regexPending.set(
        key,
        task.then((values) => values[index]!).finally(() => regexPending.delete(key)),
      ),
    )
  }
  const values = await Promise.all(
    keys.map((key) => regexCache.get(key)?.value ?? regexPending.get(key)!),
  )
  const results = keys.map((key, index) => {
    const cached = regexCache.get(key)
    const value = cached?.value ?? values[index]!
    if (cached) {
      regexCache.delete(key)
      regexCache.set(key, cached)
    } else if (!value.errors.length) {
      const bytes = (key.length + JSON.stringify(value).length) * 2
      if (bytes <= REGEX_CACHE_BYTES) {
        while (
          regexCache.size &&
          (regexCacheBytes + bytes > REGEX_CACHE_BYTES || regexCache.size >= 128)
        ) {
          const oldest = regexCache.keys().next().value!
          regexCacheBytes -= regexCache.get(oldest)!.bytes
          regexCache.delete(oldest)
        }
        regexCache.set(key, { value: structuredClone(value), bytes })
        regexCacheBytes += bytes
      }
    }
    return structuredClone(value)
  })
  return results
}

/** Non-executable projection of a detected TH frontend; mounted in its own shadow root. */
function staticFrontend(
  source: string,
  remote: boolean,
  blend = false,
  panelTheme?: 'paper' | 'green' | 'night',
): string {
  const clean = createDOMPurify(window).sanitize(mapRenderCompatibilityViewportMinimums(source), {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'],
    FORBID_ATTR: ['srcdoc'],
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  const styles = [...doc.querySelectorAll('style')]
    .map((style) => {
      const css = style.textContent || ''
      style.remove()
      try {
        const ast = parse(css)
        const visit = (rules: NonNullable<typeof ast.stylesheet>['rules']): typeof rules =>
          rules.filter((rule) => {
            if (rule.type === 'import' || rule.type === 'charset') return false
            if ('selectors' in rule && Array.isArray(rule.selectors)) {
              rule.selectors = rule.selectors
                .filter((selector) => !/:host|::slotted/i.test(selector))
                .map((selector) =>
                  selector.replace(
                    /(^|[\s>+~,])(html|body|:root|#bg1|#chat)(?=$|[\s>+~.#[:])/g,
                    '$1.reader-panel-body',
                  ),
                )
              if (!rule.selectors.length) return false
            }
            if (!remote && 'declarations' in rule && Array.isArray(rule.declarations))
              rule.declarations = rule.declarations.filter(
                (declaration) =>
                  !('value' in declaration) ||
                  !/url\s*\(|image-set\s*\(|\\/i.test(declaration.value || ''),
              )
            if ('rules' in rule && Array.isArray(rule.rules)) rule.rules = visit(rule.rules)
            return true
          })
        if (ast.stylesheet) ast.stylesheet.rules = visit(ast.stylesheet.rules)
        return stringify(ast)
      } catch {
        return ''
      }
    })
    .join('\n')
  if (!remote) {
    doc.querySelectorAll('[style]').forEach((node) => {
      if (/url\s*\(|image-set\s*\(|\\/i.test(node.getAttribute('style') || ''))
        node.removeAttribute('style')
    })
    doc.querySelectorAll('img,video,audio,source,svg image').forEach((node) => {
      const url = node.getAttribute('src') || node.getAttribute('href') || ''
      if (!url.startsWith('data:')) node.remove()
      else node.removeAttribute('srcset')
    })
  }
  const body = document.createElement('div')
  for (const attr of doc.body.attributes) body.setAttribute(attr.name, attr.value)
  body.classList.add('reader-panel-body')
  body.append(...doc.body.childNodes)
  const style = document.createElement('style')
  style.textContent = `:host{display:block;contain:layout paint;isolation:isolate;--TH-viewport-height:0px;font:14px/1.6 sans-serif}*{box-sizing:border-box}img,video{max-width:100%}q::before,q::after{content:''}\n${styles}`
  if (blend)
    style.textContent +=
      '\n.reader-panel-body{background:transparent!important;color:inherit!important}'
  if (panelTheme) style.textContent += archivedPanelThemeCss(panelTheme, '.reader-panel-body')
  return style.outerHTML + body.outerHTML
}

export function formatChatResult(
  source: string,
  remote: boolean,
  blend = false,
  panelTheme?: 'paper' | 'green' | 'night',
  textOnly = false,
) {
  if (textOnly) {
    // Remove frontend/code envelopes before the formatter parses their CSS or
    // builds static panels. A template is inert: its media/scripts never mount.
    const template = document.createElement('template')
    template.innerHTML = source.replace(
      /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g,
      '\n',
    )
    template.content
      .querySelectorAll(
        'script,style,head,iframe,object,embed,svg,canvas,img,picture,video,audio,form,button,input,select,textarea,table,details,pre,div,section,article,nav,aside,header,footer,status_top,status_bottom,status_bottom1,status_bottom2,status_current_variables,updatevariable',
      )
      .forEach((element) => element.remove())
    template.content.querySelectorAll('br').forEach((element) => element.replaceWith('\n'))
    template.content.querySelectorAll('p,li,blockquote,h1,h2,h3,h4,h5,h6').forEach((element) => {
      element.prepend('\n')
      element.append('\n')
    })
    const text = (template.content.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
    const core = formatSillyTavernCoreMessage(text, { allowExternalMedia: false })
    const html = createDOMPurify(window).sanitize(core.html, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'em',
        'strong',
        'q',
        's',
        'u',
        'blockquote',
        'h1',
        'h2',
        'h3',
        'ul',
        'ol',
        'li',
      ],
      ALLOWED_ATTR: [],
    })
    return {
      html,
      frontends: [],
      frontendCount: 0,
      formatted: {
        ...core,
        html,
        frontendBlocks: [],
        frontendBlockCount: 0,
        standaloneFrontendDocument: false as const,
      },
    }
  }
  const formatted = formatSillyTavernMessage(source, { allowExternalMedia: remote })
  const template = document.createElement('template')
  template.innerHTML = formatted.html
  // The same upstream predicate as the shared formatter identifies executable frontend envelopes.
  // Preserve static panels in message order, while ordinary code blocks remain readable code.
  const frontends: string[] = []
  template.content.querySelectorAll('[data-srl-render-frontend]').forEach((node, index) => {
    const panel = document.createElement('div')
    panel.dataset.chatFrontend = String(index)
    frontends.push(staticFrontend(formatted.frontendBlocks[index] || '', remote, blend, panelTheme))
    node.replaceWith(panel)
  })
  return {
    html: template.innerHTML,
    frontends,
    frontendCount: formatted.frontendBlockCount,
    formatted,
  }
}
