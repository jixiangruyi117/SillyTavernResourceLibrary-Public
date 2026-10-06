import { describe, expect, it } from 'vitest'

import type {
  FrontendWorkshopNode,
  FrontendWorkshopNodeKind,
} from '../types/FrontendWorkshopProject'
import {
  FRONTEND_WORKSHOP_CREATABLE_NODE_KINDS,
  getFrontendWorkshopNodeDefinition,
} from './FrontendWorkshopNodeDefinitionRegistry'
import {
  FRONTEND_WORKSHOP_INSPECTOR_ITEMS,
  listFrontendWorkshopInspectorItemKeys,
  type FrontendWorkshopInspectorItem,
  type FrontendWorkshopInspectorTab,
} from './FrontendWorkshopInspectorRegistry'

function makeNode(kind: FrontendWorkshopNodeKind): FrontendWorkshopNode {
  return { id: `test-${kind}`, kind, label: kind, style: {}, children: [] }
}

const TABS: FrontendWorkshopInspectorTab[] = ['content', 'appearance', 'layout', 'interaction']
const REMOVED_INSPECTOR_KEYS = [
  'content.action',
  'content.children',
  'appearance.preset',
  'appearance.palette',
  'appearance.paletteColors',
  'appearance.material',
  'appearance.motif',
  'appearance.gradient',
  'appearance.effects',
  'appearance.tokens',
  'layout.widthMode',
  'layout.widthValue',
  'layout.heightMode',
  'layout.heightValue',
  'layout.composition',
  'layout.constraint',
  'interaction.motion',
  'interaction.actions',
  'interaction.conditions',
  'interaction.variables',
  'interaction.hotspots',
  'interaction.conflicts',
  'interaction.flip',
  'interaction.collapse',
  'interaction.tabs',
  'interaction.reveal',
] as const

describe('FrontendWorkshopInspectorRegistry', () => {
  it('只把区块、文字、图片、分隔线和表单控件作为正式节点类型', () => {
    expect(FRONTEND_WORKSHOP_CREATABLE_NODE_KINDS).toEqual([
      'block',
      'text',
      'image',
      'divider',
      'control',
    ])
    expect(getFrontendWorkshopNodeDefinition('card')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('button')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('field')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('section')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('flip')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('collapse')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('tabs')).toBeUndefined()
    expect(getFrontendWorkshopNodeDefinition('reveal')).toBeUndefined()
  })

  it('keeps every quick item inside the full inspector', () => {
    for (const kind of FRONTEND_WORKSHOP_CREATABLE_NODE_KINDS) {
      const node = makeNode(kind)
      for (const tab of TABS) {
        const quick = listFrontendWorkshopInspectorItemKeys(node, tab, 'quick')
        const full = listFrontendWorkshopInspectorItemKeys(node, tab, 'full')
        for (const key of quick) expect(full, `${kind}/${tab}/${key}`).toContain(key)
      }
    }
  })

  it('keeps Registry as the sole parameter definition', () => {
    const actual = [
      ...new Set(
        FRONTEND_WORKSHOP_INSPECTOR_ITEMS.flatMap((item) =>
          (item as FrontendWorkshopInspectorItem).parameterKey
            ? [(item as FrontendWorkshopInspectorItem).parameterKey]
            : [],
        ),
      ),
    ].sort()
    expect(actual).toContain('fontSize')
    expect(actual).toContain('opacity')
    for (const item of FRONTEND_WORKSHOP_INSPECTOR_ITEMS) {
      expect(item).not.toHaveProperty('minimum')
      expect(item).not.toHaveProperty('maximum')
      expect(item).not.toHaveProperty('step')
      expect(item).not.toHaveProperty('defaultValue')
      expect(item).not.toHaveProperty('compileRule')
    }
  })

  it('does not expose deleted, duplicate, or high-threshold recipe entries', () => {
    const keys = FRONTEND_WORKSHOP_INSPECTOR_ITEMS.map((item) => item.key)
    for (const key of REMOVED_INSPECTOR_KEYS) expect(keys).not.toContain(key)
  })

  it('has no duplicate tab/key registration', () => {
    const seen = new Set<string>()
    for (const item of FRONTEND_WORKSHOP_INSPECTOR_ITEMS) {
      const identity = `${item.tab}:${item.key}`
      expect(seen.has(identity), identity).toBe(false)
      seen.add(identity)
    }
  })

  it('keeps content about content instead of hiding interaction inside it', () => {
    const text = makeNode('text')
    const content = listFrontendWorkshopInspectorItemKeys(text, 'content', 'full')
    expect(content).toEqual(['content.label', 'content.text'])
    expect(content).not.toContain('content.action')
  })

  it('keeps layout free of duplicate width/height editors', () => {
    const block = makeNode('block')
    const layout = listFrontendWorkshopInspectorItemKeys(block, 'layout', 'full')
    expect(layout).toEqual(
      expect.arrayContaining([
        'layout.x',
        'layout.y',
        'layout.width',
        'layout.height',
        'layout.rotation',
        'layout.locked',
        'layout.zIndex',
        'layout.layer',
        'layout.reset',
      ]),
    )
    expect(layout).not.toContain('layout.widthMode')
    expect(layout).not.toContain('layout.widthValue')
    expect(layout).not.toContain('layout.heightMode')
    expect(layout).not.toContain('layout.heightValue')
  })

  it('keeps interaction as one understandable manual entry', () => {
    const block = makeNode('block')
    expect(listFrontendWorkshopInspectorItemKeys(block, 'interaction', 'quick')).toEqual([
      'interaction.behaviors',
    ])
    expect(listFrontendWorkshopInspectorItemKeys(block, 'interaction', 'full')).toEqual([
      'interaction.behaviors',
    ])
  })
})
