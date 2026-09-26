<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
import { parseGreetingResource } from '../types/GreetingResource'
import type {
  CharacterCardContentEdit,
  CharacterCardContentSection,
} from '../types/CharacterCardContentEdit'
import { PngResourceParser } from '../parser/PngResourceParser'
import { isRecord } from '../utils/UnknownValue'
import {
  applyCharacterCardContentEdit,
  applyCharacterCardContentEdits,
  allocateCharacterBookIdentity,
  characterBookPosition,
  normalizeImportedCharacterBookEntry,
  stableCharacterContentJson,
} from '../utils/CharacterCardContentEdits'

const props = defineProps<{
  card: Record<string, unknown>
  edits: CharacterCardContentEdit[]
  overriddenSections?: CharacterCardContentSection[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:edits': [value: CharacterCardContentEdit[]]
  'draft-change': [dirty: boolean]
  'use-original': [section: CharacterCardContentSection]
  back: []
}>()

type WorkbenchTab = CharacterCardContentSection
type Row = { key: string; label: string; value: unknown; note?: string }
type ImportCandidate = {
  id: string
  label: string
  value: unknown
  selected: boolean
  warning?: string
}

function collectScriptRows(values: unknown[], folder = ''): Row[] {
  return values.flatMap((item, index) => {
    if (!isRecord(item)) return []
    if (item.type === 'folder') {
      const children = Array.isArray(item.scripts) ? item.scripts : item.value
      return Array.isArray(children) ? collectScriptRows(children, String(item.name ?? folder)) : []
    }
    const raw = item.type === 'script' && isRecord(item.value) ? item.value : item
    if (typeof raw.content !== 'string' && typeof raw.script !== 'string') return []
    const key = String(raw.id ?? `fingerprint:${stableCharacterContentJson(raw)}`)
    return [
      {
        key,
        label: String(raw.name ?? '') || `脚本 ${index + 1}`,
        value: raw,
        note: folder || (raw.enabled === true ? '已启用' : '已停用'),
      },
    ]
  })
}

function helperScriptSources(cardData: Record<string, unknown>): unknown[][] {
  const extensions = isRecord(cardData.extensions) ? cardData.extensions : undefined
  const helper = normalizeSettingsRecord(extensions?.tavern_helper)
  const legacyScript = normalizeSettingsRecord(cardData.script)
  return [
    helper?.scripts,
    extensions?.TavernHelper_scripts,
    cardData.scripts,
    legacyScript?.scripts,
  ].filter((value): value is unknown[] => Array.isArray(value))
}

function normalizeSettingsRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (!Array.isArray(value)) return undefined
  return Object.fromEntries(
    value.filter(
      (item): item is [string, unknown] =>
        Array.isArray(item) && item.length >= 2 && typeof item[0] === 'string',
    ),
  )
}

function importedHelperScripts(
  root: unknown,
): Array<{ name: string; value: Record<string, unknown> }> {
  if (Array.isArray(root))
    return collectScriptRows(root).map((row) => ({
      name: row.label,
      value: row.value as Record<string, unknown>,
    }))
  if (!isRecord(root)) return []
  const data = isRecord(root.data) ? root.data : root
  const extensions = isRecord(data.extensions) ? data.extensions : undefined
  if (data.type === 'script' || typeof data.content === 'string') {
    const raw = data.type === 'script' && isRecord(data.value) ? data.value : data
    return typeof raw.content === 'string' || typeof raw.script === 'string'
      ? [{ name: String(raw.name ?? '导入脚本'), value: raw }]
      : []
  }
  const helper = normalizeSettingsRecord(extensions?.tavern_helper)
  const legacyScript = normalizeSettingsRecord(data.script)
  const sources = [
    helper?.scripts,
    extensions?.TavernHelper_scripts,
    data.scripts,
    legacyScript?.scripts,
  ].filter((value): value is unknown[] => Array.isArray(value))
  return sources.flatMap((values) =>
    collectScriptRows(values).map((row) => ({
      name: row.label,
      value: row.value as Record<string, unknown>,
    })),
  )
}

const tabs: Array<{ id: WorkbenchTab; label: string }> = [
  { id: 'greeting', label: '开场白' },
  { id: 'worldBook', label: '世界书' },
  { id: 'regex', label: '正则' },
  { id: 'helperScript', label: '酒馆助手脚本' },
]
const tab = ref<WorkbenchTab>('greeting')
const isEditorOpen = ref(false)
const editKey = ref('')
const editLabel = ref('')
const editText = ref('')
const editStructured = ref<Record<string, unknown>>({})
const editKeys = ref('')
const editSecondaryKeys = ref('')
const editFindRegex = ref('')
const editReplaceString = ref('')
const editScriptInfo = ref('')
const editEnabled = ref(true)
const editConstant = ref(false)
const editSelective = ref(false)
const editPosition = ref('0')
const editInsertionOrder = ref(0)
const editDepth = ref(4)
const editPlacement = ref<number[]>([2])
const editMarkdownOnly = ref(false)
const editPromptOnly = ref(false)
const trackMigration = ref(true)
const importTrackMigration = ref(true)
const editorBaseline = ref('')
const hasEditorDraft = ref(false)
const query = ref('')
const page = ref(1)
const pageSize = 20
const selectedKeys = ref<string[]>([])
const importPage = ref(1)
const importQuery = ref('')
const status = ref('')
const showRecords = ref(false)
const recordPage = ref(1)
const undoStack = shallowRef<CharacterCardContentEdit[][]>([])
watch(
  () => props.edits.length,
  (count) => {
    recordPage.value = Math.min(recordPage.value, Math.max(1, Math.ceil(count / pageSize)))
  },
)
let importRequest = 0
const formError = ref('')
const importError = ref('')
const isImporting = ref(false)
const importInput = ref<HTMLInputElement>()
const importCandidates = ref<ImportCandidate[]>([])
const importMode = ref<'append' | 'replace-primary'>('append')

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function textList(value: unknown): string {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string').join('\n')
  return typeof value === 'string' ? value : ''
}

function parseTextList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function worldBookCollision(entry: Record<string, unknown>): string | undefined {
  const sourceId = String(entry.uid ?? entry.id ?? '')
  const title = String(entry.comment ?? entry.name ?? '')
    .trim()
    .toLocaleLowerCase()
  const keys = parseTextList(textList(entry.keys ?? entry.key))
    .map((item) => item.toLocaleLowerCase())
    .sort()
    .join('\u0000')
  const matching = entries.value.find((row) => {
    if (!isRecord(row.value)) return false
    const candidate = row.value
    if (sourceId && row.key === sourceId) return true
    const candidateTitle = String(candidate.comment ?? candidate.name ?? '')
      .trim()
      .toLocaleLowerCase()
    const candidateKeys = parseTextList(textList(candidate.keys ?? candidate.key))
      .map((item) => item.toLocaleLowerCase())
      .sort()
      .join('\u0000')
    return Boolean((title && title === candidateTitle) || (keys && keys === candidateKeys))
  })
  if (!matching) return undefined
  return `可能与卡内“${matching.label}”重复（编号、名称或触发词相同）。继续导入只会新增条目，不会覆盖该条目。`
}

function readData(card: Record<string, unknown>): Record<string, unknown> {
  return isRecord(card.data) ? card.data : card
}

