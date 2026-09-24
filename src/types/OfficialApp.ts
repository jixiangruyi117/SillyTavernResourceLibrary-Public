export const OFFICIAL_APP_IDS = [
  'draw',
  'stitch',
  'frontendWorkshop',
  'imageGeneration',
  'imageAlbum',
  'userPersona',
  'resourceBundle',
  'tavernBridge',
] as const
export type OfficialAppId = (typeof OFFICIAL_APP_IDS)[number]
export function isOfficialAppId(value: string): value is OfficialAppId {
  return (OFFICIAL_APP_IDS as readonly string[]).includes(value)
}
export interface OfficialAppFile {
  path: string
  size: number
  sha256: string
  bundled?: boolean
}
export interface OfficialAppPackage {
  schemaVersion: 1
  id: OfficialAppId
  shellVersion: string
  entry: string
  styles: string[]
  files: OfficialAppFile[]
}
export interface InstalledOfficialApp extends OfficialAppPackage {
  installedAt: number
}
export interface OfficialAppDownload {
  url: string
  sha256: string
  downloadBytes: number
  installedBytes: number
  entry: string
}
export interface OfficialAppCatalog {
  schemaVersion: 1
  shellVersion: string
  apps: Record<OfficialAppId, OfficialAppDownload>
}
export const OFFICIAL_APP_ASSET_CACHE = 'srl-official-app-assets-v1'

export const OFFICIAL_APP_DATA_DESCRIPTION: Record<OfficialAppId, string> = {
  draw: '抽取记录和显示偏好',
  stitch: '缝合草稿、恢复点、模板、收藏段落和最近使用记录',
  frontendWorkshop:
    '全部本地前端工程、源码、历史、恢复点、组件、旧草稿和最近颜色；共用 API 与图床设置保留',
  imageGeneration: '生图草稿、模板、接口设置及本机保存的生图密钥；已保存的相册图片保留',
  imageAlbum: '全部本地相册记录及原图；云端图片和资源库中的副本保留',
  userPersona: '人设模板；资源库中的人设文件保留',
  resourceBundle: '已保存的配套套装；资源库中的各项原始资源保留',
  tavernBridge: '当前互传会话随页面关闭结束；已归档的资源和酒馆原件保留',
}
