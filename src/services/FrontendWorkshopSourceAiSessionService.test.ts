/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { buildFrontendWorkshopSourceAiContext } from '../utils/FrontendWorkshopSourceAiContext'
import type { FrontendWorkshopSourceAiProposal } from '../utils/FrontendWorkshopSourceAiProposal'
import {
  FrontendWorkshopSourceAiSessionService,
  type FrontendWorkshopSourceAiCheckpointOwner,
  type FrontendWorkshopSourceAiProposalApplication,
} from './FrontendWorkshopSourceAiSessionService'

function proposal(summary: string, replacement: string): FrontendWorkshopSourceAiProposal {
  return {
    kind: 'source-ai-proposal',
    projectId: 'project',
    sourceRevision: 1,
    summary,
    edits: [{ start: 5, end: 10, expectedText: 'hello', replacement, reason: '修改文字' }],
    hostReferenceRequests: [],
    warnings: [],
  }
}

function setup() {
  let current = createFrontendWorkshopSourceDocument('project', '<div>hello</div>', 100)
  const anchors = new Map<string, typeof current>()
  let sequence = 0
  const checkpoints: FrontendWorkshopSourceAiCheckpointOwner = {
    create: vi.fn(async () => {
      const id = `cp-${++sequence}`
      anchors.set(id, structuredClone(current))
      return { id }
    }),
    read: vi.fn((_projectId, id) => structuredClone(anchors.get(id)!)),
    restore: vi.fn(async (_projectId, id) => {
      current = { ...structuredClone(anchors.get(id)!), revision: current.revision + 1 }
      return { document: current }
    }),
    remove: vi.fn((_projectId, id) => anchors.delete(id)),
  }
  const application: FrontendWorkshopSourceAiProposalApplication = {
    projectValidatedCandidate: vi.fn((base, _bundle, value) => ({
      ...base,
      authorSource: base.authorSource.replace('hello', value.edits[0]!.replacement),
    })),
    applyValidatedProposalFromBase: vi.fn(async (base, _expectedCurrent, _bundle, value) => {
      current = {
        ...base,
        authorSource: base.authorSource.replace('hello', value.edits[0]!.replacement),
        revision: current.revision + 1,
      }
      return {
        document: current,
        receipt: {
          projectId: 'project',
          fromRevision: current.revision - 1,
          toRevision: current.revision,
          changes: [],
        },
      }
    }),
  }
  return {
    service: new FrontendWorkshopSourceAiSessionService(application, checkpoints),
    application,
    checkpoints,
  }
}

function bundle(instruction: string) {
  return buildFrontendWorkshopSourceAiContext({
    source: createFrontendWorkshopSourceDocument('project', '<div>hello</div>', 100),
    mode: 'edit',
    instruction,
    writeScope: { kind: 'whole-source' },
  })
}

async function complete(
  service: FrontendWorkshopSourceAiSessionService,
  instruction: string,
  replacement: string,
  options = {},
) {
  const handle = await service.beginRequest('project', instruction, options)
  const generationId = service.completeRequest(
    'project',
    handle.requestId,
    bundle(instruction),
    proposal(`改成 ${replacement}`, replacement),
  )!
  return { handle, generationId }
}

