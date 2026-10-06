import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

type Point = { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Transform only the displayed image; never zoom the PWA document. */
export function useGalleryImageGestures(
  stage: Ref<HTMLElement | undefined>,
  source: () => string,
  turn: (direction: number) => void,
) {
  const scale = ref(1),
    x = ref(0),
    y = ref(0)
  const natural = ref({ width: 0, height: 0 })
  const size = ref({ width: 0, height: 0 })
  const base = computed(() => {
    const ratio = Math.min(
      size.value.width / natural.value.width,
      size.value.height / natural.value.height,
    )
    return natural.value.width && natural.value.height
      ? { width: natural.value.width * ratio, height: natural.value.height * ratio }
      : { width: 0, height: 0 }
  })
  const maxScale = computed(() => Math.max(8, size.value.width / (base.value.width || 1)))
  const style = computed(() => ({
    width: `${base.value.width}px`,
    height: `${base.value.height}px`,
    transform: `translate(${x.value}px, ${y.value}px) scale(${scale.value})`,
  }))
  const pointers = new Map<number, Point>()
  let start: Point | undefined,
    multi = false,
    moved = false
  let lastTap: { point: Point; time: number } | undefined
  let observer: ResizeObserver | undefined
  function clamp() {
    const boundX = Math.max(0, (base.value.width * scale.value - size.value.width) / 2)
    const boundY = Math.max(0, (base.value.height * scale.value - size.value.height) / 2)
    x.value = Math.max(-boundX, Math.min(boundX, x.value))
    y.value = Math.max(-boundY, Math.min(boundY, y.value))
  }
  function reset() {
    scale.value = 1
    x.value = 0
    y.value = 0
    pointers.clear()
    start = undefined
    lastTap = undefined
  }
  function zoom(value: number, anchor: Point = { x: 0, y: 0 }) {
    const next = Math.max(1, Math.min(maxScale.value, value))
    const ratio = next / scale.value
    x.value = anchor.x - (anchor.x - x.value) * ratio
    y.value = anchor.y - (anchor.y - y.value) * ratio
    scale.value = next
    clamp()
  }
  function local(point: Point): Point {
    const rect = stage.value!.getBoundingClientRect()
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 }
  }
  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const point = { x: event.clientX, y: event.clientY }
    pointers.set(event.pointerId, point)
    stage.value?.setPointerCapture(event.pointerId)
    if (pointers.size === 1) {
      start = point
      multi = false
      moved = false
    } else {
      multi = true
      lastTap = undefined
    }
  }
  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const point = { x: event.clientX, y: event.clientY }
    const before = [...pointers.values()]
    pointers.set(event.pointerId, point)
    if (start && distance(start, point) > 8) moved = true
    if (pointers.size === 2) {
      const after = [...pointers.values()]
      const oldCenter = midpoint(before[0]!, before[1]!),
        center = midpoint(after[0]!, after[1]!)
      const oldDistance = distance(before[0]!, before[1]!)
      if (oldDistance > 0)
        zoom((scale.value * distance(after[0]!, after[1]!)) / oldDistance, local(oldCenter))
      x.value += center.x - oldCenter.x
      y.value += center.y - oldCenter.y
      clamp()
    } else if (pointers.size === 1 && scale.value > 1) {
      x.value += point.x - previous.x
      y.value += point.y - previous.y
      clamp()
    }
  }
  function up(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return
    pointers.delete(event.pointerId)
    if (pointers.size) return
    const point = { x: event.clientX, y: event.clientY }
    if (!multi && start) {
      const dx = point.x - start.x,
        dy = point.y - start.y
      if (scale.value === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        lastTap = undefined
        turn(dx < 0 ? 1 : -1)
      } else if (!moved && distance(start, point) <= 8) {
        if (
          lastTap &&
          event.timeStamp - lastTap.time < 320 &&
          distance(lastTap.point, point) < 24
        ) {
          zoom(scale.value > 1 ? 1 : 2.5, local(point))
          lastTap = undefined
        } else lastTap = { point, time: event.timeStamp }
      }
    }
    start = undefined
  }
  function lost(event: PointerEvent) {
    if (pointers.has(event.pointerId)) cancel()
  }
  function cancel() {
    pointers.clear()
    start = undefined
    lastTap = undefined
  }
  function wheel(event: WheelEvent) {
    zoom(
      scale.value * Math.exp(-event.deltaY * 0.002),
      local({ x: event.clientX, y: event.clientY }),
    )
  }
  function loaded(event: Event) {
    const image = event.target as HTMLImageElement
    natural.value = { width: image.naturalWidth, height: image.naturalHeight }
  }
  function dimensions(width: number, height: number) {
    natural.value = { width, height }
  }
  function fitWidth() {
    zoom(size.value.width / (base.value.width || 1))
    y.value = Math.max(0, (base.value.height * scale.value - size.value.height) / 2)
  }
  watch(source, () => {
    reset()
    natural.value = { width: 0, height: 0 }
  })
  onMounted(() => {
    observer = new ResizeObserver(() => {
      if (!stage.value) return
      size.value = { width: stage.value.clientWidth, height: stage.value.clientHeight }
      clamp()
    })
    if (stage.value) observer.observe(stage.value)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    cancel()
  })
  return {
    ready: computed(() => base.value.width > 0),
    isLongImage: computed(
      () =>
        natural.value.height >= natural.value.width * 2 &&
        natural.value.width > 0 &&
        base.value.width < size.value.width - 1,
    ),
    scale,
    maxScale,
    style,
    reset,
    zoom,
    loaded,
    dimensions,
    geometry: computed(() => ({
      viewportWidth: size.value.width,
      viewportHeight: size.value.height,
      width: base.value.width * scale.value,
      height: base.value.height * scale.value,
      x: x.value,
      y: y.value,
    })),
    fitWidth,
    down,
    move,
    up,
    cancel,
    lost,
    wheel,
  }
}
