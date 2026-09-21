import type { CloudBackupItem, GitHubBackupConfig } from '../types/CloudBackup'
import { type GitHubBundleManifest } from './GitHubBackupBundle'
import { type CloudObjectPlan, type StructuredSnapshot } from './CloudStructuredSnapshot'
import { CloudBackupMetricsTracker } from './CloudBackupMetrics'
import { CloudBackupJobStore } from './CloudBackupJobStore'

export const SNAPSHOT_RELEASE_TAG = 'srl-cloud-snapshots'

export const OBJECT_RELEASE_PREFIX = 'srl-cloud-objects-'

export const GITHUB_OBJECT_CONTAINER_LIMIT = 900

export const GITHUB_ASSET_CONFIRM_ATTEMPTS = 4

export const GITHUB_ASSET_CONFIRM_DELAY_MS = 600

export interface GitHubAsset {
  id: number
  name: string
  size: number
  created_at: string
  url: string
  label?: string | null
}

export interface GitHubRelease {
  id: number
  assets: GitHubAsset[]
  tag_name?: string
}

export type CloudBackupProgressCallback = (message: string) => void

export interface CloudBackupTransportContext {
  activeGitHubInventory: { releaseId: number; assets: Map<number, GitHubAsset> } | undefined
  activeMetrics: CloudBackupMetricsTracker | undefined
  jobStore: CloudBackupJobStore
  cloudFetch(url: string, init: RequestInit): Promise<Response>
  readResponseBlob(response: Response, totalBytes?: number): Promise<Blob>
  githubFetch(
    config: GitHubBackupConfig,
    secret: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>
  ensureGitHubInitialCommit(config: GitHubBackupConfig, secret: string): Promise<boolean>
  getGitHubRelease(
    config: GitHubBackupConfig,
    secret: string,
    create: boolean,
    tag?: string,
  ): Promise<GitHubRelease | undefined>
  listGitHubAssets(
    config: GitHubBackupConfig,
    secret: string,
    releaseId: number,
  ): Promise<GitHubAsset[]>
  materializeCloudObject(plan: CloudObjectPlan): Promise<Blob>
  uploadGitHubAsset(
    config: GitHubBackupConfig,
    secret: string,
    releaseId: number,
    name: string,
    blob: Blob,
    contentType: string,
    label?: string,
    attempts?: number,
  ): Promise<GitHubAsset>
  confirmGitHubAssetSize(
    config: GitHubBackupConfig,
    secret: string,
    uploaded: GitHubAsset,
    expectedSize: number,
  ): Promise<GitHubAsset | undefined>
  readGitHubStructuredSnapshot(
    config: GitHubBackupConfig,
    secret: string,
    item: CloudBackupItem,
  ): Promise<StructuredSnapshot>
  readGitHubPartInventory(
    config: GitHubBackupConfig,
    secret: string,
    parts: GitHubBundleManifest['parts'],
  ): Promise<Map<string, GitHubAsset>>
  readGitHubBundleManifest(
    config: GitHubBackupConfig,
    secret: string,
    item: CloudBackupItem,
  ): Promise<GitHubBundleManifest>
}