describe('FrontendWorkshopSourceAiSessionService S7R', () => {
  it('continues a rejected component with its complete original code for field-only correction', async () => {
    const { service, application } = setup()
    const invalid = {
      name: '轮盘',
      source: {
        html: '<section>完整组件</section>',
        css: 'section{color:red}'.repeat(4000),
        javascript: 'const stage=1',
      },
      dependencies: [{ kind: 'external-resource', specifier: '本地字体栈' }],
    }
    const handle = await service.beginRequest('project', '提取组件')
    service.completeRequest('project', handle.requestId, bundle('提取组件'), {
      ...proposal('组件依赖需修正', ''),
      edits: [],
      rejectedComponentDraft: invalid,
    })
    const next = await service.beginRequest('project', '只修正依赖为 []')
    expect(next.conversation.at(-1)?.content).toContain(JSON.stringify(invalid))
    expect(service.snapshot('project').generations[0]?.proposal?.componentDraft).toBeUndefined()
    expect(application.applyValidatedProposalFromBase).not.toHaveBeenCalled()
  })
  it('continues a component draft with full code without changing project history', async () => {
    const { service, application } = setup()
    const handle = await service.beginRequest('project', '提取组件')
    service.completeRequest('project', handle.requestId, bundle('提取组件'), {
      ...proposal('组件草稿', ''),
      edits: [],
      componentDraft: {
        name: '头像',
        source: { html: '<img alt="占位">', css: 'img{width:100%}', javascript: 'const avatar=1' },
        root: { tagName: 'img' },
        provenance: { origin: 'ai' },
      },
    })
    const next = await service.beginRequest('project', '把草稿改成圆形')
    expect(next.conversation.at(-1)?.content).toContain('img{width:100%}')
    expect(next.conversation.at(-1)?.content).toContain('const avatar=1')
    expect(application.applyValidatedProposalFromBase).not.toHaveBeenCalled()
  })
  it('keeps long inputs and raw replies across more than forty generations', async () => {
    const { service } = setup()
    const instruction = '完整要求'.repeat(20_000)
    const rawText = '原始回复'.repeat(300_000)
    const first = await service.beginRequest('project', instruction)
    service.recordReceipt(
      'project',
      first.requestId,
      { id: 'full', rawText, status: 'invalid' },
      bundle(instruction),
    )
    service.failRequest('project', first.requestId, new Error('invalid'))
    for (let index = 0; index < 41; index++) {
      const handle = await service.beginRequest('project', instruction, {
        kind: 'repair',
        generationId: first.generationId,
      })
      service.failRequest('project', handle.requestId, new Error('fixture'))
    }
    expect(service.snapshot('project').turns[0]?.content).toBe(instruction)
    expect(service.snapshot('project').generations).toHaveLength(42)
    expect(service.snapshot('project').generations[0]?.receipts?.[0]?.rawText).toBe(rawText)
  })

  it('修复创建同一基线的新版本，取消修复保留旧失败原文', async () => {
    const { service } = setup()
    const original = await service.beginRequest('project', '修改文字')
    service.recordReceipt(
      'project',
      original.requestId,
      { id: 'receipt', rawText: '{broken', status: 'invalid', error: '解析失败' },
      bundle('修改文字'),
    )
    service.failRequest('project', original.requestId, new Error('解析失败'))
    const repaired = await service.beginRequest('project', '修改文字', {
      kind: 'repair',
      generationId: original.generationId,
    })
    expect(repaired.baseCheckpointId).toBe(original.baseCheckpointId)
    expect(service.snapshot('project').generations.at(-1)?.repairedFromGenerationId).toBe(
      original.generationId,
    )
    service.cancelRequest('project')
    expect(service.snapshot('project').generations[0]?.receipts?.[0]?.rawText).toBe('{broken')
    expect(service.snapshot('project').turns).toHaveLength(1)
  })

  it('把重新生成保存在同一 turn 的 sibling generations 且共享同一 base', async () => {
    const { service } = setup()
    const first = await complete(service, '修改文字', 'one')
    await service.applyGeneration('project', first.generationId)
    const second = await complete(service, '修改文字', 'two', {
      kind: 'regenerate',
      generationId: first.generationId,
    })
    const snapshot = service.snapshot('project')
    expect(snapshot.turns).toHaveLength(1)
    expect(snapshot.turns[0]?.generationIds).toEqual([first.generationId, second.generationId])
    expect(snapshot.generations.map((item) => item.ordinal)).toEqual([1, 2])
    const preview = await service.previewGeneration('project', second.generationId)
    expect(preview.before.authorSource).toBe('<div>hello</div>')
    expect(preview.after.authorSource).toBe('<div>two</div>')
  })

  it('把参考图片归属于 user turn，并在 sibling regenerate 中复用同一组图片', async () => {
    const { service } = setup()
    const referenceImages = [
      {
        id: 'image-1',
        name: 'reference.png',
        mimeType: 'image/png' as const,
        dataUrl: 'data:image/png;base64,AA==',
        size: 1,
      },
    ]
    const first = await complete(service, '参考这张图修改', 'one', { referenceImages })
    expect(first.handle.referenceImages).toEqual(referenceImages)
    const second = await complete(service, '参考这张图修改', 'two', {
      kind: 'regenerate',
      generationId: first.generationId,
    })
    expect(second.handle.referenceImages).toEqual(referenceImages)
    expect(service.snapshot('project').turns[0]?.referenceImages).toEqual(referenceImages)
  })

  it('只在 Provider 明确返回 reasoning 时写入思考详情', async () => {
    const { service } = setup()
    const handle = await service.beginRequest('project', '修改文字')
    const generationId = service.completeRequest(
      'project',
      handle.requestId,
      bundle('修改文字'),
      proposal('改成 one', 'one'),
      [],
      undefined,
      '完整思考'.repeat(10_000),
    )!

    const generation = service
      .snapshot('project')
      .generations.find((candidate) => candidate.id === generationId)
    expect(generation?.diagnostics?.providerReasoning).toBe('完整思考'.repeat(10_000))
  })

  it('从选中的旧 generation 继续会建立新分支而不删除 sibling', async () => {
    const { service } = setup()
    const first = await complete(service, '第一轮', 'one')
    await service.applyGeneration('project', first.generationId)
    const sibling = await complete(service, '第一轮', 'two', {
      kind: 'regenerate',
      generationId: first.generationId,
    })
    await service.applyGeneration('project', sibling.generationId)
    service.selectGeneration('project', first.generationId)
    const child = await complete(service, '从第一个结果继续', 'child')
    const snapshot = service.snapshot('project')
    expect(snapshot.turns).toHaveLength(2)
    expect(snapshot.turns[1]?.parentGenerationId).toBe(first.generationId)
    expect(snapshot.turns[0]?.generationIds).toContain(sibling.generationId)
    expect(child.handle.conversation.map((item) => item.content)).toEqual(['第一轮', '改成 one'])
  })

  it('删除 generation 会真删除其后继分支并通过共享 checkpoint 恢复合法 base', async () => {
    const { service, checkpoints } = setup()
    const root = await complete(service, '第一轮', 'one')
    await service.applyGeneration('project', root.generationId)
    const child = await complete(service, '第二轮', 'child')
    await service.applyGeneration('project', child.generationId)
    await service.deleteGeneration('project', root.generationId)
    const snapshot = service.snapshot('project')
    expect(snapshot.turns).toHaveLength(1)
    expect(snapshot.generations).toHaveLength(0)
    expect(checkpoints.restore).toHaveBeenCalled()
  })

  it('删除 sibling generation 后保留其余 generation 的真实顺序与历史编号', async () => {
    const { service } = setup()
    const first = await complete(service, '第一轮', 'one')
    const second = await complete(service, '第一轮', 'two', {
      kind: 'regenerate',
      generationId: first.generationId,
    })
    const third = await complete(service, '第一轮', 'three', {
      kind: 'regenerate',
      generationId: first.generationId,
    })

    await service.deleteGeneration('project', first.generationId)

    const snapshot = service.snapshot('project')
    expect(snapshot.turns[0]?.generationIds).toEqual([second.generationId, third.generationId])
    expect(snapshot.generations.map((generation) => generation.ordinal)).toEqual([2, 3])
    expect(snapshot.activeGenerationId).toBe(third.generationId)
  })

  it('Host Reference 未解决时 fail closed', async () => {
    const { service, application } = setup()
    const handle = await service.beginRequest('project', '调用未知 API')
    const value = proposal('需要证据', 'x')
    value.hostReferenceRequests = ['events']
    const generationId = service.completeRequest(
      'project',
      handle.requestId,
      bundle('调用未知 API'),
      value,
      ['events'],
      'unresolved',
    )!
    await expect(service.applyGeneration('project', generationId)).rejects.toThrow(
      '缺少 Host Reference',
    )
    expect(application.applyValidatedProposalFromBase).not.toHaveBeenCalled()
  })
})
