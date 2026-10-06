import { computed, effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLibraryImport } from './UseLibraryImport'
import * as personalImport from '../services/PersonalResourceImport'
import { hashBlob } from '../services/HashService'

const {
  inspectArchive,
  readResourceArchive,
  tavernFiles,
  startKeepAlive,
  stopKeepAlive,
  suspendKeepAlive,
  confirmImportAction,
  resourceService,
  selectMigrationEdits,
} = vi.hoisted(() => ({
  inspectArchive: vi.fn(),
  readResourceArchive: vi.fn(),
  tavernFiles: vi.fn(),
  startKeepAlive: vi.fn(),
  stopKeepAlive: vi.fn(),
  suspendKeepAlive: vi.fn(),
  confirmImportAction: vi.fn(),
  resourceService: {
    get: vi.fn(),
    findByContentHash: vi.fn(),
    findVersionCandidateForGroup: vi.fn(),
    rememberRecognizedFileHash: vi.fn().mockResolvedValue('b'.repeat(64)),
    getVersion: vi.fn(),
    importAsVersion: vi.fn(),
    importFiles: vi.fn(),
  },
  selectMigrationEdits: vi.fn(),
}))

vi.mock('../core/LibraryContainer', () => ({
  resourceArchiveService: { inspect: inspectArchive, readResourceArchive, tavernFiles },
  resourceService,
}))

vi.mock('../services/CharacterCardMigrationReview', () => ({
  migrateCharacterCardContentWithReview: vi.fn(),
  selectCharacterCardMigrationEdits: selectMigrationEdits,
}))

vi.mock('../services/NativeImportKeepAlive', () => ({
  isNativeImportKeepAliveAvailable: () => true,
  startNativeImportKeepAlive: startKeepAlive,
  stopNativeImportKeepAlive: stopKeepAlive,
  suspendNativeImportKeepAlive: suspendKeepAlive,
  updateNativeImportKeepAlive: vi.fn(),
}))

vi.mock('../core/NativeSecurity', () => ({
  requestNativeNotifications: vi.fn().mockResolvedValue(true),
}))

vi.mock('./UseConfirmDialog', () => ({
  confirmAction: confirmImportAction,
}))