const appliedEdits = computed(() => applyCharacterCardContentEdits(props.card, props.edits))
const activeCard = computed(() => appliedEdits.value.card)
const data = computed(() => readData(activeCard.value))
const entries = computed<Row[]>(() => {
  if (tab.value === 'greeting') {
    const primary = typeof data.value.first_mes === 'string' ? data.value.first_mes : ''
    const alternates = Array.isArray(data.value.alternate_greetings)
      ? data.value.alternate_greetings.filter((item): item is string => typeof item === 'string')
      : []
    return [
      ...(primary.trim() ? [{ key: 'primary', label: '主开场白', value: primary }] : []),
      ...alternates.map((value, index) => ({
        key: `alternate:${index}`,
        label: `备用开场白 ${index + 1}`,
        value,
      })),
    ]
  }
  if (tab.value === 'worldBook') {
    const book = isRecord(data.value.character_book) ? data.value.character_book : undefined
    const values = Array.isArray(book?.entries)
      ? book.entries
      : isRecord(book?.entries)
        ? Object.values(book.entries)
        : []
    return values.flatMap((value, index) => {
      if (!isRecord(value)) return []
      const key = String(
        value.uid ?? value.id ?? `fingerprint:${stableCharacterContentJson(value)}`,
      )
      const label =
        String(value.comment ?? '') ||
        (Array.isArray(value.keys) ? value.keys.join('、') : '') ||
        `条目 ${index + 1}`
      return [{ key, label, value, note: `${String(value.content ?? '').length} 字` }]
    })
  }
  if (tab.value === 'regex') {
    const extensions = isRecord(data.value.extensions) ? data.value.extensions : undefined
    const values = Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : []
    return values.flatMap((value, index) => {
      if (!isRecord(value)) return []
      const key = String(value.id ?? `fingerprint:${stableCharacterContentJson(value)}`)
      return [
        {
          key,
          label: String(value.scriptName ?? value.script_name ?? '') || `规则 ${index + 1}`,
          value,
          note: String(value.findRegex ?? value.find_regex ?? ''),
        },
      ]
    })
  }
  return helperScriptSources(data.value).flatMap((source) => collectScriptRows(source))
})

const filteredEntries = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return needle
    ? entries.value.filter((row) =>
        `${row.label}\n${row.note ?? ''}\n${
          typeof row.value === 'string'
            ? row.value
            : isRecord(row.value)
              ? `${row.value.content ?? ''}\n${textList(row.value.keys ?? row.value.key)}`
              : ''
        }`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : entries.value
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredEntries.value.length / pageSize)))
const visibleEntries = computed(() =>
  filteredEntries.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)
const filteredImports = computed(() => {
  const needle = importQuery.value.trim().toLocaleLowerCase()
  return needle
    ? importCandidates.value.filter((item) =>
        `${item.label}\n${candidateDetail(item)}`.toLocaleLowerCase().includes(needle),
      )
    : importCandidates.value
})
const importPageCount = computed(() =>
  Math.max(1, Math.ceil(filteredImports.value.length / pageSize)),
)
const visibleImports = computed(() =>
  filteredImports.value.slice((importPage.value - 1) * pageSize, importPage.value * pageSize),
)
watch(query, () => {
  page.value = 1
})
watch(importQuery, () => {
  importPage.value = 1
})
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count)
})
watch(importPageCount, (count) => {
  importPage.value = Math.min(importPage.value, count)
})

function editorState(): string {
  return JSON.stringify([
    editLabel.value,
    editText.value,
    editKeys.value,
    editSecondaryKeys.value,
    editFindRegex.value,
    editReplaceString.value,
    editScriptInfo.value,
    editEnabled.value,
    editConstant.value,
    editSelective.value,
    editPosition.value,
    editInsertionOrder.value,
    editDepth.value,
    editPlacement.value,
    editMarkdownOnly.value,
    editPromptOnly.value,
    trackMigration.value,
  ])
}
const editorDirty = computed(() => hasEditorDraft.value && editorState() !== editorBaseline.value)
watch(editorDirty, (dirty) => emit('draft-change', dirty), { flush: 'sync' })

function publishEdits(edits: CharacterCardContentEdit[], message: string): boolean {
  const previousConflicts = new Set(appliedEdits.value.conflicts.map((edit) => edit.id))
  const conflicts = applyCharacterCardContentEdits(props.card, edits).conflicts.filter(
    (edit) =>
      !previousConflicts.has(edit.id) || edit !== props.edits.find((old) => old.id === edit.id),
  )
  if (conflicts.length) {
    formError.value = importError.value = `未应用修改：${conflicts
      .map((edit) => edit.label)
      .slice(0, 5)
      .join('、')}。条目编号或原内容有冲突，请检查后重试。`
    return false
  }
  undoStack.value = [...undoStack.value.slice(-9), props.edits]
  emit('update:edits', edits)
  status.value = message
  return true
}

function undo(): void {
  const previous = undoStack.value.at(-1)
  if (!previous || editorDirty.value) return
  undoStack.value = undoStack.value.slice(0, -1)
  emit('update:edits', previous)
  status.value = '已撤销上一步；保存资源详情后生效。'
}

async function discardConflict(id: string): Promise<void> {
  const edit = props.edits.find((item) => item.id === id)
  if (
    !edit ||
    !(await confirmAction({
      title: '放弃冲突修改',
      message: `放弃“${edit.label}”这项无法应用的修改记录？原始卡内内容保留。`,
      confirmLabel: '放弃此记录',
      danger: true,
    }))
  )
    return
  publishEdits(
    props.edits.filter((item) => item.id !== id),
    '已移除冲突记录，可撤销。',
  )
}

function updateMigration(id: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  publishEdits(
    props.edits.map((edit) => (edit.id === id ? { ...edit, migrateToVersions: checked } : edit)),
    '已更新迁移选择；保存修改后生效。',
  )
}

async function prepareSave(): Promise<boolean> {
  if (isImporting.value || props.disabled) return false
  if (editorDirty.value) {
    isEditorOpen.value = true
    if (!(await saveEditor())) return false
  }
  return !appliedEdits.value.conflicts.length
}
defineExpose({ prepareSave })

async function leaveDraft(): Promise<boolean> {
  if (!editorDirty.value) return true
  const response = await chooseAction({
    title: '这条内容还没应用',
    message: '可以应用到资源草稿，或放弃这次输入。',
    confirmLabel: '应用后继续',
    alternativeLabel: '放弃输入',
    cancelLabel: '继续编辑',
  })
  if (response === 'cancel') return false
  if (response === 'confirm') return saveEditor()
  hasEditorDraft.value = false
  return true
}

async function selectTab(next: WorkbenchTab): Promise<void> {
  if (next === tab.value || !(await leaveDraft())) return
  hasEditorDraft.value = false
  tab.value = next
}

async function exitWorkbench(): Promise<void> {
  if (await leaveDraft()) emit('back')
}

function editFor(key: string): CharacterCardContentEdit | undefined {
  return props.edits.find((item) => item.section === tab.value && item.targetKey === key)
}

async function recordChange(input: {
  operation: 'add' | 'update' | 'delete'
  key: string
  label: string
  before?: unknown
  after?: unknown
}): Promise<boolean> {
  if (props.disabled) return false
  // Alternate greeting positions shift after insertions/deletions. Preserve their
  // ordered edits instead of merging two different greetings by their current index.
  const existing =
    tab.value === 'greeting' && input.key !== 'primary' ? undefined : editFor(input.key)
  const before = existing ? existing.before : input.before
  const after = input.after
  let next: CharacterCardContentEdit[]
  if (stableCharacterContentJson(before) === stableCharacterContentJson(after)) {
    next = props.edits.filter((item) => item.id !== existing?.id)
  } else {
    next = [
      ...props.edits.filter((item) => item.id !== existing?.id),
      {
        id: existing?.id ?? crypto.randomUUID(),
        section: tab.value,
        operation: before === undefined ? 'add' : after === undefined ? 'delete' : 'update',
        targetKey: input.key,
        label: input.label,
        ...(before === undefined ? {} : { before: clone(before) }),
        ...(after === undefined ? {} : { after: clone(after) }),
        migrateToVersions: trackMigration.value,
        updatedAt: Date.now(),
      },
    ]
  }
  if (!publishEdits(next, '已应用到资源草稿；点击下方“保存修改”写入资源库。')) return false
  hasEditorDraft.value = false
  isEditorOpen.value = false
  await nextTick()
  return true
}

