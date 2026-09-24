import {
  type StatusField,
  type WorkshopLayoutItem,
  type WorkshopLayoutViewport,
  type WorkshopLayoutReference,
  type WorkshopTargetSize,
} from '../types/FrontendWorkshopLegacy'
import { normalizeWorkshopImageUrls } from './FrontendWorkshopLegacyResources'

export function clampLayoutValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(Number(value) || 0)))
}

export function normalizeWorkshopLayoutReference(
  value?: WorkshopLayoutReference,
): WorkshopLayoutReference {
  const normalizeViewport = (
    viewport: WorkshopLayoutViewport | undefined,
    fallbackWidth: number,
  ): WorkshopLayoutViewport => {
    const canvasWidth = clampLayoutValue(viewport?.canvasWidth ?? fallbackWidth, 280, 960)
    const canvasHeight = clampLayoutValue(viewport?.canvasHeight ?? 560, 100, 1800)
    const items = Array.isArray(viewport?.items)
      ? viewport.items
          .filter((item) => item && (item.kind === 'field' || item.kind === 'image'))
          .slice(0, 40)
          .map((item, index) => {
            const width = clampLayoutValue(item.width, 48, canvasWidth)
            const height = clampLayoutValue(item.height, 40, canvasHeight)
            return {
              id: String(item.id || `${item.kind}-${index}`).slice(0, 80),
              kind: item.kind,
              source: String(item.source ?? '').slice(0, 800),
              label: String(item.label ?? '').slice(0, 80),
              x: clampLayoutValue(item.x, 0, canvasWidth - width),
              y: clampLayoutValue(item.y, 0, canvasHeight - height),
              width,
              height,
              zIndex: clampLayoutValue(item.zIndex, 1, 40),
              locked: Boolean(item.locked),
              groupId: String(item.groupId ?? '')
                .trim()
                .slice(0, 80),
            }
          })
      : []
    return { canvasWidth, canvasHeight, items }
  }
  const phone = normalizeViewport(value, 360)
  const desktop = value?.desktop ? normalizeViewport(value.desktop, 720) : undefined
  return { ...phone, desktop }
}

export function createWorkshopLayoutReference(
  fields: StatusField[],
  imageUrls: string[],
  previous?: WorkshopLayoutReference,
  targetSize?: WorkshopTargetSize,
): WorkshopLayoutReference {
  const normalizedImages = normalizeWorkshopImageUrls(imageUrls)
  const previousLayout = normalizeWorkshopLayoutReference(previous)
  const buildViewport = (
    canvasWidth: number,
    previousViewport: WorkshopLayoutViewport | undefined,
    columns: number,
  ): WorkshopLayoutViewport => {
    const normalizedPrevious = normalizeWorkshopLayoutReference({
      canvasWidth,
      canvasHeight: previousViewport?.canvasHeight ?? 560,
      items: previousViewport?.items ?? [],
    })
    const columnWidth = Math.floor((canvasWidth - 40 - (columns - 1) * 12) / columns)
    const minimumHeight =
      72 + normalizedImages.length * 132 + Math.ceil(Math.max(1, fields.length) / columns) * 96
    const canvasHeight = clampLayoutValue(
      Math.max(normalizedPrevious.canvasHeight, minimumHeight),
      560,
      1800,
    )
    const previousBySource = new Map<string, WorkshopLayoutItem[]>()
    for (const item of normalizedPrevious.items) {
      const key = `${item.kind}:${item.source}`
      previousBySource.set(key, [...(previousBySource.get(key) ?? []), item])
    }
    const usedIds = new Set<string>()
    const takePrevious = (key: string): WorkshopLayoutItem | undefined => {
      const item = previousBySource.get(key)?.shift()
      if (item) usedIds.add(item.id)
      return item
    }
    const items: WorkshopLayoutItem[] = []
    normalizedImages.forEach((url, index) => {
      const existing = takePrevious(`image:${url}`)
      items.push(
        existing ?? {
          id: `image-${index + 1}`,
          kind: 'image',
          source: url,
          label: `图片 ${index + 1}`,
          x: 20,
          y: 20 + index * 132,
          width: canvasWidth - 40,
          height: 112,
          zIndex: index + 1,
        },
      )
    })
    const fieldStart = 28 + normalizedImages.length * 132
    fields.forEach((field, index) => {
      const existing = takePrevious(`field:${field.path}`)
      const column = index % columns
      const row = Math.floor(index / columns)
      items.push(
        existing ?? {
          id: `field-${index + 1}`,
          kind: 'field',
          source: field.path,
          label: field.label,
          x: 20 + column * (columnWidth + 12),
          y: fieldStart + row * 96,
          width: columnWidth,
          height: 78,
          zIndex: normalizedImages.length + index + 1,
        },
      )
    })
    for (const extra of normalizedPrevious.items) {
      if (usedIds.has(extra.id)) continue
      const sourceStillExists =
        extra.kind === 'image'
          ? normalizedImages.includes(extra.source)
          : fields.some((field) => field.path === extra.source)
      if (sourceStillExists) items.push(extra)
    }
    return { canvasWidth, canvasHeight, items }
  }
  const phone = buildViewport(previousLayout.canvasWidth, previousLayout, 2)
  const desktop = buildViewport(
    previousLayout.desktop?.canvasWidth ?? 720,
    previousLayout.desktop,
    3,
  )
  const reference = normalizeWorkshopLayoutReference({ ...phone, desktop })
  return targetSize ? resizeWorkshopLayoutReference(reference, targetSize) : reference
}

