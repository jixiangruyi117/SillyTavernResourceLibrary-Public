import type { ResourceStorageAdapter } from '../storage/ResourceStorageAdapter'
import { toResourceListSummary, type Resource, type ResourceListSummary } from '../types/Resource'

export async function listResourceListSummaries(
  storage: ResourceStorageAdapter,
): Promise<ResourceListSummary[]> {
  if (storage.listResourceListSummaries) return storage.listResourceListSummaries()
  return (await storage.listSummaries()).map(toResourceListSummary)
}

export async function getResourceVersion(
  storage: ResourceStorageAdapter,
  id: string,
): Promise<Resource | undefined> {
  if (storage.getVersion) return storage.getVersion(id)
  return (await storage.listAllVersions()).find((version) => version.id === id)
}
