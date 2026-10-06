import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const workbenchSource = readFileSync(
  fileURLToPath(new URL('../composables/UseFrontendWorkshopWorkbench.ts', import.meta.url)),
  'utf8',
).replaceAll('\r\n', '\n')

describe('FrontendWorkshopWorkbench Source owner contract', () => {
  it('keeps the Source editor outside Workbench and gates takeover on the project save queue', () => {
    expect(workbenchSource).not.toContain("editorRoute.value === 'source'")
    expect(workbenchSource).not.toContain("editorRoute.value = 'source'")
    expect(workbenchSource).not.toContain('frontendWorkshopSourceDocumentService')
    expect(workbenchSource).not.toContain('saveAuthorSourceAtRevision')
    expect(workbenchSource).not.toContain('createAuthorSourceIfMissing')

    const start = workbenchSource.indexOf('async function openAdvancedSource(): Promise<void>')
    expect(start).toBeGreaterThanOrEqual(0)
    const end = workbenchSource.indexOf('\n  }\n', start)
    expect(end).toBeGreaterThan(start)
    const takeover = workbenchSource.slice(start, end)

    const saveQueueIndex = takeover.indexOf('await projectSaveQueue')
    const failureGateIndex = takeover.indexOf("saveStatus.value === '保存失败'")
    const emitIndex = takeover.indexOf("emit('sourceRequested')")
    expect(saveQueueIndex).toBeGreaterThanOrEqual(0)
    expect(failureGateIndex).toBeGreaterThan(saveQueueIndex)
    expect(emitIndex).toBeGreaterThan(failureGateIndex)
  })
})
