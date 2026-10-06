import type { ComputedRef, Ref } from 'vue'
import {
  BrowserStorageService,
  type CabinetColumns,
  type CabinetLayoutEntry,
} from '../services/BrowserStorageService'
import type { FolderLibraryViewProps } from '../types/FolderLibraryView'
import { type Category, type ResourceSummary } from '../types/Resource'

interface FolderCabinetDragContext {
  isFolderEditMode: Ref<boolean, boolean>
  folderDrag: Ref<{ pointerId: number; folderId: string; x: number; y: number } | undefined>
  FOLDER_HOLD_MS: number
  suppressFolderClickUntil: number
  setFolderPage: (nextPage: number) => void
  folderPage: Ref<number, number>
  folderPageCount: ComputedRef<number>
  moveCabinetEntryToSlot: (
    kind: CabinetLayoutEntry['kind'],
    id: string,
    targetSlot: number,
    persist?: boolean,
  ) => boolean
  orderedFolderIds: Ref<string[]>
  saveCabinetLayout: (layout: CabinetLayoutEntry[], persist?: boolean) => void
  props: Readonly<FolderLibraryViewProps>
  FOLDER_EDIT_HOLD_MS: number
  cabinetLayout: Ref<CabinetLayoutEntry[]>
  cabinetStorage: BrowserStorageService
  emit: ((event: 'openResource', resource: ResourceSummary) => void) &
    ((event: 'manage') => void) &
    ((
      event: 'add',
      details: { categoryId: string; resourceIds: string[]; removeFromCabinet?: boolean },
    ) => void) &
    ((event: 'cover', details: { category: Category; file?: File; coverUrl?: string }) => void) &
    ((
      event: 'rename',
      details: {
        category: Category
        name: string
        coverChanged?: boolean
        coverImage?: string
        file?: File
      },
    ) => void) &
    ((event: 'reorder', categoryIds: string[]) => void) &
    ((event: 'pin', resourceIds: string[]) => void) &
    ((event: 'unpin', resourceId: string) => void)
  cabinetColumns: Ref<CabinetColumns>
  folderPageSize: ComputedRef<number>
}

