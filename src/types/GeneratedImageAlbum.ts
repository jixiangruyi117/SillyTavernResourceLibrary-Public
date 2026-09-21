export type GeneratedImageAlbumSource = 'generated' | 'imported'
export type GeneratedImageHostingMode = 'shared' | 'self-hosted'
export type GeneratedImageHostedStatus = 'all' | 'hosted' | 'local'

export type ImageGenerationParameter =
  | string
  | number
  | boolean
  | null
  | ImageGenerationParameter[]
  | { [key: string]: ImageGenerationParameter }
export interface ImageGenerationManifest {
  version: 1
  provider: 'openai' | 'novelai'
  model: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg' | 'webp'
  seed?: number
  parameters: Record<string, ImageGenerationParameter>
  parentImageId?: string
  createdAt: number
}

export interface GeneratedImageAlbumItem {
  id: string
  name: string
  source: GeneratedImageAlbumSource
  provider?: 'openai' | 'novelai'
  prompt?: string
  negativePrompt?: string
  generationParameters?: Record<string, string | number | boolean>
  /** 新记录可选；旧记录不强制迁移，不包含凭据或参考图二进制。 */
  generationManifest?: ImageGenerationManifest
  category: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  hostedUrl?: string
  hostedImageId?: string
  hostingMode?: GeneratedImageHostingMode
  /** 自建 ImgBed 上传时的站点 origin，仅用于图片资源管理，不包含凭据。 */
  hostedOrigin?: string
  /** 自建 ImgBed 的真实 fileId，例如 srl-workshop/abcd.png。 */
  hostedFileId?: string
  createdAt: number
  updatedAt: number
}

export interface GeneratedImageAlbumFile {
  id: string
  originalBlob?: Blob
  originalMimeType: string
  thumbnailBlob?: Blob
  thumbnailMimeType?: string
  updatedAt: number
  /** @deprecated 仅用于从 v16 及更早版本迁移。 */
  originalBase64?: string
  /** @deprecated 仅用于从 v16 及更早版本迁移。 */
  thumbnailBase64?: string
  /** @deprecated 仅用于从 v14/v15 迁移。 */
  originalBytes?: ArrayBuffer
  /** @deprecated 仅用于从 v14/v15 迁移。 */
  thumbnailBytes?: ArrayBuffer
}

export interface GeneratedImageAlbumQuery {
  search?: string
  mimeType?: string
  category?: string
  hostedStatus?: GeneratedImageHostedStatus
  sort?: 'newest' | 'oldest'
  page?: number
  pageSize?: number
}

export interface GeneratedImageAlbumPage {
  items: GeneratedImageAlbumItem[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  categories: string[]
  mimeTypes: string[]
}
