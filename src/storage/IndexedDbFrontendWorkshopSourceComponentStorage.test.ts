/** @vitest-environment jsdom */

import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { createFrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'
import { IndexedDbFrontendWorkshopSourceComponentStorage } from './IndexedDbFrontendWorkshopSourceComponentStorage'

const databases: AppDatabase[] = []

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close()
      await database.delete()
    }),
  )
})

describe('IndexedDbFrontendWorkshopSourceComponentStorage', () => {
  it('creates, orders and updates personal components with revision CAS', async () => {
    const database = new AppDatabase(`source-components-${crypto.randomUUID()}`)
    databases.push(database)
    const storage = new IndexedDbFrontendWorkshopSourceComponentStorage(database)
    const older = createFrontendWorkshopSourceComponent(
      {
        name: '旧组件',
        source: { html: '<div>old</div>', css: '', javascript: '' },
        root: { tagName: 'div' },
        provenance: { origin: 'manual' },
      },
      'component-old',
      10,
    )
    const newer = createFrontendWorkshopSourceComponent(
      {
        name: '新组件',
        source: { html: '<section>new</section>', css: '', javascript: '' },
        root: { tagName: 'section' },
        provenance: { origin: 'manual' },
      },
      'component-new',
      20,
    )

    await expect(storage.putIfRevision(older, 0)).resolves.toBe(true)
    await expect(storage.putIfRevision(newer, 0)).resolves.toBe(true)
    await expect(storage.putIfRevision(older, 0)).resolves.toBe(false)
    await expect(storage.list()).resolves.toMatchObject([{ id: newer.id }, { id: older.id }])

    const updated = { ...older, name: '旧组件已更新', revision: 2, updatedAt: 30 }
    await expect(storage.putIfRevision(updated, 1)).resolves.toBe(true)
    await expect(storage.putIfRevision({ ...updated, revision: 3 }, 1)).resolves.toBe(false)
    await expect(storage.get(older.id)).resolves.toMatchObject({
      name: '旧组件已更新',
      revision: 2,
    })
  })

  it('returns clones and deletes only the requested component', async () => {
    const database = new AppDatabase(`source-components-${crypto.randomUUID()}`)
    databases.push(database)
    const storage = new IndexedDbFrontendWorkshopSourceComponentStorage(database)
    const component = createFrontendWorkshopSourceComponent(
      {
        name: '组件',
        tags: ['保留'],
        source: { html: '<aside></aside>', css: '', javascript: '' },
        root: { tagName: 'aside' },
        provenance: { origin: 'manual' },
      },
      'component-1',
      10,
    )
    await storage.putIfRevision(component, 0)

    const first = await storage.get(component.id)
    first?.tags.push('本地变化')
    await expect(storage.get(component.id)).resolves.toMatchObject({ tags: ['保留'] })

    await storage.delete(component.id)
    await expect(storage.get(component.id)).resolves.toBeUndefined()
  })

  it('project association is owned only by current projectIds data', async () => {
    const database = new AppDatabase(`source-component-projects-${crypto.randomUUID()}`)
    databases.push(database)
    const storage = new IndexedDbFrontendWorkshopSourceComponentStorage(database)
    const component = createFrontendWorkshopSourceComponent(
      {
        name: '项目组件',
        source: { html: '<aside></aside>', css: '', javascript: '' },
        root: { tagName: 'aside' },
        provenance: { origin: 'project-selection', projectId: 'project-origin' },
        projectIds: ['project-1'],
      },
      'component-project',
      10,
    )
    await storage.putIfRevision(component, 0)

    await expect(storage.get(component.id)).resolves.toMatchObject({
      projectIds: ['project-1'],
    })
    await storage.setProjectAssociation(component.id, 'project-2', true)
    await expect(storage.get(component.id)).resolves.toMatchObject({
      projectIds: ['project-1', 'project-2'],
    })
    await storage.setProjectAssociation(component.id, 'project-1', false)
    await expect(storage.get(component.id)).resolves.toMatchObject({
      projectIds: ['project-2'],
    })
  })
})
