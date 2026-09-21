import { describe, expect, it } from 'vitest'

import {
  FRONTEND_WORKSHOP_PARAMETER_REGISTRY,
  normalizeFrontendWorkshopParameterValue,
} from './FrontendWorkshopParameterRegistry'

describe('FrontendWorkshopParameterRegistry', () => {
  it('只保留通用 CSS 参数，不再注册 gradient / token / clip recipe 元数据', () => {
    const keys = Object.keys(FRONTEND_WORKSHOP_PARAMETER_REGISTRY)
    expect(keys).toEqual(
      expect.arrayContaining([
        'fontSize',
        'fontWeight',
        'letterSpacing',
        'lineHeight',
        'align',
        'textColor',
        'opacity',
        'cornerRadius',
        'rotation',
        'borderWidth',
        'borderColor',
        'borderStyle',
        'shadowColor',
        'shadowOffsetX',
        'shadowOffsetY',
        'shadowBlur',
        'shadowSpread',
        'padding',
        'margin',
      ]),
    )
    expect(keys).not.toContain('gradient')
    expect(keys).not.toContain('clipShape')
    for (const definition of Object.values(FRONTEND_WORKSHOP_PARAMETER_REGISTRY)) {
      expect(definition).not.toHaveProperty('tokenEligible')
      expect(definition.valueType).not.toBe('gradient')
      expect(definition.inputs).not.toContain('stops')
    }
  })

  it('使用与手动面板一致的边界，并拒绝未知 choice / color', () => {
    expect(normalizeFrontendWorkshopParameterValue('fontSize', 300)).toBe(128)
    expect(normalizeFrontendWorkshopParameterValue('fontSize', 1)).toBe(8)
    expect(normalizeFrontendWorkshopParameterValue('opacity', -20)).toBe(0)
    expect(normalizeFrontendWorkshopParameterValue('textColor', '#AABBCC')).toBe('#aabbcc')
    expect(normalizeFrontendWorkshopParameterValue('borderStyle', 'expression(alert(1))')).toBe(
      'solid',
    )
  })

  it('约束普通 spacing，不引入专用效果编辑器', () => {
    expect(
      normalizeFrontendWorkshopParameterValue('padding', {
        top: -10,
        right: 999,
        bottom: 20,
        left: 30,
      }),
    ).toEqual({ top: 0, right: 160, bottom: 20, left: 30 })
    expect(
      normalizeFrontendWorkshopParameterValue('margin', {
        top: -999,
        right: 999,
        bottom: 0,
        left: 12,
      }),
    ).toEqual({ top: -160, right: 160, bottom: 0, left: 12 })
  })
})
