<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  appearanceScopes,
  compileAppearancePreset,
  parseAppearancePreset,
  type AppearanceScope,
} from '../core/AppearanceScopes'
import { isOfficialAppId } from '../types/OfficialApp'

import { confirmAction } from '../composables/UseConfirmDialog'
import { usePreviewBudget } from '../composables/UsePreviewBudget'
import { usePreviewPolicy } from '../composables/UsePreviewPolicy'
import FeatureAppHeader from './FeatureAppHeader.vue'
import AppearanceOriginalCssActions from './AppearanceOriginalCssActions.vue'
import {
  BrowserStorageService,
  CABINET_COLUMN_OPTIONS,
  type CabinetColumns,
  type CustomCssPreset,
  type CustomCssScope,
  type LayoutMode,
  type UiFontScale,
} from '../services/BrowserStorageService'
import { downloadBlob } from '../utils/LibraryFormatting'
import { sanitizeCssForPreview } from '../utils/PreviewSafety'

const props = defineProps<{
  theme: 'light' | 'dark'
  layoutMode: LayoutMode
  uiFontScale: UiFontScale
  customCss: string
}>()
const emit = defineEmits<{
  back: []
  'update:theme': [value: 'light' | 'dark']
  'update:layoutMode': [value: LayoutMode]
  'update:uiFontScale': [value: UiFontScale]
  'save-css': [value: string]
}>()

const storage = new BrowserStorageService()
const previewPolicy = usePreviewPolicy()
const copyStatus = ref('')
const isPreviewOpen = ref(false)
const previewHost = ref<HTMLElement>()
const { previewEnabled } = usePreviewBudget('appearance-preview', isPreviewOpen, previewHost)
const importInput = ref<HTMLInputElement>()
const cabinetColumns = ref<CabinetColumns>(storage.getCabinetColumns())

const cabinetDensities: Array<{
  value: CabinetColumns
  title: string
  description: string
}> = [
  { value: 2, title: '舒展', description: '每页 6 个' },
  { value: 3, title: '均衡', description: '每页 9 个' },
  { value: 4, title: '标准', description: '每页 12 个' },
]

const fontScales: Array<{ value: UiFontScale; title: string; description: string }> = [
  { value: 'small', title: '紧凑', description: '同屏更多内容' },
  { value: 'standard', title: '标准', description: '默认显示大小' },
  { value: 'large', title: '放大', description: '正文更易阅读' },
]

const layouts: Array<{
  value: LayoutMode
  eyebrow: string
  title: string
  description: string
  cells: number
}> = [
  {
    value: 'grid',
    eyebrow: 'BROWSE',
    title: '卡片浏览',
    description: '突出角色封面与视觉识别，适合慢慢翻看收藏。',
    cells: 6,
  },
  {
    value: 'list',
    eyebrow: 'SCAN',
    title: '紧凑列表',
    description: '同屏查看更多名称、类型与归档信息，适合快速查找。',
    cells: 5,
  },
  {
    value: 'split',
    eyebrow: 'MANAGE',
    title: '分栏管理',
    description: '桌面端同时查看资源列表与详情，适合集中整理。',
    cells: 7,
  },
]

const scopes = appearanceScopes()

function selectCabinetColumns(value: CabinetColumns): void {
  if (!CABINET_COLUMN_OPTIONS.includes(value)) return
  cabinetColumns.value = storage.setCabinetColumns(value)
}

function createPreset(name = '我的样式', css = ''): CustomCssPreset {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    globalCss: css,
    scopedCss: {},
    createdAt: now,
    updatedAt: now,
  }
}

function clonePreset(value: CustomCssPreset): CustomCssPreset {
  return { ...value, scopedCss: { ...(value.scopedCss ?? {}) } }
}

const storedPresets = storage.getCustomUiPresets()
const activeStoredId = storage.getActiveCustomUiPresetId()
const initialPreset =
  storedPresets.find((item) => item.id === activeStoredId) ??
  storedPresets[0] ??
  createPreset('我的样式', props.customCss)
const presets = ref(storedPresets)
const activePresetId = ref(initialPreset.id)
const draft = ref(clonePreset(initialPreset))
const activeScope = ref<CustomCssScope>('library')
const previewCss = ref(props.customCss)

