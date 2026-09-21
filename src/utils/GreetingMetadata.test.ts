import { describe, expect, it } from 'vitest'

import { parseGreetingMetadata } from './GreetingMetadata'

describe('GreetingMetadata', () => {
  it('parses title, description and group comments from the greeting prefix', () => {
    const result = parseGreetingMetadata(`<!--title:下马威-->
<!--desc：你入职公司的第一天，上司送你的第一样东西叫下马威。-->
<!--group:恼人的上司 -->

正文开始。`)

    expect(result).toEqual({
      title: '下马威',
      description: '你入职公司的第一天，上司送你的第一样东西叫下马威。',
      group: '恼人的上司',
      theme: '',
      content: '正文开始。',
    })
  })

  it('keeps unrecognized or in-body comments as original content', () => {
    const source = `正文开始。
<!--title:这不是头部元数据-->`

    expect(parseGreetingMetadata(source)).toEqual({
      title: '',
      description: '',
      group: '',
      theme: '',
      content: source,
    })
  })

  it('supports a BOM and repeated metadata fields without exposing comments as body text', () => {
    const result = parseGreetingMetadata(
      '\uFEFF  <!--title:旧标题-->\r\n<!--title:新标题-->\r\n正文',
    )

    expect(result.title).toBe('新标题')
    expect(result.content).toBe('正文')
  })

  it('parses a theme comment before title and description metadata', () => {
    const result = parseGreetingMetadata(`<!-- theme: 暧昧期 -->
<!-- title: KTV团建 -->
<!-- desc: 我到底是为什么会来这个愚蠢的KTV，好吧，我知道你会来。 -->

正文`)

    expect(result).toEqual({
      title: 'KTV团建',
      description: '我到底是为什么会来这个愚蠢的KTV，好吧，我知道你会来。',
      group: '',
      theme: '暧昧期',
      content: '正文',
    })
  })
})
