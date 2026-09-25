import { BrowserStorageService } from './BrowserStorageService'
import { appearanceTransaction } from '../core/AppearanceSafety'
import {
  appAppearanceKey,
  appearanceScopes,
  removeAppAppearanceCss,
  SCOPED_CSS_REMOVED_EVENT,
} from '../core/AppearanceScopes'
import type { OfficialAppId } from '../types/OfficialApp'

/** Forward only the already applied APP scope, never the user's global/other APP CSS. */
export async function readAppliedAppFrameCss(appId: OfficialAppId): Promise<string> {
  const { default: postcss } = await import('postcss')
  const css = document.getElementById('srl-custom-ui-style')?.textContent || ''
  const scope = appearanceScopes().find((item) => item.appId === appId)
  if (!css || !scope) return ''
  try {
    const root = postcss.parse(css)
    return root.nodes
      .flatMap((node) =>
        node.type === 'atrule' && node.name === 'scope' && node.params === `(${scope.selector})`
          ? [
              `@scope (body) {\n${(node.nodes || []).map((child) => child.toString()).join('\n')}\n}`,
            ]
          : [],
      )
      .join('\n')
  } catch {
    // The shell's CSS editor owns syntax feedback; a bad style must not block APP startup.
    return ''
  }
}

export function clearOfficialAppAppearance(id: OfficialAppId): void {
  // Deleting an APP's CSS must not silently confirm other pending appearance changes.
  appearanceTransaction.rollback()
  const storage = new BrowserStorageService()
  const previous = storage.getCustomUiPresets()
  const key = appAppearanceKey(id)
  const nextCss = removeAppAppearanceCss(storage.getCustomUiCss(), previous, id)
  const next = previous.map((preset) => {
    const scopedCss = { ...preset.scopedCss }
    delete scopedCss[key]
    return { ...preset, scopedCss }
  })
  storage.setCustomUiPresets(next)
  if (storage.getCustomUiPresets().some((preset) => preset.scopedCss?.[key] !== undefined))
    throw new Error('局部样式未能删除，请检查本机存储权限')
  storage.setCustomUiCss(nextCss)
  if (storage.getCustomUiCss() !== nextCss) throw new Error('应用中的局部样式未能更新')
  window.dispatchEvent(new CustomEvent(SCOPED_CSS_REMOVED_EVENT, { detail: nextCss }))
}
