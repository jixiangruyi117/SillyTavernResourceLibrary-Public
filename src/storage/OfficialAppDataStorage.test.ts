/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppDatabase } from '../database/AppDatabase'
import { clearOfficialAppData } from './OfficialAppDataStorage'
import { createFrontendWorkshopProject } from '../types/FrontendWorkshopProject'
const clearCredential = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../services/LocalCredentialStore', () => ({
  localCredentialStore: { clear: clearCredential },
}))
let database: AppDatabase
beforeEach(() => {
  database = new AppDatabase(`official-data-test-${crypto.randomUUID()}`)
  localStorage.clear()
  clearCredential.mockClear()
})
afterEach(async () => {
  await database.delete()
})
it('clears only the selected app preferences, keeping shared settings and resources', async () => {
  await database.settings.put({ id: 'shared-setting', value: 'keep', updatedAt: 1 })
  localStorage.setItem('srl.stitch.draft', 'draft')
  localStorage.setItem('srl.stitch.templates', 'templates')
  localStorage.setItem('srl.userPersona.templates', 'personas')
  await clearOfficialAppData(database, 'stitch')
  expect(localStorage.getItem('srl.stitch.draft')).toBeNull()
  expect(localStorage.getItem('srl.stitch.templates')).toBeNull()
  expect(localStorage.getItem('srl.userPersona.templates')).toBe('personas')
  expect((await database.settings.get('shared-setting'))?.value).toBe('keep')
})
it('removes workshop projects while retaining the shared image album', async () => {
  const project = createFrontendWorkshopProject('greeting', 100)
  await database.frontendWorkshopProjects.put(project)
  await database.generatedImageFiles.put({
    id: 'keep-image',
    originalBase64: 'AA==',
    originalMimeType: 'image/png',
    updatedAt: 1,
  })
  await clearOfficialAppData(database, 'frontendWorkshop')
  expect(await database.frontendWorkshopProjects.count()).toBe(0)
  expect((await database.generatedImageFiles.get('keep-image'))?.originalBase64).toBe('AA==')
})
it('clears provider credentials without clearing the shared main API or image hosting credentials', async () => {
  localStorage.setItem('srl.frontendWorkshop.imageGeneration.config.v1', 'config')
  await clearOfficialAppData(database, 'imageGeneration')
  expect(clearCredential.mock.calls).toEqual([
    ['image-generation:openai'],
    ['image-generation:novelai'],
    ['image-generation:custom'],
  ])
  expect(localStorage.getItem('srl.frontendWorkshop.imageGeneration.config.v1')).toBeNull()
})
