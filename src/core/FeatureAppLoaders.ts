import type { Component } from 'vue'
import type { BuiltInFeatureAppId } from './FeatureAppRegistry'

/** Public builds load every built-in feature directly from the bundled source tree. */
export function getFeatureAppLoader(
  id: BuiltInFeatureAppId,
): () => Promise<{ default: Component }> {
  switch (id) {
    case 'draw':
      return () => import('../components/DrawApp.vue')
    case 'appearance':
      return () => import('../components/AppearanceStudio.vue')
    case 'folders':
      return () => import('../components/FolderLibraryView.vue')
    case 'cloud':
      return () => import('../components/CloudBackupCenter.vue')
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
    case 'extensions':
      return () => import('../components/ExternalAppManager.vue')
  }
}
