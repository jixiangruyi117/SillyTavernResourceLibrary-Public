/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'

import { AppDatabase } from '../database/AppDatabase'
import { IndexedDbFrontendWorkshopProjectStorage } from '../storage/IndexedDbFrontendWorkshopProjectStorage'
import { IndexedDbFrontendWorkshopSourceDocumentStorage } from '../storage/IndexedDbFrontendWorkshopSourceDocumentStorage'
import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
import { FrontendWorkshopProjectService } from './FrontendWorkshopProjectService'
import {
  FrontendWorkshopSourceAlreadyExistsError,
  FrontendWorkshopSourceDocumentService,
  FrontendWorkshopSourceRevisionConflictError,
} from './FrontendWorkshopSourceDocumentService'

const databases: AppDatabase[] = []

function createDatabase(prefix = 'frontend-workshop-source'): AppDatabase {
  const database = new AppDatabase(`${prefix}-${crypto.randomUUID()}`)
  databases.push(database)
  return database
}

function createSourceService(database: AppDatabase): FrontendWorkshopSourceDocumentService {
  return new FrontendWorkshopSourceDocumentService(
    new IndexedDbFrontendWorkshopSourceDocumentStorage(database),
  )
}

afterEach(async () => {
  const opened = databases.splice(0)
  const names = Array.from(new Set(opened.map((database) => database.name)))
  opened.forEach((database) => database.close())
  await Promise.all(names.map((name) => indexedDB.deleteDatabase(name)))
})

describe('FrontendWorkshopSourceDocumentService', () => {
  it('Author Source 经过保存和 IndexedDB 重开后仍逐字节字符串保真', async () => {
    const databaseName = `frontend-workshop-source-reopen-${crypto.randomUUID()}`
    const database = new AppDatabase(databaseName)
    databases.push(database)
    const service = createSourceService(database)
    const rawSource = [
      '',
      '<body data-custom="odd">',
      '  <button onclick="window.demo?.()"> keep spaces </button>',
      '  <odd-profile-widget></odd-profile-widget>',
      '  <div style="position:fixed;top:7px">fixed</div>',
      '  <a href="http://example.test/raw">http stays raw</a>',
      '  <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">',
      '  <script>',
      "    customElements.define('odd-profile-widget', class extends HTMLElement {",
      "      connectedCallback() { this.attachShadow({ mode: 'open' }).innerHTML = '<b>shadow</b>' }",
      '    })',
      '  </script>',
      '</body>',
      '  ',
    ].join('\r\n')

    const saved = await service.saveAuthorSource('project-raw', rawSource, {
      origin: 'imported',
      now: 100,
    })
    expect(saved.authorSource).toBe(rawSource)

    database.close()
    const reopenedDatabase = new AppDatabase(databaseName)
    databases.push(reopenedDatabase)
    const reopenedService = createSourceService(reopenedDatabase)
    const restored = await reopenedService.get('project-raw')

    expect(restored).toMatchObject({
      version: 1,
      projectId: 'project-raw',
      hostProfile: 'tavern-helper-message',
      origin: 'imported',
      revision: 1,
      createdAt: 100,
      updatedAt: 100,
    })
    expect(restored?.authorSource).toBe(rawSource)
  })

  it('更新 Source 时原样保留 last_good，恢复后把当前版本反向保存以便再次恢复', async () => {
    const database = createDatabase()
    const service = createSourceService(database)
    const first = '\n<body>first<script>window.first = true</script></body>\n'
    const second = '  <body>second onclick stays</body>  '

    await service.saveAuthorSource('project-history', first, { now: 100 })
    const savedSecond = await service.saveAuthorSource('project-history', second, { now: 200 })
    expect(savedSecond.revision).toBe(2)

    const restoredFirst = await service.restoreLastGood('project-history', 300)
    expect(restoredFirst?.authorSource).toBe(first)
    expect(restoredFirst?.revision).toBe(3)
    expect(restoredFirst?.createdAt).toBe(100)

    const restoredSecond = await service.restoreLastGood('project-history', 400)
    expect(restoredSecond?.authorSource).toBe(second)
    expect(restoredSecond?.revision).toBe(4)
  })

  it('显式接管只允许原子创建一次，不会覆盖接管期间出现的新 Source', async () => {
    const database = createDatabase()
    const service = createSourceService(database)
    const first = await service.createAuthorSourceIfMissing('project-takeover', 'first', {
      origin: 'new',
      now: 100,
    })

    expect(first).toMatchObject({ revision: 1, authorSource: 'first' })
    await expect(
      service.createAuthorSourceIfMissing('project-takeover', 'stale takeover', { now: 200 }),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceAlreadyExistsError)
    expect(await service.get('project-takeover')).toMatchObject({
      revision: 1,
      authorSource: 'first',
    })
  })

  it('交互式保存必须携带打开时 revision，stale 草稿不能覆盖较新的 Source', async () => {
    const database = createDatabase()
    const service = createSourceService(database)
    const first = await service.createAuthorSourceIfMissing('project-cas-editor', 'rev1', {
      now: 100,
    })
    const second = await service.saveAuthorSourceAtRevision(
      'project-cas-editor',
      first.revision,
      'rev2',
      { now: 200, origin: 'imported' },
    )

    await expect(
      service.saveAuthorSourceAtRevision('project-cas-editor', first.revision, 'stale rev3', {
        now: 300,
      }),
    ).rejects.toBeInstanceOf(FrontendWorkshopSourceRevisionConflictError)
    expect(await service.get('project-cas-editor')).toMatchObject({
      revision: second.revision,
      authorSource: 'rev2',
      origin: 'imported',
    })
  })

  it('结构化 Project 的保存和 normalizer 不会改写独立 Source Document', async () => {
    const database = createDatabase()
    const sourceService = createSourceService(database)
    const projectService = new FrontendWorkshopProjectService(
      new IndexedDbFrontendWorkshopProjectStorage(database),
    )
    const project = createFrontendWorkshopProject('greeting', 100)
    const rawSource = '\n<script>window.raw = "  keep  "</script>\n<div onclick="raw()">x</div>\n'

    await sourceService.saveAuthorSource(project.id, rawSource, { now: 110 })
    await projectService.save(project)
    project.name = '结构化项目第二版'
    await projectService.save(project)

    expect((await sourceService.get(project.id))?.authorSource).toBe(rawSource)
  })

  it('保存现代 Project 不会隐式生成 Source Document', async () => {
    const database = createDatabase()
    const sourceService = createSourceService(database)
    const projectService = new FrontendWorkshopProjectService(
      new IndexedDbFrontendWorkshopProjectStorage(database),
    )
    const project = createFrontendWorkshopProject('greeting', 100)

    await projectService.save(project)

    expect(await sourceService.get(project.id)).toBeUndefined()
  })

  it('删除 Source Document 会同时删除 current 与 last_good', async () => {
    const database = createDatabase()
    const service = createSourceService(database)

    await service.saveAuthorSource('project-delete', 'first', { now: 100 })
    await service.saveAuthorSource('project-delete', 'second', { now: 200 })
    await service.delete('project-delete')

    expect(await service.get('project-delete')).toBeUndefined()
    expect(await service.restoreLastGood('project-delete', 300)).toBeUndefined()
  })
})
