import { describe, expect, it, vi } from 'vitest'
import { confirmChatImports } from './UseChatImportConfirmation'
import { chooseAction } from './UseConfirmDialog'
import { createChatArchive } from '../services/TavernChatArchiveCodec.mjs'
import { hashBlob } from '../services/HashService'
import type { ResourceService } from '../services/ResourceService'

vi.mock('./UseConfirmDialog', () => ({ chooseAction: vi.fn() }))
const card = new File(['card'], 'role.png')
const archive = createChatArchive(card, new File(['{}'], 'rain.jsonl'), 'role.png')
const findByContentHash = vi.fn()
const resources = { findByContentHash } as unknown as ResourceService

describe('chat import confirmation', () => {
  it('shows the exact existing card centered and records only the confirmed identity', async () => {
    const hash = await hashBlob(card)
    findByContentHash.mockResolvedValue({
      type: 'characterCard',
      id: 'chosen',
      name: '角色',
      fileName: 'saved.png',
      contentHash: hash,
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
  it('defaults to only chat and saves a new card only after explicit selection', async () => {
    const hash = await hashBlob(card)
    findByContentHash.mockResolvedValue(undefined)
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
