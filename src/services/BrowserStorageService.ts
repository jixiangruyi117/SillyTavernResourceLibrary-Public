import { Capacitor } from '@capacitor/core'
import type { TavernConflictPolicy } from './TavernBridgeProtocol'

export interface BridgeTransferDraft {
  direction: 'pull' | 'send'
  origin: string
  policy: TavernConflictPolicy
  at: number
  items: Array<{
    key: string
    name: string
    label: string
    status: 'pending' | 'active' | 'done' | 'failed'
    detail: string
    operationId?: string
  }>
}
import type { UserPersonaTemplate } from '../types/UserPersona'
import type { PresetFavoriteSnapshot } from '../utils/PresetStitcher'
import {
  type PresetStitchTemplate,
  type ChatLoadout,
  type ResourceBundleTemplate,
  type StorageHealth,
  type LayoutMode,
  type UiFontScale,
  type CabinetColumns,
  type PreviewPolicy,
  type CustomCssPreset,
  type PortableAppearanceSettings,
  type PortableGeneralPreferences,
  type CabinetLayoutEntry,
  type PresetStitchDraft,
  type ProjectNoticeStoragePlugin,
} from '../types/BrowserPreferences'
import { LAYOUT_MODES, UI_FONT_SCALES, CABINET_COLUMN_OPTIONS } from '../types/BrowserPreferences'
import * as operationsBrowserPreferenceNormalization from './BrowserPreferenceNormalization'

export {
  type PresetStitchTemplate,
  type ChatLoadout,
  type ResourceBundleTemplate,
  type StorageHealth,
  type LayoutMode,
  type UiFontScale,
  type CabinetColumns,
  type PreviewPolicy,
  type CustomCssScope,
  type CustomCssPreset,
  type PortableAppearanceSettings,
  type PortableGeneralPreferences,
  type CabinetLayoutEntry,
  type PresetStitchDraftEntry,
  type PresetStitchDraft,
} from '../types/BrowserPreferences'

export { LAYOUT_MODES, UI_FONT_SCALES, CABINET_COLUMN_OPTIONS } from '../types/BrowserPreferences'

export const PROJECT_NOTICE_VERSION = '2026-09-21-v2'

const LAST_FULL_BACKUP_KEY = 'srl-last-full-backup'

const PRESET_STITCH_DRAFT_KEY = 'srl.stitch.draft'

const PRESET_STITCH_CHECKPOINT_KEY = 'srl.stitch.checkpoint'

const PRESET_STITCH_RECENT_KEY = 'srl.stitch.recentPresets'

const PRESET_STITCH_FAVORITES_KEY = 'srl.stitch.favoriteEntries'

const PRESET_STITCH_TEMPLATES_KEY = 'srl.stitch.templates'

const PRESET_STITCH_MAIN_SIDE_KEY = 'srl.stitch.mainSide'

const FRONTEND_WORKSHOP_RECENT_COLORS_KEY = 'srl.frontendWorkshop.recentColors'

const PROJECT_NOTICE_ACKNOWLEDGED_KEY = 'srl.projectNotice.acknowledgedVersion'

const PROJECT_NOTICE_ACKNOWLEDGED_COOKIE = 'srl_project_notice'

function getNativeProjectNoticeStorage(): ProjectNoticeStoragePlugin | undefined {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return undefined
  return (
    window as { Capacitor?: { Plugins?: { ProjectNoticeStorage?: ProjectNoticeStoragePlugin } } }
  ).Capacitor?.Plugins?.ProjectNoticeStorage
}

const SEARCH_HISTORY_KEY = 'srl-search-history'

const LAYOUT_MODE_KEY = 'srl.ui.layoutMode'

const UI_FONT_SCALE_KEY = 'srl.ui.fontScale'

const EXTRACT_CHARACTER_ASSETS_KEY = 'srl.import.extractCharacterAssets'

const SHOW_MANUALLY_BOUND_RESOURCES_KEY = 'srl.library.showManuallyBoundResources'
const HIDE_CHAT_DISPLAY_REGEX_KEY = 'srl.library.hideChatDisplayRegex'
const HIDE_CHARACTER_ASSETS_KEY = 'srl.library.hideCharacterAssets'

const BLUR_THUMBNAILS_KEY = 'srl.library.blurThumbnails'

const DRAW_SHOW_NAMES_KEY = 'srl.draw.showNames'

const PREVIEW_REMOTE_RESOURCES_KEY = 'srl.preview.allowRemoteResources'

