/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  createFrontendWorkshopPreviewSessionContext,
  createFrontendWorkshopSourceRuntimeInstance,
} from './FrontendWorkshopSourceRuntime'
import { buildRichContentPreview, createResourcePreviewSessionContext } from './RichContentPreview'
import {
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContextFromPreviewSession,
  type PreviewSessionContext,
} from './RenderCompatibilityRuntime'

const fixtureSourceMarker = 'window.__fixtureSessionContext=true'
const fixtureVariableMarker = 'fixture-session-variable'
const fixtureSource = [
  '  <fixture-session-context data-state="ready">',
  `<script>${fixtureSourceMarker}</script>`,
  '</fixture-session-context>  ',
].join('\r\n')

function sourceDocument() {
  return createFrontendWorkshopSourceDocument('fixture-session-context', fixtureSource, 100)
}

function createSessionContext(): PreviewSessionContext {
  return {
    character: {
      name: 'fixture-character',
      data: { id: 'fixture-character', extensions: {} },
    },
    user: { name: 'fixture-user' },
    messages: {
      greetings: ['fixture-message-a', 'fixture-message-b'],
      formattedGreetings: ['<p>fixture-message-a</p>', '<p>fixture-message-b</p>'],
      activeSwipe: 1,
      swipesInfo: [{ source: 'a' }, { source: 'b' }],
    },
    variables: {
      global: { fixtureGlobal: 1 },
      chat: { fixtureChat: 2 },
      character: { fixtureCharacter: 3 },
      message: [{ state: 'a' }, { state: 'b' }],
    },
  }
}

function evaluateHost(context: PreviewSessionContext) {
  const runtimeContext = createRenderCompatibilityContextFromPreviewSession(context)
  const runtimeSource = buildRenderCompatibilityHostRuntime(runtimeContext, 0)
    .replace(/^<script>/u, '')
    .replace(/<\/script>$/u, '')
  window.eval(runtimeSource)
  return {
    runtimeContext,
    host: (
      window as unknown as {
        __SRL_RENDER_COMPAT_HOST__: {
          invoke: (name: string, args?: unknown[], meta?: Record<string, unknown>) => unknown
          getInitializedGlobal: (name: string) => unknown
          context: () => {
            chat: unknown[]
            characters: unknown[]
            characterId: number
          }
        }
      }
    ).__SRL_RENDER_COMPAT_HOST__,
  }
}

