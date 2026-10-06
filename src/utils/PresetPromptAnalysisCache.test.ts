import { describe, expect, it } from 'vitest'

import {
  estimateCachedPromptSimilarity,
  PresetPromptAnalysisCache,
} from './PresetPromptAnalysisCache'

describe('PresetPromptAnalysisCache', () => {
  it('reuses content-hash analyses and parses write variables once', () => {
    const cache = new PresetPromptAnalysisCache()
    const source = 'Hello {{setvar::mood::calm}} world'
    const first = cache.get(source)
    const second = cache.get(source)
    expect(second).toBe(first)
    expect(first.setVariables).toEqual(['mood'])
    expect(cache.size).toBe(1)
  })

  it('keeps similarity behavior while allowing stale analyses to be released', () => {
    const cache = new PresetPromptAnalysisCache()
    const left = cache.get('A quiet moon over the lake')
    const right = cache.get('A quiet moon over the lake tonight')
    expect(estimateCachedPromptSimilarity(left, right)).toBeGreaterThan(0.72)
    cache.retain(['A quiet moon over the lake'])
    expect(cache.size).toBe(1)
  })
})