const activeScopedCss = computed({
  get: () => draft.value.scopedCss[activeScope.value] ?? '',
  set: (value: string) => {
    draft.value.scopedCss[activeScope.value] = value
  },
})
const installedIds = ref(new Set<string>())
const installationsLoaded = ref(false)
const installationError = ref('')
onMounted(async () => {
  try {
    const { officialAppService } = await import('../core/OfficialAppRuntime')
    installedIds.value = new Set((await officialAppService.list()).map((app) => app.id))
    installationsLoaded.value = true
  } catch {
    installationError.value = '暂时无法读取安装状态；已有样式仍保留。'
  }
})
function available(scope: AppearanceScope): boolean {
  return !scope.appId || !isOfficialAppId(scope.appId) || installedIds.value.has(scope.appId)
}
const activeScopes = computed(() => scopes.filter(available))
const inactiveScopes = computed<AppearanceScope[]>(() => [
  ...scopes.filter((scope) => !available(scope)),
  ...Object.keys(draft.value.scopedCss ?? {})
    .filter((key) => !scopes.some((scope) => scope.value === key))
    .map((key) => ({
      value: key as CustomCssScope,
      title: `未识别界面（${key}）`,
      selector: '',
      hint: '保留数据供未来版本恢复；当前不应用',
    })),
])
const selectedScope = computed(() =>
  [...activeScopes.value, ...inactiveScopes.value].find(
    (scope) => scope.value === activeScope.value,
  ),
)
const savedDraft = computed(() => presets.value.find((item) => item.id === draft.value.id))
const hasUnsavedChanges = computed(() => {
  const saved = savedDraft.value
  if (!saved) return true
  return (
    saved.name !== draft.value.name ||
    saved.globalCss !== draft.value.globalCss ||
    JSON.stringify(saved.scopedCss ?? {}) !== JSON.stringify(draft.value.scopedCss ?? {})
  )
})
const presetState = computed(() => {
  if (!savedDraft.value) return '新预设 · 尚未保存'
  if (hasUnsavedChanges.value) return '有未保存修改'
  return '已保存并应用'
})
const hasCssContent = computed(
  () =>
    Boolean(draft.value.globalCss.trim()) ||
    Object.values(draft.value.scopedCss ?? {}).some((value) => Boolean(value?.trim())),
)

const compilePreset = compileAppearancePreset

function flash(message: string): void {
  copyStatus.value = message
  window.setTimeout(() => {
    if (copyStatus.value === message) copyStatus.value = ''
  }, 2600)
}

async function selectPreset(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const id = select.value
  if (
    hasUnsavedChanges.value &&
    hasCssContent.value &&
    !(await confirmAction({
      title: '切换预设',
      message: '当前 CSS 还有未保存修改。放弃修改并切换预设？',
      confirmLabel: '放弃并切换',
      danger: true,
    }))
  ) {
    select.value = activePresetId.value
    return
  }
  const selected = presets.value.find((item) => item.id === id)
  if (!selected) return
  activePresetId.value = id
  draft.value = clonePreset(selected)
  storage.setActiveCustomUiPresetId(id)
  emit('save-css', compilePreset(selected))
  flash(`已切换到「${selected.name}」`)
}

async function newPreset(): Promise<void> {
  if (presets.value.length >= 30) {
    flash('最多保存 30 个预设，请先删除不用的样式')
    return
  }
  if (
    hasUnsavedChanges.value &&
    hasCssContent.value &&
    !(await confirmAction({
      title: '新建预设',
      message: '当前 CSS 还有未保存修改。放弃修改并新建预设？',
      confirmLabel: '放弃并新建',
      danger: true,
    }))
  ) {
    return
  }
  const next = createPreset(`新样式 ${presets.value.length + 1}`)
  activePresetId.value = next.id
  draft.value = next
  flash('已新建草稿，保存后才会加入预设库')
}

function saveAsNewPreset(): void {
  if (presets.value.length >= 30) {
    flash('最多保存 30 个预设，请先删除不用的样式')
    return
  }
  const now = new Date().toISOString()
  draft.value = {
    ...clonePreset(draft.value),
    id: crypto.randomUUID(),
    name: `${draft.value.name.trim() || '未命名样式'} 副本`,
    createdAt: now,
    updatedAt: now,
  }
  activePresetId.value = draft.value.id
  savePreset()
}

