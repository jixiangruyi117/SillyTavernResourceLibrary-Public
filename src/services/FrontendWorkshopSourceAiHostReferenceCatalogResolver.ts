import type { FrontendWorkshopSourceAiHostReference } from '../utils/FrontendWorkshopSourceAiContext'
import { readOnlineHostReferences } from './FrontendWorkshopSourceAiHostReferenceOnlineReader'
import type {
  FrontendWorkshopSourceAiHostReferenceResolutionEntry,
  FrontendWorkshopSourceAiHostReferenceResolver,
  FrontendWorkshopSourceAiHostReferenceResolutionOptions,
} from './FrontendWorkshopSourceAiHostReferenceService'

export const FRONTEND_WORKSHOP_SOURCE_AI_HOST_REFERENCE_CATALOG_VERSION =
  'st-1.18.0_th-4.9.3_s9-2' as const

interface HostReferenceCatalogEntry extends FrontendWorkshopSourceAiHostReference {
  matchers: readonly string[]
}

const CATALOG: readonly HostReferenceCatalogEntry[] = [
  {
    id: 'th-4.9.3:generation',
    title: 'TavernHelper 4.9.3 · Generation',
    matchers: [
      'generation api',
      'generateraw',
      'generate(',
      'stopgenerationbyid',
      '请求生成',
      '调用酒馆模型',
    ],
    content: `Evidence baseline: TavernHelper main@71843967b272fb6f6011d9c645f24fae57865087 @types/function/generate.d.ts.
- generate(config: GenerateConfig): Promise<string | GenerateToolCallResult> uses the host preset. Minimal text request: await generate({ user_input: '...' }).
- Supported request fields include generation_id?: string, user_input?: string and should_stream?: boolean. Check typeof result === 'string' before displaying text; tool-call results are not plain text.
- stopGenerationById(generation_id: string): boolean targets only that request. Prefer an instance-owned id; do not stop unrelated generations.
- generateRaw uses a different GenerateRawConfig; request its detailed configuration before using it. Do not invent tools/overrides/event payloads from this compact reference.
Generation requires the real host, configured model and user-authorized action; a local preview cannot prove a paid generation succeeded. Disable duplicate submissions and clean up the owning request on teardown without interfering with other scripts.`,
  },
  {
    id: 'th-4.9.3:runtime-identity',
    title: 'TavernHelper 4.9.3 · Runtime identity and reload',
    matchers: [
      'getiframename',
      'getcurrentmessageid',
      'getscriptid',
      'reloadiframe',
      'iframe identity',
      'iframe name',
      'runtime identity',
      '当前楼层',
      '楼层 id',
      '楼层id',
      '脚本 id',
      '脚本id',
      '重新加载前端',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/iframe/util.d.ts.
Signatures:
- getIframeName(): string. Message frontend names follow TH-message--<message_id>--<frontend_index>; script names follow TH-script--<script_name>--<script_id>.
- getCurrentMessageId(): number. Message-frontend only; throws outside a message iframe.
- getScriptId(): string. Script-library iframe only; throws outside a script.
- reloadIframe(): void. Equivalent to reloading the current iframe and invalidates globals shared by that iframe.
Runtime rule: an iframe name identifies a host slot, not a permanent JavaScript instance. Treat the instance as disposable and clean up local DOM listeners, timers, observers, workers and media on pagehide.`,
  },
  {
    id: 'th-4.9.3:events',
    title: 'TavernHelper 4.9.3 · Host events',
    matchers: [
      'eventon',
      'eventonce',
      'eventemit',
      'eventmakefirst',
      'eventmakelast',
      'eventclearall',
      'tavern_events',
      'iframe_events',
      'message_swiped',
      'message_received',
      'message_edited',
      'message_deleted',
      'message_updated',
      'user_message_rendered',
      'character_message_rendered',
      'character_first_message_selected',
      'worldinfo_updated',
      'world_info_activated',
      'message_iframe_render_started',
      'message_iframe_render_ended',
      'event api',
      'events api',
      'host event',
      '宿主事件',
      '事件监听',
      '监听事件',
      '消息事件',
      '生命周期事件',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/iframe/event.d.ts and SRL S0 real-host lifecycle audit.
Core signatures:
- eventOn(eventType, listener): { stop(): void }
- eventOnce(eventType, listener): { stop(): void }
- eventMakeFirst/eventMakeLast(eventType, listener): { stop(): void }
- eventEmit(eventType, ...data): Promise<void>
- eventClearAll(): void
Host event listeners are automatically unloaded when the frontend/script closes, and can also be explicitly stopped. This does not clean up ordinary DOM listeners, timers or observers created by author code.
Relevant typed events include MESSAGE_SENT/RECEIVED/EDITED/DELETED/UPDATED/SWIPED, USER_MESSAGE_RENDERED, CHARACTER_MESSAGE_RENDERED, CHAT_CHANGED, CHARACTER_FIRST_MESSAGE_SELECTED, WORLDINFO_UPDATED, WORLD_INFO_ACTIVATED, MESSAGE_IFRAME_RENDER_STARTED and MESSAGE_IFRAME_RENDER_ENDED.
Do not emit tavern_events yourself unless the event payload contract is explicitly known. setChatMessages() resolution and generic rendered events are not a reliable replacement-frontend ready signal.`,
  },
  {
    id: 'th-4.9.3:chat-messages',
    title: 'TavernHelper 4.9.3 · Chat message read/write',
    matchers: [
      'getchatmessages',
      'setchatmessages',
      'createchatmessages',
      'deletechatmessages',
      'rotatechatmessages',
      'chat message',
      'chat messages',
      '聊天消息',
      '消息读写',
      'message api',
      'message refresh',
      '消息 api',
      '消息api',
      '消息刷新',
      '创建消息',
      '删除消息',
      '修改消息',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/function/chat_message.d.ts plus SRL S0 real-host refresh audit.
Core signatures:
- getChatMessages(range: string | number, options?): ChatMessage[] | ChatMessageSwiped[]. It is synchronous. Negative range numbers are depth indexes; include_swipes defaults to false.
- setChatMessages(Array<{ message_id: number } & partial message>, { refresh?: 'none'|'affected'|'all' }): Promise<void>
- createChatMessages([{ role: 'system'|'assistant'|'user', message, ... }], { insert_before?: number|'end', refresh? }): Promise<void>
- deleteChatMessages(messageIds: number[], { refresh? }): Promise<void>
ChatMessage fields: message_id, name, role, is_hidden, message, data, extra. With include_swipes:true the shape uses swipe_id, swipes, swipes_data and swipes_info.
Safety/lifecycle: refresh defaults to affected. none still saves; affected rerenders affected floors; all reloads the chat. Promise resolution does not prove that a replacement message frontend has mounted. Preserve existing message fields unless the task explicitly authorizes changing them.`,
  },
  {
    id: 'th-4.9.3:greeting-swipes',
    title: 'TavernHelper 4.9.3 · Greeting and swipe state',
    matchers: [
      'swipe',
      'swipes',
      'swipe_id',
      'swipes_data',
      'greeting',
      'alternate greeting',
      'opening message',
      'greeting api',
      'swipe api',
      '开场白',
      '备用开场',
      '消息页',
      '重 roll',
      '重roll',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official chat-message/event types and SRL opening-preview parity evidence.
- Read every message page with getChatMessages(range, { include_swipes: true }); the returned floor has swipe_id, swipes, swipes_data and swipes_info.
- Greeting alternatives are message 0 swipes. setChatMessages([{ message_id: 0, swipes: [...] }]) changes the alternatives; setChatMessages([{ message_id: 0, swipe_id: index }]) selects one. A write still requires explicit user authorization and preservation of sibling swipe data.
- tavern_events.MESSAGE_SWIPED passes message_id. CHARACTER_FIRST_MESSAGE_SELECTED passes { input, output, character } for alternate greeting selection.
- A swipe/greeting change can dispose and recreate the message iframe. Do not keep cross-remount state only in the old iframe, and do not treat setChatMessages() resolution as frontend-ready evidence.
The exact alternate-greeting/swipe disposal timeline remains deferred real-host coverage; do not invent stronger ordering guarantees.`,
  },
  {
    id: 'th-4.9.3:variables',
    title: 'TavernHelper 4.9.3 · Variables',
    matchers: [
      'getvariables',
      'replacevariables',
      'updatevariableswith',
      'insertorassignvariables',
      'deletevariable',
      'getallvariables',
      'variableoption',
      'variables api',
      'variable api',
      '变量表',
      '聊天变量',
      '楼层变量',
      '消息变量',
      '角色变量',
      '全局变量',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/function/variables.d.ts and @types/iframe/variables.d.ts.
- getVariables(option): Record<string, any>
- replaceVariables(variables, option): void
- updateVariablesWith(updater, option): Record<string, any> or Promise<Record<string, any>>
- insertOrAssignVariables / insertVariables / deleteVariable operate on the selected scope.
VariableOption scopes are chat, preset, global, character, message ({ message_id?: number|'latest' }), script ({ script_id? }) and extension ({ extension_id }).
getAllVariables() returns the host-defined merged view. In a message iframe the merge order is global → character → chat → message 0 → intermediate floors → current floor. Prefer an explicit scope for writes; do not write a merged getAllVariables() snapshot back as if it were one authoritative table.`,
  },
  {
    id: 'mvu:optional-api',
    title: 'MVU · Optional host API',
    matchers: [
      'mvu',
      'getmvudata',
      'replacemvudata',
      'parsemessage',
      'variable_update_ended',
      'variable_initialized',
      'waitglobalinitialized',
      'stat_data',
      '变量更新框架',
      '变量框架',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/iframe/exported.mvu.d.ts, @types/function/global.d.ts, and SRL S0 MVU optionality audit.
MVU is optional and must never block base UI mount or cleanup indefinitely. Before use, await waitGlobalInitialized('Mvu') with a product-bounded fallback; API readiness does not prove that the current floor has stat_data.
Core API:
- Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() }): Mvu.MvuData
- Mvu.replaceMvuData(mvuData, options): Promise<void>
- Mvu.parseMessage(message, oldData): Promise<Mvu.MvuData>
Typed events include VARIABLE_INITIALIZED, VARIABLE_UPDATE_STARTED, COMMAND_PARSED, VARIABLE_UPDATE_ENDED and BEFORE_MESSAGE_UPDATE; subscribe through eventOn(Mvu.events....).
MvuData contains initialized_lorebooks and stat_data. Preserve the complete MvuData object when replacing it. If MVU or floor data is unavailable, keep the normal frontend usable and report the optional dependency instead of fabricating values.`,
  },
  {
    id: 'th-4.9.3:stscript',
    title: 'TavernHelper 4.9.3 + SillyTavern 1.18.0 · STScript bridge',
    matchers: [
      'triggerslash',
      'stscript',
      'slash command',
      'slash commands',
      '/help slash',
      '斜杠命令',
      '酒馆命令',
      'stscript api',
      '命令管道',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/function/slash.d.ts and SillyTavern STscript Reference for release 1.18.0.
- triggerSlash(command: string): Promise<string>. Invalid commands may throw; an aborted/error command must not be treated as a successful empty result.
- STscript is a pipeline of slash commands separated by |. It supports named/unnamed arguments, {{pipe}}, closures and scoped variables.
- The running host's /help slash output is the current command inventory because extensions can add commands. Do not invent a command or maintain a static all-commands whitelist.
Only generate a concrete slash command when the requested command syntax is present in Host Reference. Otherwise request the exact command reference and return no Source edits.`,
  },
  {
    id: 'th-4.9.3:macros-formatting',
    title: 'TavernHelper 4.9.3 · Macros and displayed-message formatting',
    matchers: [
      'registermacrolike',
      'unregistermacrolike',
      'formatasdisplayedmessage',
      'macro',
      'macros',
      'macro api',
      'macros api',
      '宏替换',
      '酒馆宏',
      '助手宏',
      '显示格式化',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/function/macro_like.d.ts and displayed_message.d.ts; SillyTavern STscript Reference.
- formatAsDisplayedMessage(text, { message_id?: 'last'|'last_user'|'last_char'|number }): string applies host macros, the corresponding Tavern regexes and display HTML formatting. The referenced message floor must exist.
- registerMacroLike(regex, replace): { unregister(): void }; unregisterMacroLike(regex): void. MacroLikeContext may provide message_id and role.
- STscript supports built-in macros such as {{pipe}} and variable macros, but available extension macros are host-dependent.
Register custom macros once per disposable iframe instance and unregister/clean up on teardown when appropriate. Do not pre-expand host macros in Author Source unless the user explicitly asks to replace the literal source text.`,
  },
  {
    id: 'th-4.9.3:worldbooks',
    title: 'TavernHelper 4.9.3 · Worldbook/lorebook API',
    matchers: [
      'getworldbook',
      'replaceworldbook',
      'updateworldbookwith',
      'createworldbookentries',
      'deleteworldbookentries',
      'worldbook',
      'lorebook',
      'world info',
      'worldbook api',
      'lorebook api',
      '世界书',
      '知识书',
      '世界信息',
    ],
    content: `Evidence baseline: TavernHelper 4.9.3 official @types/function/worldbook.d.ts. The older Lorebook-named API is deprecated.
Current API includes:
- getWorldbookNames(): string[]; getWorldbook(name): Promise<WorldbookEntry[]>
- createWorldbook(name, entries?): Promise<boolean>; createOrReplaceWorldbook(...)
- replaceWorldbook(name, entries, { render? }): Promise<void>
- updateWorldbookWith(name, updater, { render? }): Promise<WorldbookEntry[]>
- createWorldbookEntries / deleteWorldbookEntries
- getGlobalWorldbookNames / rebindGlobalWorldbooks; getCharWorldbookNames / rebindCharWorldbooks; getChatWorldbookName('current') / rebindChatWorldbook('current', name)
WorldbookEntry uid is only unique within its own book. Preserve fields not targeted by the requested change. Book mutation is persistent host data and requires explicit user authorization; ordinary frontend rendering should read rather than silently create, bind or rewrite books.`,
  },
]

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
}

function referencesFor(request: string): FrontendWorkshopSourceAiHostReference[] {
  const query = normalize(request)
  if (!query) return []
  return CATALOG.filter((entry) =>
    entry.matchers.some((matcher) => query.includes(normalize(matcher))),
  ).map(({ id, title, content }) => ({ id, title, content }))
}

/**
 * The single retrieval owner: local evidence by default, official versioned files only when the
 * caller opted into research. The reader does not introduce a second resolver or AI transport.
 */
export class FrontendWorkshopSourceAiHostReferenceCatalogResolver implements FrontendWorkshopSourceAiHostReferenceResolver {
  private readonly cache?: import('./FrontendWorkshopSourceAiReferenceCache').FrontendWorkshopSourceAiReferenceCacheOwner
  constructor(
    cache?: import('./FrontendWorkshopSourceAiReferenceCache').FrontendWorkshopSourceAiReferenceCacheOwner,
  ) {
    this.cache = cache
  }
  async resolve(
    requests: readonly string[],
    options?: FrontendWorkshopSourceAiHostReferenceResolutionOptions,
  ): Promise<readonly FrontendWorkshopSourceAiHostReferenceResolutionEntry[]> {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (options?.online)
      return readOnlineHostReferences(requests, options, globalThis.fetch, this.cache)
    return requests.map((request) => ({ request, references: referencesFor(request) }))
  }
}
