export interface FrontendWorkshopHotspotPoint {
  x: number
  y: number
}

export interface FrontendWorkshopHotspotRect {
  x: number
  y: number
  width: number
  height: number
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function hotspotPointFromClient(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): FrontendWorkshopHotspotPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 }
  return {
    x: clampPercent(((clientX - bounds.left) / bounds.width) * 100),
    y: clampPercent(((clientY - bounds.top) / bounds.height) * 100),
  }
}

export function hotspotRectFromPoints(
  start: FrontendWorkshopHotspotPoint,
  end: FrontendWorkshopHotspotPoint,
): FrontendWorkshopHotspotRect {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(Math.max(start.x, end.x) - x)),
    height: Math.max(1, Math.round(Math.max(start.y, end.y) - y)),
  }
}

export function isUsableHotspotRect(rect: FrontendWorkshopHotspotRect): boolean {
  return rect.width >= 4 && rect.height >= 4
}