async function openEditor(row?: Row): Promise<void> {
  if (props.disabled) return
  if (editorDirty.value && editKey.value === (row?.key ?? '')) {
    isEditorOpen.value = true
    return
  }
  if (!(await leaveDraft())) return
  editKey.value = row?.key ?? ''
  const value = row?.value
  const fallback = defaultValue()
  const record = isRecord(value) ? clone(value) : isRecord(fallback) ? fallback : {}
  editStructured.value = record
  editLabel.value =
    tab.value === 'greeting'
      ? (row?.label ?? '新开场白')
      : tab.value === 'worldBook'
        ? String(record.comment ?? record.name ?? '新世界书条目')
        : tab.value === 'regex'
          ? String(record.scriptName ?? record.script_name ?? '新正则')
          : String(record.name ?? '新酒馆助手脚本')
  editText.value =
    tab.value === 'greeting'
      ? typeof value === 'string'
        ? value
        : ''
      : String(record.content ?? record.script ?? '')
  editKeys.value = textList(record.keys ?? record.key)
  editSecondaryKeys.value = textList(record.secondary_keys ?? record.keysecondary)
  editFindRegex.value = String(record.findRegex ?? record.find_regex ?? '')
  editReplaceString.value = String(record.replaceString ?? record.replace_string ?? '')
  editScriptInfo.value = String(record.info ?? '')
  editEnabled.value =
    tab.value === 'worldBook'
      ? typeof record.enabled === 'boolean'
        ? record.enabled
        : record.disable !== true
      : tab.value === 'regex'
        ? record.disabled !== true
        : tab.value === 'helperScript'
          ? record.enabled === true
          : true
  editConstant.value = record.constant === true
  editSelective.value = record.selective === true
  editPosition.value = String(characterBookPosition(record))
  editInsertionOrder.value = Number(record.insertion_order ?? record.order ?? 0)
  const extensions = isRecord(record.extensions) ? record.extensions : {}
  editDepth.value = Number(extensions.depth ?? record.depth ?? 4)
  editPlacement.value = Array.isArray(record.placement)
    ? record.placement.map(Number).filter(Number.isFinite)
    : [2]
  editMarkdownOnly.value = (record.markdownOnly ?? record.markdown_only) === true
  editPromptOnly.value = (record.promptOnly ?? record.prompt_only) === true
  trackMigration.value = row ? (editFor(row.key)?.migrateToVersions ?? true) : true
  formError.value = ''
  editorBaseline.value = editorState()
  hasEditorDraft.value = true
  isEditorOpen.value = true
}

function defaultValue(): unknown {
  const id = crypto.randomUUID()
  if (tab.value === 'worldBook')
    return {
      uid: nextWorldBookUid(),
      id: nextWorldBookUid(),
      comment: '新世界书条目',
      keys: [],
      secondary_keys: [],
      content: '',
      extensions: {},
      enabled: true,
      insertion_order: 0,
      constant: false,
      selective: false,
      position: 'before_char',
    }
  if (tab.value === 'regex')
    return {
      id,
      scriptName: '新正则',
      findRegex: '',
      replaceString: '',
      disabled: false,
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      trimStrings: [],
      substituteRegex: 0,
    }
  return { id, name: '新酒馆助手脚本', info: '', content: '', enabled: false, data: {} }
}

function nextWorldBookUid(): number {
  const book = isRecord(data.value.character_book) ? data.value.character_book : undefined
  const entries = Array.isArray(book?.entries)
    ? book.entries
    : isRecord(book?.entries)
      ? Object.values(book.entries)
      : []
  const maximum = entries.reduce((current, item) => {
    if (!isRecord(item)) return current
    return [item.uid, item.id].reduce<number>((max, value) => {
      const uid = Number(value)
      return Number.isSafeInteger(uid) && uid > max ? uid : max
    }, current)
  }, 0)
  return maximum + 1
}

async function saveEditor(): Promise<boolean> {
  formError.value = ''
  let after: unknown
  if (tab.value === 'greeting') {
    after = editText.value
    if (!String(after).trim()) {
      formError.value = '开场白内容不能为空。'
      return false
    }
  } else {
    const structured = clone(editStructured.value)
    after = structured
    if (tab.value === 'worldBook') {
      if (!editText.value.trim()) {
        formError.value = '世界书条目正文不能为空。'
        return false
      }
      structured.comment = editLabel.value.trim() || '未命名条目'
      if (editKeys.value !== textList(structured.keys ?? structured.key))
        structured.keys = parseTextList(editKeys.value)
      if (
        editSecondaryKeys.value !== textList(structured.secondary_keys ?? structured.keysecondary)
      )
        structured.secondary_keys = parseTextList(editSecondaryKeys.value)
      structured.content = editText.value
      structured.enabled = editEnabled.value
      structured.constant = editConstant.value
      structured.selective = editSelective.value
      const position = Number(editPosition.value)
      if (position !== characterBookPosition(editStructured.value) || !editKey.value) {
        structured.position = position === 0 ? 'before_char' : 'after_char'
        structured.extensions = {
          ...(isRecord(structured.extensions) ? structured.extensions : {}),
          position,
        }
      }
      structured.insertion_order = Number.isFinite(Number(editInsertionOrder.value))
        ? Number(editInsertionOrder.value)
        : 0
      if (editPosition.value === '4') {
        if (!Number.isInteger(editDepth.value) || editDepth.value < 0) {
          formError.value = '深度需要填写大于或等于 0 的整数。'
          return false
        }
        structured.extensions = {
          ...(isRecord(structured.extensions) ? structured.extensions : {}),
          depth: editDepth.value,
        }
      }
    } else if (tab.value === 'regex') {
      if (!editFindRegex.value.trim()) {
        formError.value = '请填写要匹配的正则表达式。'
        return false
      }
      structured.scriptName = editLabel.value.trim() || '未命名正则'
      structured.findRegex = editFindRegex.value
      structured.replaceString = editReplaceString.value
      structured.disabled = !editEnabled.value
      if ('enabled' in structured) structured.enabled = editEnabled.value
      if (!editPlacement.value.length) {
        formError.value = '请至少选择一个正则作用范围。'
        return false
      }
      structured.placement = [...editPlacement.value]
      structured.markdownOnly = editMarkdownOnly.value
      structured.promptOnly = editPromptOnly.value
      if ('markdown_only' in structured) structured.markdown_only = editMarkdownOnly.value
      if ('prompt_only' in structured) structured.prompt_only = editPromptOnly.value
    } else {
      structured.name = editLabel.value.trim() || '未命名脚本'
      structured.info = editScriptInfo.value
      structured.content = editText.value
      if ('script' in structured) structured.script = editText.value
      structured.enabled = editEnabled.value
    }
    if (!isRecord(after)) {
      formError.value = '无法读取当前内容，请关闭后重试。'
      return false
    }
  }
  const row = entries.value.find((item) => item.key === editKey.value)
  const previous = row?.value
  if (isRecord(previous) && isRecord(after)) {
    const identityFields = tab.value === 'worldBook' ? ['uid', 'id'] : ['id']
    if (identityFields.some((field) => previous[field] !== after[field])) {
      formError.value = '条目编号用于跨版本匹配，编辑时请保留原编号。'
      return false
    }
  }
  return recordChange({
    operation: previous === undefined ? 'add' : 'update',
    key:
      editKey.value ||
      (isRecord(after) ? String(after.uid ?? after.id) : `alternate:${crypto.randomUUID()}`),
    label: editLabel.value,
    before: previous,
    after,
  })
}

async function deleteEntry(row: Row): Promise<void> {
  if (
    !(await confirmAction({
      title: '删除卡内条目',
      message: `从当前角色卡移除“${row.label}”？原始文件保留，应用后可撤销。`,
      confirmLabel: '删除此条',
      danger: true,
    }))
  )
    return
  trackMigration.value = editFor(row.key)?.migrateToVersions ?? true
  await recordChange({
    operation: 'delete',
    key: row.key,
    label: row.label,
    before: row.value,
  })
}

