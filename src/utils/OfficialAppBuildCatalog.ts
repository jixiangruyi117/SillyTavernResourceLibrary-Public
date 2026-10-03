import type { OfficialAppBuildCatalog } from '../types/OfficialApp'

export function getOfficialAppShellFiles(
  catalog: OfficialAppBuildCatalog,
): Record<string, { size: number; sha256: string }> {
  const files: Record<string, { size: number; sha256: string }> = Object.create(null)
  for (const app of Object.values(catalog.apps)) {
    if (!app) continue
    for (const file of app.hostFiles) {
      const previous = files[file.path]
      if (previous && (previous.size !== file.size || previous.sha256 !== file.sha256))
        throw new Error(`APK 内置 APP catalog 存在冲突文件：${file.path}`)
      files[file.path] = { size: file.size, sha256: file.sha256 }
    }
  }
  return files
}
