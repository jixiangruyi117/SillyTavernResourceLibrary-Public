import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from './FrontendWorkshopSourceAiContext'

function sourceDocument(authorSource: string) {
  return createFrontendWorkshopSourceDocument('project-ai-budget', authorSource, 100)
}

describe('FrontendWorkshopSourceAiContext budgets', () => {
  it('preserves complete long source, instructions, references and conversation by default', () => {
    const raw = '<main>' + '源码'.repeat(130_000) + '</main>'
    const text = '完整内容'.repeat(20_000)
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: sourceDocument(raw),
      mode: 'edit',
      instruction: text,
      writeScope: { kind: 'whole-source' },
      hostReferences: [{ id: 'full', title: 'Host', content: text }],
      registry: { label: 'all', content: text },
      conversation: [
        { role: 'user', content: text },
        { role: 'assistant', content: text },
      ],
    })
    expect(bundle.sourceCoverage.complete).toBe(true)
    expect(bundle.sourceCoverage.chunks.map((chunk) => chunk.text).join('')).toBe(raw)
    expect(bundle.sourceCoverage.omittedTextUnits).toBe(0)
    for (const kind of ['host-reference', 'registry', 'conversation']) {
      expect(bundle.sections.find((section) => section.kind === kind)?.content).toContain(text)
    }
    expect(bundle.diagnostics.conversationTruncated).toBe(false)
    expect(bundle.diagnostics.hostReferenceTruncated).toBe(false)
  })

  it('never lets full-source mode bypass the per-chunk or chunk-count budget', () => {
    const raw = Array.from({ length: 50 }, (_, index) => `${index}`.padStart(2, '0')).join('')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: sourceDocument(raw),
      mode: 'explain',
      instruction: '解释。',
      options: {
        maxSourceTextUnits: 100,
        maxSourceChunkTextUnits: 10,
        maxSourceChunks: 2,
      },
    })

    expect(bundle.sourceCoverage.complete).toBe(false)
    expect(bundle.sourceCoverage.coveredTextUnits).toBeLessThanOrEqual(20)
    expect(bundle.sourceCoverage.chunks).toHaveLength(2)
    for (const chunk of bundle.sourceCoverage.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(10)
      expect(chunk.text).toBe(raw.slice(chunk.range.start, chunk.range.end))
    }
  })

  it('splits a complete Source into exact chunks when it fits the combined budget', () => {
    const raw = '0123456789abcdefghijABCDEFGHIJ'
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: sourceDocument(raw),
      mode: 'explain',
      instruction: '解释。',
      options: {
        maxSourceTextUnits: 40,
        maxSourceChunkTextUnits: 10,
        maxSourceChunks: 4,
      },
    })

    expect(bundle.sourceCoverage.complete).toBe(true)
    expect(bundle.sourceCoverage.coveredTextUnits).toBe(raw.length)
    expect(bundle.sourceCoverage.omittedTextUnits).toBe(0)
    expect(bundle.sourceCoverage.chunks.map((chunk) => chunk.text).join('')).toBe(raw)
    expect(bundle.sourceCoverage.chunks.every((chunk) => chunk.text.length <= 10)).toBe(true)
  })

  it('keeps optional context payloads within even tiny configured text budgets', () => {
    const bundle = buildFrontendWorkshopSourceAiContext({
      source: sourceDocument('<div></div>'),
      mode: 'explain',
      instruction: '解释。',
      hostReferences: [{ id: 'host-1', title: 'Host', content: 'H'.repeat(50) }],
      registry: { label: 'registry', content: 'R'.repeat(50) },
      conversation: [{ role: 'user', content: 'C'.repeat(50) }],
      options: {
        maxHostReferenceTextUnits: 4,
        maxRegistryTextUnits: 4,
        maxConversationTextUnits: 4,
      },
    })

    const host = JSON.parse(
      bundle.sections.find((section) => section.kind === 'host-reference')?.content ?? '{}',
    ) as { provided: Array<{ content: string }> }
    const registry = JSON.parse(
      bundle.sections.find((section) => section.kind === 'registry')?.content ?? '{}',
    ) as { content: string }
    const conversation = JSON.parse(
      bundle.sections.find((section) => section.kind === 'conversation')?.content ?? '{}',
    ) as { turns: Array<{ content: string }> }

    expect(host.provided[0]?.content.length).toBeLessThanOrEqual(4)
    expect(registry.content.length).toBeLessThanOrEqual(4)
    expect(conversation.turns[0]?.content.length).toBeLessThanOrEqual(4)
    expect(bundle.diagnostics.hostReferenceTruncated).toBe(true)
    expect(bundle.diagnostics.registryTruncated).toBe(true)
    expect(bundle.diagnostics.conversationTruncated).toBe(true)
  })

  it('returns the normalized write scope as typed validation data instead of requiring prompt parsing', () => {
    const source = sourceDocument('<div>one</div><div>two</div>')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '只修改第一段。',
      writeScope: {
        kind: 'ranges',
        ranges: [
          { start: 0, end: 8 },
          { start: 6, end: 14 },
        ],
      },
    })

    expect(bundle.writeScope).toEqual({
      kind: 'ranges',
      projectId: source.projectId,
      sourceRevision: source.revision,
      sourceCreatedAt: source.createdAt,
      offsetUnit: 'utf16-code-unit',
      allowedRanges: [{ start: 0, end: 14 }],
      maxEdits: 64,
      application:
        'proposal-only; application must rebuild current-revision exact static provenance and revalidate expectedText through Patch / History / CAS',
    })
  })
  it('binds the typed AI context and Write Scope to the Source lineage', () => {
    const source = sourceDocument('<div>lineage</div>')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })

    expect(bundle.sourceCreatedAt).toBe(source.createdAt)
    expect(bundle.writeScope.sourceCreatedAt).toBe(source.createdAt)
    const relevant = JSON.parse(
      bundle.sections.find((section) => section.kind === 'relevant-source')?.content ?? '{}',
    ) as { sourceCreatedAt?: number }
    expect(relevant.sourceCreatedAt).toBe(source.createdAt)
  })
})