async function deleteSelected(): Promise<void> {
  const targets = entries.value.filter((row) => selectedKeys.value.includes(row.key))
  if (
    !targets.length ||
    !(await confirmAction({
      title: `删除所选 ${targets.length} 项`,
      message: `${targets
        .slice(0, 6)
        .map((row) => row.label)
        .join(
          '、',
        )}${targets.length > 6 ? '等' : ''}\n仅移出当前角色卡，原始文件保留；可撤销本次操作。`,
      confirmLabel: '删除所选',
      danger: true,
    }))
  )
    return
  // Reverse greeting order prevents earlier deletions shifting later targets.
  let next = [...props.edits]
  for (const row of [...targets].reverse()) {
    const old =
      tab.value === 'greeting' && row.key !== 'primary'
        ? undefined
        : next.find((edit) => edit.section === tab.value && edit.targetKey === row.key)
    if (old?.operation === 'add') {
      next = next.filter((edit) => edit.id !== old.id)
      continue
    }
    next = next.filter((edit) => edit.id !== old?.id)
    next.push({
      id: old?.id ?? crypto.randomUUID(),
      section: tab.value,
      operation: 'delete',
      targetKey: row.key,
      label: row.label,
      before: old?.before ?? clone(row.value),
      migrateToVersions: old?.migrateToVersions ?? true,
      updatedAt: Date.now(),
    })
  }
  if (publishEdits(next, `已移除 ${targets.length} 项，可撤销；保存修改后写入资源库。`))
    selectedKeys.value = []
}

function openImportPicker(): void {
  if (props.disabled || isImporting.value) return
  importError.value = ''
  importCandidates.value = []
  importQuery.value = ''
  importPage.value = 1
  importInput.value?.click()
}

function unwrapCard(root: unknown): Record<string, unknown> | undefined {
  if (!isRecord(root)) return undefined
  return isRecord(root.data) ? root : root
}

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const section = tab.value
  const request = ++importRequest
  isImporting.value = true
  importError.value = ''
  importCandidates.value = []
  try {
    let imported: Array<{ label: string; value: unknown }> = []
    if (section === 'greeting') {
      let messages: string[] = []
      if (/\.png$/iu.test(file.name) || file.type === 'image/png') {
        const parsed = await new PngResourceParser().parse(file)
        const parsedCard = isRecord(parsed.metadata.card) ? parsed.metadata.card : undefined
        if (!parsedCard) throw new Error('PNG 中没有可读取的角色卡内容')
        const cardData = readData(parsedCard)
        messages = [
          ...(typeof cardData.first_mes === 'string' && cardData.first_mes.trim()
            ? [cardData.first_mes]
            : []),
          ...(Array.isArray(cardData.alternate_greetings)
            ? cardData.alternate_greetings.filter(
                (item): item is string => typeof item === 'string' && item.trim().length > 0,
              )
            : []),
        ]
      } else {
        const text = await file.text()
        let root: unknown
        try {
          root = JSON.parse(text) as unknown
        } catch {
          root = undefined
        }
        if (isRecord(root) && root.format === 'srl-greeting') {
          const greeting = parseGreetingResource(root)
          messages = [greeting.first_mes, ...greeting.alternate_greetings]
        } else if (unwrapCard(root)) {
          const cardData = readData(unwrapCard(root)!)
          messages = [
            ...(typeof cardData.first_mes === 'string' && cardData.first_mes.trim()
              ? [cardData.first_mes]
              : []),
            ...(Array.isArray(cardData.alternate_greetings)
              ? cardData.alternate_greetings.filter(
                  (item): item is string => typeof item === 'string' && item.trim().length > 0,
                )
              : []),
          ]
        } else {
          messages = [text.trim()]
        }
      }
      if (!messages.length) throw new Error('没有从所选文件中找到开场白')
      imported = messages.map((value, index) => ({ label: `开场白 ${index + 1}`, value }))
    } else {
      const text = await file.text()
      let root: unknown
      try {
        root = JSON.parse(text) as unknown
      } catch {
        root = undefined
      }
      if (section === 'worldBook') {
        const cardRoot = isRecord(root) && isRecord(root.data) ? root.data : root
        const book =
          isRecord(cardRoot) && isRecord(cardRoot.character_book)
            ? cardRoot.character_book
            : cardRoot
        const values = Array.isArray(book)
          ? book
          : isRecord(book) && Array.isArray(book.entries)
            ? book.entries
            : isRecord(book) && isRecord(book.entries)
              ? Object.values(book.entries)
              : []
        let nextUid = nextWorldBookUid()
        const used = new Set(
          entries.value.flatMap((row) =>
            isRecord(row.value)
              ? [row.value.uid, row.value.id].filter((value) => value !== undefined).map(String)
              : [],
          ),
        )
        imported = values.flatMap((value, index) => {
          if (!isRecord(value) || typeof value.content !== 'string') return []
          let entry = normalizeImportedCharacterBookEntry(value, nextUid++)
          const uid = String(entry.uid ?? entry.id ?? '')
          const collision = worldBookCollision(entry)
          const duplicateId = Boolean(uid && used.has(uid))
          entry = allocateCharacterBookIdentity(entry, used)
          return [
            {
              label: String(entry.comment ?? `世界书条目 ${index + 1}`),
              value: entry,
              ...(collision
                ? { warning: collision }
                : duplicateId
                  ? { warning: '导入文件中存在相同条目编号，导入后会自动分配新编号。' }
                  : {}),
            },
          ]
        })
      } else if (section === 'regex') {
        const dataRoot = isRecord(root) && isRecord(root.data) ? root.data : root
        const extensions =
          isRecord(dataRoot) && isRecord(dataRoot.extensions) ? dataRoot.extensions : undefined
        const values = Array.isArray(root)
          ? root
          : isRecord(root) &&
              (typeof root.findRegex === 'string' || typeof root.find_regex === 'string')
            ? [root]
            : Array.isArray(extensions?.regex_scripts)
              ? extensions.regex_scripts
              : isRecord(root) && Array.isArray(root.regex_scripts)
                ? root.regex_scripts
                : []
        const used = new Set(entries.value.map((entry) => entry.key))
        imported = values.flatMap((value, index) => {
          if (
            !isRecord(value) ||
            !(
              (typeof value.findRegex === 'string' && typeof value.replaceString === 'string') ||
              (typeof value.find_regex === 'string' && typeof value.replace_string === 'string')
            )
          )
            return []
          const ruleId = String(value.id ?? '')
          const exists = used.has(ruleId)
          const rule: Record<string, unknown> = {
            ...value,
            id: exists || !ruleId ? crypto.randomUUID() : ruleId,
          }
          used.add(String(rule.id))
          return [
            {
              label: String(rule.scriptName ?? rule.script_name ?? `正则 ${index + 1}`),
              value: rule,
            },
          ]
        })
      } else {
        const scripts =
          root === undefined
            ? [
                {
                  name: file.name.replace(/\.js$/iu, ''),
                  value: {
                    id: crypto.randomUUID(),
                    name: file.name.replace(/\.js$/iu, ''),
                    content: text,
                    enabled: false,
                  },
                },
              ]
            : importedHelperScripts(root)
        imported = scripts.map((script) => ({ label: script.name, value: script.value }))
      }
      if (!imported.length) throw new Error('文件中没有找到可导入的项目')
    }
    if (request !== importRequest || section !== tab.value) return
    importQuery.value = ''
    importPage.value = 1
    importCandidates.value = imported.map((item, index) => ({
      ...item,
      id: `${index}-${crypto.randomUUID()}`,
      selected: true,
    }))
  } catch (error) {
    if (request === importRequest && section === tab.value)
      importError.value = error instanceof Error ? error.message : '导入文件解析失败'
  } finally {
    if (request === importRequest) isImporting.value = false
  }
}