export function resizeWorkshopLayoutReference(
  value: WorkshopLayoutReference,
  targetSize: WorkshopTargetSize,
): WorkshopLayoutReference {
  const normalized = normalizeWorkshopLayoutReference(value)
  const ratio = Math.min(10, Math.max(0.2, targetSize.width / targetSize.height))
  const resizeViewport = (
    viewport: WorkshopLayoutViewport,
    canvasWidth: number,
  ): WorkshopLayoutViewport => {
    const canvasHeight = clampLayoutValue(canvasWidth / ratio, 100, 1_800)
    const scaleX = canvasWidth / viewport.canvasWidth
    const scaleY = canvasHeight / viewport.canvasHeight
    return {
      canvasWidth,
      canvasHeight,
      items: viewport.items.map((item) => ({
        ...item,
        x: Math.round(item.x * scaleX),
        y: Math.round(item.y * scaleY),
        width: Math.max(48, Math.round(item.width * scaleX)),
        height: Math.max(40, Math.round(item.height * scaleY)),
      })),
    }
  }
  const phone = resizeViewport(normalized, 360)
  const desktop = resizeViewport(normalized.desktop ?? normalized, 720)
  return normalizeWorkshopLayoutReference({ ...phone, desktop })
}

export function describeWorkshopLayoutReference(
  layout: WorkshopLayoutReference | undefined,
): string {
  const normalized = normalizeWorkshopLayoutReference(layout)
  if (!normalized.items.length) return ''
  const describeViewport = (label: string, viewport: WorkshopLayoutViewport): string =>
    [
      `【${label}布局意图｜${viewport.canvasWidth}×${viewport.canvasHeight}】`,
      ...viewport.items.map((item) => {
        const x = Math.round((item.x / viewport.canvasWidth) * 100)
        const y = Math.round((item.y / viewport.canvasHeight) * 100)
        const width = Math.round((item.width / viewport.canvasWidth) * 100)
        const height = Math.round((item.height / viewport.canvasHeight) * 100)
        return `- ${item.kind === 'image' ? '图片' : '字段'}「${item.label}」：左 ${x}%、上 ${y}%、宽 ${width}%、高 ${height}%、层级 ${item.zIndex}${item.locked ? '、已锁定' : ''}`
      }),
    ].join('\n')
  return [
    describeViewport('手机', normalized),
    normalized.desktop ? describeViewport('宽屏', normalized.desktop) : '',
  ]
    .filter(Boolean)
    .join('\n')
}
