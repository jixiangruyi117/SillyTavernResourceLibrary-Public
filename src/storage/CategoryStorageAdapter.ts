import type { Category } from '../types/Resource'

export interface CategoryStorageAdapter {
  list(): Promise<Category[]>
  save(category: Category): Promise<void>
  update(id: string, changes: Partial<Category>): Promise<void>
  deleteAndUnassign(id: string): Promise<void>
}
