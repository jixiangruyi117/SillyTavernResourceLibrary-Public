import type { ResourceSummary } from './Resource'

/** Read-only bytes, deliberately not a Blob that could be saved or exported. */
export interface ResourceByteSource {
  readonly size: number
  readonly contentIdentity?: string
  text(): Promise<string>
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export type ResourceReadSource = ResourceSummary & { originalSource: ResourceByteSource }
