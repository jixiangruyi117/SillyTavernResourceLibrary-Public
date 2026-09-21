import type { Category, Resource } from '../types/Resource'
import type { NativeBackedResourceRecord } from '../types/Vault'

export interface ArchiveStorageAdapter {
  canRestoreNative?(): boolean
  listRestoreVersionKeys?(): Promise<string[]>
  restore(
    categories: Category[],
    resources: Resource[],
    versions?: Resource[],
    hydrate?: (resource: Resource) => Promise<Resource>,
  ): Promise<void>
  restoreNative?(
    categories: Category[],
    resources: NativeBackedResourceRecord[],
    versions?: NativeBackedResourceRecord[],
    hydrate?: (resource: NativeBackedResourceRecord) => Promise<NativeBackedResourceRecord>,
  ): Promise<void>
  replace(
    categories: Category[],
    resources: Resource[],
    versions?: Resource[],
    hydrate?: (resource: Resource) => Promise<Resource>,
  ): Promise<void>
}