async function applyImportSelection(): Promise<void> {
  const selected = importCandidates.value.filter((item) => item.selected)
  if (!selected.length) return
  if (
    tab.value === 'helperScript' &&
    selected.some(
      (item) =>
        isRecord(item.value) && (item.value.enabled === true || item.value.disabled === false),
    )
  ) {
    const confirmed = await confirmAction({
      title: '导入包含已启用脚本',
      message:
        '资源库只保存脚本源码，不会运行它。导出的角色卡在酒馆助手中加载后，启用脚本可能执行代码或访问酒馆能力；请先确认来源和内容。仍要按当前启用状态导入吗？',
      confirmLabel: '确认导入已启用脚本',
      cancelLabel: '返回检查',
    })
    if (!confirmed) return
  }
  if (props.disabled) return
  const tracked = importTrackMigration.value
  let next: CharacterCardContentEdit[] = []
  if (tab.value === 'greeting' && importMode.value === 'replace-primary') {
    const [primary, ...alternates] = selected
    if (primary) {
      const firstMes = typeof data.value.first_mes === 'string' ? data.value.first_mes : ''
      const old = editFor('primary')
      const before = old ? old.before : firstMes
      next = [
        ...props.edits.filter(
          (item) => item.targetKey !== 'primary' || item.section !== 'greeting',
        ),
        {
          id: old?.id ?? crypto.randomUUID(),
          section: 'greeting',
          operation: 'update',
          targetKey: 'primary',
          label: '主开场白',
          ...(before === undefined ? {} : { before }),
          after: String(primary.value),
          migrateToVersions: tracked,
          updatedAt: Date.now(),
        },
        ...alternates.map((item) => ({
          id: crypto.randomUUID(),
          section: 'greeting' as const,
          operation: 'add' as const,
          targetKey: `alternate:${crypto.randomUUID()}`,
          label: item.label,
          after: String(item.value),
          migrateToVersions: tracked,
          updatedAt: Date.now(),
        })),
      ]
    }
  } else {
    const used = new Set(
      entries.value.flatMap((row) =>
        isRecord(row.value)
          ? [row.value.uid, row.value.id].filter((value) => value !== undefined).map(String)
          : [],
      ),
    )
    const additions = selected.map((item): CharacterCardContentEdit => {
      let value = clone(item.value)
      if (isRecord(value) && tab.value === 'worldBook')
        value = allocateCharacterBookIdentity(value, used)
      if (isRecord(value) && tab.value !== 'worldBook') {
        if (!value.id || used.has(String(value.id))) value.id = crypto.randomUUID()
        used.add(String(value.id))
      }
      const rawId = isRecord(value) ? String(value.uid ?? value.id ?? '') : ''
      const targetKey = rawId || `${tab.value}:import:${crypto.randomUUID()}`
      return {
        id: crypto.randomUUID(),
        section: tab.value,
        operation: 'add',
        targetKey: isRecord(value) ? String(value.uid ?? value.id ?? targetKey) : targetKey,
        label: item.label,
        after: value,
        migrateToVersions: tracked,
        updatedAt: Date.now(),
      }
    })
    next = [...props.edits, ...additions]
  }
  const existingIds = new Set(props.edits.map((edit) => edit.id))
  let preview = activeCard.value
  let skipped = 0
  next = next.filter((edit) => {
    if (existingIds.has(edit.id) || edit.operation !== 'add') return true
    const result = applyCharacterCardContentEdit(preview, edit)
    if (result.status === 'already-present') {
      skipped++
      return false
    }
    preview = result.card
    return true
  })
  const message = `已将 ${selected.length - skipped} 项加入资源草稿${skipped ? `，跳过 ${skipped} 项已有内容` : ''}；保存修改后写入资源库。`
  if (publishEdits(next, message)) importCandidates.value = []
}

function candidateDetail(item: ImportCandidate): string {
  if (tab.value === 'greeting') return String(item.value).slice(0, 150)
  if (!isRecord(item.value)) return ''
  if (tab.value === 'worldBook') {
    const keys = textList(item.value.keys ?? item.value.key) || '没有触发词'
    return `触发词：${keys} · ${String(item.value.content ?? '').slice(0, 100)}`
  }
  if (tab.value === 'regex')
    return `匹配：${String(item.value.findRegex ?? item.value.find_regex ?? '').slice(0, 100)}`
  return item.value.enabled === true ? '导入后启用' : '导入后停用'
}

watch(tab, () => {
  importRequest++
  isImporting.value = false
  isEditorOpen.value = false
  importCandidates.value = []
  importError.value = ''
  query.value = ''
  page.value = 1
  selectedKeys.value = []
})
onBeforeUnmount(() => {
  importRequest++
})
</script>

