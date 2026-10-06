import { describe, expect, it } from 'vitest'

import {
  buildRenderCompatibilityMvuPreviewState,
  hasRenderCompatibilityMvuSource,
} from './RenderCompatibilityMvu'

describe('MVU Opening Preview State', () => {
  const characterData = {
    name: '林默',
    character_book: {
      name: '林默设定',
      entries: [
        {
          comment: '[initvar] 基础',
          content: '```yaml\n角色:\n  林默:\n    好感度: 3\n列表: [1, 2, 3]\n```',
        },
        {
          name: '[initvar] 补充',
          content: '<initvar>\n角色:\n  林默:\n    心情: "平静"\n列表: [9]\n</initvar>',
        },
      ],
    },
  }

  it('requires an embedded initvar source before opening initvar processing', () => {
    expect(hasRenderCompatibilityMvuSource(characterData, ['普通开场'])).toBe(true)
    expect(hasRenderCompatibilityMvuSource({}, ['<initvar>{ hp: 1 }</initvar>'])).toBe(false)
    expect(hasRenderCompatibilityMvuSource({}, ['普通开场'])).toBe(false)

    const openingOnly = buildRenderCompatibilityMvuPreviewState({
      greetings: ['<initvar>{ hp: 1 }</initvar>'],
    })
    expect(openingOnly).toMatchObject({ recognized: false, swipesData: [{}] })
  })

  it('merges embedded initvar with array replacement and builds minimum MvuData', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: ['普通开场'],
      charName: '林默',
    })

    expect(result.recognized).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.swipesData[0]).toMatchObject({
      initialized_lorebooks: { 林默设定: ['[initvar] 基础', '[initvar] 补充'] },
      stat_data: { 角色: { 林默: { 好感度: 3, 心情: '平静' } }, 列表: [9] },
      display_data: { 角色: { 林默: { 好感度: 3, 心情: '平静' } }, 列表: [9] },
      delta_data: {},
      schema: {
        type: 'object',
        properties: { 角色: { type: 'object' }, 列表: { type: 'array' } },
      },
    })
  })

  it('uses opening initvar per swipe, updates existing paths and rejects missing set paths', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: [
        '<initvar>\n角色:\n  林默:\n    好感度: 10\n</initvar>\n<UpdateVariable>\n_.add("角色.林默.好感度", 2);\n</UpdateVariable>',
        '<initvar>\n角色:\n  林默:\n    好感度: 20\n    心情: "平静"\n</initvar>\n<UpdateVariable>\n_.set("角色.林默.心情", "开心"); // 心境变化\n_.set("角色.林默.不存在", "错误数据");\n_.remove("角色.林默.旧值");\n</UpdateVariable>',
      ],
    })

    expect(result.swipesData[0]).toMatchObject({
      stat_data: { 角色: { 林默: { 好感度: 14 } } },
    })
    expect(result.swipesData[1]).toMatchObject({
      stat_data: { 角色: { 林默: { 好感度: 20, 心情: '开心' } } },
      display_data: { 角色: { 林默: { 心情: '平静->开心 (心境变化)' } } },
      delta_data: { 角色: { 林默: { 心情: '平静->开心 (心境变化)' } } },
    })
    expect(result.swipesData[1]).not.toHaveProperty('stat_data.角色.林默.不存在')
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('不存在')
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('_.remove')
    expect(result.swipesData[0]).not.toBe(result.swipesData[1])
  })

  it('matches beta numeric conversion and default VWD set/add behavior without invented reasons', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: [
        '<initvar>\n数值: 10\n带描述数值: [5, "说明"]\n列表: [1]\n</initvar>\n<UpdateVariable>\n_.set("数值", "12");\n_.add("数值", 0.5);\n_.set("带描述数值", "7");\n_.add("带描述数值", 2);\n_.set("列表[0]", 3);\n</UpdateVariable>',
      ],
    })

    expect(result.swipesData[0]).toMatchObject({
      stat_data: { 数值: 12.5, 带描述数值: [9, '说明'], 列表: [3] },
      display_data: { 数值: '12->12.5 ', 带描述数值: '7->9 ', 列表: ['3->3 '] },
      delta_data: { 数值: '12->12.5 ', 带描述数值: '7->9 ', 列表: ['3->3 '] },
    })
    expect(JSON.stringify(result.swipesData[0])).not.toContain('opening preview')
  })

  it('supports an object root set separately and leaves unsupported commands non-mutating', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: [
        '<initvar>\n旧值: 1\n</initvar>\n<UpdateVariable>\n_.set("", { 新值: 2 });\n_.add("缺失", 1);\n</UpdateVariable>',
      ],
    })

    expect(result.swipesData[0]).toMatchObject({ stat_data: { 新值: 2 } })
    expect(result.swipesData[0]).not.toHaveProperty('stat_data.缺失')
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('_.add("缺失"')
  })

  it('matches beta extensibility rules for assign/insert and remove aliases', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: [
        `<initvar>
$meta:
  extensible: true
  required: [requiredKey]
requiredKey: 1
optionalKey: 2
bag:
  $meta:
    extensible: true
  old: 1
list:
  - $arrayMeta: true
    $meta:
      extensible: true
  - a
  - b
</initvar>
<UpdateVariable>
_.assign("bag", "new", 3); // add key
_.assign("bag", { merged: 4 });
_.insert("list", 1, "x");
_.insert("list", "tail");
_.remove("optionalKey");
_.unset("list", "a");
_.delete("requiredKey");
</UpdateVariable>`,
      ],
    })

    expect(result.swipesData[0]).toMatchObject({
      stat_data: {
        $meta: { extensible: true, required: ['requiredKey'] },
        bag: { old: 1, new: 3, merged: 4 },
        list: ['x', 'x', 'b', 'tail', 'tail'],
      },
      schema: {
        type: 'object',
        extensible: true,
        properties: {
          bag: { type: 'object', extensible: true },
          list: { type: 'array', extensible: true },
        },
      },
    })
    expect(result.swipesData[0]).not.toHaveProperty('stat_data.optionalKey')
    expect(result.swipesData[0]).not.toHaveProperty('stat_data.requiredKey')
    expect(result.unsupportedOpeningUpdates.join('\n')).not.toContain('requiredKey')
    expect(result.swipesData[0]).toHaveProperty('stat_data.$meta.extensible', true)
    expect(result.swipesData[0]).not.toHaveProperty('stat_data.list.0.$arrayMeta')
    expect(result.swipesData[0]).toMatchObject({
      display_data: {
        bag: expect.stringContaining('MERGED object'),
        list: expect.stringContaining('ASSIGNED'),
      },
      delta_data: {
        bag: expect.stringContaining('MERGED object'),
        list: expect.stringContaining('ASSIGNED'),
      },
    })
  })

  it('does not assign or remove through non-extensible beta schema nodes', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: [
        `<initvar>
locked:
  value: 1
list: [a, b]
</initvar>
<UpdateVariable>
_.assign("locked", "new", 2);
_.insert("list", "c");
_.remove("locked.value");
_.unset("list", 0);
</UpdateVariable>`,
      ],
    })

    expect(result.swipesData[0]).toMatchObject({
      stat_data: { locked: { value: 1 }, list: ['a', 'b'] },
    })
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('_.assign')
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('_.insert')
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('_.remove')
    expect(result.unsupportedOpeningUpdates.join('\n')).toContain('_.unset')
  })

  it('preserves the beta one-argument array-element removal behavior', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: [
        `<initvar>
list: [a, b, c]
</initvar>
<UpdateVariable>
_.remove("list[1]");
</UpdateVariable>`,
      ],
    })

    expect(result.swipesData[0]).toMatchObject({ stat_data: { list: ['a'] } })
    expect(result.unsupportedOpeningUpdates).toEqual([])
  })

  it('replaces deterministic char and user macros before parsing', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: ['<initvar>\n角色名: "{{char}}"\n用户名: "{{user}}"\n</initvar>'],
      charName: '林默',
      userName: '顾黎',
    })

    expect(result.swipesData[0]).toMatchObject({
      stat_data: { 角色名: '林默', 用户名: '顾黎' },
    })
  })

  it('uses explicit preview placeholders when no active persona exists', () => {
    const result = buildRenderCompatibilityMvuPreviewState({
      characterData,
      greetings: ['<initvar>\n角色名: "{{char}}"\n用户名: "{{user}}"\n</initvar>'],
    })

    expect(result.swipesData[0]).toMatchObject({
      stat_data: { 角色名: '角色', 用户名: '用户' },
    })
  })
})
