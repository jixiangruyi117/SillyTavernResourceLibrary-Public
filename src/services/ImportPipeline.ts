import { hashFile } from './HashService'

export type ImportPipelineStage =
  | 'intake'
  | 'staging'
  | 'validate'
  | 'parse'
  | 'hash'
  | 'match'
  | 'extract'
  | 'confirm'
  | 'commit'
  | 'event'

export interface ImportFileContextSnapshot {
  name: string
  size: number
  mimeType: string
  completed: ImportPipelineStage[]
}

/** One file reference plus memoized task products; it never caches the complete file as ArrayBuffer. */
export class ImportFileContext<TParsed = unknown> {
  readonly file: File
  private hashPromise?: Promise<string>
  private parsedPromise?: Promise<TParsed>
  private readonly completed = new Set<ImportPipelineStage>(['intake'])
  private readonly products = new Map<string, unknown>()

  constructor(file: File) {
    this.file = file
    this.completed.add('staging')
    this.validate()
  }

  private validate(): void {
    if (!this.file.name.trim()) throw new Error('导入文件缺少文件名')
    if (this.file.size <= 0) throw new Error(`${this.file.name} 是空文件`)
    this.completed.add('validate')
  }

  hash(): Promise<string> {
    this.hashPromise ??= hashFile(this.file).then((value) => {
      this.completed.add('hash')
      return value
    })
    return this.hashPromise
  }

  parse(parser: (file: File) => Promise<TParsed>): Promise<TParsed> {
    this.parsedPromise ??= parser(this.file).then((value) => {
      this.completed.add('parse')
      return value
    })
    return this.parsedPromise
  }

  remember<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.products.get(key) as Promise<T> | undefined
    if (existing) return existing
    const pending = factory()
    this.products.set(key, pending)
    return pending
  }

  mark(stage: ImportPipelineStage): void {
    this.completed.add(stage)
  }

  snapshot(): ImportFileContextSnapshot {
    return {
      name: this.file.name,
      size: this.file.size,
      mimeType: this.file.type || 'application/octet-stream',
      completed: Array.from(this.completed),
    }
  }
}

export class ImportPipeline {
  intake<TParsed = unknown>(file: File): ImportFileContext<TParsed> {
    return new ImportFileContext<TParsed>(file)
  }
}

export const importPipeline = new ImportPipeline()