describe('shared backup route handoff', () => {
  beforeEach(() => {
    inspectArchive.mockReset()
    readResourceArchive.mockReset()
    tavernFiles.mockReset()
    startKeepAlive.mockReset().mockResolvedValue(true)
    stopKeepAlive.mockReset().mockResolvedValue(undefined)
    suspendKeepAlive.mockReset().mockResolvedValue(undefined)
    confirmImportAction.mockReset().mockResolvedValue(true)
    resourceService.get.mockReset()
    resourceService.findByContentHash.mockReset()
    resourceService.findVersionCandidateForGroup.mockReset()
    resourceService.rememberRecognizedFileHash.mockReset().mockResolvedValue('b'.repeat(64))
    resourceService.getVersion.mockReset()
    resourceService.importAsVersion.mockReset().mockResolvedValue({ id: 'resource-1' })
    resourceService.importFiles.mockReset()
    selectMigrationEdits.mockReset()
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retains a transformed source digest and skips re-encryption when resuming a committed share', async () => {
    const source = new File(['{"private":"source"}'], 'secret.json', { type: 'application/json' })
    const encrypted = new File(['{"protected":"random-iv"}'], 'secret.json', {
      type: 'application/json',
    })
    const sourceHash = await hashBlob(source)
    const committedHash = await hashBlob(encrypted)
    const protect = vi.spyOn(personalImport, 'protectPersonalImport').mockResolvedValue(encrypted)
    const markImportItemCompleted = vi.fn().mockResolvedValue(undefined)
    const context = {
      isBusy: ref(false),
      isNativeApk: false,
      pendingBackupImport: ref<File>(),
      pendingVersionImports: ref([]),
      extractCharacterAssets: ref(false),
      persistResourceVersionMatchCache: ref(false),
      skipVersionComparisonOnImport: ref(false),
      hideCharacterAssets: ref(true),
      LARGE_IMPORT_BYTES: 1024,
      backupRecommended: ref(false),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }
    resourceService.importFiles.mockImplementation(async (files, options) => {
      expect(options.originalContentHashes.get(files[0])).toBe(sourceHash)
      await options.onItemComplete({
        status: 'imported',
        fileName: source.name,
        sourceContentHash: sourceHash,
        resource: { contentHash: committedHash, fileSize: encrypted.size },
      })
      return []
    })
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const batch = {
      files: [source],
      markImportItemCompleted,
      acknowledge: vi.fn().mockResolvedValue(undefined),
    }
    expect(await importer.handleSharedImportChoice([source], 'resource', batch)).toBe('consumed')
    expect(markImportItemCompleted).toHaveBeenCalledWith(committedHash, sourceHash)
    expect(protect).toHaveBeenCalledOnce()
    resourceService.findByContentHash.mockResolvedValue({ id: 'saved', contentHash: committedHash })
    expect(
      await importer.handleSharedImportChoice([source], 'resource', {
        ...batch,
        completedImportAliases: { [sourceHash]: committedHash },
      }),
    ).toBe('consumed')
    expect(protect).toHaveBeenCalledOnce()
    expect(resourceService.importFiles.mock.calls.at(-1)?.[0]).toEqual([source])
    scope.stop()
  })

  it('passes cloud version callbacks to the existing decision owner and waits for a committed hash', async () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    const file = new File(['{"name":"卡"}'], 'card.json')
    const candidate = { status: 'versionCandidate', fileName: file.name, file, candidates: [] }
    const pending = ref<(typeof candidate)[]>([])
    const context = {
      isBusy: ref(false),
      isNativeApk: false,
      pendingBackupImport: ref<File>(),
      pendingVersionImports: pending,
      activeVersionImport: computed(() => pending.value[0]),
      isVersionImportBusy: ref(false),
      extractCharacterAssets: ref(false),
      persistResourceVersionMatchCache: ref(false),
      skipVersionComparisonOnImport: ref(false),
      hideCharacterAssets: ref(true),
      LARGE_IMPORT_BYTES: 1024,
      backupRecommended: ref(false),
      loadResources: vi.fn(),
      refreshStorageHealth: vi.fn(),
      showNotice: vi.fn(),
    }
    const resultObserver = vi.fn()
    const resolved = vi.fn()
    resourceService.importFiles.mockImplementationOnce(async (_files, options) => {
      await options.onItemComplete(candidate)
      return []
    })
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    expect(
      await importer.handleSharedImportChoice([file], 'resource', {
        files: [file],
        recoveryId: 'cloud-version-test',
        acknowledge: vi.fn(),
        onItemComplete: resultObserver,
        onVersionResolved: resolved,
      }),
    ).toBe('consumed')
    expect(resultObserver).toHaveBeenCalledWith(candidate)
    expect(resolved).not.toHaveBeenCalled()
    resourceService.importFiles.mockResolvedValueOnce([
      { status: 'imported', resource: { contentHash: 'c'.repeat(64) } },
    ])
    await importer.handleVersionImportDecision({ action: 'independent' })
    expect(resolved).toHaveBeenCalledWith('c'.repeat(64))
    expect(pending.value).toHaveLength(0)
    scope.stop()
  })

  it('分享导入逐项提交后保存检查点哈希，并传入已完成项供恢复跳过', async () => {
    const file = new File(['{}'], 'card.json', { type: 'application/json' })
    const completedHash = 'a'.repeat(64)
    const markImportItemCompleted = vi.fn().mockResolvedValue(undefined)
    const context = {
      isBusy: ref(false),
      isNativeApk: false,
      pendingBackupImport: ref<File>(),
      pendingVersionImports: ref([]),
      extractCharacterAssets: ref(false),
      persistResourceVersionMatchCache: ref(false),
      skipVersionComparisonOnImport: ref(false),
      hideCharacterAssets: ref(true),
      LARGE_IMPORT_BYTES: 1024,
      backupRecommended: ref(false),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }
    resourceService.importFiles.mockImplementation(async (_files, options) => {
      expect(options?.completedContentHashes).toEqual(['b'.repeat(64)])
      expect(options?.discardCompletedResults).toBe(true)
      await options?.onItemComplete?.({
        status: 'imported',
        fileName: file.name,
        resource: { contentHash: completedHash, fileSize: file.size } as never,
      })
      return []
    })
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    const outcome = await importer.handleSharedImportChoice([file], 'resource', {
      files: [file],
      completedContentHashes: ['b'.repeat(64)],
      markImportItemCompleted,
      acknowledge: vi.fn().mockResolvedValue(undefined),
    })
    scope.stop()

    expect(outcome).toBe('consumed')
    expect(markImportItemCompleted).toHaveBeenCalledWith(completedHash)
  })

  it('sends a selected resource archive directly through resource extraction', async () => {
    const archive = new File(['zip'], 'resources.zip')
    const resource = new File(['{}'], 'card.json', { type: 'application/json' })
    readResourceArchive.mockResolvedValue({ kind: 'resources', files: [resource] })
    resourceService.importFiles.mockResolvedValue([
      {
        status: 'duplicate',
        fileName: resource.name,
        message: '已经存在',
        resource: { id: 'resource-1', type: 'characterCard', name: '角色卡' },
      },
    ])
    const input = { files: [archive], value: '' } as unknown as HTMLInputElement
    const context = {
      isBusy: ref(false),
      isNativeApk: false,
      pendingBackupImport: ref<File>(),
      pendingVersionImports: ref([]),
      extractCharacterAssets: ref(false),
      persistResourceVersionMatchCache: ref(false),
      skipVersionComparisonOnImport: ref(false),
      hideCharacterAssets: ref(true),
      LARGE_IMPORT_BYTES: 1024,
      backupRecommended: ref(false),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    await importer.handleResourceArchiveImport({ target: input } as unknown as Event)
    scope.stop()

    expect(readResourceArchive).toHaveBeenCalledWith(archive, expect.any(Function))
    expect(resourceService.importFiles).toHaveBeenCalledWith(
      [resource],
      expect.objectContaining({ extractCharacterAssets: false }),
    )
    expect(inspectArchive).not.toHaveBeenCalled()
    expect(context.isBusy.value).toBe(false)
  })

  it('sends a selected library backup straight to restore preflight', async () => {
    const file = new File(['zip'], 'library-backup.zip')
    const input = { files: [file], value: '' } as unknown as HTMLInputElement
    const pendingBackupImport = ref<File>()
    const openRestorePanel = vi.fn()
    const handleRestoreInspect = vi.fn().mockResolvedValue(undefined)
    const context = {
      isBusy: ref(false),
      pendingBackupImport,
      openRestorePanel,
      handleRestoreInspect,
    }
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    await importer.handleLibraryBackupImport({ target: input } as unknown as Event)
    scope.stop()

    expect(openRestorePanel).toHaveBeenCalledWith('import')
    expect(handleRestoreInspect).toHaveBeenCalledWith(file)
    expect(inspectArchive).not.toHaveBeenCalled()
  })

  it('keeps a structurally valid SRL ZIP pending for restore even from the Tavern share route', async () => {
    inspectArchive.mockResolvedValue('library')
    const file = new File(['{}'], 'backup.zip')
    const pendingBackupImport = ref<File>()
    const openRestorePanel = vi.fn()
    const handleRestoreInspect = vi.fn().mockResolvedValue(undefined)
    const context = {
      isBusy: ref(false),
      pendingBackupImport,
      openRestorePanel,
      handleRestoreInspect,
      showNotice: vi.fn(),
    }

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice([file], 'tavernBackup', {
      files: [file],
      acknowledge: vi.fn().mockResolvedValue(undefined),
    })
    scope.stop()

    expect(result).toBe(false)
    expect(pendingBackupImport.value).toBeUndefined()
    expect(openRestorePanel).not.toHaveBeenCalled()
    expect(handleRestoreInspect).not.toHaveBeenCalled()
    expect(inspectArchive).toHaveBeenCalledTimes(1)
    expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('实际是资源库备份'))
  })

  it('stops an in-flight KeepAlive start if the app returns to foreground', async () => {
    let visibilityListener: (() => void) | undefined
    const documentMock = {
      visibilityState: 'hidden',
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        visibilityListener = listener
      }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('document', documentMock)
    inspectArchive.mockResolvedValue('library')
    let finishStart!: (started: boolean) => void
    startKeepAlive.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishStart = resolve
      }),
    )
    const file = new File(['{}'], 'backup.zip')
    const context = {
      isBusy: ref(false),
      pendingBackupImport: ref<File>(),
      openRestorePanel: vi.fn(),
      handleRestoreInspect: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }
    const scope = effectScope()
    const api = scope.run(() => useLibraryImport(() => context as never))!
    const handling = api.handleSharedImportChoice([file], 'libraryBackup')

    await vi.waitFor(() => expect(startKeepAlive).toHaveBeenCalledTimes(1))
    documentMock.visibilityState = 'visible'
    visibilityListener?.()
    finishStart(true)
    expect(await handling).toBe('restore')
    expect(suspendKeepAlive).toHaveBeenCalledTimes(1)
    scope.stop()
    expect(documentMock.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
  })

  it('sends a structurally valid Tavern ZIP through the Tavern parser', async () => {
    inspectArchive.mockResolvedValue('tavern')
    tavernFiles.mockImplementation(async function* () {})
    const file = new File(['{}'], 'tavern.zip')
    const context = {
      isBusy: ref(false),
      isRestorePanelOpen: ref(false),
      pendingVersionImports: ref([]),
      showNotice: vi.fn(),
    }

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice([file], 'tavernBackup')
    scope.stop()

    expect(result).toBe('consumed')
    expect(tavernFiles).toHaveBeenCalledTimes(1)
  })

  it('resumes shared Tavern imports by passing committed item hashes to each batch', async () => {
    inspectArchive.mockResolvedValue('tavern')
    const resource = new File(['{}'], 'card.json', { type: 'application/json' })
    tavernFiles.mockImplementation(async function* () {
      yield resource
    })
    const completedHash = 'c'.repeat(64)
    const markImportItemCompleted = vi.fn().mockResolvedValue(undefined)
    resourceService.importFiles.mockImplementation(async (_files, options) => {
      expect(options?.completedContentHashes).toEqual(['b'.repeat(64)])
      await options?.onItemComplete?.({
        status: 'imported',
        fileName: resource.name,
        resource: { contentHash: completedHash, fileSize: resource.size } as never,
      })
      return []
    })
    const context = {
      isBusy: ref(false),
      isNativeApk: false,
      pendingBackupImport: ref<File>(),
      isRestorePanelOpen: ref(false),
      extractCharacterAssets: ref(false),
      persistResourceVersionMatchCache: ref(false),
      skipVersionComparisonOnImport: ref(false),
      hideCharacterAssets: ref(true),
      LARGE_IMPORT_BYTES: 1024,
      backupRecommended: ref(false),
      pendingVersionImports: ref([]),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice(
      [new File(['zip'], 'tavern.zip')],
      'tavernBackup',
      {
        files: [],
        completedContentHashes: ['b'.repeat(64)],
        markImportItemCompleted,
        acknowledge: vi.fn().mockResolvedValue(undefined),
      },
    )
    scope.stop()

    expect(inspectArchive).toHaveBeenCalledTimes(1)
    expect(tavernFiles).toHaveBeenCalledTimes(1)
    expect(resourceService.importFiles).toHaveBeenCalledWith(
      [resource],
      expect.objectContaining({ completedContentHashes: ['b'.repeat(64)] }),
    )
    expect(result).toBe('consumed')
    expect(markImportItemCompleted).toHaveBeenCalledWith(completedHash)
  })

  it('locks other import entrances while a shared archive is being inspected', async () => {
    const importedResource = new File(['{}'], 'card.json', { type: 'application/json' })
    const otherFile = new File(['{}'], 'other.json', { type: 'application/json' })
    let finishInspection!: (value: { kind: 'resources'; files: File[] }) => void
    readResourceArchive.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInspection = resolve
        }),
    )
    resourceService.importFiles.mockResolvedValue([])
    const context = {
      isBusy: ref(false),
      isNativeApk: false,
      pendingBackupImport: ref<File>(),
      pendingVersionImports: ref([]),
      extractCharacterAssets: ref(false),
      persistResourceVersionMatchCache: ref(false),
      skipVersionComparisonOnImport: ref(false),
      hideCharacterAssets: ref(true),
      LARGE_IMPORT_BYTES: 1024,
      backupRecommended: ref(false),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
      showNotice: vi.fn(),
    }
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    const sharedImport = importer.handleSharedImportChoice(
      [new File(['zip'], 'shared.zip')],
      'resource',
      { files: [], completedContentHashes: [], acknowledge: vi.fn().mockResolvedValue(undefined) },
    )
    expect(context.isBusy.value).toBe(true)
    await importer.processImportedFiles([otherFile])
    expect(resourceService.importFiles).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(readResourceArchive).toHaveBeenCalledTimes(1))

    finishInspection({ kind: 'resources', files: [importedResource] })
    expect(await sharedImport).toBe('consumed')
    expect(context.isBusy.value).toBe(false)
    expect(resourceService.importFiles).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('releases the shared import lock if background protection cannot start', async () => {
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    startKeepAlive.mockRejectedValueOnce(new Error('service unavailable'))
    const context = {
      isBusy: ref(false),
      showNotice: vi.fn(),
    }
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    expect(
      await importer.handleSharedImportChoice([new File(['zip'], 'shared.zip')], 'resource', {
        files: [],
        acknowledge: vi.fn().mockResolvedValue(undefined),
      }),
    ).toBe(false)
    expect(context.isBusy.value).toBe(false)
    scope.stop()
  })

  it('rejects a Tavern archive selected through the library route without rerouting it', async () => {
    inspectArchive.mockResolvedValue('tavern')
    tavernFiles.mockImplementation(async function* () {})
    const file = new File(['{}'], 'backup.zip')
    const context = {
      isBusy: ref(false),
      isNativeApk: true,
      isRestorePanelOpen: ref(false),
      pendingVersionImports: ref([]),
      showNotice: vi.fn(),
    }

    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!
    const result = await importer.handleSharedImportChoice([file], 'libraryBackup')
    scope.stop()

    expect(result).toBe(false)
    expect(inspectArchive).toHaveBeenCalledTimes(1)
    expect(tavernFiles).not.toHaveBeenCalled()
    expect(startKeepAlive).not.toHaveBeenCalled()
    expect(stopKeepAlive).not.toHaveBeenCalled()
    expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('实际是酒馆备份'), 9000)
  })
})

