import { describe, expect, it } from 'vitest'

import {
  prepareTavernPreviewSource,
  stripOpeningPreviewHiddenBlocks,
} from './OpeningPreviewContent'

describe('OpeningPreviewContent', () => {
  it('removes tavern_status blocks while keeping visible opening content', () => {
    const source = `<div class="status-bar-lock">Visible status bar</div>

First visible paragraph.
<tavern_status>
[Character status] user in hall
[Balance: 20 copper]
</tavern_status>

Second visible paragraph.`

    const result = stripOpeningPreviewHiddenBlocks(source)

    expect(result).toContain('Visible status bar')
    expect(result).toContain('First visible paragraph.')
    expect(result).toContain('Second visible paragraph.')
    expect(result).not.toContain('<tavern_status>')
    expect(result).not.toContain('[Character status]')
    expect(result).not.toContain('Balance')
  })

  it('removes display:none script state blocks and EJS fragments', () => {
    const source = `Visible prose
<div style="display:none;">
<%_ setvar("stat_data", {}) _%>
</div>`

    const result = stripOpeningPreviewHiddenBlocks(source)

    expect(result).toBe('Visible prose')
    expect(result).not.toContain('setvar')
  })

  it('keeps the original opening source for the shared Tavern render pipeline', () => {
    const source = '<p>Visible</p><tavern_status>[hidden stats]</tavern_status>'

    expect(prepareTavernPreviewSource(source, 'chatMessage')).toContain('[hidden stats]')
    expect(prepareTavernPreviewSource(source, 'openingArchive')).toBe(source)
  })
})
