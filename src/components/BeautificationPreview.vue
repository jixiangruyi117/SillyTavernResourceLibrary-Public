<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import icon_sliders from '@fortawesome/fontawesome-free/svgs/solid/sliders.svg?raw'
import icon_plug_circle_exclamation from '@fortawesome/fontawesome-free/svgs/solid/plug-circle-exclamation.svg?raw'
import icon_font from '@fortawesome/fontawesome-free/svgs/solid/font.svg?raw'
import icon_book_atlas from '@fortawesome/fontawesome-free/svgs/solid/book-atlas.svg?raw'
import icon_user_gear from '@fortawesome/fontawesome-free/svgs/solid/user-gear.svg?raw'
import icon_panorama from '@fortawesome/fontawesome-free/svgs/solid/panorama.svg?raw'
import icon_cubes from '@fortawesome/fontawesome-free/svgs/solid/cubes.svg?raw'
import icon_face_smile from '@fortawesome/fontawesome-free/svgs/solid/face-smile.svg?raw'
import icon_address_card from '@fortawesome/fontawesome-free/svgs/solid/address-card.svg?raw'
import icon_bars from '@fortawesome/fontawesome-free/svgs/solid/bars.svg?raw'
import icon_paper_plane from '@fortawesome/fontawesome-free/svgs/solid/paper-plane.svg?raw'
import icon_pencil from '@fortawesome/fontawesome-free/svgs/solid/pencil.svg?raw'
import icon_ellipsis from '@fortawesome/fontawesome-free/svgs/solid/ellipsis.svg?raw'
import icon_chevron_left from '@fortawesome/fontawesome-free/svgs/solid/chevron-left.svg?raw'
import icon_chevron_right from '@fortawesome/fontawesome-free/svgs/solid/chevron-right.svg?raw'
import icon_copy from '@fortawesome/fontawesome-free/svgs/solid/copy.svg?raw'
import icon_xmark from '@fortawesome/fontawesome-free/svgs/solid/xmark.svg?raw'
import icon_wand from '@fortawesome/fontawesome-free/svgs/solid/wand-magic-sparkles.svg?raw'

import srlPlaceholderSvg from '../assets/sillytavern-logo.svg?raw'
import { usePreviewPolicy } from '../composables/UsePreviewPolicy'
import { usePreviewBudget } from '../composables/UsePreviewBudget'
import { isNativePreviewAssetAvailable } from '../services/NativePreviewAsset'
import type { Resource } from '../types/Resource'
import { extractPreviewCss } from '../utils/PreviewSafety'
import { preloadPreviewDocumentResources } from '../utils/PreviewResourcePreloader'
import { isRecord } from '../utils/UnknownValue'
import { BEAUTIFICATION_PREVIEW_INTERACTION } from '../utils/BeautificationPreviewInteraction'

