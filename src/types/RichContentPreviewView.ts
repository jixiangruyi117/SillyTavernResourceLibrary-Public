import type { CharacterGreetingRegexRule } from '../utils/CharacterGreetingRegex'
import { type TavernPreviewSourceKind } from '../utils/OpeningPreviewContent'
import { type RenderCompatibilityDiagnostic } from '../utils/RenderCompatibilityRuntime'
import {
  type PreviewRuntimeScript,
  type RichContentPreviewResult,
  type SillyTavernMessageAvatarMode,
} from '../utils/RichContentPreview'

export type RichContentPreviewProps = {
  source: string
  title: string
  active?: boolean
  emptyText?: string
  swipePassthrough?: boolean
  immersive?: boolean
  bare?: boolean
  runtimeScripts?: PreviewRuntimeScript[]
  charAvatar?: Blob
  inspector?: boolean
  renderShell?: 'message' | 'content'
  messageAvatarMode?: SillyTavernMessageAvatarMode
  sourceKind?: TavernPreviewSourceKind
  macroCharName?: string
  macroUserName?: string
  greetingContents?: string[]
  greetingIndex?: number
  characterData?: Record<string, unknown>
  displayRegexRules?: CharacterGreetingRegexRule[]
  frontendWorkshopBehaviorRuntime?: boolean
  preloadResources?: boolean
  /**
   * 由上层确认素材属于当前可交付内容后，即使远程资源总开关关闭，也可在宿主页
   * 受控读取并改写为 blob URL。隔离 iframe 的脚本和网络权限仍保持关闭。
   */
  preloadTrustedResources?: boolean
  /**
   * Keep a requested CSS viewport width while fitting the complete document into a narrower host.
   * The iframe reports its unscaled document height, so a long greeting is never cropped after fit.
   */
  viewportWidth?: number
  scale?: number
}

export type RichContentPreviewEvents = {
  inspect: [target: { id: string; label: string }]
  navigateGreeting: [target: number]
  compatibilityDiagnostic: [diagnostic: RenderCompatibilityDiagnostic]
}

export type CanonicalPreviewSeed = {
  preview?: RichContentPreviewResult
  revision: number
  source: string
  greetingIndex: number
}

export type PreviewPerformanceEvent = {
  stage:
    | 'component-created'
    | 'preview-budget-active'
    | 'vendor-load'
    | 'mvu-parse'
    | 'formatter'
    | 'document-build'
    | 'iframe-load'
  at: number
  durationMs?: number
  greetingIndex?: number
  formatterKind?: 'current' | 'alternate' | 'prewarm' | 'compatibility'
  vendorNames?: string[]
  title: string
}

export type PreviewSessionHost = {
  events: { CHARACTER_MESSAGE_RENDERED: string }
  transitionSwipe: (
    target: number,
    notifyParent?: boolean,
    rendered?: string,
  ) => boolean | Promise<boolean>
  emit: (type: string, args?: unknown[]) => unknown | Promise<unknown>
  context: () => { chat?: Array<{ swipe_id?: number }> }
}
