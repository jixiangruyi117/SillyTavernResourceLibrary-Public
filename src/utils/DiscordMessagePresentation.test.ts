import { describe, expect, it } from 'vitest'

import {
  isImageAttachment,
  parseDiscordMarkdown,
  presentDiscordEmbed,
  previewDiscordMessage,
  tokenizeDiscordText,
} from './DiscordMessagePresentation'

describe('Discord message presentation', () => {
  it('turns ordinary and Discord message URLs into safe link tokens without swallowing punctuation', () => {
    expect(
      tokenizeDiscordText(
        '下载 https://example.com/file.zip，原消息 https://discord.com/channels/1/2/3。',
      ),
    ).toEqual([
      { type: 'text', text: '下载 ' },
      {
        type: 'link',
        text: 'https://example.com/file.zip',
        href: 'https://example.com/file.zip',
        discordMessage: false,
      },
      { type: 'text', text: '，原消息 ' },
      {
        type: 'link',
        text: '在 Discord 中查看这条消息',
        href: 'https://discord.com/channels/1/2/3',
        discordMessage: true,
      },
      { type: 'text', text: '。' },
    ])
  })

  it('parses the Discord heading, quote, emphasis and masked-link syntax used by saved posts', () => {
    const blocks = parseDiscordMarkdown(
      '## 玩前提示：\n> 1.**一定要先看简介！**\n> 2.**常看标注消息**，或[**来这里**](https://discord.com/channels/1/2/3)留言',
    )

    expect(blocks[0]).toMatchObject({ type: 'line', kind: 'heading', level: 2 })
    expect(blocks[1]).toMatchObject({ type: 'line', kind: 'quote' })
    expect(blocks[1]).toHaveProperty(
      'tokens',
      expect.arrayContaining([
        expect.objectContaining({ text: '一定要先看简介！', marks: ['bold'] }),
      ]),
    )
    expect(blocks[2]).toHaveProperty(
      'tokens',
      expect.arrayContaining([
        expect.objectContaining({
          text: '来这里',
          marks: ['bold'],
          href: 'https://discord.com/channels/1/2/3',
          discordMessage: true,
        }),
      ]),
    )
  })

  it('keeps raw HTML inert and only creates links for HTTP(S) Markdown targets', () => {
    const blocks = parseDiscordMarkdown(
      '<img src=x onerror=alert(1)> [危险](javascript:alert(1)) `**代码**`\n```js\nalert(1)\n```',
    )
    const line = blocks[0]
    expect(line).toMatchObject({ type: 'line', kind: 'paragraph' })
    if (line.type !== 'line') throw new Error('expected a line block')
    expect(line.tokens.map((token) => token.text).join('')).toContain('<img src=x')
    expect(line.tokens.some((token) => token.href)).toBe(false)
    expect(line.tokens).toContainEqual({ text: '**代码**', marks: ['code'] })
    expect(blocks[1]).toEqual({ type: 'code-block', code: 'alert(1)', language: 'js' })
  })

  it('normalizes displayable embed data and ignores unsafe URLs', () => {
    expect(
      presentDiscordEmbed({
        title: '发布信息',
        description: '已更新',
        url: 'javascript:alert(1)',
        author: { name: 'Release Bot' },
        footer: { text: '自动发布' },
        image: { url: 'https://cdn.example.com/preview.png' },
        fields: [{ name: '状态', value: '已发布', inline: true }],
      }),
    ).toEqual({
      authorName: 'Release Bot',
      title: '发布信息',
      description: '已更新',
      url: undefined,
      fields: [{ name: '状态', value: '已发布', inline: true }],
      footerText: '自动发布',
      imageUrl: 'https://cdn.example.com/preview.png',
      thumbnailUrl: undefined,
    })
  })

  it('recognizes image attachments by MIME type or extension', () => {
    expect(
      isImageAttachment({
        id: '1',
        name: 'preview.bin',
        size: 10,
        url: 'https://x',
        contentType: 'image/png',
      }),
    ).toBe(true)
    expect(isImageAttachment({ id: '2', name: 'preview.webp', size: 10, url: 'https://x' })).toBe(
      true,
    )
    expect(isImageAttachment({ id: '3', name: 'data.json', size: 10, url: 'https://x' })).toBe(
      false,
    )
  })

  it('uses embed title and description when a bot message has no plain-text body', () => {
    expect(
      previewDiscordMessage({
        content: '',
        embeds: [{ title: 'CTE v1.4', description: '角色卡与世界书已更新' }],
      }),
    ).toBe('CTE v1.4 · 角色卡与世界书已更新')
  })
})