const props = defineProps<{ resource: Resource }>()
const SRL_PLACEHOLDER_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(srlPlaceholderSvg)}`
const NATIVE_CACHE_SWAP_WINDOW_MS = 450
const previewHost = ref<HTMLElement>()
const { previewEnabled } = usePreviewBudget('theme-preview', () => true, previewHost)

type PreviewScene = 'chat' | 'welcome' | 'startup'

const PREVIEW_SCENES: Array<{ id: PreviewScene; label: string }> = [
  { id: 'chat', label: '聊天' },
  { id: 'welcome', label: '欢迎页' },
  { id: 'startup', label: '启动' },
]

const sourceText = ref('')
const sourceError = ref('')
const isSourceLoading = ref(true)
const canRenderPreview = computed(
  () => previewEnabled.value && !isSourceLoading.value && !sourceError.value,
)
const previewScene = ref<PreviewScene>('chat')
const animationEpoch = ref(0)
const isFullscreenOpen = ref(false)
const previewDialog = ref<HTMLDialogElement>()
const fullscreenTrigger = ref<HTMLButtonElement>()
const fullscreenClose = ref<HTMLButtonElement>()
const previewWidth = ref('100%')
const previewStage = ref<HTMLElement>()
const stageWidth = ref(0)
const canvasScale = computed(() =>
  previewWidth.value === '100%' || !stageWidth.value
    ? 1
    : Math.min(1, stageWidth.value / Number.parseInt(previewWidth.value)),
)
const canvasHeight = computed(() => (previewWidth.value === '390px' ? 844 : 900))
const canvasStyle = computed(() =>
  isFullscreenOpen.value || previewWidth.value === '100%'
    ? undefined
    : {
        width: `${Number.parseInt(previewWidth.value) * canvasScale.value}px`,
        height: `${canvasHeight.value * canvasScale.value}px`,
      },
)
const frameStyle = computed(() =>
  isFullscreenOpen.value || previewWidth.value === '100%'
    ? undefined
    : {
        width: previewWidth.value,
        height: `${canvasHeight.value}px`,
        transform: `scale(${canvasScale.value})`,
      },
)
watch(previewStage, (stage, _previous, onCleanup) => {
  if (!stage || typeof ResizeObserver === 'undefined') return
  stageWidth.value = stage.clientWidth
  const observer = new ResizeObserver(([entry]) => {
    if (entry) stageWidth.value = entry.contentRect.width
  })
  observer.observe(stage)
  onCleanup(() => observer.disconnect())
})
const interactionNonce = crypto.randomUUID().replaceAll('-', '')
const isPreviewLoading = ref(true)
const previewPolicy = usePreviewPolicy()
let loadGeneration = 0
let preloadGeneration = 0
let preloadAbortController: AbortController | undefined
const preparedPreviewDocument = ref('')
const previewRevision = ref(0)
let releasePreloadedResources: (() => void) | undefined

function replacePreloadedResources(release?: () => void): void {
  const previous = releasePreloadedResources
  releasePreloadedResources = release
  if (previous && previous !== release) window.setTimeout(previous, 0)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function safeColor(value: unknown, fallback: string): string {
  const color = readString(value)
  if (!color || /[<>;{}]/.test(color)) return fallback
  if (typeof CSS !== 'undefined' && CSS.supports('color', color)) return color
  return /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i.test(color) ? color : fallback
}

function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

watch(
  () => props.resource,
  async (resource) => {
    const generation = ++loadGeneration
    isSourceLoading.value = true
    sourceText.value = ''
    sourceError.value = ''
    previewScene.value = 'chat'
    animationEpoch.value += 1
    try {
      const text = await resource.originalBlob.text()
      if (generation === loadGeneration) sourceText.value = text
    } catch {
      if (generation === loadGeneration) sourceError.value = '无法读取美化文件内容'
    } finally {
      if (generation === loadGeneration) isSourceLoading.value = false
    }
  },
  { immediate: true },
)

const theme = computed<Record<string, unknown> | undefined>(() => {
  if (!sourceText.value || !props.resource.fileName.toLocaleLowerCase().endsWith('.json')) {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(sourceText.value)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
})

const customCss = computed(() =>
  extractPreviewCss(theme.value ? readString(theme.value.custom_css) : sourceText.value, {
    allowExternalResources: previewPolicy.value.allowRemoteResources,
  }),
)
const previewKey = computed(
  () =>
    `${props.resource.id}-${sourceText.value.length}-${customCss.value.length}-${previewScene.value}-${animationEpoch.value}-${previewPolicy.value.allowRemoteResources}-${previewPolicy.value.allowScripts}`,
)

const colorEntries = computed(() => {
  const themeValue = theme.value
  const themeColors = themeValue
    ? [
        ['主文字', themeValue.main_text_color],
        ['强调文字', themeValue.italics_text_color],
        ['引用文字', themeValue.quote_text_color],
        ['面板背景', themeValue.blur_tint_color],
        ['聊天背景', themeValue.chat_tint_color],
        ['用户消息', themeValue.user_mes_blur_tint_color],
        ['角色消息', themeValue.bot_mes_blur_tint_color],
        ['边框', themeValue.border_color],
      ]
        .map(([label, value]) => ({ label: String(label), value: readString(value) }))
        .filter((item) => item.value)
    : []
  if (themeColors.length) return themeColors

  const matches = sourceText.value.match(/#[\da-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi) ?? []
  return Array.from(new Set(matches))
    .slice(0, 8)
    .map((value, index) => ({ label: `色值 ${index + 1}`, value }))
})

const hasExternalResources = computed(() => /@import\s|url\s*\(/i.test(sourceText.value))
const hasScripts = computed(() => /<script\b|\son[a-z]+\s*=|javascript\s*:/i.test(sourceText.value))
const isolatedScripts = computed(() =>
  previewPolicy.value.allowScripts
    ? Array.from(
        sourceText.value.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi),
        (match) => match[0],
      ).join('\n')
    : '',
)

function icon(svg: string): string {
  return svg.replace('<svg ', '<svg class="srl-icon" aria-hidden="true" fill="currentColor" ')
}

function buildToolbar(): string {
  const buttons = [
    ['ai-config-button', 'leftNavDrawerIcon', '生成', icon_sliders],
    ['sys-settings-button', 'API-status-top', '连接', icon_plug_circle_exclamation],
    ['advanced-formatting-button', 'advancedFormattingDrawerIcon', '格式', icon_font],
    ['WI-SP-button', 'WIDrawerIcon', '世界书', icon_book_atlas],
    ['user-settings-button', 'userSettingsDrawerIcon', '设置', icon_user_gear],
    ['backgrounds-button', 'backgrounds-drawer-toggle', '背景', icon_panorama],
    ['extensions-settings-button', 'extensionsDrawerIcon', '扩展', icon_cubes],
    ['persona-management-button', 'persona-management-icon', '人设', icon_face_smile],
    ['rightNavHolder', 'rightNavDrawerIcon', '角色', icon_address_card],
  ]
  return `<div id="top-settings-holder" role="navigation" aria-label="主题选择器兼容入口">${buttons
    .map(([drawerId, iconId, label, svg], index) => {
      const scene = DRAWER_SCENES[index]!
      const panel = panelBuilders[scene]()
        .replace('drawer-content srl-compat-panel', 'drawer-content srl-compat-panel closedDrawer')
        .replace(
          '<h2',
          `<button type="button" class="menu_button srl-close-drawer" data-close-drawer aria-label="关闭${label}面板">${icon(icon_xmark)}</button><h2`,
        )
      const panelId = panel.match(/id="([^"]+)"/)![1]
      return `<div id="${drawerId}" class="drawer"><div class="drawer-toggle drawer-header"><button id="${iconId}" class="drawer-icon closedIcon" type="button" aria-label="${label}" aria-controls="${panelId}" aria-expanded="false" title="${label}">${icon(svg!)}</button></div>${panel.replace('class="drawer-content', 'inert class="drawer-content')}</div>`
    })
    .join('')}</div>`
}

function buildComposer(): string {
  return `<div id="form_sheld"><div id="send_form" class="no-connection"><div id="nonQRFormItems"><div id="leftSendForm"><button id="options_button" class="menu_button" type="button" title="预览菜单外观" aria-label="菜单">${icon(icon_bars)}</button><button id="extensionsMenuButton" class="menu_button" type="button" title="扩展" aria-label="打开扩展面板">${icon(icon_wand)}</button></div><textarea id="send_textarea" rows="1" aria-label="预览消息输入" placeholder="输入预览文字…"></textarea><div id="rightSendForm"><button id="send_but" class="menu_button" type="button" title="仅展示发送按钮外观" aria-label="发送">${icon(icon_paper_plane)}</button></div></div></div></div>`
}

function buildFrame(content: string): string {
  return `<div id="bg1" class="srl-compat-background"></div><div id="top-bar"></div>${toolbarMarkup.value}<div id="sheld"><div id="chat">${content}</div>${buildComposer()}</div>`
}

function buildStartupScene(): string {
  return `${buildWelcomeScene()}<main id="preloader" class="srl-compat-startup"><section id="loader" class="splash-screen"><img src="${SRL_PLACEHOLDER_DATA_URL}" alt="SRL" class="splash-logo"><div id="load-spinner" aria-hidden="true">◌</div><h2 class="splash-message">正在准备兼容预览…</h2><button class="menu_button" type="button">进入预览</button></section></main>`
}

function buildWelcomeScene(): string {
  const content = `<section class="welcomePanel srl-compat-welcome"><header class="welcomeHeaderTitle"><img src="${SRL_PLACEHOLDER_DATA_URL}" alt="SRL" class="welcomeHeaderLogo"><strong class="welcomeHeaderVersionDisplay">主题兼容工作台</strong></header><div class="welcomeHeader"><h2 class="recentChatsTitle">预览档案</h2><div class="welcomeShortcuts"><button class="menu_button" type="button">新建</button><button class="menu_button" type="button">导入</button></div></div><div class="welcomeRecent"><div class="recentChatList"><article class="recentChat"><div class="avatar">苏</div><div class="recentChatInfo"><strong class="characterName">苏璃 · 雨夜重逢</strong><p class="chatMessage">窗外的雨声渐渐盖过钟摆。</p></div></article><article class="recentChat"><div class="avatar">组</div><div class="recentChatInfo"><strong class="characterName">夜航小组 · 码头</strong><p class="chatMessage">雾气沿着水面漫过来。</p></div></article></div></div></section>`
  return buildFrame(content)
}

function buildChatScene(): string {
  const messages = [
    buildMessage(0, true, '<p>雨停以后，我们沿着河边走走吧。</p>'),
    buildMessage(
      1,
      false,
      '<p><em>她合上手中的书，望向窗外。</em></p><p><q>好啊。等街灯亮起来，我们就出发。</q></p><p>窗上的雨滴慢慢滑落，远处的桥与岸边的树影一起映在水里。屋里很安静，只听得见翻动书页的声音。</p>',
    ),
    buildMessage(2, true, '<p>我会带上相机。<strong>这一次慢慢走</strong>，不必急着回去。</p>'),
    buildMessage(
      3,
      false,
      '<p><em>她点点头，把书签放回书里。</em><q>那就约好了。</q></p><blockquote>这里可以检查引用块、边框与段落间距。</blockquote><p><u>下划线</u>与 <code>行内代码</code>。</p><details><summary>展开排版样例</summary><ul><li>列表与长段落</li><li>窄屏下的换行</li></ul><pre><code>const greeting = "晚上好";</code></pre><table><thead><tr><th>地点</th><th>时间</th></tr></thead><tbody><tr><td>河岸</td><td>日落之后</td></tr></tbody></table></details>',
      true,
    ),
  ]
  return buildFrame(messages.join(''))
}

function buildMessage(id: number, isUser: boolean, content: string, last = false): string {
  const name = isUser ? '你' : '示例角色'
  // Original, local placeholder artwork; no Tavern branding or external avatar request.
  const avatar = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect width="100" height="150" fill="${isUser ? '#526b80' : '#877565'}"/><circle cx="50" cy="55" r="23" fill="#e6e1db"/><path d="M10 150V120a40 40 0 0 1 80 0v30" fill="#e6e1db"/></svg>`)}`
  const actions = `<div class="mes_buttons"><div class="mes_button extraMesButtonsHint" title="消息操作外观">${icon(icon_ellipsis)}</div><div class="extraMesButtons"><div class="mes_button mes_copy" title="复制按钮外观">${icon(icon_copy)}</div></div><div class="mes_button mes_edit" title="编辑按钮外观">${icon(icon_pencil)}</div></div>`
  const swipes = last
    ? `<div class="swipe_left" title="上一条回复外观">${icon(icon_chevron_left)}</div><div class="swipeRightBlock"><div class="swipe_right" title="下一条回复外观">${icon(icon_chevron_right)}</div><div class="swipes-counter">1/2</div></div>`
    : ''
  return `<div class="mes ${isUser ? 'user_mes' : 'bot_mes'}${last ? ' last_mes' : ''}" mesid="${id}" ch_name="${name}" is_user="${isUser}" is_system="false" bookmark_link=""><div class="mesAvatarWrapper"><div class="avatar"><img src="${avatar}" alt="${name}" /></div><div class="mesIDDisplay">#${id}</div><div class="mes_timer">${isUser ? '' : '2.4s'}</div><div class="tokenCounterDisplay">${isUser ? '18' : '96'}t</div></div><div class="mes_block"><div class="ch_name flex-container justifySpaceBetween"><div class="flex-container flex1 alignitemscenter"><div class="flex-container alignItemsBaseline"><span class="name_text">${name}</span><small class="timestamp">18:${36 + id}</small></div></div>${actions}</div><div class="mes_text">${content}</div></div>${swipes}</div>`
}

