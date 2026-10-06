import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import {
  FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT,
  type FrontendWorkshopSourceMappingConfidence,
  type FrontendWorkshopSourceProvenance,
} from './FrontendWorkshopSourceAnalysis'

export interface FrontendWorkshopExactSourceWriteTarget {
  confidence: FrontendWorkshopSourceMappingConfidence
  provenance: FrontendWorkshopSourceProvenance
}

export interface FrontendWorkshopExactSourceWriteRange {
  start: number
  end: number
}

/**
 * Shared exact-write admission rule for S4 single-range writeback and S5 bounded multi-range Patch.
 * It only validates current Source identity/provenance/range; it never mutates or reparses Source.
 */
export function resolveFrontendWorkshopExactSourceWriteRange(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision' | 'authorSource'>,
  target: FrontendWorkshopExactSourceWriteTarget,
): FrontendWorkshopExactSourceWriteRange {
  if (target.confidence !== 'exact') {
    throw new Error('Source writeback 只接受 exact mapping')
  }
  if (target.provenance.kind !== 'static-source') {
    throw new Error('Source writeback 只接受 static-source provenance')
  }

  const anchor = target.provenance.anchor
  if (anchor.projectId !== source.projectId || anchor.sourceRevision !== source.revision) {
    throw new Error('Source writeback mapping 已失效')
  }
  if (anchor.offsetUnit !== FRONTEND_WORKSHOP_SOURCE_OFFSET_UNIT) {
    throw new Error('Source writeback offset unit 不匹配')
  }

  const { start, end } = anchor.range
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.authorSource.length
  ) {
    throw new Error('Source writeback range 超出当前 Author Source')
  }

  return { start, end }
}

/**
 * S4 exact single-range writeback primitive. It only replaces the proven Source range and never
 * formats, parses, normalizes, or rebuilds surrounding Author Source. Persistence/revision CAS is a
 * separate Source Document Service responsibility.
 */
export function applyFrontendWorkshopExactSourceWriteback(
  source: Pick<FrontendWorkshopSourceDocument, 'projectId' | 'revision' | 'authorSource'>,
  target: FrontendWorkshopExactSourceWriteTarget,
  replacement: string,
): string {
  if (typeof replacement !== 'string') throw new Error('Source writeback replacement 必须是字符串')
  const { start, end } = resolveFrontendWorkshopExactSourceWriteRange(source, target)
  return source.authorSource.slice(0, start) + replacement + source.authorSource.slice(end)
}
