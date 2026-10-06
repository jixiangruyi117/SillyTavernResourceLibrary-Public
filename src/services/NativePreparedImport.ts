import type { ParsedResource } from '../types/Import'

export interface NativePreparedImport {
  parsed: ParsedResource
}

const preparedImports = new WeakMap<File, NativePreparedImport>()

export function setNativePreparedImport(file: File, prepared: NativePreparedImport): void {
  preparedImports.set(file, prepared)
}

export function getNativePreparedImport(file: File): NativePreparedImport | undefined {
  return preparedImports.get(file)
}
