// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from './FrontendWorkshopSourceAiContext'
import { parseFrontendWorkshopSourceAiProposal } from './FrontendWorkshopSourceAiProposal'
const source = createFrontendWorkshopSourceDocument('p', '<main>原作品</main>', 1)
const draft = {
  name: '人物资料',
  source: {
    html: '<section><div role="img" aria-label="头像占位"></div><h2>名字</h2></section>',
    css: 'section{color:red}',
    javascript: 'console.log("ready")',
  },
  dependencies: [{ kind: 'host-api', specifier: 'getVariables' }],
  sharePolicy: { allowShare: true },
}
function parse(
  mode: 'edit' | 'plan' | 'explain',
  componentDraft: unknown = draft,
  edits: unknown[] = [],
) {
  return parseFrontendWorkshopSourceAiProposal(
    JSON.stringify({
      kind: 'source-ai-proposal',
      projectId: 'p',
      sourceRevision: 1,
      edits,
      componentDraft,
    }),
    source,
    buildFrontendWorkshopSourceAiContext({
      source,
      instruction: '提取人物资料，头像换占位',
      mode,
      writeScope: { kind: 'whole-source' },
    }),
  )
}
describe('AI artifact protocol', () => {
  it('returns an independent private component with trusted provenance and unchanged project', () => {
    const result = parse('edit')
    expect(result.edits).toEqual([])
    expect(result.componentDraft).toMatchObject({
      name: '人物资料',
      root: { tagName: 'section' },
      sharePolicy: { allowShare: false, license: 'private' },
      provenance: { projectId: 'p', sourceRevision: 1 },
      runtimeRequirements: { requiresJavaScript: true, hostApis: ['getVariables'] },
    })
    expect(source.authorSource).toBe('<main>原作品</main>')
  })
  it('does not enable artifact saving in plan or explanation modes', () => {
    expect(parse('plan').componentDraft).toBeUndefined()
    expect(parse('explain').componentDraft).toBeUndefined()
  })
  it('keeps malformed optional drafts as warnings and never mixes extraction with source writes', () => {
    expect(parse('edit', { name: 'empty' }).warnings[0]).toContain('缺少')
    expect(() =>
      parse('edit', draft, [{ expectedText: source.authorSource, replacement: 'changed' }]),
    ).toThrow('不能同时修改')
  })
  it('retains a rejected dependency draft intact for the next correction without enabling save', () => {
    const invalid = {
      ...draft,
      dependencies: [{ kind: 'external-resource', specifier: '本地字体栈' }],
    }
    const result = parse('edit', invalid)
    expect(result.componentDraft).toBeUndefined()
    expect(result.rejectedComponentDraft).toEqual(invalid)
    expect(result.summary).toContain('组件草稿未就绪')
    expect(parse('plan', invalid).rejectedComponentDraft).toBeUndefined()
    expect(parse('explain', invalid).rejectedComponentDraft).toBeUndefined()
  })
})
