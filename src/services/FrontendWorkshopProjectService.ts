import {
  FRONTEND_WORKSHOP_PROJECT_VERSION,
  FRONTEND_WORKSHOP_SCHEMA_VERSION,
  createFrontendWorkshopProject,
  type FrontendWorkshopNode,
  type FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import type { FrontendWorkshopProjectStorage } from '../storage/FrontendWorkshopProjectStorage'
import { normalizeFrontendWorkshopMvuPath } from '../utils/FrontendWorkshopMvuState'
import { validateFrontendWorkshopProject } from '../utils/FrontendWorkshopCommandSystem'

const MAX_PROJECTS = 80

/**
 * Testing-period retirement boundary.
 *
 * Modern greeting projects are current-schema only. Historical greeting formats are handled once
 * by cleanupLegacyGreetingDataOnce() and are never interpreted by the normal read/write path.
 * Legacy status projects are intentionally left untouched and continue to be owned by
 * FrontendWorkshopApp.vue.
 */
export const FRONTEND_WORKSHOP_GREETING_LEGACY_CLEANUP_ID =
  'frontend-workshop:greeting-new-only:2026-08-28-v1'

const LEGACY_GREETING_NODE_KINDS = new Set([
  'section',
  'card',
  'button',
  'field',
  'flip',
  'collapse',
  'tabs',
  'reveal',
])

const LEGACY_GREETING_PROJECT_KEYS = [
  'advancedSource',
  'aiCandidates',
  'migration',
  'compatibilityMode',
  'componentPresets',
] as const

export interface FrontendWorkshopLegacyCleanupResult {
  skipped: boolean
  preservedStatusProjects: number
  cleanedGreetingProjects: number
  resetGreetingProjects: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneProject<T>(value: T): T {
  return structuredClone(value)
}

function isLegacyNodeTree(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false
  return nodes.some((value) => {
    if (!isRecord(value)) return true
    if (LEGACY_GREETING_NODE_KINDS.has(String(value.kind))) return true
    if (Object.hasOwn(value, 'fieldId')) return true
    if (hasLegacyConstraint(value.constraint)) return true
    return isLegacyNodeTree(value.children)
  })
}

function hasLegacyConstraint(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    Object.hasOwn(value, 'width') ||
    Object.hasOwn(value, 'phoneSpan') ||
    Object.hasOwn(value, 'wideSpan') ||
    Object.hasOwn(value, 'gridSpan')
  )
    return true
  return isRecord(value.wide) && Object.hasOwn(value.wide, 'gridSpan')
}

function hasLegacyGreetingShape(value: Record<string, unknown>): boolean {
  if (
    value.version !== FRONTEND_WORKSHOP_PROJECT_VERSION ||
    value.schemaVersion !== FRONTEND_WORKSHOP_SCHEMA_VERSION
  )
    return true
  if (LEGACY_GREETING_PROJECT_KEYS.some((key) => Object.hasOwn(value, key))) return true
  const pages = value.pages
  if (!Array.isArray(pages)) return true
  return pages.some((page) => !isRecord(page) || isLegacyNodeTree(page.nodes))
}

function stripLegacyConstraint(value: unknown): void {
  if (!isRecord(value)) return
  delete value.width
  delete value.phoneSpan
  delete value.wideSpan
  delete value.gridSpan
  if (isRecord(value.wide)) delete value.wide.gridSpan
}

// Current editable CSS values only. Old designer recipes are never round-tripped into new nodes.
const CURRENT_STYLE_KEYS = new Set([
  'align',
  'tone',
  'columns',
  'emphasis',
  'rotation',
  'imageFit',
  'imageTone',
  'cornerRadius',
  'cornerRadii',
  'opacity',
  'surfaceColor',
  'textColor',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'borderWidth',
  'borderColor',
  'borderStyle',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur',
  'shadowSpread',
  'padding',
  'margin',
])
const CURRENT_NODE_KEYS = new Set([
  'id',
  'layerId',
  'semanticRole',
  'hidden',
  'kind',
  'label',
  'text',
  'imageUrl',
  'contentSource',
  'control',
  'action',
  'style',
  'layout',
  'composition',
  'constraint',
  'children',
])

function stripLegacyNodeFields(nodes: FrontendWorkshopNode[]): void {
  for (const node of nodes) {
    const mutable = node as FrontendWorkshopNode & Record<string, unknown>
    for (const key of Object.keys(mutable)) if (!CURRENT_NODE_KEYS.has(key)) delete mutable[key]
    for (const key of Object.keys(node.style ?? {})) {
      if (!CURRENT_STYLE_KEYS.has(key)) delete (node.style as Record<string, unknown>)[key]
    }
    stripLegacyConstraint(mutable.constraint)
    stripLegacyNodeFields(node.children)
  }
}

function stripLegacyGreetingFields(project: FrontendWorkshopProject): FrontendWorkshopProject {
  const cleaned = cloneProject(project)
  const mutable = cleaned as FrontendWorkshopProject & Record<string, unknown>
  for (const key of LEGACY_GREETING_PROJECT_KEYS) delete mutable[key]
  const currentProjectKeys = new Set([
    'version',
    'schemaVersion',
    'id',
    'kind',
    'name',
    'createdAt',
    'updatedAt',
    'document',
    'fields',
    'variables',
    'states',
    'behaviors',
    'hotspots',
    'pages',
    'assets',
    'assetLinks',
  ])
  for (const key of Object.keys(mutable)) if (!currentProjectKeys.has(key)) delete mutable[key]
  for (const page of cleaned.pages) stripLegacyNodeFields(page.nodes)
  return cleaned
}

function normalizeCurrentGreetingProject(
  value: unknown,
  requireValidInvariants = true,
): FrontendWorkshopProject | undefined {
  if (!isRecord(value) || value.kind !== 'greeting') return undefined
  if (hasLegacyGreetingShape(value)) return undefined

  const project = stripLegacyGreetingFields(
    cloneProject(value as unknown as FrontendWorkshopProject),
  )
  if (!project.id || !project.name || !project.document || !Array.isArray(project.pages))
    return undefined

  for (const field of project.fields ?? []) {
    if (field.source?.provider !== 'mvu') continue
    const normalizedPath = normalizeFrontendWorkshopMvuPath(field.source.path)
    if (normalizedPath) {
      field.source.path = normalizedPath
      field.path = normalizedPath
    } else {
      field.source = undefined
    }
  }

  if (requireValidInvariants && validateFrontendWorkshopProject(project).length) return undefined
  return project
}

// Only bridge the immediately preceding release; never reconstruct retired designer recipes.
function upgradeReleasedGreetingProject(
  value: FrontendWorkshopProject,
): FrontendWorkshopProject | undefined {
  const raw = value as unknown as Record<string, unknown>
  if (raw.kind !== 'greeting' || raw.version !== 9 || raw.schemaVersion !== 6) return undefined
  if (
    !Array.isArray(value.pages) ||
    value.pages.some((page) => !Array.isArray(page.nodes) || isLegacyNodeTree(page.nodes))
  )
    return undefined
  const next = stripLegacyGreetingFields(value)
  next.version = FRONTEND_WORKSHOP_PROJECT_VERSION
  next.schemaVersion = FRONTEND_WORKSHOP_SCHEMA_VERSION
  return normalizeCurrentGreetingProject(next)
}

function normalizeLegacyStatusProject(value: unknown): FrontendWorkshopProject | undefined {
  if (!isRecord(value) || value.kind !== 'status') return undefined
  if (typeof value.id !== 'string' || !value.id) return undefined
  return cloneProject(value) as unknown as FrontendWorkshopProject
}

/**
 * Normal runtime normalizer: current greeting only; status is a deliberate legacy island.
 * No schema migration, old-node translation, inferred binding recovery, snapshot fallback or
 * advanced-source recovery is allowed here.
 */
export function normalizeFrontendWorkshopProject(
  value: unknown,
): FrontendWorkshopProject | undefined {
  if (isRecord(value) && value.kind === 'status') return normalizeLegacyStatusProject(value)
  return normalizeCurrentGreetingProject(value)
}

function resetLegacyGreetingShell(value: Record<string, unknown>): FrontendWorkshopProject {
  const createdAt =
    typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now()
  const project = createFrontendWorkshopProject('greeting', createdAt)
  const id =
    typeof value.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 100) : project.id
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim().slice(0, 120)
      : '未命名开场白'
  project.id = id
  project.document = { id, name }
  project.name = name
  project.updatedAt = Date.now()
  return project
}

