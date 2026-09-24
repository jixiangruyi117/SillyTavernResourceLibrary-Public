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

describe('Discord source-read Worker contract', () => {
  it('keeps source reads explicit, authenticated and bounded', () => {
    expect(workerSource).toContain("url.pathname === '/source/read'")
    expect(workerSource).toContain('if (!authorizedSetup(request, env))')
    expect(workerSource).toContain('const MAX_THREAD_PAGES = 3')
    expect(workerSource).toContain('const MAX_SAVED_MESSAGE_IDS = 24')
    expect(workerSource).toContain('input.savedMessageIds.includes(id)')
    expect(workerSource).toContain('starterAuthorId && authorId === starterAuthorId')
    expect(workerSource).toContain('author?.bot === true')
  })

  it('prefers the real thread id over a pasted reply when resolving the starter', () => {
    expect(workerSource).toContain(
      'const starterMessageId = threadId ?? input.starterMessageId ?? input.savedMessageIds[0]',
    )
  })

  it('reads community display metadata without making names part of source identity', () => {
    expect(workerSource).toContain('async function readGuildMetadata')
    expect(workerSource).toContain('async function readThreadParentMetadata')
    expect(workerSource).toContain('guildName: context.guildName')
    expect(workerSource).toContain('channelName: context.channelName')
    expect(workerSource).toContain('const [channelResponse, guildMetadata] = await Promise.all')
    expect(workerSource).toContain('guildName: guildMetadata.name')
  })

  it('exposes an authenticated real command-status endpoint', () => {
    expect(workerSource).toContain("url.pathname === '/setup/status'")
    expect(workerSource).toContain('commandRegistered: await readMessageCommandStatus(env)')
    expect(workerSource).toContain('discordApplicationCommandsUrl(env)')
  })

  it('rejects command registration when SRL and Worker Application IDs disagree', () => {
    expect(workerSource).toContain("error: 'application_id_mismatch'")
    expect(workerSource).toContain('requestedApplicationId !== env.DISCORD_APPLICATION_ID')
    expect(workerSource).toContain('status: 409')
  })

  it('does not persist source-read responses into the handoff table', () => {
    const sourceReadStart = readerSource.indexOf('async function handleSourceRead')
    const openPageStart = readerSource.length
    expect(sourceReadStart).toBeGreaterThanOrEqual(0)
    expect(openPageStart).toBeGreaterThan(sourceReadStart)
    const sourceReadBlock = readerSource
    expect(sourceReadBlock).not.toContain('INSERT INTO handoffs')
    expect(sourceReadBlock).not.toContain('createHandoff(')
  })
})
