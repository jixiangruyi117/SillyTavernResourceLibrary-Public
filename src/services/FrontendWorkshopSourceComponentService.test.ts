import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import type { FrontendWorkshopSourceComponentStorage } from '../storage/FrontendWorkshopSourceComponentStorage'
import type { FrontendWorkshopSourceDocumentStorage } from '../storage/FrontendWorkshopSourceDocumentStorage'
import {
  createFrontendWorkshopSourceComponent,
  type FrontendWorkshopSourceComponent,
} from '../types/FrontendWorkshopSourceComponent'
import type {
  FrontendWorkshopSourceDocument,
  FrontendWorkshopSourceDocumentLastGoodRecord,
} from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiProposal } from '../utils/FrontendWorkshopSourceAiProposal'
import { createFrontendWorkshopSourceComponentAiProjection } from '../utils/FrontendWorkshopSourceComponent'
import type { FrontendWorkshopResolvedSourceSelection } from '../utils/FrontendWorkshopSourceSelection'
import {
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
} from './FrontendWorkshopSourceDocumentService'
import { FrontendWorkshopSourceHistoryService } from './FrontendWorkshopSourceHistoryService'
import { FrontendWorkshopSourcePatchService } from './FrontendWorkshopSourcePatchService'
import {
  FrontendWorkshopSourceComponentRevisionConflictError,
  FRONTEND_WORKSHOP_SOURCE_COMPONENT_PACKAGE_FORMAT,
  FrontendWorkshopSourceComponentService,
} from './FrontendWorkshopSourceComponentService'

class MemoryComponentStorage implements FrontendWorkshopSourceComponentStorage {
  readonly components = new Map<string, FrontendWorkshopSourceComponent>()

  async list(): Promise<FrontendWorkshopSourceComponent[]> {
    return [...this.components.values()].map((item) => structuredClone(item))
  }
  async get(id: string): Promise<FrontendWorkshopSourceComponent | undefined> {
    const value = this.components.get(id)
    return value ? structuredClone(value) : undefined
  }
  async putIfRevision(
    component: FrontendWorkshopSourceComponent,
    expectedRevision: number,
  ): Promise<boolean> {
    const current = this.components.get(component.id)
    if (expectedRevision === 0 ? current : !current || current.revision !== expectedRevision)
      return false
    this.components.set(component.id, structuredClone(component))
    return true
  }
  async setProjectAssociation(
    id: string,
    projectId: string,
    associated: boolean,
  ): Promise<FrontendWorkshopSourceComponent | undefined> {
    const current = this.components.get(id)
    if (!current) return undefined
    const next = structuredClone(current)
    const ids = new Set(next.projectIds)
    if (associated) ids.add(projectId)
    else ids.delete(projectId)
    next.projectIds = [...ids]
    this.components.set(id, next)
    return structuredClone(next)
  }
  async delete(id: string): Promise<void> {
    this.components.delete(id)
  }
}

class MemorySourceStorage implements FrontendWorkshopSourceDocumentStorage {
  readonly documents = new Map<string, FrontendWorkshopSourceDocument>()
  readonly lastGood = new Map<string, FrontendWorkshopSourceDocumentLastGoodRecord>()

  async get(projectId: string): Promise<FrontendWorkshopSourceDocument | undefined> {
    const value = this.documents.get(projectId)
    return value ? structuredClone(value) : undefined
  }
  async put(document: FrontendWorkshopSourceDocument): Promise<void> {
    this.documents.set(document.projectId, structuredClone(document))
  }
  async putAtomic(
    document: FrontendWorkshopSourceDocument,
    lastGood?: FrontendWorkshopSourceDocument,
  ): Promise<void> {
    if (lastGood) {
      this.lastGood.set(lastGood.projectId, {
        projectId: lastGood.projectId,
        document: structuredClone(lastGood),
        savedAt: Date.now(),
      })
    }
    await this.put(document)
  }
  async putAtomicIfRevision(
    document: FrontendWorkshopSourceDocument,
    expectedRevision: number,
  ): Promise<boolean> {
    const current = this.documents.get(document.projectId)
    if (expectedRevision === 0 ? current : !current || current.revision !== expectedRevision)
      return false
    if (current) {
      this.lastGood.set(current.projectId, {
        projectId: current.projectId,
        document: structuredClone(current),
        savedAt: Date.now(),
      })
    }
    this.documents.set(document.projectId, structuredClone(document))
    return true
  }
  async getLastGood(
    projectId: string,
  ): Promise<FrontendWorkshopSourceDocumentLastGoodRecord | undefined> {
    const value = this.lastGood.get(projectId)
    return value ? structuredClone(value) : undefined
  }
  async delete(projectId: string): Promise<void> {
    this.documents.delete(projectId)
    this.lastGood.delete(projectId)
  }
}

