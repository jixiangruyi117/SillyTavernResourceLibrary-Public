import { appDatabase } from '../core/AppDatabaseInstance'
import { hashBlob } from '../services/HashService'

export interface TavernDirectoryEntry {
  name: string
  directory: boolean
}
export interface TavernDirectoryStorage {
  name: string
  list(path: string): Promise<TavernDirectoryEntry[]>
  read(path: string): Promise<File | null>
  write(path: string, blob: Blob, expectedHash: string | null): Promise<void>
}

const HANDLE_KEY = 'tavern-directory-handle'
type Directory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

/** Only inspect the selected folder, data/, and their immediate user folders. */
export async function locateTavernUserDirectory(root: Directory): Promise<Directory> {
  async function isUser(dir: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      await dir.getFileHandle('settings.json')
      await dir.getDirectoryHandle('characters')
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false
      throw error
    }
  }
  if (await isUser(root)) return root
  let data = root
  try {
    data = (await root.getDirectoryHandle('data')) as Directory
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
  const candidates: Directory[] = []
  let inspected = 0
  for await (const entry of data.values()) {
    if (entry.kind !== 'directory' || entry.name.startsWith('.')) continue
    if (++inspected > 100) throw new Error('这个目录范围太大，请进入 SillyTavern/data 后重选')
    const dir = (await data.getDirectoryHandle(entry.name)) as Directory
    if (await isUser(dir)) candidates.push(dir)
  }
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length > 1)
    throw new Error(
      `找到多个酒馆用户：${candidates.map((dir) => dir.name).join('、')}。请进入其中一个目录后重新选择，避免写错用户。`,
    )
  throw new Error(
    '没有找到酒馆用户目录。请选择 SillyTavern/data/default-user，或同时含 settings.json 与 characters 的用户文件夹。',
  )
}

export function directoryParts(path: string): string[] {
  const parts = path.split('/')
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.includes('\\') ||
        [...part].some((char) => char.charCodeAt(0) < 32),
    )
  ) {
    throw new Error('酒馆资源路径无效')
  }
  return parts
}

export function assertTavernPath(path: string): void {
  let parts = directoryParts(path)
  if (parts[0] === '.srl-backups') {
    if (!/^[a-f0-9-]{36}$/iu.test(parts[1] || '')) throw new Error('恢复副本路径无效')
    parts = parts.slice(2)
  }
  const folders = [
    'characters',
    'worlds',
    'OpenAI Settings',
    'TextGen Settings',
    'NovelAI Settings',
    'KoboldAI Settings',
    'themes',
    'QuickReplies',
    'User Avatars',
  ]
  if (
    !(parts.length === 1 && (parts[0] === 'settings.json' || folders.includes(parts[0]!))) &&
    !(parts.length === 2 && folders.includes(parts[0]!))
  )
    throw new Error('路径不属于支持的酒馆资源目录')
}

export class BrowserTavernDirectory implements TavernDirectoryStorage {
  private readonly root: Directory
  constructor(root: Directory) {
    this.root = root
  }
  get name(): string {
    return this.root.name
  }
  async remember(): Promise<void> {
    await appDatabase.settings.put({ id: HANDLE_KEY, value: this.root, updatedAt: Date.now() })
  }

  private async parent(path: string, create = false): Promise<[FileSystemDirectoryHandle, string]> {
    assertTavernPath(path)
    const parts = directoryParts(path)
    const name = parts.pop()!
    let dir: FileSystemDirectoryHandle = this.root
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
    return [dir, name]
  }

  async list(path: string): Promise<TavernDirectoryEntry[]> {
    if (path) assertTavernPath(path)
    let dir: Directory = this.root
    try {
      if (path)
        for (const part of directoryParts(path))
          dir = (await dir.getDirectoryHandle(part)) as Directory
      const result: TavernDirectoryEntry[] = []
      for await (const entry of dir.values())
        result.push({ name: entry.name, directory: entry.kind === 'directory' })
      return result
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return []
      throw error
    }
  }

  async read(path: string): Promise<File | null> {
    try {
      const [dir, name] = await this.parent(path)
      return await (await dir.getFileHandle(name)).getFile()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null
      throw error
    }
  }

  async write(path: string, blob: Blob, expectedHash: string | null): Promise<void> {
    const previous = await this.read(path)
    if ((previous ? await hashBlob(previous) : null) !== expectedHash) {
      throw new Error('酒馆文件已变化，请重新读取后再写入')
    }
    const [dir, name] = await this.parent(path, true)
    const file = await dir.getFileHandle(name, { create: true })
    const output = await file.createWritable()
    try {
      await blob.stream().pipeTo(output)
    } catch (error) {
      await output.abort().catch(() => undefined)
      throw error
    }
    const saved = await file.getFile()
    if (saved.size !== blob.size || (await hashBlob(saved)) !== (await hashBlob(blob))) {
      throw new Error('写入后校验失败，请从酒馆目录的 .srl-backups 恢复原件')
    }
  }
}

export function supportsBrowserTavernDirectory(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function chooseBrowserTavernDirectory(reuse = true): Promise<BrowserTavernDirectory> {
  let handle = reuse
    ? ((await appDatabase.settings.get(HANDLE_KEY))?.value as Directory | undefined)
    : undefined
  if (handle && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted')
    handle = undefined
  if (!handle) {
    const picker = (
      window as unknown as { showDirectoryPicker(options: object): Promise<Directory> }
    ).showDirectoryPicker
    handle = await picker({ id: 'srl-tavern', mode: 'readwrite' })
    handle = await locateTavernUserDirectory(handle)
  }
  return new BrowserTavernDirectory(handle)
}
