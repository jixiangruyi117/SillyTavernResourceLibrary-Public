import type { InstalledOfficialApp, OfficialAppId } from '../types/OfficialApp'

export interface OfficialAppPackageStorage {
  list(): Promise<InstalledOfficialApp[]>
  save(app: InstalledOfficialApp): Promise<void>
  remove(id: OfficialAppId): Promise<void>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  hasFile(path: string, size: number, bundled?: boolean): Promise<boolean>
  deleteFile(path: string, bundled?: boolean): Promise<void>
}
