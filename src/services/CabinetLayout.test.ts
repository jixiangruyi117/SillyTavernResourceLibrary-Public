import { describe, expect, it } from 'vitest'

import type { CabinetLayoutEntry } from './BrowserStorageService'
import {
  cabinetLayoutSignature,
  getCabinetFolderOrder,
  moveCabinetLayoutEntry,
  reconcileCabinetLayout,
} from './CabinetLayout'

function entry(kind: CabinetLayoutEntry['kind'], id: string, slot: number): CabinetLayoutEntry {
  return { kind, id, slot, columnSpan: 1, rowSpan: 1 }
}

describe('CabinetLayout', () => {
  it('removes stale entries, preserves valid slots, and fills the first free slots', () => {
    const layout = reconcileCabinetLayout(
      [entry('folder', 'kept', 2), entry('folder', 'stale', 0)],
      [
        { kind: 'folder', id: 'kept' },
        { kind: 'resource', id: 'new-resource' },
        { kind: 'folder', id: 'new-folder' },
      ],
    )

    expect(layout).toEqual([
      entry('resource', 'new-resource', 0),
      entry('folder', 'new-folder', 1),
      entry('folder', 'kept', 2),
    ])
  })

  it('moves through occupied slots without creating duplicate positions', () => {
    const layout = [entry('folder', 'a', 0), entry('resource', 'b', 1), entry('folder', 'c', 2)]

    expect(moveCabinetLayoutEntry(layout, { kind: 'folder', id: 'a' }, 2)).toEqual([
      entry('resource', 'b', 0),
      entry('folder', 'c', 1),
      entry('folder', 'a', 2),
    ])
    expect(layout).toEqual([
      entry('folder', 'a', 0),
      entry('resource', 'b', 1),
      entry('folder', 'c', 2),
    ])
  })

  it('moves into an empty slot without compacting intentional gaps', () => {
    const layout = [entry('folder', 'a', 0), entry('resource', 'b', 2)]

    expect(moveCabinetLayoutEntry(layout, { kind: 'folder', id: 'a' }, 4)).toEqual([
      entry('resource', 'b', 2),
      entry('folder', 'a', 4),
    ])
  })

  it('reports no move for invalid targets and derives stable folder order and signatures', () => {
    const layout = [
      entry('resource', 'b', 0),
      entry('folder', 'second', 2),
      entry('folder', 'first', 1),
    ]

    expect(moveCabinetLayoutEntry(layout, { kind: 'folder', id: 'missing' }, 1)).toBeUndefined()
    expect(moveCabinetLayoutEntry(layout, { kind: 'folder', id: 'first' }, -1)).toBeUndefined()
    expect(getCabinetFolderOrder(layout)).toEqual(['first', 'second'])
    expect(cabinetLayoutSignature(layout)).toBe(
      'resource:b:0:1:1|folder:second:2:1:1|folder:first:1:1:1',
    )
  })
})
