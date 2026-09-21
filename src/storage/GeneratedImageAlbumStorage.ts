import type {
  GeneratedImageAlbumFile,
  GeneratedImageAlbumItem,
  GeneratedImageAlbumPage,
  GeneratedImageAlbumQuery,
} from '../types/GeneratedImageAlbum'

export interface GeneratedImageAlbumStorage {
  list(): Promise<GeneratedImageAlbumItem[]>
  query?(query: GeneratedImageAlbumQuery): Promise<GeneratedImageAlbumPage>
  count?(): Promise<number>
  get(id: string): Promise<GeneratedImageAlbumItem | undefined>
  getFile(id: string): Promise<GeneratedImageAlbumFile | undefined>
  put(item: GeneratedImageAlbumItem, file: GeneratedImageAlbumFile): Promise<void>
  update(item: GeneratedImageAlbumItem): Promise<void>
  delete(id: string): Promise<void>
}
