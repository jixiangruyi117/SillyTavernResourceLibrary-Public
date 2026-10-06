import { describe, expect, it } from 'vitest'

import { parseDiscordCapture, parseDiscordHandoffLink } from './DiscordHandoffService'

describe('DiscordHandoffService', () => {
  it('parses a Worker open link for pasting into the installed PWA', () => {
    const token = 'A'.repeat(30)

    expect(parseDiscordHandoffLink(`https://worker.example/open/${token}`)).toEqual({
      workerUrl: 'https://worker.example',
      token,
    })
  })

  it('accepts existing SRL handoff URLs and rejects insecure or invalid links', () => {
    const token = 'B'.repeat(30)
    const legacyUrl = new URL('https://srl.example/app')
    legacyUrl.searchParams.set('discordWorker', 'https://worker.example')
    legacyUrl.searchParams.set('discordHandoff', token)

    expect(parseDiscordHandoffLink(legacyUrl.toString())).toEqual({
      workerUrl: 'https://worker.example',
      token,
    })
    const insecureWorkerLink = new URL('https://srl.example/app')
    insecureWorkerLink.searchParams.set('discordWorker', 'http://worker.example')
    insecureWorkerLink.searchParams.set('discordHandoff', token)
    expect(parseDiscordHandoffLink(insecureWorkerLink.toString())).toBeUndefined()
    expect(parseDiscordHandoffLink(`http://worker.example/open/${token}`)).toBeUndefined()
    expect(parseDiscordHandoffLink('https://worker.example/open/short')).toBeUndefined()
  })

  it('preserves Bot/Webhook and community presentation metadata from the Worker capture', () => {
    const capture = parseDiscordCapture({
      guildId: '11111',
      guildName: '社区 A',
      channelId: '22222',
      channelName: '角色发布',
      threadId: '22222',
      starterMessageId: '22222',
      messageId: '33333',
      canonicalUrl: 'https://discord.com/channels/11111/22222/33333',
      authorId: '44444',
      authorName: 'Release Bot',
      authorBot: true,
      pinned: true,
      content: 'v1.4',
      timestamp: '2026-08-27T00:00:00.000Z',
      embeds: [],
      attachments: [],
    })

    expect(capture.authorBot).toBe(true)
    expect(capture.pinned).toBe(true)
    expect(capture.guildName).toBe('社区 A')
    expect(capture.channelName).toBe('角色发布')
  })

  it('does not infer Bot state from an arbitrary truthy value', () => {
    expect(
      parseDiscordCapture({
        channelId: '22222',
        messageId: '33333',
        canonicalUrl: 'https://discord.com/channels/@me/22222/33333',
        authorId: '44444',
        authorName: 'Member',
        authorBot: 'true',
        content: 'hello',
        timestamp: '2026-08-27T00:00:00.000Z',
      }).authorBot,
    ).toBe(false)
  })
})