describe('PreviewSessionContext Phase 1A', () => {
  it('normalizes independently constructed Resource and Workshop adapters to the same Runtime semantics', () => {
    const resourceSession = createResourcePreviewSessionContext(
      {
        macroCharName: 'fixture-character',
        macroUserName: 'fixture-user',
        characterData: { id: 'fixture-character', extensions: {} },
        swipesData: [{ state: 'a' }, { state: 'b' }],
        swipesInfo: [{ source: 'a' }, { source: 'b' }],
        previewVariables: {
          global: { fixtureGlobal: 1 },
          chat: { fixtureChat: 2 },
          character: { fixtureCharacter: 3 },
        },
      },
      ['fixture-message-a', 'fixture-message-b'],
      ['<p>fixture-message-a</p>', '<p>fixture-message-b</p>'],
      1,
    )
    const workshopSession = createFrontendWorkshopPreviewSessionContext({
      character: {
        name: 'fixture-character',
        data: { id: 'fixture-character', extensions: {} },
      },
      user: { name: 'fixture-user' },
      messages: {
        greetings: ['fixture-message-a', 'fixture-message-b'],
        formattedGreetings: ['<p>fixture-message-a</p>', '<p>fixture-message-b</p>'],
        activeSwipe: 1,
        swipesInfo: [{ source: 'a' }, { source: 'b' }],
      },
      variables: {
        global: { fixtureGlobal: 1 },
        chat: { fixtureChat: 2 },
        character: { fixtureCharacter: 3 },
        message: [{ state: 'a' }, { state: 'b' }],
      },
    })

    expect(workshopSession).not.toBe(resourceSession)
    expect(createRenderCompatibilityContextFromPreviewSession(resourceSession)).toEqual(
      createRenderCompatibilityContextFromPreviewSession(workshopSession),
    )
  })

  it('carries character, user, active swipe, swipe metadata and initial variables into Runtime state', () => {
    const context = createRenderCompatibilityContextFromPreviewSession(createSessionContext())

    expect(context).toMatchObject({
      charName: 'fixture-character',
      userName: 'fixture-user',
      greetingIndex: 1,
      swipesData: [{ state: 'a' }, { state: 'b' }],
      swipesInfo: [{ source: 'a' }, { source: 'b' }],
      globalVariables: { fixtureGlobal: 1 },
      chatVariables: { fixtureChat: 2 },
      characterVariables: { fixtureCharacter: 3 },
      characterContextAvailable: true,
      messageContextAvailable: true,
      mvuRecognized: false,
    })

    const { host } = evaluateHost(createSessionContext())
    expect(host.invoke('getVariables', [{ type: 'global' }])).toEqual({ fixtureGlobal: 1 })
    expect(host.invoke('getVariables', [{ type: 'chat' }])).toEqual({ fixtureChat: 2 })
    expect(host.invoke('getVariables', [{ type: 'character' }])).toEqual({ fixtureCharacter: 3 })
    expect(host.invoke('getChatMessages', [0])).toEqual([
      expect.objectContaining({
        message: 'fixture-message-b',
        data: { state: 'b' },
        extra: { source: 'b' },
        swipe_id: 1,
      }),
    ])
  })

  it('does not expose formatter fallbacks as a real Character Context', () => {
    const { runtimeContext, host } = evaluateHost({
      messages: {
        greetings: ['fixture-message-a'],
        formattedGreetings: ['<p>fixture-message-a</p>'],
        activeSwipe: 0,
      },
    })

    expect(runtimeContext.charName).toBe('角色')
    expect(runtimeContext.characterData).toEqual({})
    expect(runtimeContext.characterContextAvailable).toBe(false)
    expect(host.invoke('getCurrentCharacterName')).toBeUndefined()
    expect(host.invoke('getCurrentCharacterId')).toBe(-1)
    expect(host.invoke('getCharacter')).toBeUndefined()
    expect(host.invoke('getCharData')).toBeUndefined()
    expect(host.context().characters).toEqual([])
    expect(host.context().characterId).toBe(-1)
  })

  it('treats an explicit empty character object as a minimal Character Context', () => {
    const { runtimeContext, host } = evaluateHost({
      character: {},
      messages: {
        greetings: ['fixture-message-a'],
        activeSwipe: 0,
      },
    })

    expect(runtimeContext.characterContextAvailable).toBe(true)
    expect(runtimeContext.charName).toBe('角色')
    expect(runtimeContext.characterData).toEqual({})
    expect(host.invoke('getCurrentCharacterName')).toBe('角色')
    expect(host.invoke('getCurrentCharacterId')).toBe(0)
    expect(host.invoke('getCharacter')).toEqual({})
    expect(host.invoke('getCharData')).toEqual({})
    expect(host.context().characters).toEqual([{}])
    expect(host.context().characterId).toBe(0)
  })

  it('normalizes activeSwipe into the available greeting range', () => {
    const base = {
      greetings: ['fixture-message-a', 'fixture-message-b', 'fixture-message-c'],
    }

    expect(
      createRenderCompatibilityContextFromPreviewSession({
        messages: { ...base, activeSwipe: -7 },
      }).greetingIndex,
    ).toBe(0)
    expect(
      createRenderCompatibilityContextFromPreviewSession({
        messages: { ...base, activeSwipe: 99 },
      }).greetingIndex,
    ).toBe(2)
    expect(
      createRenderCompatibilityContextFromPreviewSession({
        messages: { ...base, activeSwipe: 1.9 },
      }).greetingIndex,
    ).toBe(1)
    expect(
      createRenderCompatibilityContextFromPreviewSession({
        messages: { greetings: [], activeSwipe: 99 },
      }).greetingIndex,
    ).toBe(0)
  })

  it('accepts equal Message Variable aliases but rejects conflicting sources', () => {
    const shared = [{ state: 'a' }, { state: 'b' }]
    const context = createRenderCompatibilityContextFromPreviewSession({
      messages: {
        greetings: ['fixture-message-a', 'fixture-message-b'],
        activeSwipe: 1,
        swipesData: shared,
      },
      variables: { message: structuredClone(shared) },
      mvu: { recognized: false, swipesData: structuredClone(shared) },
    })
    expect(context.swipesData).toEqual(shared)

    expect(() =>
      createRenderCompatibilityContextFromPreviewSession({
        messages: {
          greetings: ['fixture-message-a'],
          swipesData: [{ state: 'message-source' }],
        },
        variables: { message: [{ state: 'variable-source' }] },
      }),
    ).toThrow(/message variable sources conflict/u)

    expect(() =>
      createRenderCompatibilityContextFromPreviewSession({
        messages: {
          greetings: ['fixture-message-a'],
          swipesData: [{ state: 'message-source' }],
        },
        mvu: { recognized: true, swipesData: [{ state: 'mvu-source' }] },
      }),
    ).toThrow(/message variable sources conflict/u)
  })

  it('does not fabricate MVU state when the PreviewSession omits it', () => {
    const { runtimeContext, host } = evaluateHost({
      character: { name: 'fixture-character' },
    })

    expect(runtimeContext.mvuRecognized).toBe(false)
    expect(host.getInitializedGlobal('Mvu')).toBeUndefined()
  })

  it('requires a valid active Message Context before recognizing MVU', () => {
    const validMvuData = {
      stat_data: { value: 1 },
      display_data: { value: 1 },
      delta_data: {},
      schema: { type: 'object', properties: { value: { type: 'number' } } },
    }

    const missingMessages = evaluateHost({
      variables: { message: [validMvuData] },
      mvu: { recognized: true },
    })
    expect(missingMessages.runtimeContext.messageContextAvailable).toBe(false)
    expect(missingMessages.runtimeContext.mvuRecognized).toBe(false)
    expect(missingMessages.host.getInitializedGlobal('Mvu')).toBeUndefined()
    expect(() => missingMessages.host.invoke('getVariables', [{ type: 'message' }])).toThrow(
      /message context is unavailable/u,
    )

    const invalidActiveSwipe = evaluateHost({
      messages: { greetings: ['fixture-message-a'], activeSwipe: 0 },
      variables: { message: [{ state: 'not-mvu' }] },
      mvu: { recognized: true },
    })
    expect(invalidActiveSwipe.runtimeContext.mvuRecognized).toBe(false)
    expect(invalidActiveSwipe.host.getInitializedGlobal('Mvu')).toBeUndefined()

    const valid = evaluateHost({
      messages: { greetings: ['fixture-message-a'], activeSwipe: 0 },
      variables: { message: [validMvuData] },
      mvu: { recognized: true },
    })
    expect(valid.runtimeContext.mvuRecognized).toBe(true)
    expect(valid.host.getInitializedGlobal('Mvu')).toBeDefined()
  })

  it('keeps an absent Workshop Message Context semantically empty while Source still runs unchanged', () => {
    const source = sourceDocument()
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'fixture-instance',
      runtimeNonce: 'fixture-nonce',
    })

    expect(source.authorSource).toBe(fixtureSource)
    expect(runtime.childDocument).toContain(`\n${fixtureSource}\n</body>`)
    expect(runtime.childDocument.split(fixtureSource)).toHaveLength(2)
    expect(runtime.hostDocument.split(fixtureSourceMarker)).toHaveLength(2)
    expect(runtime.childDocument).toContain('"messageContextAvailable":false')
    expect(runtime.childDocument).toContain('"characterContextAvailable":false')
    expect(runtime.childDocument).toContain('SRL_FW_SOURCE_MOUNT')
    expect(runtime.childDocument).toContain('SRL_FW_SOURCE_PAGEHIDE')

    const { host } = evaluateHost(createFrontendWorkshopPreviewSessionContext(undefined))
    expect(host.invoke('getChatMessages', [0])).toEqual([])
    expect(host.invoke('getLastMessageId')).toBe(-1)
    expect(host.context().chat).toEqual([])
  })

  it('uses explicit Workshop host state without treating it as Author Source', () => {
    const runtime = createFrontendWorkshopSourceRuntimeInstance(sourceDocument(), {
      instanceId: 'fixture-instance',
      runtimeNonce: 'fixture-nonce',
      previewSessionContext: {
        messages: {
          greetings: ['fixture-host-message'],
          formattedGreetings: ['<p>fixture-host-message</p>'],
          activeSwipe: 0,
        },
        variables: {
          chat: { sessionSeed: fixtureVariableMarker },
        },
      },
    })

    expect(runtime.childDocument).toContain(`\n${fixtureSource}\n</body>`)
    expect(runtime.childDocument).toContain('fixture-host-message')
    expect(runtime.childDocument).toContain(fixtureVariableMarker)
    expect(sourceDocument().authorSource).not.toContain('fixture-host-message')
    expect(sourceDocument().authorSource).not.toContain(fixtureVariableMarker)
    expect(runtime.hostDocument.split(fixtureSourceMarker)).toHaveLength(2)
  })

  it('keeps Resource Preview behavior on the shared Runtime path', () => {
    const result = buildRichContentPreview(
      '```html\n<html><body><fixture-session-context>ready</fixture-session-context></body></html>\n```',
      'fixture-session-context',
      { allowRemoteResources: false, allowScripts: true },
      [],
      {
        renderShell: 'content',
        macroCharName: 'fixture-character',
        macroUserName: 'fixture-user',
        greetingContents: ['fixture-message-a', 'fixture-message-b'],
        greetingIndex: 1,
        swipesData: [{ state: 'a' }, { state: 'b' }],
        swipesInfo: [{ source: 'a' }, { source: 'b' }],
      },
    )

    expect(result.hasRichContent).toBe(true)
    expect(result.document).toContain('__SRL_RENDER_COMPAT_HOST__')
    expect(result.document).toContain('"greetingIndex":1')
    expect(result.document).toContain('"swipesInfo":[{"source":"a"},{"source":"b"}]')
  })
})
