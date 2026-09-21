import type { CloudBackupItem, GitHubBackupConfig } from '../types/CloudBackup'
import { hashCloudBlob } from './CloudArchiveCodec'
import * as CloudBackupGitHubTransport from './CloudBackupGitHubTransport'
import { fetchWithDeadline } from './CloudBackupHttp'
import { CloudBackupJobStore } from './CloudBackupJobStore'
import { LEGACY_RELEASE_TAG } from './CloudBackupPolicy'
import {
  type CloudBackupProgressCallback,
  type CloudBackupTransportContext,
  type GitHubAsset,
  type GitHubRelease,
} from './CloudBackupTransportContext'
import {
  type CloudObjectPlan,
  type CreatedStructuredSnapshot,
  type StructuredSnapshot,
} from './CloudStructuredSnapshot'
import { type GitHubBundleManifest } from './GitHubBackupBundle'

/** Shared transport state and provider dispatch for one backup service instance. */
export class CloudBackupTransport {
  protected readonly transportState: Pick<
    CloudBackupTransportContext,
    'activeMetrics' | 'activeGitHubInventory' | 'jobStore'
  > = {
    activeMetrics: undefined,
    activeGitHubInventory: undefined,
    jobStore: new CloudBackupJobStore(),
  }

  protected transportContext?: CloudBackupTransportContext

  protected getTransportContext(): CloudBackupTransportContext {
    if (this.transportContext) return this.transportContext
    const state = this.transportState
    this.transportContext = {
      get activeGitHubInventory() {
        return state.activeGitHubInventory
      },
      set activeGitHubInventory(value) {
        state.activeGitHubInventory = value
      },
      get activeMetrics() {
        return state.activeMetrics
      },
      set activeMetrics(value) {
        state.activeMetrics = value
      },
      get jobStore() {
        return state.jobStore
      },
      cloudFetch: (...args) => this.cloudFetch(...args),
      readResponseBlob: (response) => response.blob(),
      githubFetch: (...args) => this.githubFetch(...args),
      ensureGitHubInitialCommit: (...args) => this.ensureGitHubInitialCommit(...args),
      getGitHubRelease: (...args) => this.getGitHubRelease(...args),
      listGitHubAssets: (...args) => this.listGitHubAssets(...args),
      materializeCloudObject: (...args) => this.materializeCloudObject(...args),
      uploadGitHubAsset: (...args) => this.uploadGitHubAsset(...args),
      confirmGitHubAssetSize: (...args) => this.confirmGitHubAssetSize(...args),
      readGitHubStructuredSnapshot: (...args) => this.readGitHubStructuredSnapshot(...args),
      readGitHubPartInventory: (...args) => this.readGitHubPartInventory(...args),
      readGitHubBundleManifest: (...args) => this.readGitHubBundleManifest(...args),
    }
    return this.transportContext!
  }

  protected async cloudFetch(url: string, init: RequestInit): Promise<Response> {
    const measuredFetch = async (target: string, request: RequestInit): Promise<Response> => {
      const started = typeof performance === 'undefined' ? Date.now() : performance.now()
      const metrics = this.transportState.activeMetrics
      metrics?.add('httpRequestCount', 1)
      try {
        const response = await fetchWithDeadline(target, request)
        // Accepted HTTP bodies, not pre-counted planned bytes or verified unique objects.
        if (response.ok && request.body instanceof Blob)
          metrics?.add('uploadedBytes', request.body.size)
        return response
      } finally {
        const finished = typeof performance === 'undefined' ? Date.now() : performance.now()
        metrics?.add('networkMs', finished - started)
      }
    }
    return measuredFetch(url, init)
  }

  protected async githubFetch(
    config: GitHubBackupConfig,
    secret: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    return CloudBackupGitHubTransport.githubFetch(
      this.getTransportContext(),
      config,
      secret,
      path,
      init,
    )
  }

  protected async ensureGitHubInitialCommit(
    config: GitHubBackupConfig,
    secret: string,
  ): Promise<boolean> {
    return CloudBackupGitHubTransport.ensureGitHubInitialCommit(
      this.getTransportContext(),
      config,
      secret,
    )
  }

  protected async getGitHubRelease(
    config: GitHubBackupConfig,
    secret: string,
    create: boolean,
    tag = LEGACY_RELEASE_TAG,
  ): Promise<GitHubRelease | undefined> {
    return CloudBackupGitHubTransport.getGitHubRelease(
      this.getTransportContext(),
      config,
      secret,
      create,
      tag,
    )
  }

