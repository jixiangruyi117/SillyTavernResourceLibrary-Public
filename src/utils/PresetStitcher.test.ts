import { describe, expect, it } from 'vitest'

import {
  applyEntryEdit,
  auditPresetAssembly,
  buildBaseAssembly,
  buildFavoriteEntry,
  buildPickEntry,
  buildStitchReview,
  defaultStitchName,
  estimatePromptSimilarity,
  getPromptDisplayTokens,
  listPromptVariables,
  listPresetRegexScripts,
  listPromptSetVariables,
  listPresetSegments,
  parsePresetText,
  serializeStitchedPreset,
  stitchPreset,
} from './PresetStitcher'

function makeBase(): Record<string, unknown> {
  return {
    temperature: 0.8,
    custom_unknown_field: { keep: true },
    prompts: [
      {
        identifier: 'main',
        name: '主提示',
        role: 'system',
        content: '你是一个助手。',
        system_prompt: true,
        extra_field: 'keep-me',
      },
      { identifier: 'chatHistory', name: 'Chat History', marker: true },
      { identifier: 'orphan-1', name: '孤儿段', role: 'system', content: '不在顺序里' },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true },
        ],
      },
    ],
  }
}

function makeSource(): Record<string, unknown> {
  return {
    prompts: [
      { identifier: 'style-1', name: '文风段', role: 'system', content: '用轻小说文风。' },
      { identifier: 'main', name: '主提示', role: 'system', content: '来源里的同名主提示' },
      { identifier: 'srcMarker', name: 'World Info', marker: true },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'style-1', enabled: true },
          { identifier: 'main', enabled: false },
          { identifier: 'srcMarker', enabled: true },
        ],
      },
    ],
    extensions: {
      regex_scripts: [
        { id: 'rx-1', scriptName: '状态栏正则', findRegex: '/a/g', replaceString: 'b' },
      ],
    },
  }
}

describe('listPresetSegments', () => {
  it('按 prompt_order 排序，marker 标记为不可缝，孤儿段附在末尾', () => {
    const segments = listPresetSegments(makeBase())
    expect(segments.map((s) => s.identifier)).toEqual(['main', 'chatHistory', 'orphan-1'])
    expect(segments[0].stitchable).toBe(true)
    expect(segments[0].role).toBe('system')
    expect(segments[1].marker).toBe(true)
    expect(segments[1].stitchable).toBe(false)
    expect(segments[2].inOrder).toBe(false)
    expect(segments[2].enabled).toBe(false)
  })

  it('停用状态来自 prompt_order 的 enabled', () => {
    const segments = listPresetSegments(makeSource())
    expect(segments.find((s) => s.identifier === 'main')?.enabled).toBe(false)
    expect(segments.find((s) => s.identifier === 'style-1')?.enabled).toBe(true)
  })
})

