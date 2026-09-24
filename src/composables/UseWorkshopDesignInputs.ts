import type { ComputedRef } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import type {
  FieldInputMode,
  TargetSizePreset,
  WorkshopInspectTarget,
  WorkshopPalette,
} from '../types/FrontendWorkshopLegacyApp'
import type { WorkshopMvuTurn, WorkshopStressCase } from '../utils/FrontendWorkshop'
import {
  createWorkshopLayoutReference,
  extractWorkshopPaletteColors,
  normalizeWorkshopImageUrls,
  parseStatusFields,
  parseWorkshopPaletteText,
  resizeWorkshopLayoutReference,
  serializeStatusFields,
  type StatusField,
  type WorkshopBlock,
  type WorkshopLayoutReference,
  type WorkshopTargetSize,
} from '../utils/FrontendWorkshop'
import { blockSceneOptions, targetSizePresets } from '../utils/FrontendWorkshopLegacyOptions'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopDesignInputsContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'error'
  | 'referenceImages'
  | 'imageUrls'
  | 'imageUrlDraft'
  | 'targetSizePreset'
  | 'targetWidth'
  | 'targetHeight'
  | 'layoutReference'
  | 'source'
  | 'activeDesignPanel'
  | 'layoutStudioOpen'
  | 'paletteStatus'
  | 'activePaletteId'
  | 'importedPalettes'
  | 'customTextStyleName'
  | 'customTextStyles'
  | 'fieldInputMode'
  | 'interactions'
  | 'blocks'
  | 'dataMode'
  | 'conditionFieldPath'
  | 'conditionValue'
  | 'conditionRules'
  | 'conditionOperator'
  | 'conditionColor'
  | 'conditionBackground'
  | 'activeMvuTurn'
  | 'sample'
  | 'inspectedTargets'
> {
  selectedTargetSize: ComputedRef<WorkshopTargetSize | undefined>
  parsedFields: ComputedRef<StatusField[]>
  mvuTurns: ComputedRef<WorkshopMvuTurn[]>
  stressCases: ComputedRef<WorkshopStressCase[]>
}