describe('container variant import decisions', () => {
  const characterEdits = [
    {
      id: 'edit-1',
      section: 'greeting' as const,
      operation: 'update' as const,
      targetKey: 'first_mes',
      label: '开场白',
      before: '旧内容',
      after: '新内容',
      migrateToVersions: true,
      updatedAt: 1,
    },
  ]

  beforeEach(() => {
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    resourceService.importAsVersion.mockReset().mockResolvedValue({ id: 'resource-1' })
    selectMigrationEdits.mockReset()
    resourceService.get.mockResolvedValue({
      id: 'resource-1',
      type: 'characterCard',
      metadata: { characterContentEdits: characterEdits },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each(['archive', 'activate'] as const)(
    '%s completes a same-content container binding without migration review',
    async (action) => {
      const file = new File(['variant'], 'variant.png', { type: 'image/png' })
      const pendingVersionImports = ref([
        {
          status: 'versionCandidate' as const,
          fileName: file.name,
          file,
          candidates: [
            {
              resource: {
                id: 'resource-1',
                type: 'characterCard',
                metadata: {},
              },
              matchedResource: {
                id: 'resource-1',
                type: 'characterCard',
                metadata: {},
              },
              matchedHistorical: false,
              matchKind: 'containerVariant' as const,
              score: 100,
              reasons: [],
            },
          ],
        },
      ])
      const context = {
        activeVersionImport: computed(() => pendingVersionImports.value[0]),
        isVersionImportBusy: ref(false),
        pendingVersionImports,
        extractCharacterAssets: ref(false),
        showNotice: vi.fn(),
        loadResources: vi.fn().mockResolvedValue(undefined),
        refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
      }
      const scope = effectScope()
      const importer = scope.run(() => useLibraryImport(() => context as never))!

      await importer.handleVersionImportDecision({ action, targetId: 'resource-1' })
      scope.stop()

      expect(selectMigrationEdits).not.toHaveBeenCalled()
      expect(resourceService.importAsVersion).toHaveBeenCalledOnce()
      expect(resourceService.importAsVersion.mock.calls[0]?.[8]).toEqual(
        action === 'activate' ? characterEdits : undefined,
      )
      expect(pendingVersionImports.value).toHaveLength(0)
      expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('已绑定'))
    },
  )

  it('刷新同批下一项的候选，优先绑定到刚确认的当前版本', async () => {
    const firstFile = new File(['v2'], 'card-v2.json', { type: 'application/json' })
    const nextFile = new File(['v2-png'], 'card-v2.png', { type: 'image/png' })
    const staleCandidate = {
      resource: { id: 'resource-1', type: 'characterCard', metadata: {} },
      matchedResource: { id: 'old-version', type: 'characterCard', metadata: {} },
      matchedHistorical: true,
      matchKind: 'version' as const,
      score: 90,
      reasons: ['命中历史版本'],
    }
    const freshCandidate = {
      ...staleCandidate,
      matchedResource: { id: 'resource-1', type: 'characterCard', metadata: {} },
      matchedHistorical: false,
      matchKind: 'containerVariant' as const,
      score: 100,
      reasons: ['卡数据一致'],
    }
    const pendingVersionImports = ref([
      {
        status: 'versionCandidate' as const,
        fileName: firstFile.name,
        file: firstFile,
        candidates: [staleCandidate],
      },
      {
        status: 'versionCandidate' as const,
        fileName: nextFile.name,
        file: nextFile,
        candidates: [staleCandidate],
      },
    ])
    resourceService.findVersionCandidateForGroup.mockResolvedValue(freshCandidate)
    const context = {
      activeVersionImport: computed(() => pendingVersionImports.value[0]),
      isVersionImportBusy: ref(false),
      pendingVersionImports,
      extractCharacterAssets: ref(false),
      showNotice: vi.fn(),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
    }
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    await importer.handleVersionImportDecision({ action: 'archive', targetId: 'resource-1' })
    scope.stop()

    expect(resourceService.findVersionCandidateForGroup).toHaveBeenCalledWith(
      nextFile,
      'resource-1',
      { sameNameVersionCandidates: false },
    )
    expect(pendingVersionImports.value[0]?.candidates).toEqual([freshCandidate])
  })

  it('用户在图片对比后确认已有资源时不重复保存并刷新同批下一项', async () => {
    const file = new File(['same card'], 'same-card.png', { type: 'image/png' })
    const existingCandidate = {
      resource: {
        id: 'resource-1',
        type: 'characterCard',
        name: '已有角色卡',
        contentHash: 'a'.repeat(64),
        metadata: {},
      },
      matchedResource: { id: 'resource-1', type: 'characterCard', metadata: {} },
      matchedHistorical: false,
      matchKind: 'containerVariant' as const,
      score: 100,
      reasons: ['卡数据一致'],
    }
    const pendingVersionImports = ref([
      {
        status: 'versionCandidate' as const,
        fileName: file.name,
        file,
        sourceContentHash: 'b'.repeat(64),
        candidates: [existingCandidate],
      },
      {
        status: 'versionCandidate' as const,
        fileName: 'same-card.json',
        file: new File(['same card'], 'same-card.json', { type: 'application/json' }),
        candidates: [],
      },
    ])
    resourceService.findVersionCandidateForGroup.mockResolvedValue({
      ...existingCandidate,
      matchKind: 'contentDuplicate',
    })
    const context = {
      activeVersionImport: computed(() => pendingVersionImports.value[0]),
      isVersionImportBusy: ref(false),
      pendingVersionImports,
      extractCharacterAssets: ref(false),
      showNotice: vi.fn(),
      loadResources: vi.fn().mockResolvedValue(undefined),
      refreshStorageHealth: vi.fn().mockResolvedValue(undefined),
    }
    const scope = effectScope()
    const importer = scope.run(() => useLibraryImport(() => context as never))!

    await importer.handleVersionImportDecision({ action: 'existing', targetId: 'resource-1' })
    scope.stop()

    expect(resourceService.importAsVersion).not.toHaveBeenCalled()
    expect(resourceService.importFiles).not.toHaveBeenCalled()
    expect(pendingVersionImports.value[0]?.candidates).toEqual([
      expect.objectContaining({ matchKind: 'contentDuplicate' }),
    ])
    expect(context.showNotice).toHaveBeenCalledWith(expect.stringContaining('以后会自动跳过'))
  })
})