  protected async materializeCloudObject(plan: CloudObjectPlan): Promise<Blob> {
    const hydratedLazily = !plan.blob
    const blob = plan.blob ?? (await plan.loadBlob?.())
    if (!blob) throw new Error(`云备份对象缺少本机来源：${plan.name}`)
    if (blob.size !== plan.size) throw new Error(`云备份对象本机大小已变化：${plan.name}`)
    if (hydratedLazily && (await hashCloudBlob(blob)) !== plan.hash.toLowerCase()) {
      throw new Error(`云备份对象本机摘要校验失败：${plan.name}`)
    }
    return blob
  }

  protected async uploadGitHubStructuredBackup(
    config: GitHubBackupConfig,
    secret: string,
    snapshot: CreatedStructuredSnapshot,
    onProgress?: CloudBackupProgressCallback,
    respectAutomaticConstraints = false,
  ): Promise<CloudBackupItem> {
    return CloudBackupGitHubTransport.uploadGitHubStructuredBackup(
      this.getTransportContext(),
      config,
      secret,
      snapshot,
      onProgress,
      respectAutomaticConstraints,
    )
  }

  protected async uploadGitHubAsset(
    config: GitHubBackupConfig,
    secret: string,
    releaseId: number,
    name: string,
    blob: Blob,
    contentType: string,
    label?: string,
    attempts = 1,
  ): Promise<GitHubAsset> {
    return CloudBackupGitHubTransport.uploadGitHubAsset(
      this.getTransportContext(),
      config,
      secret,
      releaseId,
      name,
      blob,
      contentType,
      label,
      attempts,
    )
  }

  protected async confirmGitHubAssetSize(
    config: GitHubBackupConfig,
    secret: string,
    uploaded: GitHubAsset,
    expectedSize: number,
  ): Promise<GitHubAsset | undefined> {
    return CloudBackupGitHubTransport.confirmGitHubAssetSize(
      this.getTransportContext(),
      config,
      secret,
      uploaded,
      expectedSize,
    )
  }

  protected async listGitHubAssets(
    config: GitHubBackupConfig,
    secret: string,
    releaseId: number,
  ): Promise<GitHubAsset[]> {
    return CloudBackupGitHubTransport.listGitHubAssets(
      this.getTransportContext(),
      config,
      secret,
      releaseId,
    )
  }

  protected async readGitHubPartInventory(
    config: GitHubBackupConfig,
    secret: string,
    parts: GitHubBundleManifest['parts'],
  ): Promise<Map<string, GitHubAsset>> {
    return CloudBackupGitHubTransport.readGitHubPartInventory(
      this.getTransportContext(),
      config,
      secret,
      parts,
    )
  }

  protected async listGitHub(
    config: GitHubBackupConfig,
    secret: string,
    onProgress?: CloudBackupProgressCallback,
  ): Promise<CloudBackupItem[]> {
    return CloudBackupGitHubTransport.listGitHub(
      this.getTransportContext(),
      config,
      secret,
      onProgress,
    )
  }

  protected async readGitHubBundleManifest(
    config: GitHubBackupConfig,
    secret: string,
    item: CloudBackupItem,
  ): Promise<GitHubBundleManifest> {
    return CloudBackupGitHubTransport.readGitHubBundleManifest(
      this.getTransportContext(),
      config,
      secret,
      item,
    )
  }

  protected async readGitHubStructuredSnapshot(
    config: GitHubBackupConfig,
    secret: string,
    item: CloudBackupItem,
  ): Promise<StructuredSnapshot> {
    return CloudBackupGitHubTransport.readGitHubStructuredSnapshot(
      this.getTransportContext(),
      config,
      secret,
      item,
    )
  }

  protected async createGitHubObjectReader(
    config: GitHubBackupConfig,
    secret: string,
  ): Promise<(object: GitHubBundleManifest) => Promise<Blob>> {
    return CloudBackupGitHubTransport.createGitHubObjectReader(
      this.getTransportContext(),
      config,
      secret,
    )
  }

  protected async downloadGitHubBundle(
    config: GitHubBackupConfig,
    secret: string,
    item: CloudBackupItem,
  ): Promise<Blob> {
    return CloudBackupGitHubTransport.downloadGitHubBundle(
      this.getTransportContext(),
      config,
      secret,
      item,
    )
  }
}