const PREVIEW_SCRIPTS_KEY = 'srl.preview.allowScripts'

const PREVIEW_GREETING_PRELOAD_KEY = 'srl.preview.preloadGreetingResources'

const PREVIEW_BEAUTIFICATION_PRELOAD_KEY = 'srl.preview.preloadBeautificationResources'

const CUSTOM_UI_CSS_KEY = 'srl.ui.customCss'

const CUSTOM_UI_PRESETS_KEY = 'srl.ui.customCssPresets'

const ACTIVE_CUSTOM_UI_PRESET_KEY = 'srl.ui.activeCustomCssPreset'

const CABINET_RESOURCE_IDS_KEY = 'srl.cabinet.resourceIds'

const CABINET_LAYOUT_KEY = 'srl.cabinet.layout'

const CABINET_COLUMNS_KEY = 'srl.cabinet.columns'

const USER_PERSONA_TEMPLATES_KEY = 'srl.userPersona.templates'

const RESOURCE_BUNDLES_KEY = 'srl.resourceBundles.templates'

const CHAT_LOADOUTS_KEY = 'srl.chatLoadouts'

const PREVIEW_POLICY_EVENT = 'srl-preview-policy-change'

const SEARCH_HISTORY_LIMIT = 10

export class BrowserStorageService {
  exportStitchWork(): {
    draft?: PresetStitchDraft
    checkpoint?: PresetStitchDraft
    recentPresets?: string[]
  } {
    return {
      draft: this.getPresetStitchDraft(),
      checkpoint: this.getPresetStitchCheckpoint(),
      recentPresets: this.getStitchRecentIds(),
    }
  }

  importStitchWork(value: {
    draft?: PresetStitchDraft
    checkpoint?: PresetStitchDraft
    recentPresets?: string[]
  }): void {
    if (value.draft) this.setPresetStitchDraft(value.draft)
    if (value.checkpoint) this.setPresetStitchCheckpoint(value.checkpoint)
    if (value.recentPresets) {
      for (const id of value.recentPresets.slice().reverse()) this.pushStitchRecentId(id)
    }
  }
  exportAppearanceSettings(): PortableAppearanceSettings {
    let theme: 'light' | 'dark' = 'light'
    try {
      theme = localStorage.getItem('srl-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      // 继续使用浅色默认值。
    }
    return {
      theme,
      layoutMode: this.getLayoutMode(),
      fontScale: this.getUiFontScale(),
      customCss: this.getCustomUiCss(),
      presets: this.getCustomUiPresets(),
      activePresetId: this.getActiveCustomUiPresetId(),
    }
  }

  importAppearanceSettings(value: PortableAppearanceSettings): void {
    try {
      localStorage.setItem('srl-theme', value?.theme === 'dark' ? 'dark' : 'light')
    } catch {
      // 其余外观项目仍可继续恢复。
    }
    this.setLayoutMode(LAYOUT_MODES.includes(value?.layoutMode) ? value.layoutMode : 'grid')
    this.setUiFontScale(
      UI_FONT_SCALES.includes(value?.fontScale as UiFontScale)
        ? (value.fontScale as UiFontScale)
        : 'standard',
    )
    this.setCustomUiCss(typeof value?.customCss === 'string' ? value.customCss : '')
    this.setCustomUiPresets(Array.isArray(value?.presets) ? value.presets : [])
    this.setActiveCustomUiPresetId(
      typeof value?.activePresetId === 'string' ? value.activePresetId : '',
    )
  }

  exportGeneralPreferences(): PortableGeneralPreferences {
    return {
      previewPolicy: this.getPreviewPolicy(),
      extractCharacterAssets: this.getExtractCharacterAssets(),
      hideCharacterAssets: this.getHideCharacterAssets(),
      hideChatDisplayRegex: this.getHideChatDisplayRegex(),
      showManuallyBoundResources: this.getShowManuallyBoundResources(),
      searchHistory: this.getSearchHistory(),
      blurThumbnails: this.getBlurThumbnails(),
      cabinetResourceIds: this.getCabinetResourceIds(),
      cabinetLayout: this.getCabinetLayout(),
      cabinetColumns: this.getCabinetColumns(),
      userPersonaTemplates: this.getUserPersonaTemplates(),
      stitchFavorites: this.getStitchFavorites(),
      stitchTemplates: this.getStitchTemplates(),
      stitchMainSide: this.getStitchMainSide(),
      frontendWorkshopRecentColors: this.getFrontendWorkshopRecentColors(),
      chatLoadouts: this.getChatLoadouts(),
    }
  }

  importGeneralPreferences(value: PortableGeneralPreferences): void {
    this.setPreviewPolicy({
      allowRemoteResources: value?.previewPolicy?.allowRemoteResources === true,
      allowScripts: value?.previewPolicy?.allowScripts === true,
    })
    this.setExtractCharacterAssets(value?.extractCharacterAssets === true)
    this.setHideCharacterAssets(value?.hideCharacterAssets !== false)
    this.setHideChatDisplayRegex(value?.hideChatDisplayRegex !== false)
    this.setShowManuallyBoundResources(value?.showManuallyBoundResources !== false)
    this.setBlurThumbnails(value?.blurThumbnails !== false)
    this.setCabinetResourceIds(value?.cabinetResourceIds ?? [])
    this.setCabinetLayout(value?.cabinetLayout ?? [])
    this.setCabinetColumns(value?.cabinetColumns ?? 4)
    this.setUserPersonaTemplates(value?.userPersonaTemplates ?? [])
    this.setStitchFavorites(value?.stitchFavorites ?? [])
    this.setStitchTemplates(value?.stitchTemplates ?? [])
    this.setStitchMainSide(value?.stitchMainSide === 'left' ? 'left' : 'right')
    this.setFrontendWorkshopRecentColors(value?.frontendWorkshopRecentColors ?? [])
    this.setChatLoadouts(value?.chatLoadouts ?? value?.resourceBundles ?? [])
    this.writeSearchHistory(
      (Array.isArray(value?.searchHistory) ? value.searchHistory : [])
        .filter((item): item is string => typeof item === 'string')
        .slice(0, SEARCH_HISTORY_LIMIT),
    )
  }

  getCabinetResourceIds(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(CABINET_RESOURCE_IDS_KEY) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return Array.from(
        new Set(parsed.filter((item): item is string => typeof item === 'string' && Boolean(item))),
      ).slice(0, 5000)
    } catch {
      return []
    }
  }

