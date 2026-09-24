import { defineComponent, h, type Component } from 'vue'
import { getFeatureAppDescriptor, type BuiltInFeatureAppId } from './FeatureAppRegistry'
import { isOfficialAppId } from '../types/OfficialApp'

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
    case 'extensions':
      return () => import('../components/ExternalAppManager.vue')
    default:
      throw new Error(`内置功能 APP 缺少异步入口：${id}`)
  }
}
