import { describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { MemoryRestoreStagingStore } from '../storage/RestoreStagingStore'
import { ResourceArchiveService } from './ResourceArchiveService'
const zip = (files: Record<string, string>) =>
  new File(
    [
      new Uint8Array(
        zipSync(
          Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])),
        ),
      ),
    ],
    'export.zip',
  )
describe('SillyTavern user archive', () => {
  it('classifies an ordinary ZIP without staging its resource payloads', async () => {
    const staging = new MemoryRestoreStagingStore()
    const writes = vi.spyOn(staging, 'putChunk')
    const service = new ResourceArchiveService(staging)
    expect(await service.inspect(zip({ 'characters/card.json': '{"name":"A"}' }))).toBe('resources')
    expect(writes).not.toHaveBeenCalled()
  })
  it('distinguishes SRL archives and reads supported folders without importing account secrets', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    expect(await service.inspect(zip({ 'manifest.json': '{"format":"srl-archive"}' }))).toBe(
      'library',
    )
    const file = zip({
      'characters/a.json': '{"name":"A"}',
      'OpenAI Settings/preset.json': '{"prompts":[]}',
      'themes/theme.json': '{}',
      'worlds/world.json': '{"entries":{}}',
      'secrets.json': '{"key":"DO-NOT-IMPORT"}',
      'chats/a.jsonl': 'CHAT-DO-NOT-IMPORT',
      'settings.json': JSON.stringify({
        password: 'DO-NOT-IMPORT',
        extension_settings: { regex: [{ scriptName: 'R', findRegex: 'x', replaceString: 'y' }] },
        power_user: {
          custom_css: 'body {color:red}',
          personas: { 'a.png': 'A' },
          persona_descriptions: { 'a.png': { description: '人设内容' } },
        },
      }),
    })
    expect(await service.inspect(file)).toBe('tavern')
    await expect(service.validateTavernBackup(file)).resolves.toBeUndefined()
    const files = []
    for await (const entry of service.tavernFiles(file)) files.push(entry)
    expect(files).toHaveLength(7)
    expect((await Promise.all(files.map((entry) => entry.text()))).join('')).not.toContain(
      'DO-NOT-IMPORT',
    )
  })
  it('extracts multiple ordinary resources from one ZIP without classifying a lone resource folder as Tavern', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    const archive = zip({
      'characters/A.png': 'character A',
      'characters/B.json': '{"name":"B"}',
      'worlds/Setting.json': '{"entries":{}}',
      'secrets.json': '{"password":"must not import"}',
      'notes.txt': 'ignored when there are importable resources',
    })
    const result = await service.readResourceArchive(archive)
    expect(result.kind).toBe('resources')
    expect(result.files.map((entry) => entry.name)).toEqual([
      'A.png',
      'B.json',
      'Setting.json',
      'notes.txt',
    ])
    expect((await Promise.all(result.files.map((entry) => entry.text()))).join('')).not.toContain(
      'must not import',
    )
    expect(await service.inspect(zip({ 'characters/A.json': '{"name":"A"}' }))).toBe('resources')
  })
  it('rejects a generic resource ZIP from the dedicated Tavern backup path', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    await expect(
      service.validateTavernBackup(zip({ 'characters/a.json': '{"name":"A"}' })),
    ).rejects.toThrow('未识别到受支持的 SillyTavern 备份结构')
  })
  it('recognizes Tavern-only archive paths while keeping resource-folder bundles ordinary', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    const archive = zip({
      'characters/a.json': '{"name":"A"}',
      'chats/1.jsonl': '{"mes":"chat"}',
    })
    expect(await service.inspect(archive)).toBe('tavern')
    await expect(service.validateTavernBackup(archive)).resolves.toBeUndefined()
  })
  it('does not extract system prompt and reasoning templates from a Tavern backup', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    const file = zip({
      'settings.json': '{}',
      'characters/a.json': '{"name":"A"}',
      'sysprompt/Chain of Thought.json': '{"name":"Chain of Thought"}',
      'reasoning/Assistant - Simple.json': '{"name":"Assistant - Simple"}',
    })
    const files = []
    for await (const entry of service.tavernFiles(file)) files.push(entry.name)
    expect(files).toEqual(['a.json'])
  })
  it('skips an unchanged built-in theme but preserves a user-edited copy with the same name', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    const builtIn = `{
    "name": "Dark Lite",
    "blur_strength": 10,
    "main_text_color": "rgba(220, 220, 210, 1)",
    "italics_text_color": "rgba(145, 145, 145, 1)",
    "underline_text_color": "rgba(188, 231, 207, 1)",
    "quote_text_color": "rgba(225, 138, 36, 1)",
    "blur_tint_color": "rgba(23, 23, 23, 1)",
    "chat_tint_color": "rgba(23, 23, 23, 1)",
    "user_mes_blur_tint_color": "rgba(30, 30, 30, 0.9)",
    "bot_mes_blur_tint_color": "rgba(30, 30, 30, 0.9)",
    "shadow_color": "rgba(0, 0, 0, 1)",
    "shadow_width": 2,
    "border_color": "rgba(0, 0, 0, 1)",
    "font_scale": 1,
    "fast_ui_mode": true,
    "waifuMode": false,
    "avatar_style": 0,
    "chat_display": 0,
    "noShadows": true,
    "chat_width": 50,
    "timer_enabled": false,
    "timestamps_enabled": true,
    "timestamp_model_icon": true,
    "mesIDDisplay_enabled": false,
    "hideChatAvatars_enabled": false,
    "message_token_count_enabled": false,
    "expand_message_actions": false,
    "enableZenSliders": "",
    "enableLabMode": "",
    "hotswap_enabled": true,
    "custom_css": "",
    "bogus_folders": true,
    "reduced_motion": false,
    "compact_input_area": true
}
`.replace(/\r\n/g, '\n')
    const unchanged = zip({ 'settings.json': '{}', 'themes/Dark Lite.json': builtIn })
    const unchangedFiles = []
    for await (const entry of service.tavernFiles(unchanged)) unchangedFiles.push(entry.name)
    expect(unchangedFiles).toEqual([])

    const edited = zip({
      'settings.json': '{}',
      'themes/Dark Lite.json': builtIn.replace('"chat_width": 50', '"chat_width": 77'),
    })
    const editedFiles = []
    for await (const entry of service.tavernFiles(edited)) editedFiles.push(entry.name)
    expect(editedFiles).toEqual(['Dark Lite.json'])

    const nestedUserCopy = zip({
      'settings.json': '{}',
      'themes/user/Dark Lite.json': builtIn,
    })
    const nestedFiles = []
    for await (const entry of service.tavernFiles(nestedUserCopy)) nestedFiles.push(entry.name)
    expect(nestedFiles).toEqual(['Dark Lite.json'])
  })

  it('uses content.log to skip seeded resources while preserving user files and subfolders', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    const file = zip({
      'settings.json': '{}',
      'content.log':
        'default_Seraphina.png\nEldoria.json\nthemes/Dark Lite.json\npresets/openai/Default.json\n',
      'characters/default_Seraphina.png': 'seed character',
      'characters/my-character.json': 'user character',
      'worlds/Eldoria.json': 'seed world',
      'themes/Dark Lite.json': 'seed theme',
      'themes/user/Dark Lite.json': 'user theme',
      'OpenAI Settings/Default.json': 'seed preset',
    })
    const files = []
    for await (const entry of service.tavernFiles(file)) files.push(entry.name)
    expect(files).toEqual(['my-character.json', 'Dark Lite.json'])
  })

  it('rejects unsafe ZIP paths before an import', async () => {
    const service = new ResourceArchiveService(new MemoryRestoreStagingStore())
    await expect(service.inspect(zip({ '../characters/a.json': '{}' }))).rejects.toThrow()
  })
})
