import { describe, expect, it, vi } from 'vitest'
import { confirmChatImports } from './UseChatImportConfirmation'
import { chooseAction } from './UseConfirmDialog'
import { createChatArchive } from '../services/TavernChatArchiveCodec.mjs'
import { hashBlob } from '../services/HashService'
import type { ResourceService } from '../services/ResourceService'
import * as nativeFiles from '../core/NativeFileSource'

vi.mock('./UseConfirmDialog', () => ({ chooseAction: vi.fn() }))
const card = new File(['card'], 'role.png')
const archive = createChatArchive(card, new File(['{}'], 'rain.jsonl'), 'role.png')
const findCharacterCardByContentHash = vi.fn()
const resources = { findCharacterCardByContentHash } as unknown as ResourceService

describe('chat import confirmation', () => {
  it('reads the native placeholder before confirming the associated chat character', async () => {
    const placeholder = new File([], archive.name)
    const read = vi.spyOn(nativeFiles, 'materializeNativeFile').mockResolvedValue(archive)
    findCharacterCardByContentHash.mockResolvedValue(undefined)
    vi.mocked(chooseAction).mockResolvedValue('confirm')
    const controller = new AbortController()
    try {
      const result = await confirmChatImports([placeholder], resources, controller.signal)
      expect(result?.chatCharacterBindings).toHaveProperty(await hashBlob(card), null)
      expect(read).toHaveBeenCalledWith(placeholder, { signal: controller.signal })
    } finally {
      read.mockRestore()
    }
  })
  it('shows the exact existing card centered and records only the confirmed identity', async () => {
    const hash = await hashBlob(card)
    findCharacterCardByContentHash.mockResolvedValue({
      resource: {
        type: 'characterCard',
        id: 'chosen',
        name: '角色',
        fileName: 'saved.png',
        contentHash: hash,
      },
      matchedHistorical: false,
      matchedFileName: 'saved.png',
      matchedBy: 'file',
    })
    vi.mocked(chooseAction).mockResolvedValue('confirm')
    expect(await confirmChatImports([archive], resources)).toMatchObject({
      chatCharacterBindings: { [hash]: 'chosen' },
    })
    expect(chooseAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        centered: true,
        message: expect.stringContaining('saved.png'),
        confirmLabel: '使用这张卡',
      }),
    )
    vi.mocked(chooseAction).mockResolvedValue('alternative')
    expect(await confirmChatImports([archive], resources)).toMatchObject({
      chatCharacterBindings: { [hash]: null },
      saveChatCharacterHashes: [],
    })
    vi.mocked(chooseAction).mockResolvedValue('cancel')
    expect(await confirmChatImports([archive], resources)).toBeNull()
  })
  it('uses the resource-group lookup so a card attached to chat can match a preserved historical file', async () => {
    const hash = await hashBlob(card)
    findCharacterCardByContentHash.mockResolvedValue({
      resource: {
        type: 'characterCard',
        id: 'current-resource',
        name: '角色',
        fileName: 'current.png',
        contentHash: 'current-hash',
      },
      matchedHistorical: true,
      matchedFileName: 'old.png',
      matchedBy: 'file',
    })
    vi.mocked(chooseAction).mockResolvedValue('confirm')

    expect(await confirmChatImports([archive], resources)).toMatchObject({
      chatCharacterBindings: { [hash]: 'current-resource' },
    })
    expect(findCharacterCardByContentHash).toHaveBeenCalledWith(hash)
    expect(chooseAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining('历史版本「old.png」') }),
    )
  })
  it('defaults to only chat and saves a new card only after explicit selection', async () => {
    const hash = await hashBlob(card)
    findCharacterCardByContentHash.mockResolvedValue(undefined)
    vi.mocked(chooseAction).mockResolvedValue('confirm')
    expect(await confirmChatImports([archive], resources)).toMatchObject({
      saveChatCharacterHashes: [],
    })
    vi.mocked(chooseAction).mockResolvedValue('alternative')
    expect(await confirmChatImports([archive], resources)).toMatchObject({
      saveChatCharacterHashes: [hash],
    })
  })
})
