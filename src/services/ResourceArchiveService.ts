import { stageArchive } from './ArchiveExtraction'
import type { RestoreStagingStore } from '../storage/RestoreStagingStore'
import { isRecord } from '../utils/UnknownValue'
import { isUnmodifiedSillyTavernDefault } from './SillyTavernDefaultContent'

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

const TAVERN_STRUCTURE_DIRECTORIES = new Set([
  ...TAVERN_RESOURCE_DIRECTORIES,
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

function isTavernStructurePath(path: string): boolean {
  const parts = path.toLowerCase().split('/')
  return isSettingsPath(path) || parts.some((part) => TAVERN_STRUCTURE_DIRECTORIES.has(part))
}

/** Uses the restore staging owner; files are decoded in bounded chunks and read one at a time. */
export class ResourceArchiveService {
  private readonly staging: RestoreStagingStore
  constructor(staging: RestoreStagingStore) {
    this.staging = staging
  }

  async inspect(file: File): Promise<'library' | 'personal' | 'tavern'> {
    let tavern = false
    const job = await stageArchive(file, this.staging, (path) => {
      tavern ||= isResourcePath(path) || isSettingsPath(path)
      return path === 'manifest.json' || path === 'srl-resource.json'
    })
    try {
      const personal = await this.staging.get(job, 'srl-resource.json')
      if (personal) return 'personal'
      const manifest = await this.staging.get(job, 'manifest.json')
      if (manifest && manifest.size < 32 * 1024 * 1024) {
        const value: unknown = JSON.parse(await manifest.blob.text())
        if (isRecord(value) && value.format === 'srl-archive') return 'library'
      }
      if (tavern) return 'tavern'
      throw new Error('未识别到资源库备份或酒馆资源目录；请检查压缩包内容')
    } finally {
      await this.staging.deleteJob(job)
    }
  }

  async validateTavernBackup(file: File): Promise<void> {
    let structureHits = 0
    let settingsFound = false
    const job = await stageArchive(file, this.staging, (path) => {
      if (isSettingsPath(path)) settingsFound = true
      if (isTavernStructurePath(path)) structureHits++
      return false
    })
    try {
      if (!settingsFound && structureHits < 2) {
        throw new Error(
          '未识别到受支持的 SillyTavern 备份结构。请选择酒馆备份 ZIP；普通资源压缩包请使用“导入本地资源 / 备份”。',
        )
      }
    } finally {
      await this.staging.deleteJob(job)
    }
  }

  async *tavernFiles(file: File): AsyncGenerator<File> {
    await this.validateTavernBackup(file)
    const paths: string[] = []
    const job = await stageArchive(file, this.staging, (path) => {
      const include = isResourcePath(path) || isSettingsPath(path)
      if (include) paths.push(path)
      return include
    })
    try {
      for (const path of paths) {
        const entry = await this.staging.get(job, path)
        if (!entry) throw new Error('压缩包暂存文件不完整')
        const name = path.split('/').at(-1)!
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
        yield new File([entry.blob], name, {
          type: /\.json$/i.test(name)
            ? 'application/json'
            : /\.png$/i.test(name)
              ? 'image/png'
              : /\.css$/i.test(name)
                ? 'text/css'
                : 'text/plain',
        })
      }
    } finally {
      await this.staging.deleteJob(job)
    }
  }
}
