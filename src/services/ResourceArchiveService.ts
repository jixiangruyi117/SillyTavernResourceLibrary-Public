import { stageArchive } from './ArchiveExtraction'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'
import { isRecord } from '../utils/UnknownValue'
import { isUnmodifiedSillyTavernDefault } from './SillyTavernDefaultContent'
import { isSillyTavernSeededPath, parseSillyTavernContentLog } from './SillyTavernContentLog'
import { parsePersonalResource } from '../types/PersonalResource'
import type { ArchiveStageProgress } from './ArchiveExtraction'

const TAVERN_RESOURCE_DIRECTORIES = new Set([
  'characters',
  'worlds',
  'themes',
  'quickreplies',
  'openai settings',
  'novelai settings',
  'koboldai settings',
  'textgen settings',
  'regex',
  'scripts',
])

const TAVERN_NON_RESOURCE_DIRECTORIES = new Set([
  'chats',
  'group chats',
  'groups',
  'instruct',
  'context',
  'sysprompt',
  'reasoning',
])

function isResourcePath(path: string): boolean {
  const parts = path.toLowerCase().split('/')
  return (
    parts.some((part) => TAVERN_RESOURCE_DIRECTORIES.has(part)) &&
    /\.(png|json|css|txt)$/i.test(path) &&
    !parts.some((part) => ['backups', 'secrets.json', 'config.yaml', '.git'].includes(part))
  )
}

function isSettingsPath(path: string): boolean {
  return /(^|\/)settings\.json$/i.test(path) && !path.toLowerCase().includes('backups/')
}

function isOrdinaryResourcePath(path: string): boolean {
  const parts = path.toLowerCase().split('/')
  const name = parts.at(-1) ?? ''
  return (
    /\.(png|json|css|txt)$/i.test(name) &&
    !['manifest.json', 'srl-resource.json', 'settings.json', 'content.log'].includes(name) &&
    !parts.some((part) =>
      ['backups', 'secrets.json', 'config.yaml', '.git', '__macosx'].includes(part),
    )
  )
}

function fileMimeType(name: string): string {
  return /\.json$/i.test(name)
    ? 'application/json'
    : /\.png$/i.test(name)
      ? 'image/png'
      : /\.css$/i.test(name)
        ? 'text/css'
        : 'text/plain'
}

/** Uses the restore staging owner; files are decoded in bounded chunks and read one at a time. */
export class ResourceArchiveService {
  private readonly staging: RestoreStagingStore
  constructor(staging: RestoreStagingStore) {
    this.staging = staging
  }

  async inspect(
    file: File,
    onProgress?: (progress: ArchiveStageProgress) => void,
  ): Promise<'library' | 'personal' | 'tavern' | 'resources'> {
    return (await this.readArchive(file, onProgress, false)).kind
  }

  async readResourceArchive(
    file: File,
    onProgress?: (progress: ArchiveStageProgress) => void,
  ): Promise<{ kind: 'library' | 'personal' | 'tavern' | 'resources'; files: File[] }> {
    return this.readArchive(file, onProgress, true)
  }

  private async readArchive(
    file: File,
    onProgress: ((progress: ArchiveStageProgress) => void) | undefined,
    materialize: boolean,
  ): Promise<{ kind: 'library' | 'personal' | 'tavern' | 'resources'; files: File[] }> {
    let settingsFound = false
    const structureDirectories = new Set<string>()
    const resourcePaths: string[] = []
    const job = await stageArchive(
      file,
      this.staging,
      (path) => {
        if (isSettingsPath(path)) settingsFound = true
        const parts = path.toLowerCase().split('/')
        const directory = parts.find((part) => TAVERN_NON_RESOURCE_DIRECTORIES.has(part))
        if (directory) structureDirectories.add(directory)
        if (isOrdinaryResourcePath(path)) resourcePaths.push(path)
        return (
          path === 'manifest.json' ||
          path === 'srl-resource.json' ||
          (materialize && isOrdinaryResourcePath(path))
        )
      },
      onProgress,
    )
    try {
      const personal = await this.staging.get(job, 'srl-resource.json')
      if (personal) {
        if (personal.size > 2 * 1024 * 1024) throw new Error('个人资源包清单超过 2 MB')
        try {
          parsePersonalResource(JSON.parse(await personal.blob.text()))
        } catch (error) {
          throw new Error(
            `压缩包内的个人资源清单无效：${error instanceof Error ? error.message : 'JSON 格式错误'}`,
            { cause: error },
          )
        }
        return { kind: 'personal', files: [] }
      }
      const manifest = await this.staging.get(job, 'manifest.json')
      if (manifest) {
        // SRL exports write `format` first. Large libraries can have manifests
        // over 32 MiB; inspect only the prefix so they are not mistaken for a
        // Tavern ZIP just because they also contain characters/ or worlds/ paths.
        const prefix = await manifest.blob.slice(0, 4096).text()
        if (/^\s*\{\s*"format"\s*:\s*"srl-archive"\s*(?:,|\})/u.test(prefix))
          return { kind: 'library', files: [] }
        if (manifest.size < 32 * 1024 * 1024) {
          const value: unknown = JSON.parse(await manifest.blob.text())
          if (isRecord(value) && value.format === 'srl-archive')
            return { kind: 'library', files: [] }
        }
      }
      // Settings or Tavern-only paths such as chats/ identify a Tavern backup.
      // A lone characters/ or worlds/ folder is a common ordinary resource
      // bundle and must remain on the ordinary import path.
      if (settingsFound || structureDirectories.size > 0) return { kind: 'tavern', files: [] }
      if (resourcePaths.length) {
        if (!materialize) return { kind: 'resources', files: [] }
        const files: File[] = []
        for (const path of resourcePaths) {
          const entry = await this.staging.get(job, path)
          if (!entry) throw new Error('压缩包暂存文件不完整')
          files.push(
            new File([entry.blob], path.split('/').at(-1)!, {
              type: fileMimeType(path),
            }),
          )
        }
        return { kind: 'resources', files }
      }
      throw new Error('未识别到资源库备份、酒馆备份或可导入资源；请检查压缩包内容')
    } finally {
      await this.staging.deleteJob(job)
    }
  }

