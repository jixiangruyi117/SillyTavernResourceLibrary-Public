import type {
  FrontendWorkshopProject,
  FrontendWorkshopProjectLastGoodRecord,
} from '../types/FrontendWorkshopProject'

export interface FrontendWorkshopProjectStorage {
  list(): Promise<FrontendWorkshopProject[]>
  get(id: string): Promise<FrontendWorkshopProject | undefined>
  put(project: FrontendWorkshopProject): Promise<void>
  putAtomic(project: FrontendWorkshopProject, lastGood?: FrontendWorkshopProject): Promise<void>
  getLastGood(id: string): Promise<FrontendWorkshopProjectLastGoodRecord | undefined>
  delete(id: string): Promise<void>
  /** Persistent idempotent marker: every production/test storage must guarantee one-shot maintenance. */
  hasMaintenanceMarker(id: string): Promise<boolean>
  setMaintenanceMarker(id: string): Promise<void>
  /** One-shot cleanup for retired Source/component metadata owned by the same FrontendWorkshop store. */
  cleanupLegacyAuxiliaryData(): Promise<void>
}