function savePreset(): void {
  const cleanName = draft.value.name.trim() || '未命名样式'
  const saved = {
    ...clonePreset(draft.value),
    name: cleanName,
    updatedAt: new Date().toISOString(),
  }
  const index = presets.value.findIndex((item) => item.id === saved.id)
  if (index < 0 && presets.value.length >= 30) {
    flash('最多保存 30 个预设，请先删除不用的样式')
    return
  }
  if (index >= 0) presets.value[index] = saved
  else presets.value.push(saved)
  presets.value = [...presets.value]
  activePresetId.value = saved.id
  draft.value = clonePreset(saved)
  storage.setCustomUiPresets(presets.value)
  storage.setActiveCustomUiPresetId(saved.id)
  emit('save-css', compilePreset(saved))
  flash(`「${saved.name}」已保存并应用`)
}

async function deletePreset(): Promise<void> {
  if (!presets.value.some((item) => item.id === draft.value.id)) {
    const next = presets.value[0] ?? createPreset()
    activePresetId.value = next.id
    draft.value = clonePreset(next)
    flash('未保存草稿已放弃')
    return
  }
  const deletePresetConfirmed = await confirmAction({
    title: '删除 CSS 预设',
    message: `删除 CSS 预设「${draft.value.name}」？导出的文件不受影响。`,
    confirmLabel: '删除',
    danger: true,
  })
  if (!deletePresetConfirmed) return
  presets.value = presets.value.filter((item) => item.id !== draft.value.id)
  storage.setCustomUiPresets(presets.value)
  const next = presets.value[0] ?? createPreset()
  activePresetId.value = next.id
  draft.value = clonePreset(next)
  storage.setActiveCustomUiPresetId(presets.value.length ? next.id : '')
  emit('save-css', presets.value.length ? compilePreset(next) : '')
  flash('预设已删除')
}

function preview(): void {
  previewCss.value = compilePreset(draft.value)
  isPreviewOpen.value = true
}

async function clearDraft(): Promise<void> {
  if (
    hasCssContent.value &&
    !(await confirmAction({
      title: '清空草稿',
      message: '清空当前草稿里的全部 CSS？保存的预设不会立即改变。',
      confirmLabel: '清空',
      danger: true,
    }))
  ) {
    return
  }
  draft.value.globalCss = ''
  draft.value.scopedCss = {}
  flash('草稿已清空，尚未保存')
}

async function exportPreset(): Promise<void> {
  const css = `/* SRL 外观预设：${draft.value.name || '未命名样式'} */\n${compilePreset(draft.value)}\n`
  await downloadBlob(
    new Blob([css], { type: 'text/css;charset=utf-8' }),
    `${(draft.value.name || 'srl-style').replace(/[\\/:*?"<>|]/g, '-')}.css`,
  )
  flash('CSS 文件已导出，可以直接分享')
}

