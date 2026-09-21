/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import { BrowserStorageService } from './BrowserStorageService'

describe('BrowserStorageService cabinet desktop resources', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'srl_project_notice=; Max-Age=0; Path=/'
  })

  it('remembers bottom and side drawer sizes separately and tolerates corrupt preferences', () => {
    const service = new BrowserStorageService()
    expect(service.getFrontendWorkshopDrawerSize()).toEqual({ bottom: 0.46, side: 0.32 })
    service.setFrontendWorkshopDrawerSize({ bottom: 0.7, side: 0.5 })
    expect(new BrowserStorageService().getFrontendWorkshopDrawerSize()).toEqual({
      bottom: 0.7,
      side: 0.5,
    })
    localStorage.setItem('srl.frontendWorkshop.drawerSize', '{bad')
    expect(service.getFrontendWorkshopDrawerSize()).toEqual({ bottom: 0.46, side: 0.32 })
    localStorage.setItem('srl.frontendWorkshop.drawerSize', '{"bottom":100,"side":-1}')
    expect(service.getFrontendWorkshopDrawerSize()).toEqual({ bottom: 0.95, side: 0.12 })
  })

  it('persists only supported font scale tiers and includes them in appearance backups', () => {
    const service = new BrowserStorageService()

    expect(service.getUiFontScale()).toBe('standard')
    expect(service.setUiFontScale('large')).toBe('large')
    expect(service.exportAppearanceSettings().fontScale).toBe('large')

    localStorage.setItem('srl.ui.fontScale', 'huge')
    expect(service.getUiFontScale()).toBe('standard')

    service.importAppearanceSettings({
      theme: 'light',
      layoutMode: 'grid',
      fontScale: 'small',
      customCss: '',
      presets: [],
      activePresetId: '',
    })
    expect(service.getUiFontScale()).toBe('small')
  })

  it('为开场白和美化分别保存预下载偏好，并兼容旧的两字段预览设置', () => {
    const service = new BrowserStorageService()

    expect(service.getPreviewPolicy()).toEqual({
      allowRemoteResources: false,
      allowScripts: false,
      preloadGreetingResources: false,
      preloadBeautificationResources: false,
    })

    service.setPreviewPolicy({
      allowRemoteResources: true,
      allowScripts: false,
      preloadGreetingResources: true,
      preloadBeautificationResources: false,
    })

    expect(service.getPreviewPolicy()).toEqual({
      allowRemoteResources: true,
      allowScripts: false,
      preloadGreetingResources: true,
      preloadBeautificationResources: false,
    })
    expect(service.setPreviewPolicy({ allowRemoteResources: false, allowScripts: false })).toEqual({
      allowRemoteResources: false,
      allowScripts: false,
      preloadGreetingResources: false,
      preloadBeautificationResources: false,
    })
  })

  it('persists a unique ordered list and includes it in portable preferences', () => {
    const service = new BrowserStorageService()
    service.setCabinetResourceIds(['resource-b', 'resource-a', 'resource-b', ''])

    expect(service.getCabinetResourceIds()).toEqual(['resource-b', 'resource-a'])
    expect(service.exportGeneralPreferences().cabinetResourceIds).toEqual([
      'resource-b',
      'resource-a',
    ])
  })

  it('only remembers the project notice on this device and does not export it as a preference', () => {
    const service = new BrowserStorageService()

    expect(service.hasAcknowledgedProjectNotice()).toBe(false)
    service.acknowledgeProjectNotice()
    expect(service.hasAcknowledgedProjectNotice()).toBe(true)
    expect(service.exportGeneralPreferences()).not.toHaveProperty('projectNoticeAcknowledged')

    localStorage.clear()
    expect(service.hasAcknowledgedProjectNotice()).toBe(true)
    document.cookie = 'srl_project_notice=; Max-Age=0; Path=/'
    expect(service.hasAcknowledgedProjectNotice()).toBe(false)
  })

  it('restores cabinet resource ids from portable preferences', () => {
    const service = new BrowserStorageService()
    service.importGeneralPreferences({
      previewPolicy: { allowRemoteResources: false, allowScripts: false },
      extractCharacterAssets: false,
      hideCharacterAssets: true,
      searchHistory: [],
      cabinetResourceIds: ['resource-a', 'resource-a', 'resource-c'],
    })

    expect(service.getCabinetResourceIds()).toEqual(['resource-a', 'resource-c'])
  })

  it('persists sparse mixed cabinet slots and restores them with portable preferences', () => {
    const service = new BrowserStorageService()
    service.setCabinetLayout([
      { kind: 'resource', id: 'resource-a', slot: 0, columnSpan: 1, rowSpan: 1 },
      { kind: 'folder', id: 'folder-a', slot: 5, columnSpan: 1, rowSpan: 1 },
      { kind: 'folder', id: 'folder-a', slot: 8, columnSpan: 1, rowSpan: 1 },
      { kind: 'resource', id: '', slot: 2, columnSpan: 1, rowSpan: 1 },
    ])

    expect(service.getCabinetLayout()).toEqual([
      { kind: 'resource', id: 'resource-a', slot: 0, columnSpan: 1, rowSpan: 1 },
      { kind: 'folder', id: 'folder-a', slot: 5, columnSpan: 1, rowSpan: 1 },
    ])
    expect(service.exportGeneralPreferences().cabinetLayout).toEqual(service.getCabinetLayout())

    localStorage.clear()
    service.importGeneralPreferences({
      previewPolicy: { allowRemoteResources: false, allowScripts: false },
      extractCharacterAssets: false,
      hideCharacterAssets: true,
      searchHistory: [],
      cabinetResourceIds: ['resource-a'],
      cabinetLayout: [{ kind: 'folder', id: 'folder-a', slot: 3, columnSpan: 1, rowSpan: 1 }],
    })
    expect(service.getCabinetLayout()).toEqual([
      { kind: 'folder', id: 'folder-a', slot: 3, columnSpan: 1, rowSpan: 1 },
    ])
  })

  it('persists only supported cabinet column counts and includes them in portable preferences', () => {
    const service = new BrowserStorageService()
    expect(service.getCabinetColumns()).toBe(4)

    service.setCabinetColumns(2)
    expect(service.getCabinetColumns()).toBe(2)
    expect(service.exportGeneralPreferences().cabinetColumns).toBe(2)

    localStorage.setItem('srl.cabinet.columns', '8')
    expect(service.getCabinetColumns()).toBe(4)
  })

  it('restores cabinet columns from portable preferences', () => {
    const service = new BrowserStorageService()
    service.importGeneralPreferences({
      previewPolicy: { allowRemoteResources: false, allowScripts: false },
      extractCharacterAssets: false,
      hideCharacterAssets: true,
      searchHistory: [],
      cabinetColumns: 3,
    })

    expect(service.getCabinetColumns()).toBe(3)
  })

  it('persists valid custom persona templates and restores them with portable preferences', () => {
    const service = new BrowserStorageService()
    const templates = service.setUserPersonaTemplates([
      { id: 'custom-city', name: '  都市玩家  ', description: '{{user}} 喜欢推理。' },
      { id: 'built-in-id', name: '不能覆盖内置', description: '忽略' },
      { id: 'custom-empty', name: '空内容', description: '  ' },
    ])

    expect(templates).toEqual([
      { id: 'custom-city', name: '都市玩家', description: '{{user}} 喜欢推理。' },
    ])
    expect(service.getUserPersonaTemplates()).toEqual(templates)
    expect(service.exportGeneralPreferences().userPersonaTemplates).toEqual(templates)

    localStorage.clear()
    service.importGeneralPreferences({
      previewPolicy: { allowRemoteResources: false, allowScripts: false },
      extractCharacterAssets: false,
      hideCharacterAssets: true,
      searchHistory: [],
      userPersonaTemplates: templates,
    })
    expect(service.getUserPersonaTemplates()).toEqual(templates)
  })

  it('persists stitch favorites and the preferred main side through portable preferences', () => {
    const service = new BrowserStorageService()
    const favorites = service.setStitchFavorites([
      {
        id: 'favorite-1',
        sourceResourceId: 'preset-1',
        sourceName: '来源预设',
        identifier: 'style-1',
        name: '文风段',
        role: 'system',
        content: '轻小说文风',
        prompt: {
          identifier: 'style-1',
          name: '文风段',
          role: 'system',
          content: '轻小说文风',
          unknown: { keep: true },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    service.setStitchMainSide('left')
    expect(service.getStitchFavorites()).toEqual(favorites)
    expect(service.exportGeneralPreferences()).toMatchObject({
      stitchFavorites: favorites,
      stitchMainSide: 'left',
    })

    const portable = service.exportGeneralPreferences()
    localStorage.clear()
    service.importGeneralPreferences(portable)
    expect(service.getStitchFavorites()).toEqual(favorites)
    expect(service.getStitchMainSide()).toBe('left')
  })

  it('persists stitch templates through portable preferences', () => {
    const service = new BrowserStorageService()
    const templates = service.setStitchTemplates([
      {
        id: 'template-1',
        name: '常用文风',
        entries: [
          {
            id: 'favorite-1',
            sourceName: '来源预设',
            identifier: 'style-1',
            name: '文风段',
            role: 'system',
            content: '轻小说文风',
            prompt: {
              identifier: 'style-1',
              name: '文风段',
              role: 'system',
              content: '轻小说文风',
            },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(service.getStitchTemplates()).toEqual(templates)
    const portable = service.exportGeneralPreferences()
    localStorage.clear()
    service.importGeneralPreferences(portable)
    expect(service.getStitchTemplates()).toEqual(templates)
  })

  it('persists chat loadouts and migrates legacy portable preferences', () => {
    const service = new BrowserStorageService()
    const bundles = service.setChatLoadouts([
      {
        id: 'bundle-1',
        name: '  北境完整套装  ',
        primaryResourceId: 'character-1',
        resourceIds: ['world-1', 'preset-1', 'world-1', 'character-1'],
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'invalid',
        name: '没有配套资源',
        primaryResourceId: 'character-2',
        resourceIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(bundles).toEqual([
      {
        id: 'bundle-1',
        name: '北境完整套装',
        primaryResourceId: 'character-1',
        resourceIds: ['world-1', 'preset-1'],
        createdAt: 1,
        updatedAt: 2,
      },
    ])
    expect(service.exportGeneralPreferences().chatLoadouts).toEqual(bundles)

    localStorage.clear()
    service.importGeneralPreferences({
      previewPolicy: { allowRemoteResources: false, allowScripts: false },
      extractCharacterAssets: false,
      hideCharacterAssets: true,
      searchHistory: [],
      resourceBundles: bundles,
    })
    expect(service.getChatLoadouts()).toEqual(bundles)
  })

  it('saves and clears one manual preset stitch checkpoint', () => {
    const service = new BrowserStorageService()
    const checkpoint = {
      baseId: 'base-1',
      name: '检查点预设',
      savedAt: 1_700_000_000_000,
      entries: [{ origin: 'base' as const, identifier: 'main', enabled: true }],
      regexPickIds: [],
    }
    service.setPresetStitchCheckpoint(checkpoint)
    expect(service.getPresetStitchCheckpoint()).toEqual(checkpoint)
    service.clearPresetStitchCheckpoint()
    expect(service.getPresetStitchCheckpoint()).toBeUndefined()
  })
})
