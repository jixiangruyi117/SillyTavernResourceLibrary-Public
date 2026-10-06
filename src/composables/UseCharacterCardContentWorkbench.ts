import {
  type Row,
  type ImportCandidate,
  collectScriptRows,
  helperScriptSources,
  importedHelperScripts,
  clone,
  textList,
  parseTextList,
  worldBookCollision,
  readData,
  defaultValue,
  nextWorldBookUid,
  candidateDetail,
  unwrapCard,
} from '../utils/CharacterCardContentRows'

import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { chooseAction, confirmAction } from './UseConfirmDialog'

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

import type { EmitFn } from 'vue'

export function useCharacterCardContentWorkbench(
  props: {
    card: Record<string, unknown>
    edits: CharacterCardContentEdit[]
    overriddenSections?: CharacterCardContentSection[]
    disabled?: boolean
  },
  emit: EmitFn<{
    'update:edits': [value: CharacterCardContentEdit[]]
    'draft-change': [dirty: boolean]
    'use-original': [section: CharacterCardContentSection]
    back: []
  }>,
) {
  type WorkbenchTab = CharacterCardContentSection
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
          `${item.label}\n${candidateDetail(item, tab.value)}`.toLocaleLowerCase().includes(needle),
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
    const fallback = defaultValue(tab.value, () => nextWorldBookUid(data.value))
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
          let nextUid = nextWorldBookUid(data.value)
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
            const collision = worldBookCollision(entry, entries.value)
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
  return {
    prepareSave,
    tabs,
    tab,
    isEditorOpen,
    editLabel,
    editText,
    editKeys,
    editSecondaryKeys,
    editFindRegex,
    editReplaceString,
    editScriptInfo,
    editEnabled,
    editConstant,
    editSelective,
    editPosition,
    editInsertionOrder,
    editDepth,
    editPlacement,
    editMarkdownOnly,
    editPromptOnly,
    trackMigration,
    importTrackMigration,
    query,
    page,
    pageSize,
    selectedKeys,
    importPage,
    importQuery,
    status,
    showRecords,
    recordPage,
    undoStack,
    formError,
    importError,
    isImporting,
    importInput,
    importCandidates,
    importMode,
    appliedEdits,
    entries,
    filteredEntries,
    pageCount,
    visibleEntries,
    filteredImports,
    importPageCount,
    visibleImports,
    editorDirty,
    undo,
    discardConflict,
    updateMigration,
    selectTab,
    exitWorkbench,
    openEditor,
    saveEditor,
    deleteEntry,
    deleteSelected,
    openImportPicker,
    importFile,
    applyImportSelection,
  }
}
