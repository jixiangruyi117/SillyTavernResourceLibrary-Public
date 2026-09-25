import { expect, it } from 'vitest'
import { remapReaderPortableData } from './ChatReaderPortableData'

it('remaps reader bookmarks, appearance and resume index when merge restore changes resource IDs', () => {
  const record = {
    appId: 'com.srl.duleme',
    id: 'old',
    updatedAt: 1,
    value: {
      marks: [{ floor: 7, reply: 2 }],
      regexSources: { preset: 'old-preset', character: 'kept' },
    },
  }
  const data = remapReaderPortableData(
    {
      version: 1,
      chatReader: [
        { ...record, key: 'chat:old-chat' },
        { ...record, key: 'appearance:old-card' },
        { ...record, key: 'reader-index-v1', value: { lastChat: 'old-chat' } },
      ],
    },
    new Map([
      ['old-chat', 'new-chat'],
      ['old-card', 'new-card'],
      ['old-preset', 'new-preset'],
    ]),
  )!
  expect(data.chatReader?.map((item) => item.key)).toEqual([
    'chat:new-chat',
    'appearance:new-card',
    'reader-index-v1',
  ])
  expect(data.chatReader?.[0]?.value).toEqual({
    ...record.value,
    regexSources: { preset: 'new-preset', character: 'kept' },
  })
  expect(record.value.regexSources.preset).toBe('old-preset')
  expect(data.chatReader?.[2]?.value).toEqual({ lastChat: 'new-chat' })
})
