import { describe, expect, it } from 'vitest'
import {
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
} from '../types/FrontendWorkshopProject'
import {
  getFrontendWorkshopHotspotConflicts,
  safeFrontendWorkshopHotspots,
} from './FrontendWorkshopHotspotConflicts'

function node(
  id: string,
  kind: FrontendWorkshopNode['kind'],
  children: FrontendWorkshopNode[] = [],
) {
  return { id, kind, label: id, style: {}, children } as FrontendWorkshopNode
}

describe('FrontendWorkshopHotspotConflicts', () => {
  it('blocks hotspots over buttons, fields, links and scroll containers', () => {
    const project = createFrontendWorkshopProject('greeting')
    const parent = node('parent', 'block', [node('submit', 'control'), node('name', 'control')])
    parent.semanticRole = 'scroll-container'
    project.pages[0]!.nodes = [parent]
    project.hotspots = [
      {
        id: 'hot',
        name: '整卡点击',
        parentNodeId: 'parent',
        behaviorId: 'b',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ]
    const conflicts = getFrontendWorkshopHotspotConflicts(project)
    expect(conflicts.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['interactive-child', 'scroll-container']),
    )
    expect(safeFrontendWorkshopHotspots(project)).toEqual([])
  })

  it('detects two overlapping hotspots in the same parent', () => {
    const project = createFrontendWorkshopProject('greeting')
    project.pages[0]!.nodes = [node('parent', 'block')]
    project.hotspots = [
      {
        id: 'a',
        name: 'A',
        parentNodeId: 'parent',
        behaviorId: 'a',
        x: 0,
        y: 0,
        width: 60,
        height: 60,
      },
      {
        id: 'b',
        name: 'B',
        parentNodeId: 'parent',
        behaviorId: 'b',
        x: 50,
        y: 50,
        width: 40,
        height: 40,
      },
    ]
    expect(getFrontendWorkshopHotspotConflicts(project)).toHaveLength(2)
  })
})
