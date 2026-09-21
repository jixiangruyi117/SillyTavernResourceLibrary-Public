import { describe, expect, it } from 'vitest'
import { RESOURCE_TYPE } from '../types/Resource'
import { getResourceInspector, listResourceInspectors } from './ResourceInspectorRegistry'

describe('ResourceInspectorRegistry', () => {
  it('registers every resource type with sections, actions, validation, preview and diff', () => {
    expect(listResourceInspectors()).toHaveLength(Object.values(RESOURCE_TYPE).length)
    for (const type of Object.values(RESOURCE_TYPE)) {
      const inspector = getResourceInspector(type)
      expect(inspector.sections).toContain('versions')
      expect(inspector.actions).toContain('download')
      expect(inspector.preview).toBeTruthy()
      expect(inspector.diffRenderer).toBeTruthy()
      expect(typeof inspector.validate).toBe('function')
    }
  })

  it('exposes character-only artwork and live preview actions', () => {
    expect(getResourceInspector(RESOURCE_TYPE.CHARACTER_CARD).actions).toContain('replaceArtwork')
    expect(getResourceInspector(RESOURCE_TYPE.CHARACTER_CARD).actions).toContain('preview')
    expect(getResourceInspector(RESOURCE_TYPE.OTHER).actions).not.toContain('replaceArtwork')
  })
})
