import { describe, expect, it } from 'vitest'

import {
  FEATURE_APP_REGISTRY,
  getFeatureAppBadge,
  getFeatureAppDescriptor,
} from './FeatureAppRegistry'

import { getFeatureAppLoader } from './FeatureAppLoaders'

describe('FeatureAppRegistry', () => {
  it('registers every built-in feature app in stable desktop order', () => {
    expect(FEATURE_APP_REGISTRY.map((app) => app.id)).toEqual([
      'draw',
      'appearance',
      'folders',
      'cloud',
      'tavernBridge',
      'stitch',
      'frontendWorkshop',
      'imageGeneration',
      'imageAlbum',
      'userPersona',
      'resourceBundle',
      'extensions',
    ])
    expect(new Set(FEATURE_APP_REGISTRY.map((app) => app.page)).size).toBe(
      FEATURE_APP_REGISTRY.length,
    )
  })

  it('resolves component entrypoints separately from registry metadata', () => {
    expect(getFeatureAppLoader('tavernBridge')).toBeTypeOf('function')
    expect(getFeatureAppLoader('draw')).toBeTypeOf('function')
    expect(
      getFeatureAppBadge(getFeatureAppDescriptor('extensions'), {
        drawCount: 3,
        folderCount: 2,
        presetCount: 4,
        userPersonaCount: 5,
        resourceBundleCount: 6,
        enabledExternalAppCount: 7,
      }),
    ).toBe('7 个已启用')
  })
})
