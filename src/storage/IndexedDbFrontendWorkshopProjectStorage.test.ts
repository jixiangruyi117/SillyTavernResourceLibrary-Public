/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import { createFrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from './IndexedDbFrontendWorkshopSourceDocumentStorage'
import { IndexedDbFrontendWorkshopProjectStorage } from './IndexedDbFrontendWorkshopProjectStorage'

const databases: AppDatabase[] = []

function createDatabase(): AppDatabase {
  const database = new AppDatabase(`frontend-workshop-delete-${crypto.randomUUID()}`)
  databases.push(database)
  return database
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = opened.map((database) => database.name)
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('IndexedDbFrontendWorkshopProjectStorage', () => {
  it('atomically removes Project and linked Source current/last_good without touching siblings', async () => {
    const database = createDatabase()
    const projectStorage = new IndexedDbFrontendWorkshopProjectStorage(database)
    const sourceStorage = new IndexedDbFrontendWorkshopSourceDocumentStorage(database)

    const previousProject = createFrontendWorkshopProject('greeting', 100)
    previousProject.id = 'project-delete'
    previousProject.document.id = previousProject.id
    const currentProject = structuredClone(previousProject)
    currentProject.name = 'current project'
    currentProject.document.name = currentProject.name
    currentProject.updatedAt = 200
    await projectStorage.putAtomic(previousProject)
    await projectStorage.putAtomic(currentProject, previousProject)

    const previousSource = createFrontendWorkshopSourceDocument(
      previousProject.id,
      '<div>previous</div>',
      100,
    )
    const currentSource = {
      ...previousSource,
      authorSource: '<script>window.current=true</script>',
      revision: 2,
      updatedAt: 200,
    }
    await sourceStorage.putAtomic(previousSource)
    await sourceStorage.putAtomic(currentSource, previousSource)

    const siblingSource = createFrontendWorkshopSourceDocument(
      'project-keep',
      '<div>keep</div>',
      100,
    )
    await sourceStorage.putAtomic(siblingSource)

    await projectStorage.delete(previousProject.id)

    await expect(database.frontendWorkshopProjects.get(previousProject.id)).resolves.toBeUndefined()
    await expect(
      database.frontendWorkshopProjectLastGood.get(previousProject.id),
    ).resolves.toBeUndefined()
    await expect(
      database.frontendWorkshopSourceDocuments.get(previousProject.id),
    ).resolves.toBeUndefined()
    await expect(
      database.frontendWorkshopSourceDocumentLastGood.get(previousProject.id),
    ).resolves.toBeUndefined()
    await expect(
      database.frontendWorkshopSourceDocuments.get('project-keep'),
    ).resolves.toMatchObject({ authorSource: '<div>keep</div>' })
  })

  it('one-shot auxiliary cleanup removes retired component assets without rewriting Author Source', async () => {
    const database = createDatabase()
    const projectStorage = new IndexedDbFrontendWorkshopProjectStorage(database)

    const source = createFrontendWorkshopSourceDocument(
      'project-legacy-source',
      '<main>  keep exactly  </main>',
      100,
    )
    const rawSource = {
      ...source,
      origin: 'legacy-advanced-source',
    } as unknown as typeof source
    await database.frontendWorkshopSourceDocuments.put(rawSource)
    await database.frontendWorkshopSourceDocumentLastGood.put({
      projectId: source.projectId,
      document: rawSource,
      savedAt: 101,
    })

    const component = createFrontendWorkshopSourceComponent(
      {
        name: '旧二进制组件',
        source: { html: '<article>keep</article>', css: '', javascript: '' },
        root: { tagName: 'article' },
        provenance: { origin: 'manual' },
        projectIds: ['project-1', 'project-1'],
      },
      'component-old-assets',
      100,
    )
    const rawComponent = component as unknown as Record<string, unknown>
    rawComponent.assets = [
      {
        assetId: 'asset-old',
        path: 'files/old.png',
        mimeType: 'image/png',
        contentHash: 'a'.repeat(64),
      },
    ]
    await database.frontendWorkshopSourceComponents.put(rawComponent as unknown as typeof component)

    await projectStorage.cleanupLegacyAuxiliaryData()

    const cleanedSource = await database.frontendWorkshopSourceDocuments.get(source.projectId)
    expect(cleanedSource?.authorSource).toBe('<main>  keep exactly  </main>')
    expect(cleanedSource?.origin).toBe('imported')
    const lastGood = await database.frontendWorkshopSourceDocumentLastGood.get(source.projectId)
    expect(lastGood?.document.authorSource).toBe('<main>  keep exactly  </main>')
    expect(lastGood?.document.origin).toBe('imported')

    const cleanedComponent = await database.frontendWorkshopSourceComponents.get(component.id)
    expect(cleanedComponent?.projectIds).toEqual(['project-1'])
    expect('assets' in (cleanedComponent as unknown as Record<string, unknown>)).toBe(false)
  })
})
