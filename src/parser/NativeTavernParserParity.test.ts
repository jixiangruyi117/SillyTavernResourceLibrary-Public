import { describe, expect, it } from 'vitest'
import fixtures from '../../android/app/src/test/resources/tavern-resource-parity.json'
import { JsonResourceParser } from './JsonResourceParser'
import { ChatResourceParser } from './ChatResourceParser'
import { TextBeautificationParser } from './TextBeautificationParser'

describe('native and foreground Tavern parser contracts', () => {
  it.each(fixtures)('$name shares the background recognition contract', async (fixture) => {
    const file = new File(
      ['content' in fixture ? fixture.content! : JSON.stringify(fixture.value)],
      fixture.name,
    )
    const parser = fixture.name.endsWith('.jsonl')
      ? new ChatResourceParser()
      : /\.(css|txt)$/.test(fixture.name)
        ? new TextBeautificationParser()
        : new JsonResourceParser()
    expect(await parser.parse(file)).toMatchObject(fixture.expected)
  })
})