<template>
  <section
    class="card-content-workbench"
    :class="[`is-${tab}`, { 'is-editing': isEditorOpen }]"
    aria-label="角色卡卡内内容编辑"
  >
    <header class="card-content-workbench__header">
      <button
        type="button"
        class="is-text card-content-workbench__back"
        aria-label="退出编辑"
        @click="exitWorkbench"
      >
        ‹ 退出编辑
      </button>
      <div v-if="isEditorOpen" class="card-content-workbench__heading">
        <strong>{{
          isEditorOpen
            ? tab === 'greeting'
              ? '开场白'
              : tab === 'worldBook'
                ? '世界书条目'
                : tab === 'regex'
                  ? '正则规则'
                  : '酒馆助手脚本'
            : tabs.find((item) => item.id === tab)?.label
        }}</strong>
      </div>
      <div v-if="isEditorOpen" class="card-content-workbench__actions">
        <button type="button" class="is-text" @click="isEditorOpen = false">返回列表</button>
      </div>
      <div v-else class="card-content-workbench__actions">
        <button
          type="button"
          class="is-secondary"
          :disabled="isImporting || disabled"
          @click="openImportPicker"
        >
          <span aria-hidden="true">↥</span> 导入条目
        </button>
        <button type="button" class="is-primary" :disabled="disabled" @click="openEditor()">
          <span aria-hidden="true">＋</span> 新建条目
        </button>
      </div>
    </header>

    <nav v-if="!isEditorOpen" class="card-content-workbench__tabs" aria-label="编辑内容类型">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        :aria-pressed="tab === item.id"
        :class="{ 'is-active': tab === item.id }"
        :disabled="disabled"
        @click="selectTab(item.id)"
      >
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div v-if="overriddenSections?.includes(tab)" class="card-content-workbench__notice">
      <span>当前预览与导出使用绑定资源，此处编辑的是原卡内容。</span>
      <button type="button" @click="emit('use-original', tab)">改用卡内内容</button>
    </div>
    <div v-if="editorDirty && !isEditorOpen" class="card-content-workbench__notice">
      <span>“{{ editLabel }}”还有未应用的输入，已暂存。</span>
      <button type="button" @click="isEditorOpen = true">继续编辑</button>
    </div>
    <div v-if="status && !isEditorOpen" class="card-content-workbench__notice" role="status">
      <span>{{ status }}</span>
      <button
        v-if="undoStack.length"
        type="button"
        :disabled="editorDirty || disabled"
        @click="undo"
      >
        撤销
      </button>
    </div>
    <section
      v-if="appliedEdits.conflicts.length"
      class="card-content-workbench__conflicts"
      role="alert"
    >
      <strong>{{ appliedEdits.conflicts.length }} 项修改未应用，请先处理再保存或导出</strong>
      <div v-for="edit in appliedEdits.conflicts" :key="edit.id">
        <span>{{ edit.label }}</span>
        <button type="button" @click="discardConflict(edit.id)">放弃此记录</button>
      </div>
    </section>

    <p v-if="!isEditorOpen && tab !== 'worldBook'" class="card-content-workbench__section-note">
      {{
        tab === 'greeting'
          ? '管理主开场白与备用开场白。导入后可选择替换主开场，或作为新备用开场。'
          : tab === 'regex'
            ? '编辑角色卡专属正则规则；资源库只保存规则，不执行替换。'
            : '管理角色卡内的酒馆助手脚本；资源库只保存源码，不会运行脚本。'
      }}
    </p>

    <input
      ref="importInput"
      class="card-content-workbench__file"
      type="file"
      :accept="
        tab === 'greeting'
          ? '.txt,.md,.json,.png,application/json,text/plain,image/png'
          : tab === 'helperScript'
            ? '.js,.json,application/json,text/javascript'
            : '.json,application/json'
      "
      @change="importFile"
    />
    <p v-if="isImporting" class="card-content-workbench__status" role="status">正在读取文件…</p>
    <p v-if="importError" class="card-content-workbench__error" role="alert">{{ importError }}</p>
    <p v-if="tab === 'helperScript' && !isEditorOpen" class="card-content-workbench__status">
      脚本按源码数据导入；资源库不会执行。酒馆助手加载已启用脚本时可能运行代码，新建与纯 JS
      文件导入默认停用。
    </p>

    <label
      v-if="importCandidates.length && tab === 'greeting' && !isEditorOpen"
      class="card-content-workbench__import-mode"
    >
      导入策略
      <select v-model="importMode">
        <option value="append">保留原主开场，添加为备用开场</option>
        <option value="replace-primary">替换主开场，其余添加为备用开场</option>
      </select>
    </label>

    <section
      v-if="importCandidates.length && !isEditorOpen"
      class="card-content-workbench__import-preview"
    >
      <header>
        <div>
          <strong>导入预览</strong>
          <small
            >{{ importCandidates.filter((item) => item.selected).length }} /
            {{ importCandidates.length }} 项已选</small
          >
        </div>
        <button
          type="button"
          class="is-text"
          @click="filteredImports.forEach((item) => (item.selected = true))"
        >
          选择筛选结果
        </button>
      </header>
      <input
        v-model="importQuery"
        type="search"
        aria-label="搜索待导入条目"
        placeholder="搜索待导入条目"
      />
      <label v-for="item in visibleImports" :key="item.id">
        <input v-model="item.selected" type="checkbox" />
        <span class="card-content-workbench__candidate">
          <strong>{{ item.label }}</strong>
          <small>{{ candidateDetail(item) }}</small>
          <em v-if="item.warning">可能重复：{{ item.warning }}</em>
        </span>
      </label>
      <div v-if="importPageCount > 1" class="card-content-workbench__pagination">
        <button type="button" :disabled="importPage <= 1" @click="importPage--">上一页</button>
        <span>{{ importPage }} / {{ importPageCount }}</span>
        <button type="button" :disabled="importPage >= importPageCount" @click="importPage++">
          下一页
        </button>
      </div>
      <label class="card-content-workbench__migration"
        ><input v-model="importTrackMigration" type="checkbox" />随新版迁移这些修改</label
      >
      <p v-if="tab === 'worldBook'" class="card-content-workbench__import-note">
        仅嵌入勾选的条目到当前角色卡，不会新建独立的全局世界书。重复项会先提醒；导入只新增，不覆盖已有条目。
      </p>
      <footer>
        <button type="button" class="is-text" @click="importCandidates = []">取消导入</button>
        <button
          type="button"
          class="is-primary"
          :disabled="disabled || !importCandidates.some((item) => item.selected)"
          @click="applyImportSelection"
        >
          导入 {{ importCandidates.filter((item) => item.selected).length }} 项
        </button>
      </footer>
    </section>

    <div v-if="entries.length && !isEditorOpen" class="card-content-workbench__list-tools">
      <input
        v-model="query"
        type="search"
        aria-label="搜索卡内条目"
        placeholder="搜索名称、触发词或正文"
      />
      <span>{{ filteredEntries.length }} 项</span>
    </div>
    <div v-if="selectedKeys.length && !isEditorOpen" class="card-content-workbench__selection">
      <span>已选 {{ selectedKeys.length }} 项</span>
      <button type="button" @click="selectedKeys = filteredEntries.map((row) => row.key)">
        选择筛选结果
      </button>
      <button type="button" @click="selectedKeys = []">取消选择</button>
      <button type="button" class="is-danger" @click="deleteSelected">删除所选</button>
    </div>

    <ul v-if="entries.length && !isEditorOpen" class="card-content-workbench__list">
      <li v-for="row in visibleEntries" :key="row.key">
        <input
          v-model="selectedKeys"
          type="checkbox"
          :value="row.key"
          :aria-label="`选择 ${row.label}`"
        />
        <div>
          <strong>{{ row.label }}</strong>
          <small>{{
            row.note || (tab === 'greeting' ? String(row.value).slice(0, 100) : '')
          }}</small>
        </div>
        <div>
          <button type="button" @click="openEditor(row)">编辑</button>
          <button type="button" class="is-danger" @click="deleteEntry(row)">删除</button>
        </div>
      </li>
    </ul>
    <p
      v-if="entries.length && !filteredEntries.length && !isEditorOpen"
      class="card-content-workbench__status"
    >
      没有匹配的条目，可修改搜索词或清空搜索。
    </p>
    <div v-if="!isEditorOpen && pageCount > 1" class="card-content-workbench__pagination">
      <button type="button" :disabled="page <= 1" @click="page--">上一页</button>
      <span>{{ page }} / {{ pageCount }}</span>
      <button type="button" :disabled="page >= pageCount" @click="page++">下一页</button>
    </div>
    <p v-if="!entries.length && !isEditorOpen" class="card-content-workbench__empty">
      <span aria-hidden="true">＋</span>
      <strong>还没有{{ tabs.find((item) => item.id === tab)?.label }}内容</strong>
      <small>可以新建一项，或从文件导入并选择要加入的内容。</small>
      <button type="button" class="is-primary" @click="openEditor()">
        新建{{ tabs.find((item) => item.id === tab)?.label }}
      </button>
    </p>

    <div
      v-if="isEditorOpen"
      class="card-content-workbench__editor"
      role="group"
      aria-label="条目编辑"
      @keydown.ctrl.enter.stop.prevent="saveEditor"
    >
      <template v-if="tab === 'greeting'">
        <label>
          <span>开场白正文</span>
          <textarea v-model="editText" rows="8" placeholder="输入角色发给用户的第一段内容…" />
        </label>
        <small class="card-content-workbench__field-hint"
          >支持多段文本；保存后作为主开场白或备用开场白进入卡内容。</small
        >
      </template>

      <template v-else-if="tab === 'worldBook'">
        <label>
          <span>条目名称</span>
          <input v-model="editLabel" maxlength="120" placeholder="例如：旧城区的传闻" />
        </label>
        <label>
          <span>触发词 <small>每行一个，逗号会保留在词内</small></span>
          <textarea v-model="editKeys" class="is-keys" rows="2" placeholder="旧城区&#10;黑市入口" />
        </label>
        <label>
          <span>条目正文</span>
          <textarea v-model="editText" rows="7" placeholder="输入触发后注入对话的世界观内容…" />
        </label>
        <details class="card-content-workbench__advanced">
          <summary>更多世界书设置</summary>
          <label>
            <span>辅助触发词 <small>可选</small></span>
            <textarea
              v-model="editSecondaryKeys"
              class="is-keys"
              rows="2"
              placeholder="每行一个辅助触发词"
            />
          </label>
          <div class="card-content-workbench__field-grid">
            <label>
              <span>注入位置</span>
              <select v-model="editPosition">
                <option value="0">角色设定前</option>
                <option value="1">角色设定后</option>
                <option value="2">作者注释前</option>
                <option value="3">作者注释后</option>
                <option value="5">示例对话前</option>
                <option value="6">示例对话后</option>
                <option value="4">指定深度</option>
                <option v-if="Number(editPosition) > 6" :value="editPosition">
                  保留原位置（{{ editPosition }}）
                </option>
              </select>
            </label>
            <label>
              <span>插入顺序</span>
              <input v-model.number="editInsertionOrder" type="number" />
            </label>
            <label v-if="editPosition === '4'">
              <span>注入深度</span
              ><input v-model.number="editDepth" type="number" min="0" step="1" />
            </label>
          </div>
          <div class="card-content-workbench__toggles">
            <label><input v-model="editEnabled" type="checkbox" />启用条目</label>
            <label><input v-model="editConstant" type="checkbox" />始终触发</label>
            <label><input v-model="editSelective" type="checkbox" />需要次要触发词</label>
          </div>
        </details>
      </template>

      <template v-else-if="tab === 'regex'">
        <label><span>规则名称</span><input v-model="editLabel" maxlength="120" /></label>
        <label
          ><span>匹配正则</span
          ><input
            v-model="editFindRegex"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            placeholder="例如：\b(hello)\b"
        /></label>
        <label
          ><span>替换内容</span
          ><textarea
            v-model="editReplaceString"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            rows="4"
            placeholder="输入替换文本；留空表示删除匹配内容"
          />
        </label>
        <div class="card-content-workbench__toggles">
          <label><input v-model="editEnabled" type="checkbox" />启用此规则</label>
        </div>
        <fieldset class="card-content-workbench__regex-scope">
          <legend>作用范围</legend>
          <label><input v-model="editPlacement" type="checkbox" :value="1" />用户输入</label>
          <label><input v-model="editPlacement" type="checkbox" :value="2" />角色回复</label>
          <label><input v-model="editPlacement" type="checkbox" :value="5" />世界书</label>
          <label><input v-model="editMarkdownOnly" type="checkbox" />作用于显示</label>
          <label><input v-model="editPromptOnly" type="checkbox" />作用于发送给模型的内容</label>
        </fieldset>
      </template>

      <template v-else>
        <label><span>脚本名称</span><input v-model="editLabel" maxlength="120" /></label>
        <label
          ><span>说明</span
          ><input v-model="editScriptInfo" maxlength="240" placeholder="这段脚本的用途"
        /></label>
        <label
          ><span>脚本源码</span
          ><textarea
            v-model="editText"
            rows="10"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            placeholder="脚本源码只会保存，不会在资源库执行。"
          />
        </label>
        <div class="card-content-workbench__toggles">
          <label><input v-model="editEnabled" type="checkbox" />在酒馆助手中启用</label>
        </div>
      </template>

      <p v-if="formError" class="card-content-workbench__error" role="alert">{{ formError }}</p>
      <label class="card-content-workbench__migration"
        ><input v-model="trackMigration" type="checkbox" />随新版迁移这项修改</label
      >
      <footer>
        <button type="button" class="is-secondary" @click="isEditorOpen = false">暂存并返回</button>
        <button type="button" class="is-primary" :disabled="disabled" @click="saveEditor">
          应用到草稿
        </button>
      </footer>
    </div>
    <details
      v-if="edits.length && !isEditorOpen"
      class="card-content-workbench__records"
      @toggle="showRecords = ($event.target as HTMLDetailsElement).open"
    >
      <summary>修改清单 · {{ edits.length }} 项</summary>
      <div v-if="showRecords">
        <p>勾选的修改可在更新版本时迁移；此处不是逐次编辑历史。</p>
        <label
          v-for="edit in edits.slice((recordPage - 1) * pageSize, recordPage * pageSize)"
          :key="edit.id"
        >
          <input
            type="checkbox"
            :checked="edit.migrateToVersions"
            @change="updateMigration(edit.id, $event)"
          />
          <span
            >{{
              edit.operation === 'delete' ? '删除' : edit.operation === 'add' ? '新增' : '修改'
            }}
            · {{ edit.label }}</span
          >
        </label>
        <div v-if="edits.length > pageSize" class="card-content-workbench__pagination">
          <button type="button" :disabled="recordPage <= 1" @click="recordPage--">上一页</button>
          <span>{{ recordPage }} / {{ Math.ceil(edits.length / pageSize) }}</span>
          <button
            type="button"
            :disabled="recordPage * pageSize >= edits.length"
            @click="recordPage++"
          >
            下一页
          </button>
        </div>
      </div>
    </details>
  </section>
