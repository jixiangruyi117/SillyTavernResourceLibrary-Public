import { BrowserStorageService } from './BrowserStorageService'
import { appearanceTransaction } from '../core/AppearanceSafety'
import {
  appAppearanceKey,
  removeAppAppearanceCss,
  SCOPED_CSS_REMOVED_EVENT,
} from '../core/AppearanceScopes'
import type { OfficialAppId } from '../types/OfficialApp'

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
