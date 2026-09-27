import { Capacitor, registerPlugin } from '@capacitor/core'
import { transferNativeStream } from '../core/NativeStreamTransfer'

export interface ArchiveTaskSummary {
  id: string
  kind: 'restore' | 'export'
  name: string
  phase: string
  updatedAt: number
}

export interface ArchiveTaskRecord extends ArchiveTaskSummary {
  version: 1
  payload: unknown
}

interface ArchiveTasksPlugin {
  beginArchiveSource(options: { id: string }): Promise<void>
  appendArchiveSource(options: { id: string; offset: number; data: string }): Promise<void>
  finishArchiveSource(options: { id: string; hash: string; size: number }): Promise<{ uri: string }>
  saveArchiveTask(options: { task: ArchiveTaskRecord }): Promise<void>
  readArchiveTask(options: { id: string }): Promise<{ task?: ArchiveTaskRecord }>
  listArchiveTasks(): Promise<{ tasks: ArchiveTaskSummary[] }>
  deleteArchiveTask(options: { id: string }): Promise<void>
}

const plugin = registerPlugin<ArchiveTasksPlugin>('NativeArchive')

/** Native private files, encrypted by the existing Android Keystore owner. */
export class NativeArchiveTaskStore {
  async retainSource(id: string, file: File, hash: string): Promise<string> {
    await plugin.beginArchiveSource({ id })
    let offset = 0
    await transferNativeStream(file, {
      append: async (data) => {
        await plugin.appendArchiveSource({ id, offset, data })
        offset +=
          Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
      },
    })
    return (await plugin.finishArchiveSource({ id, size: file.size, hash })).uri
  }

  async recoverSource(id: string, size: number, hash: string): Promise<string> {
    return (await plugin.finishArchiveSource({ id, size, hash })).uri
  }
  async list(): Promise<ArchiveTaskSummary[]> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return []
    try {
      return (await plugin.listArchiveTasks()).tasks
    } catch (error) {
      if ((error as { code?: string }).code === 'UNIMPLEMENTED') return []
      throw error
    }
  }

  async save(task: ArchiveTaskRecord): Promise<void> {
    await plugin.saveArchiveTask({ task: { ...task, updatedAt: Date.now() } })
  }

  async read(id: string): Promise<ArchiveTaskRecord | undefined> {
    const task = (await plugin.readArchiveTask({ id })).task
    if (task && (task.version !== 1 || task.id !== id)) throw new Error('无法读取此版本的恢复任务')
    return task
  }

  async remove(id: string): Promise<void> {
    await plugin.deleteArchiveTask({ id })
  }
}
