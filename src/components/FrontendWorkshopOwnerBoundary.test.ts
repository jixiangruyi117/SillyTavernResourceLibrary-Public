import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(`src/components/${name}.vue`, 'utf8')
describe('FrontendWorkshop greeting owner boundaries', () => {
  it('has one flat manual editor and no retired route or duplicate transform dock', () => {
    const workbench = read('FrontendWorkshopWorkbench')
    const editor = read('FrontendWorkshopNodeEditor')
    const canvas = read('FrontendWorkshopWorkspace')
    expect(workbench).toContain('FrontendWorkshopNodeEditor')
    expect(editor).not.toMatch(/nodeDetailView|settingsEditor|openGuidedInteraction/)
    expect(workbench).not.toContain("editorRoute.value = 'node-detail'")
    expect(canvas).not.toContain('class="frontend-workbench__transform-dock"')
    for (const tab of ['content', 'appearance', 'layout'])
      expect(editor).toContain(`requestedTab === '${tab}'`)
  })
  it('retired abstractions and their dedicated styles have no remaining files', () => {
    for (const path of [
      'components/FrontendWorkshopInteractionEditor.vue',
      'utils/FrontendWorkshopGuidedInteraction.ts',
      'utils/FrontendWorkshopStyleSystem.ts',
      'utils/FrontendWorkshopCapabilityRegistry.ts',
      'utils/FrontendWorkshopPerformanceAdvisor.ts',
      'styles/FrontendWorkshopNodeEditor.css',
      'styles/FrontendWorkshopInteractionEditor.css',
    ])
      expect(existsSync(`src/${path}`), path).toBe(false)
  })
  it('Source-backed canvas is owned by SourceSession and writes only through Source History', () => {
    const workbench = read('FrontendWorkshopWorkbench')
    const session = read('FrontendWorkshopSourceSession')
    const inspector = read('FrontendWorkshopSourceInspector')
    expect(workbench).toContain('name="source-canvas"')
    expect(session).toContain('#source-canvas')
    expect(session).toContain('FrontendWorkshopSourceWorkspace')
    expect(workbench).not.toContain('frontendWorkshopSourceDocumentService')
    expect(inspector).toContain('frontendWorkshopSourceHistoryService.applyAndRecord')
    expect(inspector).not.toContain('saveAuthorSourceAtRevision')
  })
  it('Source editing has one contextual AI entry and the existing session owner', () => {
    const shell = read('FrontendWorkshopSourceAiShell')
    expect(shell).not.toContain('FrontendWorkshopSourceQuickAi')
    expect(shell).not.toContain('fw-ai-shortcut')
    expect(shell).toContain('FrontendWorkshopSourceAiWorkspace')
    expect(read('FrontendWorkshopSourceInspector')).toContain("emit('aiRequested')")
    expect(read('FrontendWorkshopWorkbench')).toContain(
      ':hide-ai="props.sourceOwnerState === \'source\'"',
    )
    expect(shell).not.toContain('saveAuthorSourceAtRevision')
  })
  it('keeps legacy status outside greeting source takeover and retains the shared preview host', () => {
    expect(read('FrontendWorkshopSourceEditor')).toContain("project.kind !== 'greeting'")
    expect(existsSync('src/components/FrontendWorkshopApp.vue')).toBe(true)
    expect(read('FrontendWorkshopWorkbench')).toContain(
      ':frontend-workshop-behavior-runtime="true"',
    )
    expect(read('FrontendWorkshopSourcePreview')).toContain('FrontendWorkshopSourceRuntime')
  })
})