function cleanupGreetingRecord(value: unknown): {
  project?: FrontendWorkshopProject
  reset: boolean
} {
  if (!isRecord(value) || value.kind !== 'greeting') return { reset: false }

  // Old schemas and old hard-node trees are test data. Do not keep migration code alive for them.
  // Replace only the structured shell so an already-existing Source Document with the same projectId
  // remains intact and continues to be the Source-first truth.
  if (
    value.version !== FRONTEND_WORKSHOP_PROJECT_VERSION ||
    value.schemaVersion !== FRONTEND_WORKSHOP_SCHEMA_VERSION ||
    (Array.isArray(value.pages) &&
      value.pages.some((page) => isRecord(page) && isLegacyNodeTree(page.nodes)))
  ) {
    return { project: resetLegacyGreetingShell(value), reset: true }
  }

  const candidate = cloneProject(value) as unknown as FrontendWorkshopProject
  const cleaned = stripLegacyGreetingFields(candidate)
  const normalized = normalizeCurrentGreetingProject(cleaned)
  return normalized
    ? { project: normalized, reset: false }
    : { project: resetLegacyGreetingShell(value), reset: true }
}

export class FrontendWorkshopProjectService {
  private readonly storage: FrontendWorkshopProjectStorage
  private cleanupPromise?: Promise<FrontendWorkshopLegacyCleanupResult>