describe('候选检查工具', () => {
  it('高亮宏时保留原文，并区分读取、写入和普通宏', () => {
    const value = getPromptDisplayTokens(
      '<daily_limits>{{user}} {{getvar::mood}} {{setvar::mood::warm}}</daily_limits>',
    )
    expect(value).toEqual([
      { text: '<daily_limits>', kind: 'plain' },
      { text: '{{user}}', kind: 'plain' },
      { text: ' ', kind: 'plain' },
      { text: '{{getvar::mood}}', kind: 'read' },
      { text: ' ', kind: 'plain' },
      { text: '{{setvar::mood::warm}}', kind: 'write' },
      { text: '</daily_limits>', kind: 'plain' },
    ])
  })

  it('识别正文近似度与 setvar 写入变量', () => {
    expect(estimatePromptSimilarity(' 你好 世界 ', '你好世界')).toBe(1)
    expect(estimatePromptSimilarity('完全不同', '另一个条目')).toBeLessThan(0.72)
    expect(listPromptSetVariables('{{setvar::mood::warm}} {{setglobalvar::scene::night}}')).toEqual(
      ['mood', 'scene'],
    )
  })

  it('区分聊天与全局变量读写，并检查未配对宏和未关闭条件块', () => {
    expect(
      listPromptVariables(
        '{{getvar::mood}} {{setvar::mood::warm}} {{getglobalvar::mood}} {{setglobalvar::mood::cold}}',
      ),
    ).toEqual([
      { scope: 'chat', operation: 'read', name: 'mood' },
      { scope: 'chat', operation: 'write', name: 'mood' },
      { scope: 'global', operation: 'read', name: 'mood' },
      { scope: 'global', operation: 'write', name: 'mood' },
    ])

    const assembly = buildBaseAssembly(makeBase())
    applyEntryEdit(assembly[0], {
      name: '错误宏',
      role: 'system',
      content: '{{getvar::missing}} }} {{if mood}}没有结束',
    })
    const report = auditPresetAssembly(assembly)
    expect(report.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(['braces', 'condition', 'unwritten-read']),
    )
  })

  it('识别酒馆变量简写、读存在宏、增减写入和带保留空白标记的条件块', () => {
    expect(
      listPromptVariables(
        '{{.localRead}} {{$globalRead}} {{ .localWrite = yes }} {{ $globalWrite ||= ready }} {{.score += 10}} {{.fallback ?? Guest}} {{.status == active}} {{hasvar::known}} {{incglobalvar::count}}',
      ),
    ).toEqual([
      { scope: 'chat', operation: 'read', name: 'localRead' },
      { scope: 'global', operation: 'read', name: 'globalRead' },
      { scope: 'chat', operation: 'write', name: 'localWrite' },
      { scope: 'global', operation: 'write', name: 'globalWrite' },
      { scope: 'chat', operation: 'write', name: 'score' },
      { scope: 'chat', operation: 'read', name: 'fallback' },
      { scope: 'chat', operation: 'read', name: 'status' },
      { scope: 'chat', operation: 'read', name: 'known' },
      { scope: 'global', operation: 'write', name: 'count' },
    ])

    const assembly = buildBaseAssembly(makeBase())
    applyEntryEdit(assembly[0], {
      name: '保留空白条件',
      role: 'system',
      content: '{{ # if .localRead }}没有结束',
    })
    expect(auditPresetAssembly(assembly).issues.map((issue) => issue.kind)).toContain('condition')
  })

  it('只在两个启用条目写入同一作用域变量时提示重复写入', () => {
    const assembly = buildBaseAssembly(makeBase())
    const first = assembly[0]
    const second = buildPickEntry('res-b', '来源预设', makeSource(), 'style-1')!
    const global = buildPickEntry('res-b', '来源预设', makeSource(), 'main')!
    applyEntryEdit(first, { name: first.name, role: first.role, content: '{{setvar::mood::warm}}' })
    applyEntryEdit(second, {
      name: second.name,
      role: second.role,
      content: '{{setvar::mood::cold}}',
    })
    applyEntryEdit(global, {
      name: global.name,
      role: global.role,
      content: '{{setglobalvar::mood::cold}}',
    })
    const report = auditPresetAssembly([...assembly, second, global])
    expect(report.issues.filter((issue) => issue.kind === 'repeated-write')).toHaveLength(1)
    expect(report.issues.find((issue) => issue.kind === 'repeated-write')?.title).toContain(
      '聊天：mood',
    )
    second.enabled = false
    expect(
      auditPresetAssembly([...assembly, second, global]).issues.filter(
        (issue) => issue.kind === 'repeated-write',
      ),
    ).toHaveLength(0)
  })
})