function exportEditablePreset(): void {
  downloadBlob(
    new Blob(
      [
        JSON.stringify(
          { format: 'srl-appearance-preset', version: 1, preset: draft.value },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
    `${(draft.value.name || '外观预设').replace(/[\\/:*?"<>|]/g, '-')}.srl-style.json`,
  )
  flash('可编辑预设已导出，包含未安装 APP 的局部样式')
}

async function importPresets(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const selectedFiles = Array.from(input.files ?? [])
  const files = selectedFiles.slice(0, Math.max(0, 30 - presets.value.length))
  const prepared: CustomCssPreset[] = []
  try {
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) throw new Error('外观文件超过 2 MB')
      const text = await file.text()
      const imported = /\.json$/i.test(file.name)
        ? parseAppearancePreset(JSON.parse(text))
        : createPreset(file.name.replace(/\.css$/i, '') || '导入样式', text.slice(0, 200_000))
      prepared.push(imported)
    }
  } catch (error) {
    flash(error instanceof Error ? error.message : '预设导入失败')
    input.value = ''
    return
  }
  for (const imported of prepared) {
    presets.value.push(imported)
    activePresetId.value = imported.id
    draft.value = clonePreset(imported)
  }
  if (files.length) {
    storage.setCustomUiPresets(presets.value)
    storage.setActiveCustomUiPresetId(activePresetId.value)
    emit('save-css', compilePreset(draft.value))
    flash(
      selectedFiles.length === files.length
        ? `已导入 ${files.length} 个 CSS 预设`
        : `已导入 ${files.length} 个，预设库上限为 30 个`,
    )
  }
  input.value = ''
}

const previewDocument = computed(() => {
  const css = sanitizeCssForPreview(previewCss.value, {
    allowExternalResources: previewPolicy.value.allowRemoteResources,
  })
  const csp = previewPolicy.value.allowRemoteResources
    ? "default-src 'none'; style-src 'unsafe-inline' https: http:; img-src data: https: http:; font-src data: https: http:; script-src 'none'"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'"
  const featurePage = selectedScope.value?.appId ?? 'home'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>:root{--color-paper:#f4f0e6;--color-ink:#17231f;--color-accent:#17604c;--color-line:#c9c9bf}*{box-sizing:border-box}body{margin:0;background:var(--color-paper);color:var(--color-ink);font:14px/1.5 system-ui}.app-shell{display:grid;grid-template-columns:8rem 1fr;min-height:100vh}.sidebar{padding:1rem;border-right:1px solid var(--color-line)}.sidebar span{display:block;padding:.55rem}.library{padding:1rem}.toolbar{display:flex;gap:.5rem;margin-bottom:1rem}.toolbar input{min-width:0;flex:1;padding:.7rem}.resource-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.resource-card{min-height:8rem;padding:.8rem;border:1px solid var(--color-line);background:#fff}.resource-card i{display:block;height:4rem;margin:-.8rem -.8rem .7rem;background:linear-gradient(135deg,#bdcfca,#345f52)}@media(max-width:520px){.app-shell{grid-template-columns:1fr}.sidebar{display:none}.library{padding:.75rem}}${css}</style></head><body><div class="app-shell"><aside class="sidebar"><strong>SRL</strong><span>全部资源</span><span>角色卡</span><span>世界书</span></aside><main class="library resource-detail-sheet feature-hub layout-settings-page" data-feature-page="${featurePage}"><span hidden data-official-app-ready="${featurePage}"></span><div class="toolbar"><input value="搜索名称或文件名"><button>导入</button></div><section class="resource-grid"><article class="resource-card"><i></i><strong>示例角色</strong><small>角色卡 · 收藏</small></article><article class="resource-card"><i></i><strong>城市设定</strong><small>世界书 · 12 条</small></article><article class="resource-card"><strong>界面正则</strong><small>正则 · HTML / CSS</small></article></section></main></div></body></html>`
})
</script>

<template>
  <section ref="previewHost" class="appearance-studio">
    <FeatureAppHeader title="外观" @back="emit('back')">
      <template #status>
        <span class="feature-header-status">本机生效</span>
      </template>
    </FeatureAppHeader>

    <div class="appearance-studio__grid">
      <section class="appearance-panel">
        <header>
          <div>
            <small>THEME</small>
            <h2>界面明暗</h2>
          </div>
        </header>
        <div class="settings-theme" role="radiogroup" aria-label="选择界面主题">
          <button
            type="button"
            role="radio"
            :aria-checked="theme === 'light'"
            :class="{ 'settings-theme__option--active': theme === 'light' }"
            @click="emit('update:theme', 'light')"
          >
            <span class="settings-theme__sample settings-theme__sample--light"></span
            ><strong>浅色档案</strong>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="theme === 'dark'"
            :class="{ 'settings-theme__option--active': theme === 'dark' }"
            @click="emit('update:theme', 'dark')"
          >
            <span class="settings-theme__sample settings-theme__sample--dark"></span
            ><strong>深色档案</strong>
          </button>
        </div>
      </section>

      <section class="appearance-panel appearance-panel--font-scale">
        <header>
          <div>
            <small>TYPE SIZE</small>
            <h2>文字大小</h2>
          </div>
          <span>不会缩放整个页面</span>
        </header>
        <div class="font-scale-options" role="radiogroup" aria-label="文字大小">
          <button
            v-for="option in fontScales"
            :key="option.value"
            type="button"
            role="radio"
            :data-font-scale="option.value"
            :aria-checked="uiFontScale === option.value"
            :class="{ 'is-active': uiFontScale === option.value }"
            @click="emit('update:uiFontScale', option.value)"
          >
            <span class="font-scale-option__sample" aria-hidden="true">字</span>
            <span
              ><strong>{{ option.title }}</strong
              ><small>{{ option.description }}</small></span
            >
            <i aria-hidden="true">{{ uiFontScale === option.value ? '✓' : '' }}</i>
          </button>
        </div>
      </section>

      <section class="appearance-panel appearance-panel--layout">
        <header>
          <div>
            <small>RESOURCE VIEW</small>
            <h2>资源排版</h2>
          </div>
          <span>不会改变筛选</span>
        </header>
        <div class="layout-settings__options" role="radiogroup" aria-label="资源排版">
          <button
            v-for="layout in layouts"
            :key="layout.value"
            type="button"
            class="layout-option"
            :class="{ 'layout-option--active': layoutMode === layout.value }"
            role="radio"
            :aria-checked="layoutMode === layout.value"
            @click="emit('update:layoutMode', layout.value)"
          >
            <span
              class="layout-option__preview"
              :class="`layout-option__preview--${layout.value}`"
              aria-hidden="true"
              ><i v-for="cell in layout.cells" :key="cell"></i
            ></span>
            <span class="layout-option__copy"
              ><small>{{ layout.eyebrow }}</small
              ><strong>{{ layout.title }}</strong
              ><span>{{ layout.description }}</span></span
            >
            <span class="layout-option__check" aria-hidden="true">{{
              layoutMode === layout.value ? '✓' : ''
            }}</span>
          </button>
        </div>
      </section>

      <section class="appearance-panel appearance-panel--cabinet">
        <header>
          <div>
            <h2>收藏柜布局</h2>
          </div>
          <span>固定三行</span>
        </header>
        <p>文件夹少可以放大图标，收藏多则保留四列。分页、空位和拖动会自动适配。</p>
        <div class="cabinet-density" role="radiogroup" aria-label="收藏柜每行图标数量">
          <button
            v-for="density in cabinetDensities"
            :key="density.value"
            type="button"
            role="radio"
            :data-cabinet-columns="density.value"
            :aria-checked="cabinetColumns === density.value"
            :class="{ 'is-active': cabinetColumns === density.value }"
            @click="selectCabinetColumns(density.value)"
          >
            <span
              class="cabinet-density__preview"
              :style="{ '--density-columns': density.value }"
              aria-hidden="true"
            >
              <i v-for="cell in density.value * 3" :key="cell"></i>
            </span>
            <strong>{{ density.value }} 列 · {{ density.title }}</strong>
            <small>{{ density.description }}</small>
            <b aria-hidden="true">{{ cabinetColumns === density.value ? '✓' : '' }}</b>
          </button>
        </div>
      </section>

      <section class="appearance-panel appearance-panel--code">
        <header>
          <div>
            <small>CUSTOM CSS</small>
            <h2>可分享的自定义样式</h2>
          </div>
          <AppearanceOriginalCssActions />
        </header>
        <p>
          每个预设互相独立，可导出为 CSS 文件分享。写错导致界面无法操作时，按 Alt + Shift + 0
          清除当前样式。
        </p>

        <section class="appearance-preset-manager">
          <header>
            <div>
              <small>PRESET LIBRARY</small><strong>预设库</strong
              ><span>{{ presets.length }} / 30 份保存在本机</span>
            </div>
            <i :class="{ 'is-dirty': hasUnsavedChanges }">{{ presetState }}</i>
          </header>
          <div class="appearance-preset-fields">
            <label
              ><span>正在编辑</span
              ><select :value="activePresetId" @change="selectPreset">
                <option v-if="!savedDraft" :value="draft.id">{{ draft.name }}（未保存）</option>
                <option v-for="preset in presets" :key="preset.id" :value="preset.id">
                  {{ preset.name }}
                </option>
              </select></label
            >
            <label
              ><span>预设名称</span
              ><input v-model="draft.name" maxlength="40" placeholder="例如：夜间玻璃风"
            /></label>
          </div>
          <div class="appearance-preset-tools">
            <button type="button" @click="newPreset"><b>＋</b><span>新建空白预设</span></button>
            <button type="button" @click="importInput?.click()">
              <b>↑</b><span>导入 CSS / 预设</span>
            </button>
            <button type="button" @click="exportPreset"><b>↓</b><span>导出 CSS</span></button>
            <button type="button" @click="exportEditablePreset">
              <b>↓</b><span>导出可编辑预设</span>
            </button>
          </div>
          <input
            ref="importInput"
            hidden
            type="file"
            accept=".css,.json,text/css,application/json"
            multiple
            @change="importPresets"
          />
        </section>

        <label class="appearance-code-editor"
          ><span>全局 CSS <small>会作用于整个应用</small></span
          ><textarea
            v-model="draft.globalCss"
            spellcheck="false"
            placeholder="例如：:root { --color-accent: #7d4be2; }"
          ></textarea>
        </label>

        <details class="appearance-advanced">
          <summary>
            <span><strong>按界面精细装修</strong><small>只想改某个页面时再展开</small></span
            ><i>高级</i>
          </summary>
          <div class="appearance-scope-tabs" role="tablist" aria-label="选择要装修的界面">
            <button
              v-for="scope in activeScopes"
              :key="scope.value"
              type="button"
              role="tab"
              :aria-selected="activeScope === scope.value"
              :class="{ 'is-active': activeScope === scope.value }"
              @click="activeScope = scope.value"
            >
              {{ scope.title }}<i v-if="draft.scopedCss[scope.value]">●</i>
            </button>
          </div>
          <p v-if="installationError" role="status">{{ installationError }}</p>
          <p v-else-if="!installationsLoaded" role="status">正在读取 APP 安装状态…</p>
          <details v-if="inactiveScopes.length">
            <summary>未安装 APP / 待恢复的样式（{{ inactiveScopes.length }}）</summary>
            <p>样式保留在预设与备份中，安装后自动恢复。可在这里提前编辑。</p>
            <div class="appearance-scope-tabs" role="tablist" aria-label="未安装 APP 的样式">
              <button
                v-for="scope in inactiveScopes"
                :key="scope.value"
                type="button"
                role="tab"
                :aria-selected="activeScope === scope.value"
                :class="{ 'is-active': activeScope === scope.value }"
                @click="activeScope = scope.value"
              >
                {{ scope.title }}<i v-if="draft.scopedCss[scope.value]">●</i>
              </button>
            </div>
          </details>
          <p>
            {{ selectedScope?.hint }}。
            <template v-if="selectedScope?.selector"
              >保存时会自动限制在
              <code>{{ selectedScope.selector }}</code> 内，不需要手写外层选择器。</template
            >
            <template v-else>该界面暂不可用，样式仅保存、不应用。</template>
          </p>
          <div class="appearance-scope-editor__header">
            <strong>{{ selectedScope?.title }}专用 CSS</strong>
            <AppearanceOriginalCssActions v-if="selectedScope" :scope="selectedScope" />
          </div>
          <label class="appearance-code-editor">
            <textarea
              v-model="activeScopedCss"
              spellcheck="false"
              placeholder="在此填写本界面的自定义 CSS"
            ></textarea>
          </label>
        </details>

        <div class="appearance-code-actions">
          <span role="status">{{ copyStatus }}</span
          ><button type="button" @click="preview">保存前预览</button
          ><button type="button" @click="clearDraft">清空草稿</button
          ><button type="button" @click="deletePreset">
            {{ savedDraft ? '删除预设' : '放弃草稿' }}</button
          ><button v-if="savedDraft" type="button" @click="saveAsNewPreset">另存为新预设</button
          ><button
            class="button--primary"
            type="button"
            :disabled="!hasUnsavedChanges"
            @click="savePreset"
          >
            {{ hasUnsavedChanges ? '保存并应用' : '已保存' }}
          </button>
        </div>
      </section>

      <section v-if="isPreviewOpen" class="appearance-panel appearance-panel--preview">
        <header>
          <div>
            <small>PREVIEW</small>
            <h2>保存前预览</h2>
          </div>
          <button type="button" @click="isPreviewOpen = false">关闭预览</button>
        </header>
        <iframe
          v-if="previewEnabled"
          :key="previewCss"
          :srcdoc="previewDocument"
          sandbox=""
          title="自定义 CSS 隔离预览"
        ></iframe>
        <p v-else role="status">预览资源已暂停，回到当前区域后恢复。</p>
      </section>
    </div>
  </section>
</template>