  constructor(storage: FrontendWorkshopProjectStorage) {
    this.storage = storage
  }

  /**
   * Run exactly once per persistent store. The marker is written only after projects, Source rows
   * and Source components all finish successfully; an interrupted cleanup is therefore safe to retry.
   * Status projects are never rewritten.
   */
  cleanupLegacyGreetingDataOnce(): Promise<FrontendWorkshopLegacyCleanupResult> {
    this.cleanupPromise ??= this.runLegacyGreetingCleanup()
    return this.cleanupPromise
  }

  private async runLegacyGreetingCleanup(): Promise<FrontendWorkshopLegacyCleanupResult> {
    if (await this.storage.hasMaintenanceMarker(FRONTEND_WORKSHOP_GREETING_LEGACY_CLEANUP_ID)) {
      return {
        skipped: true,
        preservedStatusProjects: 0,
        cleanedGreetingProjects: 0,
        resetGreetingProjects: 0,
      }
    }

    const records = (await this.storage.list()) as unknown[]
    let preservedStatusProjects = 0
    let cleanedGreetingProjects = 0
    let resetGreetingProjects = 0

    for (const record of records) {
      if (isRecord(record) && record.kind === 'status') {
        preservedStatusProjects += 1
        continue
      }
      if (!isRecord(record) || record.kind !== 'greeting') continue

      const result = cleanupGreetingRecord(record)
      if (!result.project) continue
      result.project.updatedAt = Date.now()
      await this.storage.putAtomic(
        result.project,
        (await this.storage.getLastGood(result.project.id))?.project ??
          (record as unknown as FrontendWorkshopProject),
      )
      if (result.reset) resetGreetingProjects += 1
      else cleanedGreetingProjects += 1
    }

    await this.storage.cleanupLegacyAuxiliaryData()
    await this.storage.setMaintenanceMarker(FRONTEND_WORKSHOP_GREETING_LEGACY_CLEANUP_ID)
    return {
      skipped: false,
      preservedStatusProjects,
      cleanedGreetingProjects,
      resetGreetingProjects,
    }
  }

  async list(): Promise<FrontendWorkshopProject[]> {
    // Upgrade the immediately preceding released schema before the historical test-data cleanup.
    // putAtomic saves the raw original to the existing last_good owner in the same transaction.
    for (const project of await this.storage.list()) {
      const raw = project as unknown as Record<string, unknown>
      if (raw.kind !== 'greeting' || raw.version !== 9 || raw.schemaVersion !== 6) continue
      const next = upgradeReleasedGreetingProject(project)
      if (!next) throw new Error(`开场白「${project.name}」无法安全升级；原始项目已保留，未重置。`)
      await this.storage.putAtomic(next, project)
    }
    await this.cleanupLegacyGreetingDataOnce()
    return (await this.storage.list())
      .map(normalizeFrontendWorkshopProject)
      .filter(Boolean) as FrontendWorkshopProject[]
  }

  async save(value: FrontendWorkshopProject): Promise<FrontendWorkshopProject> {
    const project =
      value.kind === 'greeting'
        ? normalizeCurrentGreetingProject(value, false)
        : normalizeFrontendWorkshopProject(value)
    if (!project) throw new Error('工作台项目不是当前格式；旧开场白数据只能经过一次性清理')

    if (project.kind === 'greeting') {
      const invariantIssues = validateFrontendWorkshopProject(project)
      if (invariantIssues.length)
        throw new Error(invariantIssues.map((item) => item.message).join('；'))
    }

    project.updatedAt = Date.now()
    const existing = await this.storage.get(project.id)
    if (!existing && (await this.storage.list()).length >= MAX_PROJECTS) {
      throw new Error(`最多保留 ${MAX_PROJECTS} 个工作台项目，请先删除不再使用的项目`)
    }

    const previous = existing ? normalizeFrontendWorkshopProject(existing) : undefined
    await this.storage.putAtomic(project, previous)
    return project
  }

  async restoreLastGood(id: string): Promise<FrontendWorkshopProject | undefined> {
    const record = await this.storage.getLastGood(id)
    if (!record) return undefined
    const project =
      normalizeFrontendWorkshopProject(record.project) ??
      upgradeReleasedGreetingProject(record.project)
    if (!project) return undefined
    if (project.kind === 'greeting') {
      const invariantIssues = validateFrontendWorkshopProject(project)
      if (invariantIssues.length) return undefined
    }
    project.updatedAt = Date.now()
    await this.storage.putAtomic(project)
    return project
  }

  async delete(id: string): Promise<void> {
    await this.storage.delete(id)
  }
}