  setCabinetResourceIds(resourceIds: string[]): void {
    const normalized = Array.from(
      new Set(
        resourceIds.filter((item): item is string => typeof item === 'string' && Boolean(item)),
      ),
    ).slice(0, 5000)
    try {
      localStorage.setItem(CABINET_RESOURCE_IDS_KEY, JSON.stringify(normalized))
    } catch {
      // 收藏柜桌面布局写入失败时，不阻断文件夹与资源本身的使用。
    }
  }

  getCabinetLayout(): CabinetLayoutEntry[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(CABINET_LAYOUT_KEY) ?? '[]')
      return this.normalizeCabinetLayout(parsed)
    } catch {
      return []
    }
  }

  setCabinetLayout(layout: CabinetLayoutEntry[]): void {
    try {
      localStorage.setItem(CABINET_LAYOUT_KEY, JSON.stringify(this.normalizeCabinetLayout(layout)))
    } catch {
      // 收藏柜槽位属于可恢复偏好，写入失败时不影响资源和文件夹本体。
    }
  }

  getCabinetColumns(): CabinetColumns {
    try {
      const value = Number(localStorage.getItem(CABINET_COLUMNS_KEY))
      return CABINET_COLUMN_OPTIONS.includes(value as CabinetColumns)
        ? (value as CabinetColumns)
        : 4
    } catch {
      return 4
    }
  }

  setCabinetColumns(value: number): CabinetColumns {
    const normalized = CABINET_COLUMN_OPTIONS.includes(value as CabinetColumns)
      ? (value as CabinetColumns)
      : 4
    try {
      localStorage.setItem(CABINET_COLUMNS_KEY, String(normalized))
    } catch {
      // 收藏柜密度属于本机视觉偏好，写入失败时继续使用四列默认值。
    }
    return normalized
  }

  getUserPersonaTemplates(): UserPersonaTemplate[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(USER_PERSONA_TEMPLATES_KEY) ?? '[]')
      return this.normalizeUserPersonaTemplates(parsed)
    } catch {
      return []
    }
  }

  setUserPersonaTemplates(value: UserPersonaTemplate[]): UserPersonaTemplate[] {
    const normalized = this.normalizeUserPersonaTemplates(value)
    try {
      localStorage.setItem(USER_PERSONA_TEMPLATES_KEY, JSON.stringify(normalized))
    } catch {
      // 自定义人设模板属于本机偏好，写入失败时不影响当前人设编辑。
    }
    return normalized
  }

  getPreviewPolicy(): PreviewPolicy {
    try {
      const allowScripts = localStorage.getItem(PREVIEW_SCRIPTS_KEY) === 'true'
      return {
        allowScripts,
        allowRemoteResources:
          allowScripts || localStorage.getItem(PREVIEW_REMOTE_RESOURCES_KEY) === 'true',
        preloadGreetingResources: localStorage.getItem(PREVIEW_GREETING_PRELOAD_KEY) === 'true',
        preloadBeautificationResources:
          localStorage.getItem(PREVIEW_BEAUTIFICATION_PRELOAD_KEY) === 'true',
      }
    } catch {
      return {
        allowRemoteResources: false,
        allowScripts: false,
        preloadGreetingResources: false,
        preloadBeautificationResources: false,
      }
    }
  }

  setPreviewPolicy(value: PreviewPolicy): PreviewPolicy {
    const normalized = {
      allowScripts: value.allowScripts,
      allowRemoteResources: value.allowScripts || value.allowRemoteResources,
      preloadGreetingResources: value.preloadGreetingResources === true,
      preloadBeautificationResources: value.preloadBeautificationResources === true,
    }
    try {
      localStorage.setItem(PREVIEW_REMOTE_RESOURCES_KEY, String(normalized.allowRemoteResources))
      localStorage.setItem(PREVIEW_SCRIPTS_KEY, String(normalized.allowScripts))
      localStorage.setItem(
        PREVIEW_GREETING_PRELOAD_KEY,
        String(normalized.preloadGreetingResources),
      )
      localStorage.setItem(
        PREVIEW_BEAUTIFICATION_PRELOAD_KEY,
        String(normalized.preloadBeautificationResources),
      )
      window.dispatchEvent(new CustomEvent(PREVIEW_POLICY_EVENT, { detail: normalized }))
    } catch {
      // 隐私模式拒绝写入时，当前组件仍可使用传入的新状态。
    }
    return normalized
  }

  onPreviewPolicyChange(listener: (value: PreviewPolicy) => void): () => void {
    const handler = (event: Event) =>
      listener((event as CustomEvent<PreviewPolicy>).detail ?? this.getPreviewPolicy())
    window.addEventListener(PREVIEW_POLICY_EVENT, handler)
    return () => window.removeEventListener(PREVIEW_POLICY_EVENT, handler)
  }

  getCustomUiCss(): string {
    try {
      return localStorage.getItem(CUSTOM_UI_CSS_KEY) ?? ''
    } catch {
      return ''
    }
  }

  setCustomUiCss(value: string): void {
    try {
      localStorage.setItem(CUSTOM_UI_CSS_KEY, value)
    } catch {
      // 自定义样式写入失败不影响当前会话应用。
    }
  }

  getCustomUiPresets(): CustomCssPreset[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_UI_PRESETS_KEY) ?? '[]') as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (item): item is CustomCssPreset =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as CustomCssPreset).id === 'string' &&
          typeof (item as CustomCssPreset).name === 'string' &&
          typeof (item as CustomCssPreset).globalCss === 'string',
      )
    } catch {
      return []
    }
  }

  setCustomUiPresets(value: CustomCssPreset[]): void {
    try {
      localStorage.setItem(CUSTOM_UI_PRESETS_KEY, JSON.stringify(value.slice(0, 30)))
    } catch {
      // CSS 预设属于可导出的偏好，写入失败时仍允许当前会话继续编辑。
    }
  }

  getActiveCustomUiPresetId(): string {
    try {
      return localStorage.getItem(ACTIVE_CUSTOM_UI_PRESET_KEY) ?? ''
    } catch {
      return ''
    }
  }

  setActiveCustomUiPresetId(value: string): void {
    try {
      localStorage.setItem(ACTIVE_CUSTOM_UI_PRESET_KEY, value)
    } catch {
      // 当前预设指针写入失败不影响 CSS 本身的应用。
    }
  }

  getDrawShowNames(): boolean {
    try {
      const value = localStorage.getItem(DRAW_SHOW_NAMES_KEY)
      return value == null ? true : value === 'true'
    } catch {
      return true
    }
  }

  setDrawShowNames(enabled: boolean): void {
    try {
      localStorage.setItem(DRAW_SHOW_NAMES_KEY, String(enabled))
    } catch {
      // 抽卡显示偏好写入失败时，当前会话仍可正常使用。
    }
  }

  getShowManuallyBoundResources(): boolean {
    try {
      return localStorage.getItem(SHOW_MANUALLY_BOUND_RESOURCES_KEY) !== 'false'
    } catch {
      return true
    }
  }

  setShowManuallyBoundResources(enabled: boolean): void {
    try {
      localStorage.setItem(SHOW_MANUALLY_BOUND_RESOURCES_KEY, String(enabled))
    } catch {
      /* 当前会话仍应用此显示偏好。 */
    }
  }

  getHideChatDisplayRegex(): boolean {
    try {
      return localStorage.getItem(HIDE_CHAT_DISPLAY_REGEX_KEY) !== 'false'
    } catch {
      return true
    }
  }

  setHideChatDisplayRegex(enabled: boolean): void {
    try {
      localStorage.setItem(HIDE_CHAT_DISPLAY_REGEX_KEY, String(enabled))
    } catch {
      /* The current session still applies the display preference. */
    }
  }

  getHideCharacterAssets(): boolean {
    try {
      const value = localStorage.getItem(HIDE_CHARACTER_ASSETS_KEY)
      return value == null ? true : value === 'true'
    } catch {
      return true
    }
  }

  setHideCharacterAssets(enabled: boolean): void {
    try {
      localStorage.setItem(HIDE_CHARACTER_ASSETS_KEY, String(enabled))
    } catch {
      // 显示偏好写入失败时，不影响当前会话继续筛选。
    }
  }

  getBlurThumbnails(): boolean {
    try {
      const value = localStorage.getItem(BLUR_THUMBNAILS_KEY)
      return value == null ? true : value === 'true'
    } catch {
      return true
    }
  }

  setBlurThumbnails(enabled: boolean): void {
    try {
      localStorage.setItem(BLUR_THUMBNAILS_KEY, String(enabled))
    } catch {
      // 缩略图模糊偏好写入失败时，不影响当前会话继续使用。
    }
  }

  getExtractCharacterAssets(): boolean {
    try {
      return localStorage.getItem(EXTRACT_CHARACTER_ASSETS_KEY) === 'true'
    } catch {
      return false
    }
  }

  setExtractCharacterAssets(enabled: boolean): void {
    try {
      localStorage.setItem(EXTRACT_CHARACTER_ASSETS_KEY, String(enabled))
    } catch {
      // 导入偏好写入失败时，不影响当前会话继续导入。
    }
  }

  getLayoutMode(): LayoutMode {
    try {
      const value = localStorage.getItem(LAYOUT_MODE_KEY)
      return LAYOUT_MODES.includes(value as LayoutMode) ? (value as LayoutMode) : 'grid'
    } catch {
      return 'grid'
    }
  }

  setLayoutMode(value: LayoutMode): void {
    try {
      localStorage.setItem(LAYOUT_MODE_KEY, value)
    } catch {
      // 排版偏好写入失败时，当前会话仍可正常切换。
    }
  }

  getUiFontScale(): UiFontScale {
    try {
      const value = localStorage.getItem(UI_FONT_SCALE_KEY)
      return UI_FONT_SCALES.includes(value as UiFontScale) ? (value as UiFontScale) : 'standard'
    } catch {
      return 'standard'
    }
  }

  setUiFontScale(value: UiFontScale): UiFontScale {
    const normalized = UI_FONT_SCALES.includes(value) ? value : 'standard'
    try {
      localStorage.setItem(UI_FONT_SCALE_KEY, normalized)
    } catch {
      // 写入失败时仍返回当前会话可应用的安全档位。
    }
    return normalized
  }

  async getHealth(): Promise<StorageHealth> {
    if (!navigator.storage) {
      return { supported: false, persisted: false, usage: 0, quota: 0 }
    }

    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted?.().catch(() => false) ?? false,
      navigator.storage.estimate?.().catch((): StorageEstimate => ({})) ??
        Promise.resolve<StorageEstimate>({}),
    ])
    return {
      supported: true,
      persisted,
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    }
  }

  async requestPersistence(): Promise<StorageHealth> {
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false)
    return this.getHealth()
  }

  getLastFullBackupAt(): number | undefined {
    try {
      const value = Number(localStorage.getItem(LAST_FULL_BACKUP_KEY))
      return Number.isFinite(value) && value > 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  recordFullBackup(at = Date.now()): void {
    try {
      localStorage.setItem(LAST_FULL_BACKUP_KEY, String(at))
    } catch {
      // 浏览器禁用 localStorage 时，导出本身仍然有效。
    }
  }

  /** 互传报告：最近 20 条跨会话保留，供下次打开互传中心时回看。 */
  getBridgeTransferLog(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem('srl-bridge-transfer-log') || '[]')
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : []
    } catch {
      return []
    }
  }

  appendBridgeTransferLog(entries: string[]): string[] {
    const next = [...entries, ...this.getBridgeTransferLog()].slice(0, 20)
    try {
      localStorage.setItem('srl-bridge-transfer-log', JSON.stringify(next))
    } catch {
      // 报告属于非关键偏好，写入失败不影响传输。
    }
    return next
  }

  getBridgeTransferDraft(): BridgeTransferDraft | undefined {
    try {
      const value = JSON.parse(
        localStorage.getItem('srl-bridge-transfer-draft') || 'null',
      ) as BridgeTransferDraft | null
      if (
        !value ||
        !['pull', 'send'].includes(value.direction) ||
        typeof value.origin !== 'string' ||
        !['copy', 'skip', 'overwrite'].includes(value.policy) ||
        !Number.isFinite(value.at) ||
        Date.now() - value.at > 7 * 86400_000 ||
        !Array.isArray(value.items) ||
        value.items.length > 200
      )
        return
      if (
        value.items.some(
          (item) =>
            !item ||
            typeof item.key !== 'string' ||
            typeof item.name !== 'string' ||
            typeof item.label !== 'string' ||
            typeof item.detail !== 'string' ||
            !['pending', 'active', 'done', 'failed'].includes(item.status) ||
            (item.operationId !== undefined &&
              (typeof item.operationId !== 'string' || !/^[\w-]{16,80}$/.test(item.operationId))),
        )
      )
        return
      return value
    } catch {
      return
    }
  }

  setBridgeTransferDraft(value: BridgeTransferDraft): void {
    try {
      // Only task metadata: no files, endpoint credentials, pairing tokens or encryption keys.
      localStorage.setItem(
        'srl-bridge-transfer-draft',
        JSON.stringify({ ...value, items: value.items.slice(0, 200) }),
      )
    } catch {
      /* A disabled preference store must not prevent an otherwise valid transfer. */
    }
  }

  /** 缝了么：装配区非空时的本地草稿，防误退丢工作。 */
  getPresetStitchDraft(): PresetStitchDraft | undefined {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(PRESET_STITCH_DRAFT_KEY) || 'null')
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as PresetStitchDraft).baseId === 'string' &&
        Array.isArray((parsed as PresetStitchDraft).entries)
      ) {
        return parsed as PresetStitchDraft
      }
      return undefined
    } catch {
      return undefined
    }
  }

  setPresetStitchDraft(draft: PresetStitchDraft): void {
    try {
      localStorage.setItem(PRESET_STITCH_DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // 草稿属于便利功能，写入失败不阻断缝合流程。
    }
  }

  clearPresetStitchDraft(): void {
    try {
      localStorage.removeItem(PRESET_STITCH_DRAFT_KEY)
    } catch {
      // 同上。
    }
  }

  /** 缝了么：用户手动保存的单个工作台检查点。 */
  getPresetStitchCheckpoint(): PresetStitchDraft | undefined {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(PRESET_STITCH_CHECKPOINT_KEY) || 'null',
      )
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as PresetStitchDraft).baseId === 'string' &&
        Array.isArray((parsed as PresetStitchDraft).entries)
      ) {
        return parsed as PresetStitchDraft
      }
      return undefined
    } catch {
      return undefined
    }
  }

  setPresetStitchCheckpoint(checkpoint: PresetStitchDraft): void {
    try {
      localStorage.setItem(PRESET_STITCH_CHECKPOINT_KEY, JSON.stringify(checkpoint))
    } catch {
      // 检查点属于本机便利功能，写入失败不阻断缝合流程。
    }
  }

  clearPresetStitchCheckpoint(): void {
    try {
      localStorage.removeItem(PRESET_STITCH_CHECKPOINT_KEY)
    } catch {
      // 同上。
    }
  }

  /** 缝了么：最近用过的预设置顶（底板或来源），最多保留 6 个。 */
  getStitchRecentIds(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(PRESET_STITCH_RECENT_KEY) || '[]')
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6)
        : []
    } catch {
      return []
    }
  }

  pushStitchRecentId(id: string): void {
    const next = [id, ...this.getStitchRecentIds().filter((item) => item !== id)].slice(0, 6)
    try {
      localStorage.setItem(PRESET_STITCH_RECENT_KEY, JSON.stringify(next))
    } catch {
      // 同上。
    }
  }

  /** 缝了么：收藏条目保存完整 prompt 快照，来源资源删除后仍可复用。 */
  getStitchFavorites(): PresetFavoriteSnapshot[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(PRESET_STITCH_FAVORITES_KEY) || '[]')
      return this.normalizeStitchFavorites(parsed)
    } catch {
      return []
    }
  }

  setStitchFavorites(value: PresetFavoriteSnapshot[]): PresetFavoriteSnapshot[] {
    const normalized = this.normalizeStitchFavorites(value)
    try {
      localStorage.setItem(PRESET_STITCH_FAVORITES_KEY, JSON.stringify(normalized))
    } catch {
      // 收藏属于本机便利数据，写入失败不阻断预设编辑与导出。
    }
    return normalized
  }

  getStitchTemplates(): PresetStitchTemplate[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(PRESET_STITCH_TEMPLATES_KEY) || '[]')
      return this.normalizeStitchTemplates(parsed)
    } catch {
      return []
    }
  }

  setStitchTemplates(value: PresetStitchTemplate[]): PresetStitchTemplate[] {
    const normalized = this.normalizeStitchTemplates(value)
    try {
      localStorage.setItem(PRESET_STITCH_TEMPLATES_KEY, JSON.stringify(normalized))
    } catch {
      // 缝合包是可恢复偏好，写入失败不阻断本次缝合。
    }
    return normalized
  }

  getChatLoadouts(): ChatLoadout[] {
    try {
      const current = localStorage.getItem(CHAT_LOADOUTS_KEY)
      const legacy = localStorage.getItem(RESOURCE_BUNDLES_KEY)
      return this.normalizeChatLoadouts(JSON.parse(current ?? legacy ?? '[]'))
    } catch {
      return []
    }
  }

  setChatLoadouts(value: ChatLoadout[]): ChatLoadout[] {
    const normalized = this.normalizeChatLoadouts(value)
    try {
      localStorage.setItem(CHAT_LOADOUTS_KEY, JSON.stringify(normalized))
    } catch {
      // 装载方案是可恢复偏好，写入失败不影响资源本体或永久资源关系。
    }
    return normalized
  }

  /** @deprecated 使用 getChatLoadouts。 */
  getResourceBundles(): ResourceBundleTemplate[] {
    return this.getChatLoadouts()
  }

  /** @deprecated 使用 setChatLoadouts。 */
  setResourceBundles(value: ResourceBundleTemplate[]): ResourceBundleTemplate[] {
    return this.setChatLoadouts(value)
  }

  getStitchMainSide(): 'left' | 'right' {
    try {
      return localStorage.getItem(PRESET_STITCH_MAIN_SIDE_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  }

  setStitchMainSide(value: 'left' | 'right'): 'left' | 'right' {
    const normalized = value === 'left' ? 'left' : 'right'
    try {
      localStorage.setItem(PRESET_STITCH_MAIN_SIDE_KEY, normalized)
    } catch {
      // 左右习惯属于非关键偏好。
    }
    return normalized
  }

  getFrontendWorkshopDrawerSize(): { bottom: number; side: number } {
    try {
      const value = JSON.parse(localStorage.getItem('srl.frontendWorkshop.drawerSize') ?? '{}')
      const normalize = (n: unknown, fallback: number) =>
        typeof n === 'number' && Number.isFinite(n) ? Math.max(0.12, Math.min(0.95, n)) : fallback
      return { bottom: normalize(value?.bottom, 0.46), side: normalize(value?.side, 0.32) }
    } catch {
      return { bottom: 0.46, side: 0.32 }
    }
  }

  setFrontendWorkshopDrawerSize(value: { bottom: number; side: number }): void {
    try {
      localStorage.setItem('srl.frontendWorkshop.drawerSize', JSON.stringify(value))
    } catch {
      /* Nonessential device layout; editing must remain available. */
    }
  }

  getFrontendWorkshopRecentColors(): string[] {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(FRONTEND_WORKSHOP_RECENT_COLORS_KEY) ?? '[]',
      )
      return this.normalizeFrontendWorkshopRecentColors(value)
    } catch {
      return []
    }
  }

  setFrontendWorkshopRecentColors(value: unknown): string[] {
    const normalized = this.normalizeFrontendWorkshopRecentColors(value)
    try {
      localStorage.setItem(FRONTEND_WORKSHOP_RECENT_COLORS_KEY, JSON.stringify(normalized))
    } catch {
      // 最近色属于非关键设备偏好，写入失败不阻断当前编辑。
    }
    return normalized
  }

  pushFrontendWorkshopRecentColor(value: string): string[] {
    return this.setFrontendWorkshopRecentColors([value, ...this.getFrontendWorkshopRecentColors()])
  }

  private normalizeFrontendWorkshopRecentColors(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().toUpperCase())
          .filter((item) => /^#[0-9A-F]{6}$/u.test(item)),
      ),
    ).slice(0, 12)
  }

  hasAcknowledgedProjectNotice(): boolean {
    const hasCookie = () => {
      try {
        return document.cookie
          .split(';')
          .map((item) => item.trim())
          .includes(`${PROJECT_NOTICE_ACKNOWLEDGED_COOKIE}=${PROJECT_NOTICE_VERSION}`)
      } catch {
        return false
      }
    }
    try {
      return (
        localStorage.getItem(PROJECT_NOTICE_ACKNOWLEDGED_KEY) === PROJECT_NOTICE_VERSION ||
        hasCookie()
      )
    } catch {
      return hasCookie()
    }
  }

  async hasAcknowledgedProjectNoticePersisted(): Promise<boolean> {
    if (this.hasAcknowledgedProjectNotice()) return true
    try {
      const version = (await getNativeProjectNoticeStorage()?.getAcknowledgedVersion())?.version
      return version === PROJECT_NOTICE_VERSION
    } catch {
      return false
    }
  }

  acknowledgeProjectNotice(): void {
    try {
      localStorage.setItem(PROJECT_NOTICE_ACKNOWLEDGED_KEY, PROJECT_NOTICE_VERSION)
    } catch {
      // WebView 的 localStorage 不可用或尚未落盘时，仍由同设备 Cookie 保留确认记录。
    }
    try {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${PROJECT_NOTICE_ACKNOWLEDGED_COOKIE}=${PROJECT_NOTICE_VERSION}; Max-Age=315360000; Path=/; SameSite=Lax${secure}`
    } catch {
      // 这是设备侧的首次阅读提示；两种本地存储都不可用时，本次仍可继续使用。
    }
    void getNativeProjectNoticeStorage()
      ?.setAcknowledgedVersion({ version: PROJECT_NOTICE_VERSION })
      .catch(() => undefined)
  }

  getSearchHistory(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]')
      return Array.isArray(parsed)
        ? parsed
            .filter((item): item is string => typeof item === 'string')
            .slice(0, SEARCH_HISTORY_LIMIT)
        : []
    } catch {
      return []
    }
  }

  saveSearch(query: string): string[] {
    const normalized = query.trim()
    if (!normalized) return this.getSearchHistory()
    const history = [
      normalized,
      ...this.getSearchHistory().filter(
        (item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase(),
      ),
    ].slice(0, SEARCH_HISTORY_LIMIT)
    this.writeSearchHistory(history)
    return history
  }

  clearSearchHistory(): void {
    this.writeSearchHistory([])
  }

  private writeSearchHistory(history: string[]): void {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))
    } catch {
      // 历史记录属于非关键偏好，写入失败不影响搜索。
    }
  }

  private normalizeCabinetLayout(value: unknown): CabinetLayoutEntry[] {
    return operationsBrowserPreferenceNormalization.normalizeCabinetLayout(value)
  }

  private normalizeUserPersonaTemplates(value: unknown): UserPersonaTemplate[] {
    return operationsBrowserPreferenceNormalization.normalizeUserPersonaTemplates(value)
  }

  private normalizeStitchFavorites(value: unknown): PresetFavoriteSnapshot[] {
    return operationsBrowserPreferenceNormalization.normalizeStitchFavorites(value)
  }

  private normalizeStitchTemplates(value: unknown): PresetStitchTemplate[] {
    return operationsBrowserPreferenceNormalization.normalizeStitchTemplates(value)
  }

  private normalizeChatLoadouts(value: unknown): ChatLoadout[] {
    return operationsBrowserPreferenceNormalization.normalizeChatLoadouts(value)
  }
}