</template>

<style scoped>
.card-content-workbench {
  --workbench-accent: var(--color-accent, #496a59);
  --workbench-accent-soft: var(--color-accent-soft, #e4ede7);
  --workbench-ink: var(--color-ink, #24352d);
  --workbench-muted: var(--color-ink-soft, #6d7c73);
  --workbench-line: var(--color-line, #d5dfd8);
  --workbench-surface: var(--color-surface, #fbfcfa);
  --workbench-raised: var(--color-surface-raised, #f3f6f3);
  display: grid;
  gap: 0.7rem;
  margin: 0.85rem 0;
  padding: 0;
  color: var(--workbench-ink);
  background: transparent;
  min-width: 0;
}
.card-content-workbench *,
.card-content-workbench *::before,
.card-content-workbench *::after {
  box-sizing: border-box;
}
.card-content-workbench button,
.card-content-workbench select,
.card-content-workbench input,
.card-content-workbench textarea {
  font: inherit;
  color: inherit;
}
.card-content-workbench button {
  min-height: 44px;
  padding: 0.55rem 0.8rem;
  border: 1px solid var(--workbench-line);
  border-radius: 0.7rem;
  color: var(--workbench-ink);
  background: var(--workbench-surface);
  font-size: 0.875rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    transform 150ms ease,
    border-color 150ms ease,
    background-color 150ms ease;
}
.card-content-workbench button:not([aria-pressed]):hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--workbench-accent) 55%, var(--workbench-line));
  transform: translateY(-1px);
}
.card-content-workbench button:focus-visible,
.card-content-workbench input:focus-visible,
.card-content-workbench textarea:focus-visible,
.card-content-workbench select:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--workbench-accent) 25%, transparent);
  outline-offset: 2px;
}
.card-content-workbench button.is-primary {
  border-color: var(--workbench-accent);
  color: var(--color-on-accent, #fff);
  background: var(--workbench-accent);
}
.card-content-workbench button.is-secondary {
  background: color-mix(in srgb, var(--workbench-raised) 72%, var(--workbench-surface));
}
.card-content-workbench button.is-text {
  min-height: 36px;
  padding: 0.35rem 0.55rem;
  border-color: transparent;
  color: var(--workbench-accent);
  background: transparent;
}
.card-content-workbench__header,
.card-content-workbench__heading,
.card-content-workbench__actions,
.card-content-workbench__tabs,
.card-content-workbench__list li,
.card-content-workbench__import-preview header,
.card-content-workbench__editor footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.card-content-workbench__header {
  min-width: 0;
  padding: 0;
}
.card-content-workbench__back {
  white-space: nowrap;
}
.card-content-workbench__heading {
  min-width: 0;
  align-items: flex-start;
  flex-direction: column;
  gap: 0.2rem;
}
.card-content-workbench__heading > span,
.card-content-workbench__editor header small {
  color: var(--workbench-accent);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.card-content-workbench__heading > strong {
  font-family: var(--font-display, inherit);
  font-size: 1.18rem;
  line-height: 1.25;
}
.card-content-workbench__heading > small {
  max-width: 38rem;
  font-size: 0.72rem;
  line-height: 1.5;
}
.card-content-workbench__actions {
  flex: 0 0 auto;
}
.card-content-workbench__actions button span {
  margin-right: 0.2rem;
  font-size: 1rem;
}
.card-content-workbench small {
  display: block;
  color: var(--workbench-muted);
  font-size: 0.78rem;
}
.card-content-workbench__section-note,
.card-content-workbench__import-note {
  margin: 0;
  color: var(--workbench-muted);
  font-size: 0.76rem;
  line-height: 1.55;
}
.card-content-workbench__tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  border-bottom: 1px solid var(--workbench-line);
}
.card-content-workbench__tabs button {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 0;
  min-height: 44px;
  padding: 0.4rem 0;
  border-radius: 0;
  border-color: transparent;
  background: transparent;
  font-size: 0.74rem;
  white-space: nowrap;
}
.card-content-workbench__tabs button.is-active {
  color: var(--workbench-accent);
  background: transparent;
}
.card-content-workbench__tabs button.is-active::after {
  content: '';
  position: absolute;
  bottom: 0;
  width: 1.5rem;
  height: 2px;
  border-radius: 1px;
  background: var(--workbench-accent);
}
@media (max-width: 360px) {
  .card-content-workbench__tabs button {
    font-size: 0.6875rem;
  }
}
.card-content-workbench__import-mode,
.card-content-workbench__editor label {
  display: grid;
  gap: 0.42rem;
  color: var(--workbench-ink);
  font-size: 0.77rem;
  font-weight: 700;
}
.card-content-workbench__import-mode select,
.card-content-workbench__editor input,
.card-content-workbench__editor textarea,
.card-content-workbench__editor select {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 0.62rem 0.7rem;
  border: 1px solid var(--workbench-line);
  border-radius: 0.65rem;
  color: var(--workbench-ink);
  background: var(--workbench-surface);
  font-size: 16px;
  font-weight: 450;
}
.card-content-workbench__editor textarea {
  min-height: min(42vh, 18rem);
  resize: vertical;
  line-height: 1.65;
}
.card-content-workbench__editor textarea.is-keys {
  min-height: 4.5rem;
}
.card-content-workbench__editor textarea::placeholder,
.card-content-workbench__editor input::placeholder {
  color: color-mix(in srgb, var(--workbench-muted) 76%, transparent);
}
.card-content-workbench__file {
  display: none;
}
.card-content-workbench__list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0 0.15rem 0.15rem 0;
  list-style: none;
  scrollbar-width: thin;
}
.card-content-workbench__list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--workbench-line);
}
.card-content-workbench__list li > div:nth-child(2) {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 0.28rem;
}
.card-content-workbench__list li > div:last-child {
  display: flex;
  flex: 0 0 auto;
  gap: 0.35rem;
}
.card-content-workbench__list li strong {
  font-size: 0.85rem;
}
.card-content-workbench__list li strong,
.card-content-workbench__list li small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-content-workbench__list li button {
  min-height: 44px;
  padding: 0.35rem 0.55rem;
  font-size: 0.8125rem;
  border-color: transparent;
  background: transparent;
}
.card-content-workbench__list .is-danger,
.card-content-workbench__error {
  color: var(--color-danger, #a23434);
}
.card-content-workbench__list .is-danger {
  color: var(--color-danger, #a23434);
  background: transparent;
}
.card-content-workbench__empty {
  display: grid;
  justify-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 1.3rem 0.8rem;
  border: 1px dashed var(--workbench-line);
  border-radius: 0.85rem;
  color: var(--workbench-muted);
  text-align: center;
}
.card-content-workbench__empty > span {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 50%;
  color: var(--workbench-accent);
  background: var(--workbench-accent-soft);
  font-size: 1.2rem;
}
.card-content-workbench__empty strong {
  color: var(--workbench-ink);
  font-size: 0.86rem;
}
.card-content-workbench__empty small,
.card-content-workbench__status {
  margin: 0;
  color: var(--workbench-muted);
  font-size: 0.85rem;
  line-height: 1.55;
}
.card-content-workbench__import-preview,
.card-content-workbench__editor {
  display: grid;
  gap: 0.75rem;
  padding: 0.8rem;
  border: 1px solid var(--workbench-line);
  border-radius: 0.85rem;
  background: var(--workbench-raised);
}
.card-content-workbench__import-preview header > div {
  display: grid;
  gap: 0.18rem;
}
.card-content-workbench__import-preview header strong {
  font-size: 0.9rem;
}
.card-content-workbench__import-preview > label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.6rem;
  padding: 0.65rem;
  border: 1px solid var(--workbench-line);
  border-radius: 0.7rem;
  background: var(--workbench-surface);
  cursor: pointer;
}
.card-content-workbench__import-preview > label input {
  width: 1.1rem;
  height: 1.1rem;
  margin-top: 0.15rem;
  accent-color: var(--workbench-accent);
}
.card-content-workbench__candidate {
  display: grid;
  min-width: 0;
  gap: 0.22rem;
}
.card-content-workbench__candidate strong {
  font-size: 0.8rem;
}
.card-content-workbench__candidate small {
  display: -webkit-box;
  overflow: hidden;
  font-size: 0.7rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.card-content-workbench__candidate em {
  color: #99671f;
  font-size: 0.7rem;
  font-style: normal;
  line-height: 1.45;
}
.card-content-workbench__import-note {
  padding: 0.65rem;
  border-left: 3px solid var(--workbench-accent);
  border-radius: 0 0.55rem 0.55rem 0;
  background: var(--workbench-accent-soft);
}
.card-content-workbench__import-preview footer,
.card-content-workbench__editor footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: 0;
  padding: 0.7rem 0 0;
  border-top: 1px solid var(--workbench-line);
  background: color-mix(in srgb, var(--workbench-surface) 94%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}
.card-content-workbench__editor {
  border-top: 3px solid var(--workbench-accent);
  background: var(--workbench-surface);
}
.card-content-workbench__editor label span small {
  display: inline;
  margin-left: 0.25rem;
  font-size: 0.68rem;
  font-weight: 450;
}
.card-content-workbench__field-hint {
  margin-top: -0.45rem;
  color: var(--workbench-muted);
  font-size: 0.7rem;
}
.card-content-workbench__advanced {
  display: grid;
  gap: 0.65rem;
  padding-top: 0.15rem;
  border-top: 1px solid var(--workbench-line);
}
.card-content-workbench__advanced summary {
  min-height: 44px;
  align-content: center;
  color: var(--workbench-accent);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}
.card-content-workbench__field-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(6rem, 0.6fr);
  gap: 0.65rem;
}
.card-content-workbench__toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.card-content-workbench__toggles label {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--workbench-line);
  border-radius: 999px;
  color: var(--workbench-muted);
  background: var(--workbench-surface);
  font-size: 0.7rem;
  font-weight: 600;
}
.card-content-workbench__toggles input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--workbench-accent);
}
.card-content-workbench__error {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
}
.card-content-workbench__notice,
.card-content-workbench__list-tools,
.card-content-workbench__pagination,
.card-content-workbench__selection {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  font-size: 0.8125rem;
}
.card-content-workbench__notice {
  padding: 0.6rem 0.7rem;
  background: var(--workbench-accent-soft);
  border-radius: 0.6rem;
}
.card-content-workbench__notice > span {
  flex: 1;
  min-width: 10rem;
  overflow-wrap: anywhere;
}
.card-content-workbench__pagination {
  justify-content: space-between;
}
.card-content-workbench input[type='search'] {
  min-width: 0;
  flex: 1;
  width: 100%;
  min-height: 44px;
  padding: 0.6rem;
  border: 1px solid var(--workbench-line);
  border-radius: 0.6rem;
  background: var(--workbench-surface);
  font-size: 16px;
}
.card-content-workbench input[type='checkbox'] {
  width: 20px;
  min-height: 20px;
  height: 20px;
  padding: 0;
  margin: 0;
  accent-color: var(--workbench-accent);
}
.card-content-workbench__editor .card-content-workbench__migration,
.card-content-workbench__regex-scope label,
.card-content-workbench__records label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 44px;
  font-size: 0.875rem;
  font-weight: 450;
}
.card-content-workbench__regex-scope {
  display: grid;
  gap: 0.25rem;
  border: 1px solid var(--workbench-line);
  border-radius: 0.6rem;
  min-width: 0;
}
.card-content-workbench__records summary {
  min-height: 44px;
  align-content: center;
  cursor: pointer;
  font-size: 0.875rem;
}
.card-content-workbench__records p {
  color: var(--workbench-muted);
  font-size: 0.8125rem;
}
.card-content-workbench__conflicts {
  padding: 0.7rem;
  border: 1px solid var(--color-danger);
  border-radius: 0.6rem;
}
.card-content-workbench__conflicts > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
@media (max-width: 480px) {
  .card-content-workbench {
    gap: 0.65rem;
  }
  .card-content-workbench.is-editing {
    gap: 0.5rem;
  }
  .card-content-workbench.is-editing .card-content-workbench__header {
    align-items: center;
    flex-direction: row;
  }
  .card-content-workbench.is-editing .card-content-workbench__actions {
    width: auto;
  }
  .card-content-workbench.is-editing .card-content-workbench__actions button {
    flex: 0 0 auto;
    min-height: 44px;
  }
  .card-content-workbench__heading > strong {
    font-size: 1rem;
  }
  .card-content-workbench__header {
    align-items: center;
    flex-direction: row;
  }
  .card-content-workbench__actions {
    width: auto;
  }
  .card-content-workbench__actions button {
    padding-inline: 0.55rem;
  }
  .card-content-workbench__editor {
    gap: 0.65rem;
    padding: 0.7rem;
    border-radius: 0.7rem;
  }
  .card-content-workbench__editor input:not([type='checkbox']),
  .card-content-workbench__editor textarea,
  .card-content-workbench__editor select,
  .card-content-workbench__import-mode select {
    min-height: 44px;
    font-size: 16px;
  }
  .card-content-workbench__editor textarea:not(.is-keys) {
    min-height: min(calc(var(--visual-viewport-height, 100dvh) * 0.38), 16rem);
  }
  .card-content-workbench__editor footer {
    margin: 0;
    padding: 0.55rem 0 0;
  }
  .card-content-workbench__editor footer button {
    flex: 1;
    min-height: 44px;
  }
}
</style>