function field(label: string, control: string): string {
  const styledControl = control.replace(
    /<(textarea|select|input)(?=[ >])/g,
    '<$1 class="text_pole"',
  )
  return `<label class="srl-compat-field"><span>${label}</span>${styledControl}</label>`
}

function buildGenerationScene(): string {
  const panel = `<section id="left-nav-panel" class="drawer-content srl-compat-panel fillLeft"><h2>生成参数</h2><div id="ai_response_configuration">${field('预设', '<select id="settings_preset"><option>当前预设</option></select>')}${field('Temperature', '<input id="temp" type="range" min="0" max="2" value="1">')}${field('Top P', '<input id="top_p" type="range" min="0" max="1" value=".9">')}</div></section>`
  return panel
}

function buildConnectionScene(): string {
  const panel = `<section id="rm_api_block" class="drawer-content srl-compat-panel"><h2 id="title_api">连接配置</h2>${field('API 类型', '<select id="main_api"><option>Chat Completion</option></select>')}${field('API 地址', '<input id="custom_api_url_text" value="https://example.invalid/v1">')}<div id="online_status">预览环境未连接</div></section>`
  return panel
}

function buildFormattingScene(): string {
  const panel = `<section id="AdvancedFormatting" class="drawer-content srl-compat-panel"><h2>格式化</h2><div id="ContextSettings">${field('上下文模板', '<textarea id="context_story_string">description\npersonality\nscenario</textarea>')}</div><div id="InstructSettings">${field('指令模式', '<input id="instruct_enabled" type="checkbox" checked>')}</div></section>`
  return panel
}

function buildCharacterScene(): string {
  const panel = `<nav id="right-nav-panel" class="drawer-content srl-compat-panel fillRight"><h2>角色</h2><section id="rm_characters_block"><input id="character_search_bar" type="search" placeholder="搜索角色"><div id="rm_print_characters_block" class="srl-compat-list"><article class="character_select"><div class="avatar">苏</div><strong>苏璃</strong><span>收藏</span></article><article class="character_select"><div class="avatar">林</div><strong>林间来客</strong><span>最近</span></article></div></section></nav>`
  return panel
}

function buildPersonaScene(): string {
  const panel = `<section id="PersonaManagement" class="drawer-content srl-compat-panel"><h2>用户角色</h2><div id="persona-management-block" class="srl-compat-columns"><div id="user_avatar_block"><button class="persona-card selected" type="button" aria-pressed="true">默认人设</button><button class="persona-card" type="button" aria-pressed="false">旅行者</button></div><div class="persona_management_right_column">${field('名称', '<input id="your_name" value="用户">')}${field('描述', '<textarea id="persona_description">用于检查表单主题。</textarea>')}</div></div></section>`
  return panel
}

function buildWorldBookScene(): string {
  const panel = `<section id="WorldInfo" class="drawer-content srl-compat-panel"><h2>世界书</h2><div id="wi-holder"><div id="world_popup_entries_list" class="srl-compat-list"><article class="world_entry"><strong>港口城市</strong>${field('关键词', '<input value="码头, 港口">')}${field('内容', '<textarea>潮湿的海风穿过街道。</textarea>')}</article><article class="world_entry"><strong>隐藏条目</strong><small>停用</small></article></div></div></section>`
  return panel
}

