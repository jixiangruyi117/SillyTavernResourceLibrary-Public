export function normalizeWorkshopImageUrls(values: string[]): string[] {
  const urls: string[] = []
  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) continue
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`图片直链格式不正确：${value.slice(0, 80)}`)
    }
    if (parsed.protocol !== 'https:')
      throw new Error('成品图片只接受 HTTPS 直链，避免酒馆 HTTPS 页面被混合内容拦截')
    if (parsed.username || parsed.password) throw new Error('图片直链不能包含账号或密码')
    const normalized = parsed.toString()
    if (!urls.includes(normalized)) urls.push(normalized)
    if (urls.length >= 4) break
  }
  return urls
}

export function normalizeWorkshopFontUrls(values: string[]): string[] {
  const urls: string[] = []
  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) continue
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`字体直链格式不正确：${value.slice(0, 80)}`)
    }
    if (parsed.protocol !== 'https:')
      throw new Error('自定义字体只接受 HTTPS 直链，避免酒馆 HTTPS 页面被混合内容拦截')
    if (parsed.username || parsed.password) throw new Error('字体直链不能包含账号或密码')
    const normalized = parsed.toString()
    if (!urls.includes(normalized)) urls.push(normalized)
    if (urls.length >= 8) break
  }
  return urls
}

export function normalizeApprovedResourceUrl(value: string): string {
  const decoded = String(value ?? '')
    .trim()
    .replace(/&amp;/gi, '&')
  try {
    return new URL(decoded).toString()
  } catch {
    return decoded
  }
}

export function normalizeWorkshopPaletteColors(values: string[]): string[] {
  const colors: string[] = []
  for (const rawValue of values) {
    const match = rawValue.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (!match) continue
    const source = match[1]!
    const expanded =
      source.length === 3
        ? source
            .split('')
            .map((character) => character + character)
            .join('')
        : source
    const color = `#${expanded.toUpperCase()}`
    if (!colors.includes(color)) colors.push(color)
    if (colors.length >= 12) break
  }
  return colors
}

export function parseWorkshopPaletteText(source: string): string[] {
  const candidates = Array.from(
    source.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi),
    (match) => match[0],
  )
  for (const match of source.matchAll(
    /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+)?\s*\)/gi,
  )) {
    const channels = match.slice(1, 4).map((value) => Math.min(255, Number(value)))
    candidates.push(`#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`)
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+.*)?$/)
    if (!match) continue
    const channels = match.slice(1, 4).map((value) => Math.min(255, Number(value)))
    candidates.push(`#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`)
  }
  const colors = normalizeWorkshopPaletteColors(candidates)
  if (!colors.length) throw new Error('色卡中没有找到 HEX、RGB 或 GIMP GPL 色值')
  return colors
}

export function extractWorkshopPaletteColors(pixels: Uint8ClampedArray, maximum = 8): string[] {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>()
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3]!
    if (alpha < 128) continue
    const red = pixels[index]!
    const green = pixels[index + 1]!
    const blue = pixels[index + 2]!
    const key = `${red >> 4}-${green >> 4}-${blue >> 4}`
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    bucket.count += 1
    bucket.red += red
    bucket.green += green
    bucket.blue += blue
    buckets.set(key, bucket)
  }
  const selected: Array<{ red: number; green: number; blue: number }> = []
  for (const bucket of Array.from(buckets.values()).sort(
    (left, right) => right.count - left.count,
  )) {
    const color = {
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
    }
    const tooClose = selected.some(
      (existing) =>
        Math.hypot(
          existing.red - color.red,
          existing.green - color.green,
          existing.blue - color.blue,
        ) < 46,
    )
    if (!tooClose) selected.push(color)
    if (selected.length >= Math.max(1, Math.min(12, maximum))) break
  }
  return selected.map(
    (color) =>
      `#${[color.red, color.green, color.blue]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`,
  )
}
