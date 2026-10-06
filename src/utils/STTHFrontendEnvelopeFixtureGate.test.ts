/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { applyCharacterGreetingRegex } from './CharacterGreetingRegex'
import {
  parseTavernHelperFrontendEnvelope,
  serializeTavernHelperFrontendEnvelope,
} from './FrontendWorkshopTavernFrontendEnvelope'
import { buildRichContentPreview } from './RichContentPreview'
import { formatSillyTavernMessage } from './SillyTavernMessageFormatter'

const fixtureNames = [
  'fixture-th-frontend-fence',
  'fixture-th-frontend-full-document',
  'fixture-th-frontend-script',
  'fixture-th-frontend-style',
  'fixture-th-frontend-text-mixed',
  'fixture-th-frontend-multiple-blocks',
  'fixture-th-non-html-code-block',
  'fixture-th-malformed-envelope',
  'fixture-th-regex-produced-envelope',
  'fixture-th-regex-unwrapped-html',
] as const

type FixtureName = (typeof fixtureNames)[number]

function fixture(name: FixtureName): string {
  return readFileSync(
    path.join(process.cwd(), 'fixtures', 'st-th-frontend-envelope', `${name}.txt`),
    'utf8',
  )
}

function previewBody(source: string): HTMLElement {
  const result = buildRichContentPreview(
    source,
    'anonymous TH envelope fixture',
    { allowRemoteResources: false, allowScripts: true },
    [],
    { renderShell: 'content' },
  )
  return new DOMParser().parseFromString(result.document, 'text/html').body
}

describe('ST/TH frontend envelope anonymous fixture gate', () => {
  it('keeps every required anonymous fixture checked into the gate', () => {
    expect(fixtureNames).toHaveLength(10)
    for (const name of fixtureNames) expect(fixture(name).length).toBeGreaterThan(0)
  })

  it('classifies official fenced payloads, full documents, script and style as one TH frontend', () => {
    for (const name of [
      'fixture-th-frontend-fence',
      'fixture-th-frontend-full-document',
      'fixture-th-frontend-script',
      'fixture-th-frontend-style',
    ] as const) {
      const parsed = parseTavernHelperFrontendEnvelope(fixture(name))
      expect(parsed.kind, name).toBe('single')
      expect(parsed.blocks, name).toHaveLength(1)
      expect(parsed.blocks[0]?.officialBodyEnvelope, name).toBe(true)
    }
  })

  it('matches real TH mixed and multiple block semantics without concatenation or prose loss', () => {
    const mixed = parseTavernHelperFrontendEnvelope(fixture('fixture-th-frontend-text-mixed'))
    const multiple = parseTavernHelperFrontendEnvelope(
      fixture('fixture-th-frontend-multiple-blocks'),
    )

    expect(mixed).toMatchObject({ kind: 'mixed', hasNonFrontendContent: true })
    expect(mixed.blocks).toHaveLength(1)
    expect(multiple.kind).toBe('multiple')
    expect(multiple.blocks).toHaveLength(2)
    expect(multiple.blocks[0]?.source).toContain('multiple-a')
    expect(multiple.blocks[1]?.source).toContain('multiple-b')
  })

  it('leaves ordinary code alone and refuses malformed envelope-shaped input', () => {
    expect(
      parseTavernHelperFrontendEnvelope(fixture('fixture-th-non-html-code-block')),
    ).toMatchObject({
      kind: 'none',
      blocks: [],
    })
    expect(
      parseTavernHelperFrontendEnvelope(fixture('fixture-th-malformed-envelope')),
    ).toMatchObject({
      kind: 'malformed',
      blocks: [],
    })
  })

  it('Resource Preview preserves mixed prose while mounting the matching TH frontend iframe', () => {
    const body = previewBody(fixture('fixture-th-frontend-text-mixed'))
    const wrapper = body.querySelector('div.TH-render')

    expect(wrapper).not.toBeNull()
    expect(wrapper?.querySelector('iframe')?.id).toBe('TH-message--0--0')
    expect(body.textContent).toContain('前置匿名正文。')
    expect(body.textContent).toContain('后置匿名正文。')
  })

  it('Resource Preview creates one iframe per real TH frontend PRE and preserves script/style payloads', () => {
    const multipleBody = previewBody(fixture('fixture-th-frontend-multiple-blocks'))
    expect(multipleBody.querySelectorAll('div.TH-render iframe')).toHaveLength(2)

    const scriptBody = previewBody(fixture('fixture-th-frontend-script'))
    const scriptSrcdoc =
      scriptBody.querySelector('div.TH-render iframe')?.getAttribute('srcdoc') ?? ''
    expect(scriptSrcdoc).toContain("window.__anonymousFixtureScript = '雪'")

    const styleBody = previewBody(fixture('fixture-th-frontend-style'))
    const styleSrcdoc =
      styleBody.querySelector('div.TH-render iframe')?.getAttribute('srcdoc') ?? ''
    expect(styleSrcdoc).toContain('[data-fixture="style"]')
    expect(styleSrcdoc).toContain('display: grid')
  })

  it('display regex can produce the frontend envelope before ST Markdown and TH extraction', () => {
    const producedEnvelope = fixture('fixture-th-regex-produced-envelope')
    const result = applyCharacterGreetingRegex(
      ['[[ANONYMOUS_FRONTEND]]'],
      [
        {
          id: 'fixture-produced',
          name: 'anonymous display regex',
          find: '/\\[\\[ANONYMOUS_FRONTEND\\]\\]/g',
          replace: producedEnvelope,
        },
      ],
    )
    const formatted = formatSillyTavernMessage(result.contents[0] ?? '')

    expect(result.contents[0]).toBe(producedEnvelope)
    expect(formatted.frontendBlockCount).toBe(1)
    expect(formatted.frontendBlocks[0]).toContain('regex-produced')
    expect(
      previewBody(result.contents[0] ?? '').querySelectorAll('div.TH-render iframe'),
    ).toHaveLength(1)
  })

  it('display regex can unwrap the fence, after which raw HTML no longer becomes a TH message iframe', () => {
    const wrapped = fixture('fixture-th-regex-produced-envelope')
    const unwrapped = fixture('fixture-th-regex-unwrapped-html')
    const result = applyCharacterGreetingRegex(
      [wrapped],
      [
        {
          id: 'fixture-unwrapped',
          name: 'anonymous unwrap regex',
          find: '/```html\\n[\\s\\S]*?\\n```/g',
          replace: unwrapped,
        },
      ],
    )
    const formatted = formatSillyTavernMessage(result.contents[0] ?? '')

    expect(result.contents[0]).toBe(unwrapped)
    expect(formatted.frontendBlockCount).toBe(0)
    expect(previewBody(result.contents[0] ?? '').querySelector('div.TH-render')).toBeNull()
  })

  it('round-trips the host payload through parse -> Author Source -> serialize without content loss', () => {
    for (const name of [
      'fixture-th-frontend-full-document',
      'fixture-th-frontend-script',
      'fixture-th-frontend-style',
    ] as const) {
      const parsed = parseTavernHelperFrontendEnvelope(fixture(name))
      const authorSource = parsed.blocks[0]?.source ?? ''
      const serialized = serializeTavernHelperFrontendEnvelope(authorSource)
      const reparsed = parseTavernHelperFrontendEnvelope(serialized.envelope)

      expect(reparsed.kind, name).toBe('single')
      expect(reparsed.blocks[0]?.source, name).toBe(authorSource)
    }
  })
})