function buildBackgroundsScene(): string {
  const panel = `<section id="Backgrounds" class="drawer-content srl-compat-panel"><h2>背景</h2>${field('搜索', '<input id="bg-filter" placeholder="搜索背景">')}<div id="bg_menu_content" class="srl-compat-gallery"><button class="bg_example selected" type="button" aria-pressed="true" data-background="linear-gradient(145deg,#173c34,#503d2d)">临海夜色</button><button class="bg_example" type="button" aria-pressed="false" data-background="linear-gradient(145deg,#dae3eb,#829aac)">冬日档案</button><button class="bg_example" type="button" aria-pressed="false" data-background="linear-gradient(145deg,#282740,#4b334e)">雨夜街道</button></div></section>`
  return panel
}

function buildExtensionsScene(): string {
  const panel = `<section id="rm_extensions_block" class="drawer-content srl-compat-panel"><h2>扩展</h2><div id="extensions_settings" class="srl-compat-list"><article class="extension_container"><strong>正则扩展</strong><span>已启用</span></article><article class="extension_container"><strong>向量扩展</strong><span>未配置</span></article></div></section>`
  return panel
}

function buildSettingsScene(): string {
  const range = (label: string, id: string, min: number, max: number, step = 1) =>
    `<label class="range-block"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"><output for="${id}"></output></label>`
  const toggle = (label: string, id: string, className: string, inverse = false) =>
    `<label class="checkbox_label"><input id="${id}" type="checkbox" data-body-class="${className}"${inverse ? ' data-inverse' : ''}><span>${label}</span></label>`
  const colors = [
    ['主文字', 'main_text_color', '--SmartThemeBodyColor'],
    ['强调文字', 'italics_text_color', '--SmartThemeEmColor'],
    ['引用文字', 'quote_text_color', '--SmartThemeQuoteColor'],
    ['下划线', 'underline_text_color', '--SmartThemeUnderlineColor'],
    ['面板背景', 'blur_tint_color', '--SmartThemeBlurTintColor'],
    ['聊天背景', 'chat_tint_color', '--SmartThemeChatTintColor'],
    ['用户消息', 'user_mes_blur_tint_color', '--SmartThemeUserMesBlurTintColor'],
    ['角色消息', 'bot_mes_blur_tint_color', '--SmartThemeBotMesBlurTintColor'],
    ['边框', 'border_color', '--SmartThemeBorderColor'],
    ['阴影', 'shadow_color', '--SmartThemeShadowColor'],
  ]
    .map(
      ([label, id, variable]) =>
        `<label class="srl-color-row"><span>${label}</span><input type="color" id="${id}" data-theme-color="${variable}" aria-label="${label}" value="#171717"></label>`,
    )
    .join('')
  const panel = `<section id="user-settings-block" class="drawer-content srl-compat-panel"><h2>用户设置</h2><div id="user-settings-block-content">
    <div id="UI-Theme-Block"><h4>UI 主题</h4>${field('主题', '<select id="themes"><option>当前主题</option></select>')}
    ${field('头像样式', '<select id="avatar_style"><option value="0">圆形</option><option value="2">方形</option><option value="3">圆角</option><option value="1">长方形</option></select>')}
    ${field('聊天风格', '<select id="chat_display"><option value="0">扁平</option><option value="1">气泡</option><option value="2">文档</option></select>')}
    <h4>布局与效果</h4><div class="srl-range-grid">${range('页面宽度', 'chat_width', 25, 100)}${range('字体比例', 'font_scale', 0.5, 1.5, 0.05)}${range('模糊强度', 'blur_strength', 0, 30)}${range('文本阴影宽度', 'shadow_width', 0, 5)}</div>
    ${toggle('禁用模糊效果', 'fast_ui_mode', 'no-blur')}${toggle('禁用文本阴影', 'noShadows', 'noShadows')}</div>
    <div><h4>主题颜色</h4>${colors}</div>
    <div><h4>聊天 / 消息显示</h4>${toggle('显示时间戳', 'timestamps_enabled', 'no-timestamps', true)}${toggle('显示生成用时', 'timer_enabled', 'no-timer', true)}${toggle('显示消息编号', 'mesIDDisplay_enabled', 'no-mesIDDisplay', true)}${toggle('显示 Token 数量', 'message_token_count_enabled', 'no-tokenCount', true)}${toggle('隐藏聊天头像', 'hideChatAvatars_enabled', 'hideChatAvatars')}${toggle('展开消息操作', 'expand_message_actions', 'expandMessageActions')}
    <h4>排版样例</h4><p class="srl-type-sample">普通文字<br><em>强调文字</em><br><q>“对话与引用”</q><br><u>下划线文字</u></p><small>仅试调当前画布，点击“还原主题”可恢复资源原样。</small></div></div></section>`
  return panel
}

type DrawerScene =
  | 'generation'
  | 'connection'
  | 'formatting'
  | 'characters'
  | 'persona'
  | 'worldBook'
  | 'backgrounds'
  | 'extensions'
  | 'settings'
const DRAWER_SCENES: DrawerScene[] = [
  'generation',
  'connection',
  'formatting',
  'worldBook',
  'settings',
  'backgrounds',
  'extensions',
  'persona',
  'characters',
]
const panelBuilders: Record<DrawerScene, () => string> = {
  generation: buildGenerationScene,
  connection: buildConnectionScene,
  formatting: buildFormattingScene,
  characters: buildCharacterScene,
  persona: buildPersonaScene,
  worldBook: buildWorldBookScene,
  backgrounds: buildBackgroundsScene,
  extensions: buildExtensionsScene,
  settings: buildSettingsScene,
}

