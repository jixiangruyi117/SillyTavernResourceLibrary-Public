import type { Component } from 'vue'
// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=official-app-loader-runtime-imports
import { defineComponent, h } from 'vue'
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=official-app-loader-runtime-imports
import { getFeatureAppDescriptor, type BuiltInFeatureAppId } from './FeatureAppRegistry'
// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=official-app-loader-import
import { isOfficialAppId } from '../types/OfficialApp'
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=official-app-loader-import

// SRL-PUBLIC-SYNC: BEGIN REPLACE id=public-feature-app-loaders
/** Keep UI imports out of metadata consumers such as appearance and uninstall services. */
export function getFeatureAppLoader(
  id: BuiltInFeatureAppId,
): () => Promise<{ default: Component }> {
  const descriptor = getFeatureAppDescriptor(id)
  if (isOfficialAppId(id)) {
    return async () => {
      const { default: Gate } = await import('../components/OfficialAppGate.vue')
      return {
        default: defineComponent({
          inheritAttrs: false,
          setup:
            (_, { attrs }) =>
            () =>
              h(Gate, { ...attrs, appId: id, appName: descriptor.name }),
        }),
      }
    }
  }
  switch (id) {
    case 'appearance':
      return () => import('../components/AppearanceStudio.vue')
    case 'cloud':
      return () => import('../components/CloudBackupCenter.vue')
    case 'inbox':
      return () => import('../components/DiscordInboxCenter.vue')
    case 'extensions':
      return () => import('../components/ExternalAppManager.vue')
    default:
      throw new Error(`内置功能 APP 缺少异步入口：${id}`)
  }
}
// SRL-PUBLIC-SYNC: END REPLACE id=public-feature-app-loaders
