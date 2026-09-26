import type { ResourceSummary } from '../types/Resource'

export type SimilarNameMode = 'precise' | 'broad'

export interface SimilarResourceNameGroup {
  id: string
  /** 原始资源名称，按字典序排列，供分组列表展示。 */
  names: string[]
  resources: ResourceSummary[]
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function nameStems(value: string): string[] {
  const normalized = normalizeName(value)
  const folded = value.normalize('NFKC').trim()
  const withoutBracketSuffix = normalizeName(
    folded.replace(/(?:\s*[([{【][^()（）]{1,24}[)\]}】])+\s*$/u, ''),
  )
  const withoutKnownSuffix = normalizeName(
    folded.replace(/(?:番外|外传|特别篇|衍生篇|续篇|续集|重制版|修订版|新版|旧版|if线)+$/iu, ''),
  )
  return [...new Set([withoutBracketSuffix, withoutKnownSuffix])].filter(
    (stem) => stem && stem !== normalized,
  )
}

function broadNameStem(value: string): string {
  let stem = value.normalize('NFKC').trim()
  // Strip only suffix descriptions/version tokens. Do not merge arbitrary shared prefixes.
  for (let index = 0; index < 4; index += 1) {
    const next = stem
      .replace(/\.(?:png|json|webp)$/iu, '')
      .replace(/\s*[([{【][^()[\]{}【】]{1,40}[)\]}】]\s*$/u, '')
      .replace(
        /[\s_-]*(?:(?:v(?:er(?:sion)?)?\.?\s*|版本\s*)\d+(?:\.\d+)*|\d+(?:\.\d+)+|正式版|测试版|最终版|完整版|重制版|修订版|新版|旧版|番外(?:篇)?|外传|特别篇|衍生篇|续篇|续集|if线)\s*$/iu,
        '',
      )
      .trim()
    if (next === stem) break
    stem = next
  }
  return normalizeName(stem)
}

function deletionSignatures(value: string): string[] {
  const signatures = new Set<string>([value])
  for (let index = 0; index < value.length; index += 1) {
    signatures.add(value.slice(0, index) + value.slice(index + 1))
  }
  return [...signatures]
}

/**
 * 按资源名称整理重复与轻微变体。只做名称比较，不读取正文或卡片内容。
 *
 * 先折叠规范化后的同名，再用变体后缀和单字符编辑索引生成候选；不会对全库
 * 做 O(n²) 两两比较。长度不足 4 的名称只按同名/明确变体后缀分组，以减少误报。
 */
export function findSimilarResourceNameGroups(
  resources: ResourceSummary[],
  mode: SimilarNameMode = 'precise',
): SimilarResourceNameGroup[] {
  const resourcesByName = new Map<string, ResourceSummary[]>()
  const stemsByName = new Map<string, Set<string>>()
  for (const resource of resources) {
    const normalized = normalizeName(resource.name)
    if (!normalized) continue
    const bucket = resourcesByName.get(normalized)
    if (bucket) bucket.push(resource)
    else resourcesByName.set(normalized, [resource])
    const stems = stemsByName.get(normalized) ?? new Set<string>()
    nameStems(resource.name).forEach((stem) => stems.add(stem))
    stemsByName.set(normalized, stems)
  }

  const names = [...resourcesByName.keys()]
  const parent = new Map(names.map((name) => [name, name]))
  const find = (name: string): string => {
    const current = parent.get(name) ?? name
    if (current === name) return name
    const root = find(current)
    parent.set(name, root)
    return root
  }
  const join = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }

  for (const name of names) {
    for (const stem of stemsByName.get(name) ?? []) {
      if (resourcesByName.has(stem)) join(name, stem)
    }
  }

  if (mode === 'broad') {
    const byStem = new Map<string, string>()
    for (const resource of resources) {
      const name = normalizeName(resource.name)
      const stem = broadNameStem(resource.name)
      if (!name || !stem) continue
      const previous = byStem.get(stem)
      if (previous) join(previous, name)
      else byStem.set(stem, name)
    }
  }

  const signatureIndex = new Map<string, string[]>()
  for (const name of names) {
    if (name.length < 4) continue
    for (const signature of deletionSignatures(name)) {
      const bucket = signatureIndex.get(signature)
      if (bucket) bucket.push(name)
      else signatureIndex.set(signature, [name])
    }
  }

  for (const candidates of signatureIndex.values()) {
    const first = candidates[0]
    if (!first) continue
    // 同一删除签名意味着两名称之间最多有一次字符增删改；将桶线性并入，
    // 避免常见前缀下的候选退化为两两比较。
    for (const candidate of candidates.slice(1)) join(first, candidate)
  }

  const groups = new Map<string, ResourceSummary[]>()
  for (const name of names) {
    const root = find(name)
    const bucket = groups.get(root) ?? []
    bucket.push(...(resourcesByName.get(name) ?? []))
    groups.set(root, bucket)
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const sortedResources = [...group].sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id),
      )
      const distinctNames = [...new Set(sortedResources.map((resource) => resource.name))].sort(
        (left, right) => left.localeCompare(right, 'zh-CN'),
      )
      return {
        id: sortedResources
          .map((resource) => resource.id)
          .sort()
          .join(':'),
        names: distinctNames,
        resources: sortedResources,
      }
    })
    .sort(
      (left, right) =>
        right.resources.length - left.resources.length ||
        left.names[0].localeCompare(right.names[0], 'zh-CN'),
    )
}
