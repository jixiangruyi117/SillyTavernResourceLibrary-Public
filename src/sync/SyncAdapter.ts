export interface BackupInfo {
  id: string
  objectKey: string
  size: number
  createdAt: number
}

export interface SyncAdapter {
  connect(): Promise<void>
  upload(objectKey: string, payload: Blob): Promise<void>
  download(objectKey: string): Promise<Blob>
  listBackups(): Promise<BackupInfo[]>
  deleteBackup(objectKey: string): Promise<void>
}
