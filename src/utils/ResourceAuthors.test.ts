import { expect, it } from 'vitest'
import { readParsedAuthor, resourceAuthorLabel, resourceAuthorSearchText } from './ResourceAuthors'

it('searches noted and parsed authors without conflating them', () => {
  const resource = {
    metadata: {
      creator: '原作者',
      author: '原作者',
      authors: ['ABC', null],
      authorNote: '  补充作者  ',
    },
  }
  expect(readParsedAuthor(resource)).toBe('原作者、ABC')
  expect(resourceAuthorLabel(resource)).toBe('备注作者：补充作者')
  expect(resourceAuthorSearchText(resource)).toBe('补充作者\n原作者、abc')
  expect(resourceAuthorSearchText({ metadata: {} })).toBe('未知作者')
  expect(resourceAuthorLabel({ metadata: { authorNote: ' ' } })).toBe('')
})