function buildCompatibilityStyles(themeValue: Record<string, unknown>): string {
  const mainText = safeColor(themeValue.main_text_color, 'rgb(220,220,210)')
  const emphasis = safeColor(themeValue.italics_text_color, 'rgb(145,145,145)')
  const underline = safeColor(themeValue.underline_text_color, 'rgb(188,231,207)')
  const quoteText = safeColor(themeValue.quote_text_color, 'rgb(225,138,36)')
  const panel = safeColor(themeValue.blur_tint_color, 'rgb(23,23,23)')
  const chat = safeColor(themeValue.chat_tint_color, 'rgb(23,23,23)')
  const userMessage = safeColor(themeValue.user_mes_blur_tint_color, 'rgba(0,0,0,.3)')
  const assistantMessage = safeColor(themeValue.bot_mes_blur_tint_color, 'rgba(60,60,60,.3)')
  const border = safeColor(themeValue.border_color, 'rgba(0,0,0,.5)')
  const shadow = safeColor(themeValue.shadow_color, 'rgba(0,0,0,.5)')
  const blurStrength = safeNumber(themeValue.blur_strength, 10, 0, 30)
  const shadowWidth = safeNumber(themeValue.shadow_width, 2, 0, 5)
  const fontScale = safeNumber(themeValue.font_scale, 1, 0.5, 1.5)
  const chatWidth = safeNumber(themeValue.chat_width, 50, 25, 100)

  // Compatibility names and geometry target the installed ST 1.18.0 host (ce8554dff).
  // Keep this scoped to the theme iframe; author CSS follows this base and can override it.
  return `:root{--SmartThemeBodyColor:${mainText};--SmartThemeEmColor:${emphasis};--SmartThemeUnderlineColor:${underline};--SmartThemeQuoteColor:${quoteText};--SmartThemeBlurTintColor:${panel};--SmartThemeChatTintColor:${chat};--SmartThemeUserMesBlurTintColor:${userMessage};--SmartThemeBotMesBlurTintColor:${assistantMessage};--SmartThemeBorderColor:${border};--SmartThemeShadowColor:${shadow};--blurStrength:${blurStrength};--shadowWidth:${shadowWidth};--SmartThemeBlurStrength:calc(var(--blurStrength) * 1px);--fontScale:${fontScale};--mainFontSize:calc(var(--fontScale) * 15px);--mainFontFamily:"Noto Sans","Microsoft YaHei",sans-serif;--monoFontFamily:Consolas,monospace;--sheldWidth:${chatWidth}vw;--topBarIconSize:calc(var(--mainFontSize) * 2);--topBarBlockPadding:calc(var(--mainFontSize) / 3);--topBarBlockSize:calc(var(--topBarIconSize) + var(--topBarBlockPadding));--bottomFormBlockPadding:calc(var(--mainFontSize) / 2.5);--bottomFormIconSize:calc(var(--mainFontSize) * 1.9);--bottomFormBlockSize:calc(var(--bottomFormIconSize) + var(--bottomFormBlockPadding));--avatar-base-width:50px;--avatar-base-height:50px;--avatar-base-border-radius:2px;--avatar-base-border-radius-round:50%;--avatar-base-border-radius-rounded:10px;--big-avatar-width-factor:1;--big-avatar-height-factor:1.5;--mes-right-spacing:30px}
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:rgba(150,150,150,.55) transparent}.srl-icon{display:inline-block;vertical-align:-.125em;width:1em;height:1em;fill:currentColor;flex:none}
html,body{margin:0;width:100%;height:100%;color:var(--SmartThemeBodyColor);background:#171717;font:var(--mainFontSize) var(--mainFontFamily)}
body{position:relative;overflow:hidden}
button,input,textarea,select{font:inherit;color:inherit}
.srl-compat-background{position:fixed;inset:0;background:#171717}
#top-bar{position:fixed;inset:0 0 auto;height:var(--topBarBlockSize);background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength))}
#top-settings-holder{position:relative;z-index:2;display:flex;justify-content:center;width:var(--sheldWidth);height:var(--topBarBlockSize);margin:auto}
.drawer{display:flex;align-items:center;justify-content:center;flex:1;min-width:0}
.drawer-toggle{height:100%;display:flex;align-items:center}.drawer-icon.openIcon{opacity:1}.drawer-icon:focus-visible,.menu_button:focus-visible{outline:2px solid var(--SmartThemeQuoteColor);outline-offset:-2px}
.drawer-icon{display:inline-flex;align-items:center;justify-content:center;max-width:100%;height:100%;padding:1px 3px;border:0;background:transparent;font-size:var(--topBarIconSize);opacity:.55;cursor:pointer}
.drawer-icon svg{width:1em;height:1em;max-width:100%}
.drawer-icon:hover{opacity:1}.menu_button{padding:5px;border:1px solid var(--SmartThemeBorderColor);border-radius:5px;background:rgba(0,0,0,.15)}
#sheld{position:absolute;z-index:1;inset:var(--topBarBlockSize) 0 auto;display:flex;flex-direction:column;width:var(--sheldWidth);height:calc(100dvh - var(--topBarBlockSize) - 1px);min-height:0;margin-inline:auto}
#chat{display:flex;flex-direction:column;flex:1;min-height:0;overflow-x:hidden;overflow-y:scroll;background:var(--SmartThemeChatTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength));text-shadow:0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor)}
#form_sheld{flex:none;width:100%;margin-top:1px}
#send_form{border:1px solid var(--SmartThemeBorderColor);border-radius:0 0 10px 10px;background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength))}
#nonQRFormItems{display:flex;align-items:center;gap:5px;width:100%;padding:var(--bottomFormBlockPadding)}
#leftSendForm,#rightSendForm{display:flex;flex:none;align-items:center;gap:5px}#options_button,#extensionsMenuButton,#send_but{border:0;background:transparent;padding:0;font-size:var(--bottomFormIconSize);line-height:1}
#send_textarea{flex:1;min-width:0;min-height:var(--bottomFormBlockSize);max-height:50dvh;margin:0;padding:5px;border:0;background:transparent;resize:vertical;line-height:1.4}
.drawer-content:where(.srl-compat-panel){display:none;position:absolute;z-index:5;inset:var(--topBarBlockSize) 0 auto;width:var(--sheldWidth);min-width:min(450px,100dvw);max-height:calc(100dvh - var(--topBarBlockSize) - var(--bottomFormBlockSize));margin-inline:auto;padding:8px;overflow:auto;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength))}
.drawer-content.openDrawer{display:block}.drawer-content.fillLeft,.drawer-content.fillRight{position:fixed;top:0;min-width:100px;width:calc((100dvw - var(--sheldWidth) - 2px) / 2);height:100%;max-height:100dvh;margin:0}.drawer-content.fillLeft{left:0;right:auto}.drawer-content.fillRight{right:0;left:auto}
.srl-close-drawer{float:right;cursor:pointer;min-width:30px}.srl-compat-panel [hidden]{display:none}.srl-compat-panel .world_entry{grid-template-columns:minmax(0,1fr)}.persona-card.selected{outline:1px solid var(--SmartThemeQuoteColor)}
.srl-compat-panel h2{margin:0 0 5px;font-size:1.15em;line-height:1.5}.srl-compat-panel h4{font-size:1em;margin:4px 0 5px;padding:3px 5px;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;background:linear-gradient(348deg,rgba(255,255,255,.15),rgba(0,0,0,.35) 20%,rgba(0,0,0,.65) 95%,var(--SmartThemeQuoteColor))}
.srl-compat-field{display:flex;align-items:center;gap:5px;margin:3px 0;min-width:0}.srl-compat-field>span{flex:none;font-size:.95em}.srl-compat-field:has(textarea){display:block}.srl-compat-field textarea{min-height:5em;resize:vertical}
:where(.srl-compat-panel) input:not([type=range]):not([type=checkbox]):not([type=color]),:where(.srl-compat-panel) textarea,:where(.srl-compat-panel) select{min-width:0;width:100%;padding:3px 5px;border:1px solid var(--SmartThemeBorderColor);border-radius:5px;background:rgba(0,0,0,.3);color:var(--SmartThemeBodyColor);line-height:1.5}
select option{color:var(--SmartThemeBodyColor);background:var(--SmartThemeBlurTintColor)}.srl-compat-panel small{font-size:.8em;opacity:.7}
#user-settings-block-content{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}#user-settings-block-content>div{min-width:0}.srl-range-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 5px;margin:10px 0}.range-block{display:grid;gap:6px;text-align:center;min-width:0;font-size:.85em}.range-block output{background:rgba(0,0,0,.3);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:3px;font-size:1.1em}
:where(.srl-compat-panel) input[type=range]{appearance:none;margin:6px 0;padding:0;width:100%;min-width:0;height:5px;background:var(--SmartThemeBodyColor);border:0;border-radius:15px;filter:brightness(.75);cursor:ew-resize}
input[type=range]::-webkit-slider-thumb{appearance:none;width:15px;height:15px;border-radius:50%;background:var(--SmartThemeBlurTintColor);border:2px solid var(--SmartThemeBodyColor)}input[type=range]::-moz-range-thumb{width:11px;height:11px;border-radius:50%;background:var(--SmartThemeBlurTintColor);border:2px solid var(--SmartThemeBodyColor)}
.checkbox_label{display:flex;gap:5px;align-items:center;font-size:.9em;margin:4px 0}.checkbox_label input{appearance:none;width:14px;height:14px;border:1px solid var(--SmartThemeEmColor);border-radius:2px;margin:0;flex:none;background:var(--SmartThemeBodyColor)}.checkbox_label input:checked::after{content:'✓';display:block;line-height:12px;text-align:center;font-size:13px;font-weight:bold;color:var(--SmartThemeBlurTintColor)}
.srl-color-row{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:5px 2px;font-size:.9em}.srl-color-row input[type=color]{width:30px;height:23px;border:1px solid var(--SmartThemeBorderColor);border-radius:5px;padding:1px;background:transparent}.srl-type-sample{line-height:1.7;font-size:.9em}.srl-type-sample em{color:var(--SmartThemeEmColor)}.srl-type-sample q{color:var(--SmartThemeQuoteColor)}.srl-type-sample u{color:var(--SmartThemeUnderlineColor)}
@media(max-width:600px){#user-settings-block-content{grid-template-columns:1fr}.srl-range-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.mes{position:relative;display:flex;flex:none;width:100%;padding:10px 10px 0;border:0;border-radius:0;background:transparent}
.mesAvatarWrapper{flex:none}.avatar{width:var(--avatar-base-width);height:var(--avatar-base-height);border-radius:var(--avatar-base-border-radius-round)}
.avatar img{display:block;width:100%;height:100%;object-fit:cover;object-position:center;border:1px solid var(--SmartThemeBorderColor);border-radius:inherit}
.mes_block{flex:1;min-width:0;padding-left:10px}.ch_name{font-weight:700}.flex-container{display:flex;gap:5px}.flex1{flex:1;min-width:0}.alignitemscenter{align-items:center}.alignItemsBaseline{align-items:baseline;flex-wrap:wrap}.justifySpaceBetween{justify-content:space-between}
.timestamp{font-size:.7em;font-weight:400;opacity:.6}.mes_buttons{display:flex;gap:6px;align-items:baseline;opacity:.5}.extraMesButtons{display:none}.mes_button{font-size:1em;font-weight:400;line-height:1}
.mes_text{padding:5px var(--mes-right-spacing) 5px 0;line-height:calc(var(--mainFontSize) + .5rem);overflow-wrap:anywhere}.mes_text p{margin:0 0 1em}.mes_text p:last-child{margin-bottom:0}.mes_text em{color:var(--SmartThemeEmColor)}.mes_text u{color:var(--SmartThemeUnderlineColor)}.mes_text q{color:var(--SmartThemeQuoteColor)}.mes_text q::before,.mes_text q::after{content:''}
.mes_text blockquote{margin:1em 0;padding:0 1em;border-inline-start:3px solid var(--SmartThemeQuoteColor)}.mes_text pre{max-width:100%;overflow:auto;padding:10px;background:rgba(0,0,0,.25);white-space:pre}.mes_text code{font-family:var(--monoFontFamily)}.mes_text table{border-collapse:collapse;max-width:100%}.mes_text th,.mes_text td{padding:5px 10px;border:1px solid var(--SmartThemeBorderColor)}.mes_text summary{cursor:pointer}
.mesIDDisplay,.mes_timer,.tokenCounterDisplay{text-align:center;font-size:.8em;opacity:.6;min-height:1em}.last_mes{padding-bottom:25px}.last_mes .mesAvatarWrapper{padding-bottom:var(--avatar-base-height)}
.swipe_left{position:absolute;left:20px;bottom:20px}.swipeRightBlock{position:absolute;right:10px;bottom:0;text-align:center}.swipe_left,.swipe_right{font-size:25px;opacity:.5}.swipes-counter{font-size:12px;opacity:.5}
.srl-compat-welcome{display:grid;gap:12px}.welcomeHeaderTitle,.welcomeHeader{display:flex;align-items:center;gap:10px}.welcomeHeaderLogo{width:42px;height:42px}.welcomeHeaderVersionDisplay,.recentChatsTitle{flex:1}.recentChatList,.srl-compat-list{display:grid;gap:8px}.recentChat,.character_select,.extension_container,.world_entry,.persona-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--SmartThemeBorderColor);border-radius:12px;background:rgba(255,255,255,.04)}.recentChatInfo{min-width:0}.chatMessage{margin:2px 0 0;color:var(--SmartThemeEmColor)}
.srl-compat-columns{display:grid;grid-template-columns:1fr 1.4fr;gap:14px}.srl-compat-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.bg_example{min-height:100px;border:1px solid var(--SmartThemeBorderColor);border-radius:13px;background:linear-gradient(145deg,#173c34,#503d2d)}.bg_example.selected{outline:2px solid var(--SmartThemeQuoteColor)}
.srl-compat-startup{position:fixed;z-index:10;inset:0;display:grid;place-items:center;background:var(--SmartThemeBlurTintColor)}#loader.splash-screen{display:grid;justify-items:center;gap:24px;animation:srl-preview-intro 1.2s ease both}.splash-logo{width:min(170px,46vw)}#load-spinner{font-size:40px;animation:srl-placeholder-spin 1.4s linear infinite}.splash-message{margin:0}@keyframes srl-placeholder-spin{to{transform:rotate(360deg)}}@keyframes srl-preview-intro{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){#loader.splash-screen,#load-spinner{animation:none}}
body.bubblechat .mes{padding:10px;margin-bottom:5px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;background:var(--SmartThemeBotMesBlurTintColor)}
body.bubblechat .mes[is_user="true"]{background:var(--SmartThemeUserMesBlurTintColor)}
body.documentstyle .mes{padding:5px 10px 0}body.documentstyle .last_mes{padding-top:0;padding-bottom:25px}
body.documentstyle .mes_text{margin-left:20px;padding:0}body.documentstyle .mes_block{margin-right:30px}
body.documentstyle .last_mes .mes_text{min-height:70px}
body.documentstyle .mesAvatarWrapper,body.documentstyle .name_text,body.documentstyle .timestamp,body.documentstyle .mes:not(.last_mes) .mes_buttons{display:none}
body.documentstyle .last_mes .swipe_left{left:5px}
body.big-avatars .avatar{width:calc(var(--avatar-base-width) * var(--big-avatar-width-factor));height:calc(var(--avatar-base-height) * var(--big-avatar-height-factor));border-radius:var(--avatar-base-border-radius)}
body.square-avatars .avatar{border-radius:var(--avatar-base-border-radius)}body.rounded-avatars .avatar{border-radius:var(--avatar-base-border-radius-rounded)}
body.hideChatAvatars .mesAvatarWrapper .avatar,body.no-timestamps .timestamp,body.no-timer .mes_timer,body.no-tokenCount .tokenCounterDisplay,body.no-mesIDDisplay .mesIDDisplay{display:none}
body.expandMessageActions .extraMesButtons{display:flex;gap:6px}body.expandMessageActions .extraMesButtonsHint{display:none}
body.noShadows #chat{text-shadow:none}body.no-blur #chat,body.no-blur #send_form,body.no-blur #top-bar,body.no-blur .drawer-content{backdrop-filter:none}
@media(max-width:1000px){#sheld,#top-settings-holder{width:100dvw}.drawer-content:where(.srl-compat-panel),.drawer-content.fillLeft,.drawer-content.fillRight{position:fixed;inset:var(--topBarBlockSize) 0 auto;width:100dvw;min-width:0;height:auto;max-height:calc(100dvh - var(--topBarBlockSize));margin:0}.srl-compat-columns{grid-template-columns:1fr}.srl-compat-gallery{grid-template-columns:1fr 1fr}}
`
}