export function useFolderCabinetDrag(getContext: () => FolderCabinetDragContext) {
  const FOLDER_MOVE_TOLERANCE = 10
  const PAGE_SWIPE_DISTANCE = 48
  const PAGE_EDGE_SIZE = 42
  const PAGE_EDGE_DWELL_MS = 520
  let folderHoldTimer: number | undefined
  let folderEdgeTimer: number | undefined
  let folderEdgeDirection = 0
  let pagerHoldTimer: number | undefined
  let initialFolderOrder = ''
  let initialCabinetLayout = ''
  let lastFolderDragTarget = ''
  let folderMoveFrame: number | undefined
  let pendingFolderMove: { x: number; y: number } | undefined
  let folderCandidate:
    | { pointerId: number; folderId: string; startX: number; startY: number; source: HTMLElement }
    | undefined
  let pagerGesture:
    | { pointerId: number; startX: number; startY: number; latestX: number; latestY: number }
    | undefined

  function handlePagerPointerDown(event: PointerEvent): void {
    const context = getContext()

    if (event.pointerType === 'mouse' || context.isFolderEditMode.value || context.folderDrag.value)
      return
    if (!(event.target instanceof Element)) return
    if (!event.target.closest('[data-folder-order-id], [data-cabinet-resource-id]')) {
      if (pagerHoldTimer !== undefined) window.clearTimeout(pagerHoldTimer)
      pagerHoldTimer = window.setTimeout(() => {
        context.isFolderEditMode.value = true
        pagerGesture = undefined
        navigator.vibrate?.(14)
      }, context.FOLDER_HOLD_MS)
    }
    pagerGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
    }
  }

  function handlePagerPointerMove(event: PointerEvent): void {
    const context = getContext()

    if (!pagerGesture || pagerGesture.pointerId !== event.pointerId || context.folderDrag.value)
      return
    pagerGesture.latestX = event.clientX
    pagerGesture.latestY = event.clientY
    const distanceX = event.clientX - pagerGesture.startX
    const distanceY = event.clientY - pagerGesture.startY
    if (Math.hypot(distanceX, distanceY) > FOLDER_MOVE_TOLERANCE && pagerHoldTimer !== undefined) {
      window.clearTimeout(pagerHoldTimer)
      pagerHoldTimer = undefined
    }
    if (Math.abs(distanceX) > 14 && Math.abs(distanceX) > Math.abs(distanceY) * 1.2) {
      event.preventDefault()
    }
  }

  function finishPagerGesture(event: PointerEvent): void {
    const context = getContext()

    if (!pagerGesture || pagerGesture.pointerId !== event.pointerId || context.folderDrag.value)
      return
    const distanceX = pagerGesture.latestX - pagerGesture.startX
    const distanceY = pagerGesture.latestY - pagerGesture.startY
    pagerGesture = undefined
    if (pagerHoldTimer !== undefined) window.clearTimeout(pagerHoldTimer)
    pagerHoldTimer = undefined
    if (
      Math.abs(distanceX) < PAGE_SWIPE_DISTANCE ||
      Math.abs(distanceX) < Math.abs(distanceY) * 1.25
    ) {
      return
    }
    context.suppressFolderClickUntil = Date.now() + 320
    context.setFolderPage(context.folderPage.value + (distanceX < 0 ? 1 : -1))
  }

  function cancelPagerGesture(): void {
    pagerGesture = undefined
    if (pagerHoldTimer !== undefined) window.clearTimeout(pagerHoldTimer)
    pagerHoldTimer = undefined
  }

  function clearFolderEdgeTurn(): void {
    if (folderEdgeTimer !== undefined) window.clearTimeout(folderEdgeTimer)
    folderEdgeTimer = undefined
    folderEdgeDirection = 0
  }

  function scheduleFolderEdgeTurn(direction: number): void {
    const context = getContext()

    if (folderEdgeDirection === direction && folderEdgeTimer !== undefined) return
    clearFolderEdgeTurn()
    const nextPage = context.folderPage.value + direction
    if (nextPage < 0 || nextPage >= context.folderPageCount.value) return
    folderEdgeDirection = direction
    folderEdgeTimer = window.setTimeout(() => {
      context.setFolderPage(nextPage)
      navigator.vibrate?.(10)
      clearFolderEdgeTurn()
    }, PAGE_EDGE_DWELL_MS)
  }

  function cancelFolderHold(): void {
    if (folderHoldTimer !== undefined) window.clearTimeout(folderHoldTimer)
    folderHoldTimer = undefined
    folderCandidate = undefined
    window.removeEventListener('pointermove', handleFolderPointerMove)
    window.removeEventListener('pointerup', finishFolderDrag)
    window.removeEventListener('pointercancel', handleFolderPointerCancel)
  }

  function cancelFolderMoveFrame(): void {
    if (folderMoveFrame !== undefined) window.cancelAnimationFrame(folderMoveFrame)
    folderMoveFrame = undefined
    pendingFolderMove = undefined
  }

  function flushFolderPointerMove(): void {
    const context = getContext()

    folderMoveFrame = undefined
    const position = pendingFolderMove
    pendingFolderMove = undefined
    const drag = context.folderDrag.value
    if (!position || !drag) return

    context.folderDrag.value = { ...drag, x: position.x, y: position.y }
    const target = document.elementFromPoint?.(position.x, position.y)
    const targetSlot = Number(
      target?.closest<HTMLElement>('[data-cabinet-slot]')?.dataset.cabinetSlot,
    )
    if (Number.isInteger(targetSlot)) {
      const targetKey = `slot:${targetSlot}`
      if (targetKey === lastFolderDragTarget) return
      lastFolderDragTarget = targetKey
      context.moveCabinetEntryToSlot('folder', drag.folderId, targetSlot, false)
    } else {
      lastFolderDragTarget = ''
    }
  }

  function cancelFolderDrag(restore = false): void {
    const context = getContext()

    cancelFolderHold()
    cancelFolderMoveFrame()
    clearFolderEdgeTurn()
    if (restore && initialFolderOrder)
      context.orderedFolderIds.value = initialFolderOrder.split('|')
    if (restore && initialCabinetLayout) {
      context.saveCabinetLayout(JSON.parse(initialCabinetLayout) as CabinetLayoutEntry[], false)
    }
    context.folderDrag.value = undefined
    lastFolderDragTarget = ''
    initialFolderOrder = ''
    initialCabinetLayout = ''
  }

  function handleFolderPointerDown(event: PointerEvent, category: Category): void {
    const context = getContext()

    if (context.props.busy || event.button > 0) return
    const target = event.target
    if (target instanceof Element && target.closest('[data-folder-action]')) return
    cancelFolderDrag()
    const source = event.currentTarget
    if (!(source instanceof HTMLElement)) return
    folderCandidate = {
      pointerId: event.pointerId,
      folderId: category.id,
      startX: event.clientX,
      startY: event.clientY,
      source,
    }
    window.addEventListener('pointermove', handleFolderPointerMove, { passive: false })
    window.addEventListener('pointerup', finishFolderDrag)
    window.addEventListener('pointercancel', handleFolderPointerCancel)
    const holdMs = context.isFolderEditMode.value
      ? context.FOLDER_EDIT_HOLD_MS
      : context.FOLDER_HOLD_MS
    folderHoldTimer = window.setTimeout(() => {
      if (!folderCandidate || folderCandidate.pointerId !== event.pointerId) return
      context.isFolderEditMode.value = true
      initialFolderOrder = context.orderedFolderIds.value.join('|')
      initialCabinetLayout = JSON.stringify(context.cabinetLayout.value)
      context.suppressFolderClickUntil = Date.now() + 500
      context.folderDrag.value = {
        pointerId: event.pointerId,
        folderId: category.id,
        x: event.clientX,
        y: event.clientY,
      }
      navigator.vibrate?.(14)
    }, holdMs)
  }

  function handleFolderPointerCancel(event: PointerEvent): void {
    const context = getContext()

    if (!folderCandidate || folderCandidate.pointerId !== event.pointerId) return
    cancelFolderDrag(Boolean(context.folderDrag.value))
  }

  function handleFolderPointerMove(event: PointerEvent): void {
    const context = getContext()

    if (!folderCandidate || folderCandidate.pointerId !== event.pointerId) return
    if (!context.folderDrag.value) {
      const distance = Math.hypot(
        event.clientX - folderCandidate.startX,
        event.clientY - folderCandidate.startY,
      )
      if (distance > FOLDER_MOVE_TOLERANCE) cancelFolderHold()
      return
    }

    event.preventDefault()
    if (event.clientX <= PAGE_EDGE_SIZE) scheduleFolderEdgeTurn(-1)
    else if (event.clientX >= window.innerWidth - PAGE_EDGE_SIZE) scheduleFolderEdgeTurn(1)
    else clearFolderEdgeTurn()
    pendingFolderMove = { x: event.clientX, y: event.clientY }
    if (folderMoveFrame === undefined) {
      folderMoveFrame = window.requestAnimationFrame(flushFolderPointerMove)
    }
  }

  function finishFolderDrag(event: PointerEvent): void {
    const context = getContext()

    if (!folderCandidate || folderCandidate.pointerId !== event.pointerId) return
    if (folderMoveFrame !== undefined) window.cancelAnimationFrame(folderMoveFrame)
    flushFolderPointerMove()
    const wasDragging = Boolean(context.folderDrag.value)
    const changed =
      (initialFolderOrder && initialFolderOrder !== context.orderedFolderIds.value.join('|')) ||
      (initialCabinetLayout && initialCabinetLayout !== JSON.stringify(context.cabinetLayout.value))
    if (wasDragging) {
      event.preventDefault()
      context.suppressFolderClickUntil = Date.now() + 450
      if (changed) {
        context.cabinetStorage.setCabinetLayout(context.cabinetLayout.value)
        context.emit('reorder', context.orderedFolderIds.value.slice())
      }
      navigator.vibrate?.(changed ? 20 : 8)
    }
    cancelFolderDrag()
  }

  function moveFolderByKeyboard(event: KeyboardEvent, folderId: string): void {
    const context = getContext()

    const directions: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -context.cabinetColumns.value,
      ArrowDown: context.cabinetColumns.value,
    }
    if (!context.isFolderEditMode.value || directions[event.key] === undefined) return
    event.preventDefault()
    const currentSlot = context.cabinetLayout.value.find(
      (entry) => entry.kind === 'folder' && entry.id === folderId,
    )?.slot
    const direction = directions[event.key]!
    if (currentSlot === undefined) return
    const targetSlot = currentSlot + direction
    if (
      targetSlot < 0 ||
      targetSlot >= context.folderPageCount.value * context.folderPageSize.value
    )
      return
    if (!context.moveCabinetEntryToSlot('folder', folderId, targetSlot)) return
    context.emit('reorder', context.orderedFolderIds.value.slice())
    const page = Math.floor(targetSlot / context.folderPageSize.value)
    context.setFolderPage(page)
  }
  return {
    handlePagerPointerDown,
    handlePagerPointerMove,
    finishPagerGesture,
    cancelPagerGesture,
    clearFolderEdgeTurn,
    scheduleFolderEdgeTurn,
    cancelFolderHold,
    cancelFolderMoveFrame,
    flushFolderPointerMove,
    cancelFolderDrag,
    handleFolderPointerDown,
    handleFolderPointerCancel,
    handleFolderPointerMove,
    finishFolderDrag,
    moveFolderByKeyboard,
  }
}