export function useWorkshopDesignInputs(getContext: () => WorkshopDesignInputsContext) {
  function readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('参考图读取失败'))
      reader.readAsDataURL(file)
    })
  }

  async function addReferenceImages(event: Event): Promise<void> {
    const context = getContext()

    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    context.error.value = ''
    for (const file of files.slice(0, Math.max(0, 3 - context.referenceImages.value.length))) {
      if (!file.type.startsWith('image/')) {
        context.error.value = `「${file.name}」不是图片文件`
        continue
      }
      if (file.size > 5 * 1024 * 1024) {
        context.error.value = `「${file.name}」超过 5 MiB，请先压缩`
        continue
      }
      context.referenceImages.value.push({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: await readImage(file),
      })
    }
  }

  function removeReferenceImage(imageId: string): void {
    const context = getContext()

    context.referenceImages.value = context.referenceImages.value.filter(
      (image) => image.id !== imageId,
    )
  }

  function addImageUrl(): void {
    const context = getContext()

    context.error.value = ''
    try {
      const normalized = normalizeWorkshopImageUrls([
        ...context.imageUrls.value,
        context.imageUrlDraft.value,
      ])
      if (normalized.length === context.imageUrls.value.length) {
        context.error.value = context.imageUrlDraft.value.trim()
          ? '这条图片直链已经添加'
          : '请先输入图片直链'
        return
      }
      context.imageUrls.value = normalized
      context.imageUrlDraft.value = ''
    } catch (cause) {
      context.error.value = cause instanceof Error ? cause.message : '图片直链无法使用'
    }
  }

  function removeImageUrl(url: string): void {
    const context = getContext()

    context.imageUrls.value = context.imageUrls.value.filter((item) => item !== url)
  }

  function applyTargetSizePreset(presetId: TargetSizePreset): void {
    const context = getContext()

    context.targetSizePreset.value = presetId
    const preset = targetSizePresets.find((item) => item.id === presetId)
    if (preset?.width && preset.height) {
      context.targetWidth.value = preset.width
      context.targetHeight.value = preset.height
    }
    if (context.layoutReference.value && context.selectedTargetSize.value)
      context.layoutReference.value = resizeWorkshopLayoutReference(
        context.layoutReference.value,
        context.selectedTargetSize.value,
      )
  }

  function applyCustomTargetSize(): void {
    const context = getContext()

    context.targetSizePreset.value = 'custom'
    context.targetWidth.value = Math.min(
      1_200,
      Math.max(160, Math.round(Number(context.targetWidth.value) || 390)),
    )
    context.targetHeight.value = Math.min(
      1_800,
      Math.max(100, Math.round(Number(context.targetHeight.value) || 260)),
    )
    if (context.layoutReference.value && context.selectedTargetSize.value)
      context.layoutReference.value = resizeWorkshopLayoutReference(
        context.layoutReference.value,
        context.selectedTargetSize.value,
      )
  }

  function openLayoutStudio(): void {
    const context = getContext()

    const fields = parseStatusFields(context.source.value)
    if (!fields.length) {
      context.error.value = '请先在“内容”中输入至少一个状态字段'
      context.activeDesignPanel.value = 'content'
      return
    }
    try {
      createWorkshopLayoutReference(
        fields,
        context.imageUrls.value,
        context.layoutReference.value,
        context.selectedTargetSize.value,
      )
      context.layoutStudioOpen.value = true
      context.error.value = ''
    } catch (cause) {
      context.error.value = cause instanceof Error ? cause.message : '自由排版画布无法打开'
    }
  }

  function applyLayoutReference(value: WorkshopLayoutReference): void {
    const context = getContext()

    context.layoutReference.value = value
    context.layoutStudioOpen.value = false
    context.paletteStatus.value = `已保存 ${value.items.length} 个构图对象；下次生成时会交给 AI 转成响应式布局`
  }

  async function clearLayoutReference(): Promise<void> {
    const context = getContext()

    if (!context.layoutReference.value?.items.length) return
    const confirmed = await confirmAction({
      title: '取消自由排版参考？',
      message: '已保存的手机与宽屏构图会被清除。之后生成时 AI 将不再受这份布局约束，自行组织版面。',
      confirmLabel: '取消参考',
    })
    if (!confirmed) return
    context.layoutReference.value = undefined
    context.paletteStatus.value = '已取消自由排版参考；下次生成由 AI 自行组织响应式布局'
  }

  function choosePalette(paletteId: string): void {
    const context = getContext()

    context.activePaletteId.value = context.activePaletteId.value === paletteId ? '' : paletteId
  }

  function removeImportedPalette(paletteId: string): void {
    const context = getContext()

    context.importedPalettes.value = context.importedPalettes.value.filter(
      (palette) => palette.id !== paletteId,
    )
    if (context.activePaletteId.value === paletteId) context.activePaletteId.value = ''
  }

  async function extractPaletteFromImage(file: File): Promise<string[]> {
    const objectUrl = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error(`无法读取色卡图片「${file.name}」`))
        element.src = objectUrl
      })
      const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('当前浏览器无法解析色卡图片')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return extractWorkshopPaletteColors(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
        8,
      )
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  async function importPalette(event: Event): Promise<void> {
    const context = getContext()

    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    context.paletteStatus.value = ''
    context.error.value = ''
    if (file.size > 5 * 1024 * 1024) {
      context.error.value = '色卡文件超过 5 MiB，请先压缩'
      return
    }
    try {
      let paletteName = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '导入色卡'
      let colors: string[]
      if (file.type.startsWith('image/')) {
        colors = await extractPaletteFromImage(file)
      } else {
        const content = await file.text()
        colors = parseWorkshopPaletteText(content)
        if (file.type === 'application/json' || /\.json$/i.test(file.name)) {
          try {
            const parsed = JSON.parse(content) as { name?: unknown }
            const structuredName = String(parsed.name ?? '')
              .trim()
              .slice(0, 40)
            if (structuredName) paletteName = structuredName
          } catch {
            // 色值解析已经成功时，不因 JSON 外壳不标准而丢弃色卡。
          }
        }
      }
      if (!colors.length) throw new Error('没有提取到可用颜色')
      const palette: WorkshopPalette = {
        id: `imported_${crypto.randomUUID().slice(0, 8)}`,
        name: paletteName,
        colors,
        source: 'imported',
      }
      context.importedPalettes.value = [...context.importedPalettes.value, palette].slice(-4)
      context.activePaletteId.value = palette.id
      context.paletteStatus.value = `已提取 ${colors.length} 个参考色；只保存色值，不保存原色卡文件`
    } catch (cause) {
      context.error.value = cause instanceof Error ? cause.message : '色卡解析失败'
    }
  }

  function addCustomTextStyle(): void {
    const context = getContext()

    const label = context.customTextStyleName.value.trim().slice(0, 20)
    if (!label) {
      context.error.value = '请先填写文字样式名称'
      return
    }
    if (context.customTextStyles.value.length >= 6) {
      context.error.value = '最多添加 6 个自定义文字样式'
      return
    }
    context.customTextStyles.value = [
      ...context.customTextStyles.value,
      {
        id: `style_${crypto.randomUUID().slice(0, 8)}`,
        label,
        typography: 'auto',
        fontUrl: '',
      },
    ]
    context.customTextStyleName.value = ''
    context.error.value = ''
  }

  function removeCustomTextStyle(styleId: string): void {
    const context = getContext()

    context.customTextStyles.value = context.customTextStyles.value.filter(
      (textStyle) => textStyle.id !== styleId,
    )
  }

  function switchFieldInputMode(mode: FieldInputMode): void {
    const context = getContext()

    context.error.value = ''
    if (mode === 'visual' && !context.parsedFields.value.length) {
      context.error.value = '请先在文本模式中输入至少一个可识别字段'
      context.fieldInputMode.value = 'text'
      return
    }
    context.fieldInputMode.value = mode
  }

  function replaceVisualFields(fields: StatusField[]): void {
    const context = getContext()

    context.source.value = serializeStatusFields(fields)
  }

  function updateVisualField(
    index: number,
    key: 'group' | 'label' | 'kind' | 'example',
    value: string,
  ): void {
    const context = getContext()

    const fields = context.parsedFields.value.map((field) => ({ ...field }))
    const field = fields[index]
    if (!field) return
    const normalized = value.trim()
    if (key === 'label') {
      if (!normalized) {
        context.error.value = '字段名称不能为空'
        return
      }
      if (
        fields.some(
          (item, itemIndex) =>
            itemIndex !== index &&
            item.label.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
        )
      ) {
        context.error.value = `字段名称「${normalized}」重复，请换一个名称`
        return
      }
    }
    if (key === 'kind') {
      if (
        normalized !== 'text' &&
        normalized !== 'number' &&
        normalized !== 'percent' &&
        normalized !== 'tags' &&
        normalized !== 'longText'
      )
        return
      field.kind = normalized
    } else {
      field[key] = normalized || (key === 'group' ? '基础信息' : field[key])
    }
    context.error.value = ''
    replaceVisualFields(fields)
  }

  function addVisualField(): void {
    const context = getContext()

    if (context.parsedFields.value.length >= 24) {
      context.error.value = '最多只能添加 24 个字段'
      return
    }
    const fields = context.parsedFields.value.map((field) => ({ ...field }))
    const group = fields.at(-1)?.group || '基础信息'
    let suffix = fields.length + 1
    while (fields.some((field) => field.label === `新字段${suffix}`)) suffix += 1
    fields.push({
      group,
      label: `新字段${suffix}`,
      kind: 'text',
      example: '待填写',
      path: '',
    })
    replaceVisualFields(fields)
  }

  async function removeVisualField(index: number): Promise<void> {
    const context = getContext()

    const field = context.parsedFields.value[index]
    if (!field) return
    const confirmed = await confirmAction({
      title: `删除字段「${field.label}」？`,
      message: '字段会同时从生成契约中移除；未保存内容仍受本机自动恢复保护。',
      confirmLabel: '删除字段',
      cancelLabel: '保留',
    })
    if (!confirmed) return
    replaceVisualFields(
      context.parsedFields.value.filter((_item, itemIndex) => itemIndex !== index),
    )
  }

  function moveVisualField(index: number, offset: -1 | 1): void {
    const context = getContext()

    const target = index + offset
    if (target < 0 || target >= context.parsedFields.value.length) return
    const fields = context.parsedFields.value.map((field) => ({ ...field }))
    const [field] = fields.splice(index, 1)
    fields.splice(target, 0, field!)
    replaceVisualFields(fields)
  }

  function ensureBlockInteractions(selectedBlocks: WorkshopBlock[]): void {
    const context = getContext()

    const next = new Set(context.interactions.value)
    if (selectedBlocks.includes('character-tabs')) next.add('tabs')
    if (selectedBlocks.includes('long-collapse')) next.add('collapsible')
    context.interactions.value = Array.from(next)
  }

  function applyBlockScene(sceneId: string): void {
    const context = getContext()

    const scene = blockSceneOptions.find((item) => item.id === sceneId)
    if (!scene) return
    context.blocks.value = [...scene.blocks]
    ensureBlockInteractions(scene.blocks)
  }

  function toggleBlock(value: WorkshopBlock): void {
    const context = getContext()

    if (context.blocks.value.includes(value)) {
      context.blocks.value = context.blocks.value.filter((item) => item !== value)
      return
    }
    context.blocks.value = [...context.blocks.value, value]
    ensureBlockInteractions(context.blocks.value)
  }

  function addConditionRule(): void {
    const context = getContext()

    if (context.dataMode.value !== 'mvu') {
      context.error.value = '条件样式需要 MVU 变量，请先选择“已有 MVU 变量”'
      return
    }
    const field = context.parsedFields.value.find(
      (item) => item.path === context.conditionFieldPath.value,
    )
    if (!field) {
      context.error.value = '请先选择一个字段'
      return
    }
    if (!context.conditionValue.value.trim()) {
      context.error.value = '请填写条件值'
      return
    }
    if (context.conditionRules.value.length >= 8) {
      context.error.value = '最多添加 8 条条件样式'
      return
    }
    context.conditionRules.value = [
      ...context.conditionRules.value,
      {
        id: `condition-${crypto.randomUUID().slice(0, 8)}`,
        fieldPath: field.path,
        fieldLabel: field.label,
        operator: context.conditionOperator.value,
        value: context.conditionValue.value.trim(),
        color: context.conditionColor.value,
        background: context.conditionBackground.value,
      },
    ]
    context.error.value = ''
  }

  function removeConditionRule(ruleId: string): void {
    const context = getContext()

    context.conditionRules.value = context.conditionRules.value.filter((rule) => rule.id !== ruleId)
  }

  function applyMvuTurn(index: number): void {
    const context = getContext()

    const turn = context.mvuTurns.value[index]
    if (!turn) return
    context.activeMvuTurn.value = index
    context.sample.value = turn.sample
  }

  function handleInspectTarget(target: WorkshopInspectTarget): void {
    const context = getContext()

    const existing = context.inspectedTargets.value.some((item) => item.id === target.id)
    context.inspectedTargets.value = existing
      ? context.inspectedTargets.value.filter((item) => item.id !== target.id)
      : [...context.inspectedTargets.value, target].slice(-8)
  }

  function clearInspectedTargets(): void {
    const context = getContext()

    context.inspectedTargets.value = []
  }

  function applyStressCase(caseId: string): void {
    const context = getContext()

    const stressCase = context.stressCases.value.find((item) => item.id === caseId)
    if (stressCase) context.sample.value = stressCase.sample
  }
  return {
    readImage,
    addReferenceImages,
    removeReferenceImage,
    addImageUrl,
    removeImageUrl,
    applyTargetSizePreset,
    applyCustomTargetSize,
    openLayoutStudio,
    applyLayoutReference,
    clearLayoutReference,
    choosePalette,
    removeImportedPalette,
    extractPaletteFromImage,
    importPalette,
    addCustomTextStyle,
    removeCustomTextStyle,
    switchFieldInputMode,
    replaceVisualFields,
    updateVisualField,
    addVisualField,
    removeVisualField,
    moveVisualField,
    ensureBlockInteractions,
    applyBlockScene,
    toggleBlock,
    addConditionRule,
    removeConditionRule,
    applyMvuTurn,
    handleInspectTarget,
    clearInspectedTargets,
    applyStressCase,
  }
}
