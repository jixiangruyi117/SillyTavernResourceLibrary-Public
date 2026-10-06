import { strToU8, zip } from 'fflate'
import { serializeTavernHelperFrontendEnvelope } from './FrontendWorkshopTavernFrontendEnvelope'
import type { GreetingResourceDocument } from '../types/GreetingResource'
import { segmentFrontendWorkshopAuthorSource } from './FrontendWorkshopSourceHtmlSegmentation'

function withoutCompanionData(source: string): string {
  const segments = segmentFrontendWorkshopAuthorSource(source).segments
  const ranges: Array<{ start: number; end: number }> = []
  for (const segment of segments) {
    if (segment.semanticKind !== 'html.start-tag') continue
    const tag = source.slice(segment.range.start, segment.range.end)
    if (!/^<script[\s>]/i.test(tag)) continue
    const element = new DOMParser()
      .parseFromString(`${tag}</script>`, 'text/html')
      .querySelector('script[type="application/json"][data-tavern-helper-script]')
    if (!element) continue
    const end = segments.find(
      (item) => item.semanticKind === 'html.end-tag' && item.range.start >= segment.range.end,
    )
    if (!end) throw new Error('配套脚本数据标签未闭合，请先修正')
    ranges.push({ start: segment.range.start, end: end.range.end })
  }
  return ranges
    .reverse()
    .reduce((text, range) => text.slice(0, range.start) + text.slice(range.end), source)
}

export function createFrontendWorkshopSplitGreetingFile(source: string, name = '我的开场白'): File {
  readFrontendWorkshopCompanionScripts(source)
  return createFrontendWorkshopGreetingFile(withoutCompanionData(source), name)
}

export function createFrontendWorkshopHelperScriptsFile(source: string): File {
  const scripts = readFrontendWorkshopCompanionScripts(source)
  if (!scripts.length) throw new Error('当前作品没有独立酒馆助手脚本')
  const value =
    scripts.length === 1
      ? scripts[0]
      : { type: 'folder', id: crypto.randomUUID(), name: '开场白配套脚本', enabled: false, scripts }
  return new File([JSON.stringify(value, null, 2)], '酒馆助手脚本.json', {
    type: 'application/json',
  })
}

export function createFrontendWorkshopGreetingFile(source: string, name: string): File {
  if (!source.trim()) throw new Error('请先填写开场白源码')
  const character = readFrontendWorkshopCharacterData(source)
  const document: GreetingResourceDocument = {
    format: 'srl-greeting',
    version: 1,
    name: name.trim() || '我的开场白',
    first_mes: serializeTavernHelperFrontendEnvelope(source).envelope,
    alternate_greetings: (character?.alternate_greetings as string[] | undefined) ?? [],
    companion_scripts: readFrontendWorkshopCompanionScripts(source, () => ''),
  }
  return new File(
    [JSON.stringify(document, null, 2)],
    `${Array.from(document.name, (char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')}.greeting.json`,
    { type: 'application/json' },
  )
}

/** Companion scripts are inert Author Source data, never a second editable store. */
export function readFrontendWorkshopCompanionScripts(
  source: string,
  createId: () => string = () => crypto.randomUUID(),
): Array<Record<string, unknown>> {
  const document = new DOMParser().parseFromString(source, 'text/html')
  return [
    ...document.querySelectorAll('script[type="application/json"][data-tavern-helper-script]'),
  ].map((node, index) => {
    let value: unknown
    try {
      value = JSON.parse(node.textContent ?? '')
    } catch {
      throw new Error(`配套脚本 ${index + 1} 的 JSON 无法读取，请先修正。`)
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`配套脚本 ${index + 1} 不是脚本对象`)
    const script = value as Record<string, unknown>
    if (
      script.type !== 'script' ||
      typeof script.name !== 'string' ||
      typeof script.content !== 'string'
    )
      throw new Error(`配套脚本 ${index + 1} 缺少 type、name 或 content`)
    return {
      ...script,
      id: typeof script.id === 'string' ? script.id : createId(),
      enabled: false,
    }
  })
}

/** Same inert character data is used by local greeting preview and exported cards. */
export function readFrontendWorkshopCharacterData(
  source: string,
): Record<string, unknown> | undefined {
  const characterNode = new DOMParser()
    .parseFromString(source, 'text/html')
    .querySelector('script[type="application/json"][data-tavern-character]')
  let character: Record<string, unknown> | undefined
  if (characterNode) {
    let value: unknown
    try {
      value = JSON.parse(characterNode.textContent ?? '')
    } catch {
      throw new Error('角色卡资料的 JSON 无法读取，请先修正。')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('角色卡资料必须是对象。')
    character = value as Record<string, unknown>
    if (
      typeof character.name !== 'string' ||
      !character.name.trim() ||
      !Array.isArray(character.alternate_greetings) ||
      !character.alternate_greetings.every((text) => typeof text === 'string' && text.trim())
    )
      throw new Error('角色卡资料需要名称 name 和非空字符串组成的 alternate_greetings 数组。')
  }
  return character
}

export async function createFrontendWorkshopSourceDelivery(source: string): Promise<Blob> {
  const scripts = readFrontendWorkshopCompanionScripts(source)
  const envelope = serializeTavernHelperFrontendEnvelope(source)
  const character = readFrontendWorkshopCharacterData(source)
  const files: Record<string, Uint8Array> = {
    '前端.html': strToU8(source),
    '酒馆开场白.txt': strToU8(envelope.envelope),
    '使用说明.txt': strToU8(
      `${character ? '将“角色卡.json”通过酒馆的角色导入功能导入，再开启新聊天。默认开场白是前端介绍页，备用开场白已一并写入角色卡；点击介绍页的开场白选项即可切换真实消息。\n如果用于已有角色，只把“酒馆开场白.txt”放进默认开场白，并将本包“备用开场白”文件依次填入角色的备用开场白。不要用示例角色卡覆盖你的完整角色设定。\n' : '将“酒馆开场白.txt”粘贴进角色开场白或聊天消息。\n'}${scripts.length ? '将配套脚本 JSON 导入酒馆助手脚本库，核对内容后手动启用。脚本仅凭导入不会自动启用。\n' : ''}本地预览不能替代真实酒馆接口与设备验证。`,
    ),
  }
  if (character) {
    files['角色卡.json'] = strToU8(
      JSON.stringify(
        {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: {
            description: '',
            personality: '',
            scenario: '',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            tags: [],
            creator: '',
            character_version: '1.0',
            extensions: {},
            ...character,
            first_mes: envelope.envelope,
          },
        },
        null,
        2,
      ),
    )
    ;(character.alternate_greetings as string[]).forEach((text, index) => {
      files[`备用开场白/${index + 1}.txt`] = strToU8(text)
    })
  }
  scripts.forEach((script, index) => {
    files[`配套脚本-${index + 1}.json`] = strToU8(JSON.stringify(script, null, 2))
  })
  return new Promise((resolve, reject) => {
    zip(files, (error, bytes) =>
      error
        ? reject(error)
        : resolve(new Blob([new Uint8Array(bytes)], { type: 'application/zip' })),
    )
  })
}