// Cache only invariant fragments, not complete documents or author resources.
const toolbarMarkup = computed(buildToolbar)
const compatibilityStyles = computed(() => buildCompatibilityStyles(theme.value ?? {}))

const previewDocument = computed(() => {
  if (isSourceLoading.value || sourceError.value) return ''
  const themeValue = theme.value ?? {}
  const chatDisplay = safeNumber(themeValue.chat_display, 0, 0, 2)
  const avatarStyle = safeNumber(themeValue.avatar_style, 0, 0, 3)
  const bodyClasses = [
    chatDisplay === 1 ? 'bubblechat' : '',
    chatDisplay === 2 ? 'documentstyle' : '',
    themeValue.noShadows === true ? 'noShadows' : '',
    themeValue.hideChatAvatars_enabled === true ? 'hideChatAvatars' : '',
    avatarStyle === 1 ? 'big-avatars' : '',
    avatarStyle === 2 ? 'square-avatars' : '',
    avatarStyle === 3 ? 'rounded-avatars' : '',
    themeValue.timestamps_enabled === false ? 'no-timestamps' : '',
    themeValue.timer_enabled === false ? 'no-timer' : '',
    themeValue.mesIDDisplay_enabled === true ? '' : 'no-mesIDDisplay',
    themeValue.message_token_count_enabled === true ? '' : 'no-tokenCount',
    themeValue.fast_ui_mode === false ? '' : 'no-blur',
    themeValue.expand_message_actions === true ? 'expandMessageActions' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const policy = previewPolicy.value.allowScripts
    ? "default-src 'none'; style-src 'unsafe-inline' data: blob: http: https:; img-src data: blob: http: https:; font-src data: blob: http: https:; connect-src http: https: ws: wss:; script-src 'unsafe-inline' data: blob: http: https:; object-src 'none'; frame-src http: https:; base-uri 'none'; form-action 'none'"
    : previewPolicy.value.allowRemoteResources
      ? `default-src 'none'; style-src 'unsafe-inline' blob: http: https:; img-src data: blob: http: https:; font-src data: blob: http: https:; script-src 'nonce-${interactionNonce}'; object-src 'none'; base-uri 'none'; form-action 'none'`
      : `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'nonce-${interactionNonce}'; object-src 'none'; base-uri 'none'; form-action 'none'`

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escapeHtml(props.resource.name)}</title><style>${compatibilityStyles.value}</style><style>${customCss.value}</style></head><body class="${bodyClasses}" data-preview-scene="${previewScene.value}">${previewScene.value === 'startup' ? buildStartupScene() : previewScene.value === 'welcome' ? buildWelcomeScene() : buildChatScene()}<script nonce="${interactionNonce}">${BEAUTIFICATION_PREVIEW_INTERACTION}</scr${'ipt'}>${isolatedScripts.value}</body></html>`
})

watch(
  [previewDocument, () => previewPolicy.value.preloadBeautificationResources],
  async ([documentSource, preloadResources], _previous, onCleanup) => {
    const generation = ++preloadGeneration
    isPreviewLoading.value = true
    preloadAbortController?.abort()
    preloadAbortController = undefined
    const shouldWarmNativeResources =
      preloadResources &&
      previewPolicy.value.allowRemoteResources &&
      isNativePreviewAssetAvailable()
    // 保留原始外链交给 iframe 直显。网页无法读取跨域响应体不代表图片无法显示，
    // Android 的原生缓存也只能加速下一次，不得决定当前预览是否可用。
    preparedPreviewDocument.value = documentSource
    replacePreloadedResources()
    if (!documentSource || !shouldWarmNativeResources) return
    const controller = new AbortController()
    preloadAbortController = controller
    onCleanup(() => controller.abort())
    const startedAt = performance.now()
    void preloadPreviewDocumentResources(documentSource, undefined, { signal: controller.signal })
      .then((preloaded) => {
        if (generation !== preloadGeneration || controller.signal.aborted) {
          preloaded.release()
          return
        }
        if (preloaded.loaded && performance.now() - startedAt <= NATIVE_CACHE_SWAP_WINDOW_MS) {
          preparedPreviewDocument.value = preloaded.document
          replacePreloadedResources(preloaded.release)
          previewRevision.value += 1
          return
        }
        preloaded.release()
      })
      .catch(() => undefined)
      .finally(() => {
        if (preloadAbortController === controller) preloadAbortController = undefined
      })
  },
  { immediate: true },
)

onUnmounted(() => {
  loadGeneration += 1
  preloadAbortController?.abort()
  preloadAbortController = undefined
  releasePreloadedResources?.()
  releasePreloadedResources = undefined
})

const affectedScenes = computed(() => {
  const source = sourceText.value
  const patterns: Record<PreviewScene, RegExp> = {
    startup: /#(?:preloader|loader|load-spinner)\b|\.splash-(?:screen|logo|message)\b|@keyframes/i,
    welcome: /\.welcome(?:Panel|Header|Recent|Shortcuts)\b|\.recentChat\b/i,
    chat: /#(?:chat|send_form|send_textarea|form_sheld)\b|\.mes(?:_text|_block|AvatarWrapper)?\b|\.user_mes\b|\.bot_mes\b/i,
  }
  return new Set(
    PREVIEW_SCENES.filter((scene) => patterns[scene.id].test(source)).map((scene) => scene.id),
  )
})

function selectScene(scene: PreviewScene): void {
  if (scene === 'startup' && previewScene.value === 'startup') animationEpoch.value += 1
  previewScene.value = scene
}

function replayStartup(): void {
  previewScene.value = 'startup'
  animationEpoch.value += 1
}

function openFullscreen(): void {
  const dialog = previewDialog.value
  if (!dialog) return
  dialog.close()
  dialog.showModal()
  isFullscreenOpen.value = true
  void nextTick(() => fullscreenClose.value?.focus({ preventScroll: true }))
}

function closeFullscreen(): void {
  const dialog = previewDialog.value
  if (!dialog) return
  dialog.close()
  dialog.show()
  isFullscreenOpen.value = false
  fullscreenTrigger.value?.focus({ preventScroll: true })
}

function resetTheme(): void {
  isPreviewLoading.value = true
  previewRevision.value += 1
}

function handlePreviewFrameLoad(): void {
  isPreviewLoading.value = false
}
</script>

<template>
  <section ref="previewHost" class="beauty-preview" aria-labelledby="beauty-preview-title">
    <header class="beauty-preview__header">
      <h3 id="beauty-preview-title">主题预览</h3>
      <span v-if="previewWidth !== '100%'" title="等比缩放以完整显示画布"
        >{{ Math.round(canvasScale * 100) }}%</span
      >
      <div class="beauty-preview__actions">
        <button
          type="button"
          class="beauty-preview__fullscreen-btn"
          :disabled="!canRenderPreview"
          @click="resetTheme"
        >
          还原主题
        </button>
        <button
          ref="fullscreenTrigger"
          type="button"
          class="beauty-preview__fullscreen-btn"
          :disabled="!canRenderPreview"
          @click="openFullscreen"
        >
          全屏预览
        </button>
      </div>
    </header>

    <p v-if="sourceError" class="beauty-preview__error">{{ sourceError }}</p>
    <template v-else>
      <nav class="beauty-preview__controls" aria-label="预览控制">
        <label
          >场景
          <select
            :value="previewScene"
            aria-label="预览场景"
            @change="selectScene(($event.target as HTMLSelectElement).value as PreviewScene)"
          >
            <option v-for="scene in PREVIEW_SCENES" :key="scene.id" :value="scene.id">
              {{ scene.label }}{{ affectedScenes.has(scene.id) ? ' · 样式涉及' : '' }}
            </option>
          </select>
        </label>
        <label
          >画布
          <select v-model="previewWidth" aria-label="预览画布宽度">
            <option value="100%">自适应</option>
            <option value="390px">手机 · 390</option>
            <option value="768px">平板 · 768</option>
            <option value="1280px">桌面 · 1280</option>
          </select>
        </label>
        <button
          v-if="previewScene === 'startup'"
          type="button"
          class="beauty-preview__replay"
          @click="replayStartup"
        >
          ↻ 重播
        </button>
      </nav>
      <div
        v-if="hasExternalResources || hasScripts"
        class="beauty-preview__network"
        :class="{ 'is-enabled': previewPolicy.allowRemoteResources }"
      >
        <div>
          <strong>{{
            previewPolicy.allowScripts
              ? '隔离脚本与联网内容已允许'
              : previewPolicy.allowRemoteResources
                ? '联网素材已允许'
                : '联网素材与脚本已阻止'
          }}</strong>
          <p>这是全局预览策略，可前往“设置 → 预览安全”修改；下载与导出的原文件始终不变。</p>
        </div>
      </div>
      <dialog
        ref="previewDialog"
        open
        class="beauty-preview__dialog"
        :class="{ 'beauty-fullscreen-overlay': isFullscreenOpen }"
        :aria-modal="isFullscreenOpen || undefined"
        :aria-label="isFullscreenOpen ? '美化主题全屏预览' : '美化主题预览画布'"
        @cancel.prevent="closeFullscreen"
      >
        <header v-show="isFullscreenOpen" class="beauty-fullscreen__toolbar">
          <span>主题预览</span>
          <div class="beauty-preview__actions">
            <button class="beauty-fullscreen__close" type="button" @click="resetTheme">
              还原主题
            </button>
            <button
              ref="fullscreenClose"
              class="beauty-fullscreen__close"
              type="button"
              @click="closeFullscreen"
            >
              × 退出全屏
            </button>
          </div>
        </header>
        <div ref="previewStage" class="beauty-preview__frame-wrap">
          <div class="beauty-preview__canvas" :style="canvasStyle">
            <iframe
              v-if="canRenderPreview"
              :key="`${previewKey}-${previewRevision}`"
              class="beauty-preview__frame"
              :style="frameStyle"
              :srcdoc="preparedPreviewDocument"
              sandbox="allow-scripts"
              title="隔离的酒馆主题兼容预览"
              @load="handlePreviewFrameLoad"
            ></iframe>
          </div>
          <p v-if="!previewEnabled" class="beauty-preview__loading" role="status">主题预览已暂停</p>
          <div v-if="isPreviewLoading" class="beauty-preview__loading" role="status">
            <span>正在加载预览</span>
            <i role="progressbar" aria-label="预览加载中"></i>
          </div>
        </div>
      </dialog>
      <details class="beauty-preview__details">
        <summary>预览说明与主题色</summary>
        <p class="beauty-preview__caption">
          预览内的调整不会修改资源。指定画布较大时等比缩小显示，内部仍按所选尺寸排版；全屏按实际窗口显示。作者脚本由“设置
          → 预览安全”控制。
        </p>
        <p v-if="hasExternalResources || hasScripts" class="beauty-preview__notice">
          预览权限不会修改、删除或重写原文件；联网服务器仍可能记录 IP、访问时间与浏览器信息。
        </p>
        <div v-if="colorEntries.length" class="beauty-preview__palette" aria-label="主题色板">
          <span v-for="color in colorEntries" :key="`${color.label}-${color.value}`">
            <i :style="{ backgroundColor: color.value }"></i>
            <small>{{ color.label }}</small>
            <code>{{ color.value }}</code>
          </span>
        </div>
      </details>
    </template>
  </section>
</template>