function exactSelection(
  source: FrontendWorkshopSourceDocument,
  range: { start: number; end: number },
): FrontendWorkshopResolvedSourceSelection {
  return {
    projectId: source.projectId,
    sourceRevision: source.revision,
    instanceId: 'instance-1',
    runtimeNonce: 'nonce-1',
    runtimeNodeId: 'node-1',
    tagName: 'article',
    elementId: 'card',
    treeScope: 'document',
    mappingConfidence: 'exact',
    provenanceKind: 'static-source',
    sourceRange: range,
  }
}

function createHarness() {
  const componentStorage = new MemoryComponentStorage()
  const sourceStorage = new MemorySourceStorage()
  const sourceDocuments = new FrontendWorkshopSourceDocumentService(sourceStorage)
  const history = new FrontendWorkshopSourceHistoryService(
    sourceDocuments,
    new FrontendWorkshopSourcePatchService(sourceDocuments),
  )
  const service = new FrontendWorkshopSourceComponentService(
    componentStorage,
    sourceDocuments,
    history,
  )
  return { componentStorage, sourceDocuments, service }
}

describe('FrontendWorkshopSourceComponentService new-only packages', () => {
  it('saves an exact selected Source element without normalizing its HTML', async () => {
    const { service, sourceDocuments } = createHarness()
    const authorSource = '<main>\n  <article id="card">  保留  </article>\n</main>'
    const source = await sourceDocuments.createAuthorSourceIfMissing('project-1', authorSource, {
      now: 1,
    })
    const start = authorSource.indexOf('<article')
    const end = authorSource.indexOf('>', start) + 1

    const component = await service.createFromSelection(
      source,
      exactSelection(source, { start, end }),
      { name: '  人物卡  ', tags: [' 卡片 ', '卡片'] },
      { id: 'component-1', now: 10 },
    )

    expect(component).toMatchObject({
      id: 'component-1',
      revision: 1,
      name: '人物卡',
      tags: ['卡片'],
      source: { html: '<article id="card">  保留  </article>', css: '', javascript: '' },
      provenance: { origin: 'project-selection', projectId: 'project-1', sourceRevision: 1 },
      projectIds: ['project-1'],
    })
    expect('assets' in component).toBe(false)
  })

  it('rejects a stale selection and persists nothing', async () => {
    const { service, sourceDocuments } = createHarness()
    const authorSource = '<main><article id="card">旧</article></main>'
    const source = await sourceDocuments.createAuthorSourceIfMissing('project-1', authorSource, {
      now: 1,
    })
    const start = authorSource.indexOf('<article')
    const end = authorSource.indexOf('>', start) + 1
    const selection = exactSelection(source, { start, end })
    await sourceDocuments.saveAuthorSourceAtRevision(
      'project-1',
      source.revision,
      '<main><article id="card">新</article></main>',
      { now: 2 },
    )

    await expect(
      service.createFromSelection(source, selection, { name: '过期组件' }),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)
    await expect(service.list()).resolves.toEqual([])
  })

  it('uses component revision CAS', async () => {
    const { service } = createHarness()
    const component = await service.create(
      {
        name: '卡片',
        source: { html: '<article></article>', css: '', javascript: '' },
        root: { tagName: 'article' },
        provenance: { origin: 'manual' },
      },
      { id: 'component-1', now: 10 },
    )
    const updated = await service.updateAtRevision({ ...component, description: '新版' }, 1, 20)
    await expect(
      service.updateAtRevision({ ...component, description: '过期写入' }, 1, 30),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceComponentRevisionConflictError)
    expect(updated.revision).toBe(2)
  })

  it('exports and imports a pure Source component package with only component.json', async () => {
    const { service } = createHarness()
    const component = await service.create(
      {
        name: '网络卡片',
        source: {
          html: '<img src="https://cdn.example.com/avatar.png">',
          css: '',
          javascript: '',
        },
        root: { tagName: 'img' },
        dependencies: [
          { kind: 'external-resource', specifier: 'https://cdn.example.com/avatar.png' },
        ],
        provenance: { origin: 'manual' },
      },
      { id: 'component-export', now: 10 },
    )

    const portable = await service.createPortablePackageAtRevision(
      component.id,
      component.revision,
      20,
    )
    const files = unzipSync(new Uint8Array(await portable.blob.arrayBuffer()))
    expect(Object.keys(files)).toEqual(['component.json'])
    const manifest = JSON.parse(strFromU8(files['component.json']!)) as Record<string, unknown>
    expect(manifest.format).toBe(FRONTEND_WORKSHOP_SOURCE_COMPONENT_PACKAGE_FORMAT)
    expect('assets' in manifest).toBe(false)

    const imported = await service.importPortablePackage(portable.blob, {
      id: 'component-import',
      now: 30,
    })
    expect(imported).toMatchObject({
      id: 'component-import',
      provenance: { origin: 'imported' },
      source: component.source,
      dependencies: component.dependencies,
    })
    expect('assets' in imported).toBe(false)
  })

  it('rejects legacy binary packages instead of importing their files or assets', async () => {
    const { service } = createHarness()
    const oldManifest = {
      format: FRONTEND_WORKSHOP_SOURCE_COMPONENT_PACKAGE_FORMAT,
      packageVersion: 1,
      exportedAt: 1,
      component: {
        schemaVersion: 1,
        name: '旧组件',
        description: '',
        tags: [],
        source: { html: '<img src="files/a.png">', css: '', javascript: '' },
        root: { tagName: 'img' },
        dependencies: [],
        runtimeRequirements: {
          hostProfile: 'tavern-helper-message',
          requiresJavaScript: false,
          requiresNetwork: false,
          hostApis: [],
        },
        sharePolicy: { license: 'private', allowShare: false, allowDerivatives: true },
        preview: { viewportWidth: 390, colorScheme: 'auto' },
      },
      assets: [
        {
          path: 'a.png',
          mimeType: 'image/png',
          contentHash: 'a'.repeat(64),
          file: 'files/a.png',
        },
      ],
    }
    const blob = new Blob([
      zipSync({
        'component.json': strToU8(JSON.stringify(oldManifest)),
        'files/a.png': new Uint8Array([1, 2, 3]),
      }),
    ])

    await expect(service.importPortablePackage(blob)).rejects.toThrow(/旧二进制|当前版本只接受/)
  })

  it('requires HTTPS for external-resource dependencies', async () => {
    const { service } = createHarness()
    await expect(
      service.create({
        name: '不安全组件',
        source: { html: '<img src="http://example.com/a.png">', css: '', javascript: '' },
        root: { tagName: 'img' },
        dependencies: [{ kind: 'external-resource', specifier: 'http://example.com/a.png' }],
        provenance: { origin: 'manual' },
      }),
    ).rejects.toThrow('HTTPS')
  })

  it('creates and edits components through the shared AI exact-patch pipeline', async () => {
    const { service } = createHarness()
    const base = createFrontendWorkshopSourceComponent(
      {
        name: 'AI 卡片',
        source: { html: '<div data-srl-ai-component-root></div>', css: '', javascript: '' },
        root: { tagName: 'div' },
        provenance: { origin: 'ai' },
      },
      'ai-draft',
      10,
    )
    const projection = createFrontendWorkshopSourceComponentAiProjection(base)
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: projection.document,
      mode: 'edit',
      instruction: '生成卡片',
      writeScope: { kind: 'ranges', ranges: Object.values(projection.ranges) },
    })
    const proposal: FrontendWorkshopSourceAiProposal = {
      kind: 'source-ai-proposal',
      projectId: projection.document.projectId,
      sourceRevision: projection.document.revision,
      summary: '生成卡片',
      edits: [
        {
          ...projection.ranges.html,
          expectedText: base.source.html,
          replacement: '<article>在线</article>',
          reason: '建立组件根元素',
        },
      ],
      hostReferenceRequests: [],
      warnings: [],
    }
    const created = await service.createFromAiProposal(base, bundle, proposal, {
      id: 'component-ai',
      now: 20,
    })
    expect(created.source.html).toBe('<article>在线</article>')
    expect(created.root.tagName).toBe('article')
  })

  it('inserts through History/Patch/CAS and updates project association after Source succeeds', async () => {
    const { service, sourceDocuments } = createHarness()
    const source = await sourceDocuments.createAuthorSourceIfMissing(
      'project-1',
      '<body><p>keep</p></body>',
      { now: 1 },
    )
    const component = await service.create(
      {
        name: '插入卡片',
        source: { html: '<article>component</article>', css: '', javascript: '' },
        root: { tagName: 'article' },
        provenance: { origin: 'manual' },
      },
      { id: 'component-insert', now: 10 },
    )

    const result = await service.insertIntoProject(component.id, source.projectId, source.revision)
    expect(result.document.authorSource).toContain('<article>component</article>')
    expect(result.projectAssociationUpdated).toBe(true)
    await expect(service.listForProject(source.projectId)).resolves.toHaveLength(1)
  })
})
