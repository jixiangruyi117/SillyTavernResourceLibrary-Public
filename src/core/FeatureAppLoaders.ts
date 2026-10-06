import type { Component } from 'vue'
import { getFeatureAppDescriptor, type BuiltInFeatureAppId } from './FeatureAppRegistry'

// SRL-PUBLIC-SYNC: BEGIN REPLACE id=public-feature-app-loaders
/** Load each public built-in locally without the private official-app gate. */
export function getFeatureAppLoader(
  id: BuiltInFeatureAppId,
): () => Promise<{ default: Component }> {
  getFeatureAppDescriptor(id)
  switch (id) {
    case 'appearance':
      return () => import('../components/AppearanceStudio.vue')
    case 'cloud':
      return () => import('../components/CloudBackupCenter.vue')
    case 'inbox':
      return () => import('../components/DiscordInboxCenter.vue')
    case 'extensions':
      return () => import('../components/ExternalAppManager.vue')
    case 'draw':
      return () => import('../components/DrawApp.vue')
    case 'tavernBridge':
      return () => import('../components/TavernBridgeCenter.vue')
    case 'stitch':
      return () => import('../components/PresetStitcherApp.vue')
    case 'frontendWorkshop':
      return () => import('../components/FrontendWorkshopApp.vue')
    case 'imageGeneration':
      return () => import('../components/ImageGenerationApp.vue')
    case 'imageAlbum':
      return () => import('../components/GeneratedImageAlbumApp.vue')
    case 'userPersona':
      return () => import('../components/UserPersonaApp.vue')
    case 'resourceBundle':
      return () => import('../components/ResourceBundleApp.vue')
    case 'chatReader':
      return () => import('../components/ChatReaderApp.vue')
    default:
      throw new Error(`Public 内置功能 APP 缺少异步入口：${id}`)
  }
}
// SRL-PUBLIC-SYNC: END REPLACE id=public-feature-app-loaders