describe('stitchPreset', () => {
  it('空挑选返回与底板语义等价的副本，未知字段透传', () => {
    const base = makeBase()
    const { preset, provenance } = stitchPreset(base, buildBaseAssembly(base))
    expect(provenance).toEqual([])
    expect(JSON.parse(serializeStitchedPreset(preset))).toEqual(base)
  })

  it('无冲突挑选段插入 prompts 并按装配顺序进入 prompt_order', () => {
    const base = makeBase()
    const pick = buildPickEntry('res-b', '来源预设', makeSource(), 'style-1')!
    const assembly = [...buildBaseAssembly(base)]
    assembly.splice(1, 0, pick)
    const { preset, provenance } = stitchPreset(base, assembly)
    const prompts = preset.prompts as Record<string, unknown>[]
    expect(prompts.map((p) => p.identifier)).toContain('style-1')
    const order = (preset.prompt_order as { order: { identifier: string }[] }[])[0].order
    expect(order.map((o) => o.identifier)).toEqual(['main', 'style-1', 'chatHistory'])
    expect(provenance).toEqual([
      {
        kind: 'segment',
        resourceId: 'res-b',
        resourceName: '来源预设',
        identifier: 'style-1',
        finalIdentifier: 'style-1',
        name: '文风段',
      },
    ])
  })

  it('identifier 冲突时换新 uuid 并加「·缝」后缀，原底板段不动', () => {
    const base = makeBase()
    const pick = buildPickEntry('res-b', '来源预设', makeSource(), 'main')!
    const assembly = [...buildBaseAssembly(base), pick]
    const { preset, provenance } = stitchPreset(base, assembly)
    const prompts = preset.prompts as Record<string, unknown>[]
    const added = prompts.find((p) => p.content === '来源里的同名主提示')!
    expect(added.identifier).not.toBe('main')
    expect(added.name).toBe('主提示·缝')
    expect(prompts.find((p) => p.identifier === 'main')?.name).toBe('主提示')
    expect(provenance[0].finalIdentifier).toBe(added.identifier)
    const order = (preset.prompt_order as { order: { identifier: string }[] }[])[0].order
    expect(order.at(-1)?.identifier).toBe(added.identifier)
  })

  it('marker 段不可作为挑选单元', () => {
    expect(buildPickEntry('res-b', '来源预设', makeSource(), 'srcMarker')).toBeUndefined()
  })

  it('装配区停用底板段只改 prompt_order 的 enabled', () => {
    const base = makeBase()
    const assembly = buildBaseAssembly(base)
    assembly[0].enabled = false
    const { preset } = stitchPreset(base, assembly)
    const order = (
      preset.prompt_order as { order: { identifier: string; enabled: boolean }[] }[]
    )[0].order
    expect(order[0]).toEqual({ identifier: 'main', enabled: false })
    const prompts = preset.prompts as Record<string, unknown>[]
    expect(prompts.find((p) => p.identifier === 'main')?.extra_field).toBe('keep-me')
  })

  it('编辑只写入工作副本中的已识别 prompt 字段，底板未知字段保持不变', () => {
    const base = makeBase()
    const assembly = buildBaseAssembly(base)
    applyEntryEdit(assembly[0], {
      name: '改写主提示',
      role: 'assistant',
      content: '你好 {{user}}，我是 {{char}}。',
    })
    const { preset } = stitchPreset(base, assembly)
    const prompt = (preset.prompts as Record<string, unknown>[]).find(
      (item) => item.identifier === 'main',
    )!
    expect(prompt).toMatchObject({
      name: '改写主提示',
      role: 'assistant',
      content: '你好 {{user}}，我是 {{char}}。',
      extra_field: 'keep-me',
      system_prompt: true,
    })
    expect(preset.custom_unknown_field).toEqual({ keep: true })
    expect((base.prompts as Record<string, unknown>[])[0].name).toBe('主提示')
  })

  it('评审清楚列出新增、编辑、启停、顺序与正则变化', () => {
    const base = makeBase()
    const assembly = buildBaseAssembly(base)
    applyEntryEdit(assembly[0], { name: '主提示', role: 'system', content: '已编辑' })
    assembly[0].enabled = false
    const pick = buildPickEntry('res-b', '来源预设', makeSource(), 'style-1')!
    assembly.splice(0, 2, pick, assembly[1], assembly[0])
    const review = buildStitchReview(base, assembly, [
      {
        sourceResourceId: 'res-b',
        sourceName: '来源预设',
        scripts: listPresetRegexScripts(makeSource()),
      },
    ])
    expect(review.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['add', 'edit', 'toggle', 'move', 'regex']),
    )
    expect(review.find((item) => item.kind === 'add')?.detail).toContain('最前面')
    expect(review.find((item) => item.kind === 'add')?.addedLines).toContain('用轻小说文风。')
    expect(review.find((item) => item.kind === 'edit')?.removedLines).toContain('你是一个助手。')
    expect(review.find((item) => item.kind === 'edit')?.addedLines).toContain('已编辑')
  })

  it('收藏快照可独立构建挑选行，不依赖来源资源仍保留完整 prompt', () => {
    const favorite = buildFavoriteEntry({
      id: 'favorite-1',
      sourceResourceId: 'deleted-source',
      sourceName: '已删除来源',
      identifier: 'style-1',
      name: '收藏文风',
      role: 'system',
      content: '收藏内容',
      prompt: { identifier: 'style-1', name: '收藏文风', role: 'system', content: '收藏内容' },
      createdAt: 1,
      updatedAt: 1,
    })
    const { preset, provenance } = stitchPreset(makeBase(), [
      ...buildBaseAssembly(makeBase()),
      favorite,
    ])
    expect((preset.prompts as Record<string, unknown>[]).at(-1)?.content).toBe('收藏内容')
    expect(provenance.at(-1)?.resourceId).toBe('deleted-source')
  })

  it('整组正则并入 extensions.regex_scripts，id 冲突换新', () => {
    const base = makeBase()
    const source = makeSource()
    const scripts = listPresetRegexScripts(source)
    const first = stitchPreset(base, buildBaseAssembly(base), [
      { sourceResourceId: 'res-b', sourceName: '来源预设', scripts },
    ])
    const merged = (first.preset.extensions as { regex_scripts: Record<string, unknown>[] })
      .regex_scripts
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('rx-1')
    // 再缝一次同组：id 已占用则换新
    const second = stitchPreset(first.preset, buildBaseAssembly(first.preset), [
      { sourceResourceId: 'res-b', sourceName: '来源预设', scripts },
    ])
    const twice = (second.preset.extensions as { regex_scripts: Record<string, unknown>[] })
      .regex_scripts
    expect(twice).toHaveLength(2)
    expect(twice[1].id).not.toBe('rx-1')
    expect(second.provenance[0].kind).toBe('regex')
  })

  it('底板没有 prompt_order 时为挑选段新建默认顺序组', () => {
    const base = { prompts: [] }
    const pick = buildPickEntry('res-b', '来源预设', makeSource(), 'style-1')!
    const { preset } = stitchPreset(base, [pick])
    const groups = preset.prompt_order as { character_id: number; order: unknown[] }[]
    expect(groups[0].character_id).toBe(100001)
    expect(groups[0].order).toEqual([{ identifier: 'style-1', enabled: true }])
  })

  it('多 character 组同步重建，各组私有条目保留在末尾', () => {
    const base = makeBase()
    ;(base.prompt_order as Record<string, unknown>[]).push({
      character_id: 100000,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'group-only', enabled: true },
      ],
    })
    const pick = buildPickEntry('res-b', '来源预设', makeSource(), 'style-1')!
    const { preset } = stitchPreset(base, [...buildBaseAssembly(base), pick])
    const groups = preset.prompt_order as { order: { identifier: string }[] }[]
    expect(groups[1].order.map((o) => o.identifier)).toEqual([
      'main',
      'chatHistory',
      'style-1',
      'group-only',
    ])
  })
})

describe('辅助函数', () => {
  it('parsePresetText 拒绝非对象顶层', () => {
    expect(parsePresetText('[1,2]')).toBeUndefined()
    expect(parsePresetText('not json')).toBeUndefined()
    expect(parsePresetText('{"a":1}')).toEqual({ a: 1 })
  })

  it('defaultStitchName 处理空名称', () => {
    expect(defaultStitchName('破限A')).toBe('破限A·缝合')
    expect(defaultStitchName('  ')).toBe('未命名预设·缝合')
  })
})