  async validateTavernBackup(
    file: File,
    onProgress?: (progress: ArchiveStageProgress) => void,
  ): Promise<void> {
    const structureDirectories = new Set<string>()
    let settingsFound = false
    const job = await stageArchive(
      file,
      this.staging,
      (path) => {
        if (isSettingsPath(path)) settingsFound = true
        const directory = path
          .toLowerCase()
          .split('/')
          .find((part) => TAVERN_NON_RESOURCE_DIRECTORIES.has(part))
        if (directory) structureDirectories.add(directory)
        return false
      },
      onProgress,
    )
    try {
      if (!settingsFound && structureDirectories.size === 0) {
        throw new Error(
          '未识别到受支持的 SillyTavern 备份结构。请选择酒馆备份 ZIP；普通资源压缩包请使用“导入本地资源 / 备份”。',
        )
      }
    } finally {
      await this.staging.deleteJob(job)
    }
  }

  async *tavernFiles(
    file: File,
    onProgress?: (progress: ArchiveStageProgress) => void,
  ): AsyncGenerator<File> {
    const paths: string[] = []
    let contentLogPath: string | undefined
    const structureDirectories = new Set<string>()
    let settingsFound = false
    const job = await stageArchive(
      file,
      this.staging,
      (path) => {
        if (isSettingsPath(path)) settingsFound = true
        const directory = path
          .toLowerCase()
          .split('/')
          .find((part) => TAVERN_NON_RESOURCE_DIRECTORIES.has(part))
        if (directory) structureDirectories.add(directory)
        const include = isResourcePath(path) || isSettingsPath(path)
        if (include) paths.push(path)
        const isContentLog = /(?:^|\/)content\.log$/iu.test(path)
        if (!contentLogPath && isContentLog) contentLogPath = path
        return include || isContentLog
      },
      onProgress,
    )
    try {
      if (!settingsFound && structureDirectories.size === 0) {
        throw new Error(
          '未识别到受支持的 SillyTavern 备份结构。请选择酒馆备份 ZIP；普通资源压缩包请使用“导入本地资源 / 备份”。',
        )
      }
      let seededPaths = new Set<string>()
      if (contentLogPath) {
        const contentLog = await this.staging.get(job, contentLogPath)
        if (contentLog) seededPaths = parseSillyTavernContentLog(await contentLog.blob.text())
      }
      for (const path of paths) {
        const entry = await this.staging.get(job, path)
        if (!entry) throw new Error('压缩包暂存文件不完整')
        const name = path.split('/').at(-1)!
        if (!/^settings\.json$/i.test(name) && isSillyTavernSeededPath(path, seededPaths)) continue
        if (
          !/^settings\.json$/i.test(name) &&
          (await isUnmodifiedSillyTavernDefault(path, entry.blob))
        ) {
          continue
        }
        if (/^settings\.json$/i.test(name)) {
          if (entry.size > 20 * 1024 * 1024) throw new Error('酒馆设置过大，请单独导出正则和美化')
          const settings: unknown = JSON.parse(await entry.blob.text())
          if (!isRecord(settings)) continue
          const extensions = isRecord(settings.extension_settings)
            ? settings.extension_settings
            : {}
          if (Array.isArray(extensions.regex) && extensions.regex.length)
            yield new File([JSON.stringify(extensions.regex)], '酒馆全局正则.json', {
              type: 'application/json',
            })
          const power = isRecord(settings.power_user) ? settings.power_user : {}
          if (typeof power.custom_css === 'string' && power.custom_css.trim())
            yield new File([power.custom_css], '酒馆自定义美化.css', { type: 'text/css' })
          if (
            isRecord(power.personas) &&
            isRecord(power.persona_descriptions) &&
            Object.keys(power.personas).length
          )
            yield new File(
              [
                JSON.stringify({
                  personas: power.personas,
                  persona_descriptions: power.persona_descriptions,
                  default_persona: power.default_persona,
                }),
              ],
              '酒馆用户人设.json',
              { type: 'application/json' },
            )
          // Do not persist the complete settings object: it may contain credentials.
          continue
        }
        yield new File([entry.blob], name, { type: fileMimeType(name) })
      }
    } finally {
      await this.staging.deleteJob(job)
    }
  }
}
