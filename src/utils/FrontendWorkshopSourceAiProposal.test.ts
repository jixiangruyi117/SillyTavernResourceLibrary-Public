import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from './FrontendWorkshopSourceAiContext'
import { parseFrontendWorkshopSourceAiProposal } from './FrontendWorkshopSourceAiProposal'

function sourceDocument(authorSource = '<div id="box">hello</div>') {
  return createFrontendWorkshopSourceDocument('project-ai-proposal', authorSource, 100)
}

function proposal(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: 'source-ai-proposal',
    projectId: 'project-ai-proposal',
    sourceRevision: 1,
    summary: '更新文本',
    edits: [],
    hostReferenceRequests: [],
    warnings: [],
    ...overrides,
  })
}

describe('FrontendWorkshopSourceAiProposal', () => {
  it('keeps a reviewable plan without allowing code writes even with an explicit write scope', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'plan',
      instruction: '设计开场白',
      writeScope: { kind: 'whole-source' },
    })
    expect(bundle.writeScope.kind).toBe('read-only')
    expect(
      parseFrontendWorkshopSourceAiProposal(
        proposal({ generationPrompt: '制作带开场白导航的角色介绍。' }),
        source,
        bundle,
      ).generationPrompt,
    ).toBe('制作带开场白导航的角色介绍。')
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [{ expectedText: source.authorSource, replacement: '<main>不应执行</main>' }],
        }),
        source,
        bundle,
      ),
    ).toThrow()
  })
  it('accepts literal string controls without changing code, backslashes or exact original text', () => {
    const original = 'line 1\r\n\tline 2 😀'
    const replacement =
      '<style>\n.cfx{color:red}\n</style>\r\n<script>const x="\\n";</script>\t\u0000'
    const source = sourceDocument(original)
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改',
      writeScope: { kind: 'whole-source' },
    })
    const raw = proposal({ edits: [{ expectedText: original, replacement }] })
      .replace('line 1\\r\\n\\t', 'line 1\r\n\t')
      .replace('<style>\\n', '<style>\n')
      .replace('}\\n</style>', '}\n</style>')
    expect(() => JSON.parse(raw)).toThrow()
    expect(parseFrontendWorkshopSourceAiProposal(raw, source, bundle).edits[0]).toMatchObject({
      expectedText: original,
      replacement,
      start: 0,
      end: original.length,
    })
    expect(source.authorSource).toBe(original)
    expect(
      parseFrontendWorkshopSourceAiProposal(
        proposal({ edits: [{ expectedText: original, replacement }] }),
        source,
        bundle,
      ).edits[0]?.replacement,
    ).toBe(replacement)
  })

  it('does not repair truncation, ambiguous quotes or identities while escaping a literal newline', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改',
    })
    const raw = proposal({ summary: 'one\ntwo' }).replace('one\\ntwo', 'one\ntwo')
    expect(() => parseFrontendWorkshopSourceAiProposal(raw.slice(0, -1), source, bundle)).toThrow(
      /纯 JSON/,
    )
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(raw.replace('one\ntwo', 'one"\ntwo'), source, bundle),
    ).toThrow(/纯 JSON/)
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        raw.replace('project-ai-proposal', 'other-project'),
        source,
        bundle,
      ),
    ).toThrow(/projectId/)
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        raw.replace('"sourceRevision":1', '"sourceRevision":2'),
        source,
        bundle,
      ),
    ).toThrow(/sourceRevision/)
  })
  it('locates a unique exact fragment without offsets or reason, and ignores metadata', () => {
    const source = sourceDocument('😀hello世界')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改',
      writeScope: { kind: 'whole-source' },
    })
    for (const positions of [{}, { start: 1, end: 6 }]) {
      const parsed = parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [{ ...positions, expectedText: 'hello', replacement: '你好', extra: true }],
          summary: undefined,
          warnings: undefined,
          hostReferenceRequests: undefined,
        }),
        source,
        bundle,
      )
      expect(parsed.edits).toEqual([
        { start: 2, end: 7, expectedText: 'hello', replacement: '你好', reason: '' },
      ])
    }
  })

  it('does not guess between repeated fragments, normalize whitespace or place empty insertions', () => {
    const source = sourceDocument('hello hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改',
      writeScope: { kind: 'whole-source' },
    })
    for (const expectedText of ['hello', 'hello  hello', '']) {
      expect(() =>
        parseFrontendWorkshopSourceAiProposal(
          proposal({ edits: [{ expectedText, replacement: 'x' }] }),
          source,
          bundle,
        ),
      ).toThrow()
    }
    const parsed = parseFrontendWorkshopSourceAiProposal(
      proposal({ edits: [{ start: 6, end: 11, expectedText: 'hello', replacement: 'x' }] }),
      source,
      bundle,
    )
    expect(parsed.edits[0]?.start).toBe(6)
  })
  it('accepts a current scoped proposal without mutating Source', () => {
    const source = sourceDocument()
    const start = source.authorSource.indexOf('hello')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit-selection',
      instruction: '把 hello 改成 world。',
      writeScope: { kind: 'ranges', ranges: [{ start, end: start + 5 }] },
    })

    const parsed = parseFrontendWorkshopSourceAiProposal(
      proposal({
        edits: [
          {
            start,
            end: start + 5,
            expectedText: 'hello',
            replacement: 'world',
            reason: '按用户要求替换可写文本',
          },
        ],
      }),
      source,
      bundle,
    )

    expect(parsed.edits).toEqual([
      {
        start,
        end: start + 5,
        expectedText: 'hello',
        replacement: 'world',
        reason: '按用户要求替换可写文本',
      },
    ])
    expect(source.authorSource).toBe('<div id="box">hello</div>')
  })

  it('ignores extra metadata while rejecting fences and wrong identity', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'explain',
      instruction: '解释。',
    })

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(`\`\`\`json\n${proposal()}\n\`\`\``, source, bundle),
    ).toThrow(/纯 JSON/)
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(proposal({ extra: true }), source, bundle),
    ).not.toThrow()
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({ projectId: 'other-project' }),
        source,
        bundle,
      ),
    ).toThrow(/projectId/)
    expect(() =>
      parseFrontendWorkshopSourceAiProposal(proposal({ sourceRevision: 2 }), source, bundle),
    ).toThrow(/sourceRevision/)
  })

  it('rejects stale context before trusting a response', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const newer = { ...source, revision: 2, authorSource: `${source.authorSource}\n<!-- newer -->` }

    expect(() => parseFrontendWorkshopSourceAiProposal(proposal(), newer, bundle)).toThrow(
      /Context Bundle 已失效/,
    )
  })

  it('keeps read-only requests fail closed', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'explain',
      instruction: '只解释。',
    })

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [
            {
              start: 0,
              end: 0,
              expectedText: '',
              replacement: '<script></script>',
              reason: '不应允许',
            },
          ],
        }),
        source,
        bundle,
      ),
    ).toThrow(/read-only/)
  })

  it('rejects ranges outside one allowed scope and stale expectedText', () => {
    const source = sourceDocument('0123456789abcdefghij')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '局部修改。',
      writeScope: {
        kind: 'ranges',
        ranges: [
          { start: 0, end: 5 },
          { start: 10, end: 15 },
        ],
      },
    })

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [
            {
              start: 4,
              end: 11,
              expectedText: '456789a',
              replacement: 'x',
              reason: '跨越未授权 gap',
            },
          ],
        }),
        source,
        bundle,
      ),
    ).toThrow(/超出可写/)

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [
            {
              start: 0,
              end: 2,
              expectedText: 'xx',
              replacement: 'ab',
              reason: '错误 expectedText',
            },
          ],
        }),
        source,
        bundle,
      ),
    ).toThrow(/expectedText 已失效/)
  })

  it('rejects duplicate or overlapping edits before a later Patch stage', () => {
    const source = sourceDocument('abcdefghij')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [
            { start: 1, end: 4, expectedText: 'bcd', replacement: 'B', reason: '一' },
            { start: 3, end: 5, expectedText: 'de', replacement: 'D', reason: '二' },
          ],
        }),
        source,
        bundle,
      ),
    ).toThrow(/重叠或重复/)

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          edits: [
            { start: 1, end: 1, expectedText: '', replacement: 'A', reason: '一' },
            { start: 1, end: 1, expectedText: '', replacement: 'B', reason: '二' },
          ],
        }),
        source,
        bundle,
      ),
    ).toThrow(/重叠或重复/)
  })

  it('requires missing Host API evidence to be requested without edits', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '使用 TavernHelper API 修改。',
      writeScope: { kind: 'whole-source' },
    })

    const requestOnly = parseFrontendWorkshopSourceAiProposal(
      proposal({
        summary: '需要宿主 API 证据',
        hostReferenceRequests: ['TavernHelper 消息刷新 API'],
      }),
      source,
      bundle,
    )
    expect(requestOnly.edits).toEqual([])
    expect(requestOnly.hostReferenceRequests).toEqual(['TavernHelper 消息刷新 API'])

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(
        proposal({
          hostReferenceRequests: ['TavernHelper API'],
          edits: [
            {
              start: 0,
              end: 0,
              expectedText: '',
              replacement: '<script>invented()</script>',
              reason: '不应边请求边修改',
            },
          ],
        }),
        source,
        bundle,
      ),
    ).toThrow(/不得同时提交 edits/)
  })

  it('enforces edit scopes but preserves long replies', () => {
    const source = sourceDocument('x'.repeat(100))
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const tooMany = Array.from({ length: bundle.writeScope.maxEdits + 1 }, (_, index) => ({
      start: index,
      end: index,
      expectedText: '',
      replacement: 'x',
      reason: `edit ${index}`,
    }))

    expect(() =>
      parseFrontendWorkshopSourceAiProposal(proposal({ edits: tooMany }), source, bundle),
    ).toThrow(/edits 超出 Write Scope 上限/)
    const replacement = 'x'.repeat(1_100_000)
    const summary = 'summary'.repeat(10_000)
    const parsed = parseFrontendWorkshopSourceAiProposal(
      proposal({ summary, edits: [{ expectedText: source.authorSource, replacement }] }),
      source,
      bundle,
    )
    expect(parsed.edits[0]?.replacement).toBe(replacement)
    expect(parsed.summary).toBe(summary)
  })

  it('rejects a recreated Source that collides on projectId and revision but has a new lineage', () => {
    const source = sourceDocument('<div>old</div>')
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const recreated = {
      ...source,
      authorSource: '<div>new</div>',
      createdAt: source.createdAt + 1,
      updatedAt: source.updatedAt + 1,
      revision: source.revision,
    }

    expect(() => parseFrontendWorkshopSourceAiProposal(proposal(), recreated, bundle)).toThrow(
      /Context Bundle 已失效/,
    )
  })

  it('rejects an unknown runtime Write Scope kind instead of widening authority', () => {
    const source = sourceDocument()
    const bundle = buildFrontendWorkshopSourceAiContext({
      source,
      mode: 'edit',
      instruction: '修改。',
      writeScope: { kind: 'whole-source' },
    })
    const tampered = {
      ...bundle,
      writeScope: { ...bundle.writeScope, kind: 'everything' },
    } as unknown as typeof bundle

    expect(() => parseFrontendWorkshopSourceAiProposal(proposal(), source, tampered)).toThrow(
      /Write Scope kind 非法/,
    )
  })
})
