import { describe, expect, it } from 'vitest'

import { RESOURCE_TYPE } from '../types/Resource'
import { TextBeautificationParser } from './TextBeautificationParser'

describe('TextBeautificationParser', () => {
  const parser = new TextBeautificationParser()

  it('识别 CSS 美化并提取预览摘要', async () => {
    const file = new File(
      [
        '/* @name: 深海档案 */\n:root { --accent: #3f8f7d; }\n#chat .mes { color: rgb(230, 240, 236); }',
      ],
      'theme.css',
      { type: 'text/css' },
    )

    const result = await parser.parse(file)

    expect(result.type).toBe(RESOURCE_TYPE.BEAUTIFICATION)
    expect(result.name).toBe('深海档案')
    expect(result.metadata).toMatchObject({
      detectedVariant: 'customCss',
      cssSummary: { selectorCount: 2, customPropertyCount: 1 },
    })
  })

  it('仅在 TXT 具有明确 CSS 结构时识别', async () => {
    const file = new File(['这是一段普通说明文字。'], 'readme.txt', { type: 'text/plain' })

    await expect(parser.parse(file)).rejects.toThrow('不像 CSS')
  })
})
