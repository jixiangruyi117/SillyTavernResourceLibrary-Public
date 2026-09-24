import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const readWorkerModule = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL('../../workers/discord-source-bridge/src/' + name + '.ts', import.meta.url),
    ),
    'utf8',
  )
const readerSource = readWorkerModule('DiscordSourceReader')
const workerSource = [
  readWorkerModule('DiscordSourceProtocol'),
  readWorkerModule('DiscordWorkerHttp'),
  readWorkerModule('DiscordSourceCapture'),
  readerSource,
  readWorkerModule('index'),
].join('\n')
const refreshSource = readFileSync(
  fileURLToPath(new URL('./DiscordSourceRefreshService.ts', import.meta.url)),
  'utf8',
)

describe('Discord refresh phase two contracts', () => {
  it('separates incremental discovery from bounded rotating saved-message health checks', () => {
    expect(workerSource).toContain("url.pathname === '/source/messages/check'")
    expect(workerSource).toContain('const MAX_HEALTH_MESSAGE_IDS = 12')
    expect(workerSource).toContain('const HEALTH_CHECK_CONCURRENCY = 2')
    expect(refreshSource).toContain('savedMessageIds: []')
    expect(refreshSource).toContain('scanMessageIds: healthMessageIds')
    expect(refreshSource).toContain('selectDiscordSavedMessageHealthCheckIds')
    expect(refreshSource).toContain('savedMessageCheckCursor')
    expect(refreshSource).not.toContain('CommunitySourceRuntime')
    expect(refreshSource).not.toContain('communitySourceStorage')
    expect(refreshSource).not.toContain('MAX_REFRESH_SAVED_MESSAGE_IDS')
  })

  it('uses snowflake cursors with bounded continuation instead of rescanning the same 300 messages', () => {
    expect(workerSource).toContain('BigInt(left)')
    expect(workerSource).toContain("query.set('after', scanCursor.lastSeenMessageId)")
    expect(workerSource).toContain("query.set('before', scanCursor.pendingBeforeMessageId)")
    expect(workerSource).toContain('pendingHighWaterMessageId')
    expect(workerSource).toContain('const MAX_THREAD_PAGES = 3')
    expect(refreshSource).toContain('latestSavedMessageId')
  })

  it('does not advance the source high-water while source changes still need a user decision', () => {
    expect(refreshSource).toContain('syncState: {')
  })

  it('keeps changed health ids at the front until the user resolves them and only advances a checked prefix', () => {
    expect(refreshSource).toContain('if (!checked.has(messageId)) break')
    expect(refreshSource).toContain('lastContiguousCheckedMessageId')
  })

  it('stops health scheduling on Discord 429 without inferring unchecked ids as missing', () => {
    expect(workerSource).toContain('if (response.status === 429)')
    expect(workerSource).toContain('rateLimited = true')
    expect(workerSource).toContain('stopped = true')
    expect(workerSource).toContain('checkedMessageIds')
  })
})
