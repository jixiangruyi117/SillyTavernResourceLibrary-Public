import { describe, expect, it } from 'vitest'
import { inspectGreetingScripts, mergeGreetingScripts } from './GreetingScriptMerge'
import { extractTavernHelperScripts } from './TavernHelperScriptParser'

const script = (id: string, content: string) => ({
  type: 'script',
  id,
  name: id,
  content,
  enabled: true,
})
const incoming = [script('copy-id', 'same()'), script('new', 'new()')]
function card() {
  return {
    extensions: {
      unrelated: { keep: 1 },
      tavern_helper: [
        ['setting', { keep: 2 }],
        [
          'scripts',
          [
            {
              type: 'folder',
              name: '保留文件夹',
              enabled: true,
              scripts: [script('same', 'same()'), script('other', 'other()')],
            },
          ],
        ],
      ],
      TavernHelper_scripts: [{ type: 'script', value: script('legacy', 'legacy()') }],
    },
  }
}
describe('greeting script merge decisions', () => {
  it.each(['add', 'replace-all', 'replace-selected'] as const)(
    '%s preserves matching scripts and respects the chosen removal scope',
    (mode) => {
      const data = card()
      const before = inspectGreetingScripts(data, incoming)
      expect(before.find((item) => item.name === 'same')?.identical).toBe(true)
      const key = before.find((item) => item.name === 'other')!.key
      mergeGreetingScripts(data, incoming, {
        mode,
        removeKeys: mode === 'replace-selected' ? [key] : [],
      })
      const result = extractTavernHelperScripts(data, { source: 'character' })
      expect(result.map((item) => item.content).sort()).toEqual(
        (mode === 'add'
          ? ['same()', 'other()', 'legacy()', 'new()']
          : mode === 'replace-selected'
            ? ['same()', 'legacy()', 'new()']
            : ['same()', 'new()']
        ).sort(),
      )
      expect(result.find((item) => item.content === 'same()')).toMatchObject({
        id: 'same',
        enabled: true,
        folder: '保留文件夹',
      })
      expect(result.find((item) => item.content === 'new()')?.enabled).toBe(false)
      expect(data.extensions.unrelated).toEqual({ keep: 1 })
      expect(data.extensions.tavern_helper[0]).toEqual(['setting', { keep: 2 }])
    },
  )
  it('does not equate different script configuration or silently resolve conflicting ids', () => {
    const data = {
      extensions: {
        tavern_helper: { scripts: [{ ...script('same', 'same()'), data: { amount: 1 } }] },
      },
    }
    const replacement = [{ ...script('same', 'same()'), data: { amount: 2 } }]
    expect(inspectGreetingScripts(data, replacement)[0]?.identical).toBe(false)
    expect(() => mergeGreetingScripts(structuredClone(data), replacement)).toThrow('编号相同')
    expect(() =>
      mergeGreetingScripts(structuredClone(data), replacement, {
        mode: 'replace-selected',
        removeKeys: ['missing'],
      }),
    ).toThrow('重新选择')
    mergeGreetingScripts(data, replacement, { mode: 'replace-selected', removeKeys: ['helper/0'] })
    expect(data.extensions.tavern_helper.scripts[0]?.data).toEqual({ amount: 2 })
  })
  it('an opening without companion scripts cannot remove existing scripts', () => {
    const data = card(),
      before = structuredClone(data)
    mergeGreetingScripts(data, [], { mode: 'replace-all', removeKeys: [] })
    expect(data).toEqual(before)
  })
})
