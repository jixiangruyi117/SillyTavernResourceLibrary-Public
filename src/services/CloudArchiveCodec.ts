import { hashBlob } from './HashService'

export async function hashCloudBlob(blob: Blob): Promise<string> {
  return hashBlob(blob)
}

export function addTransportHash(fileName: string, hash: string): string {
  const marker = `--sha256-${hash.slice(0, 16)}`
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex > 0
    ? `${fileName.slice(0, extensionIndex)}${marker}${fileName.slice(extensionIndex)}`
    : `${fileName}${marker}`
}

export function readTransportHash(fileName: string): string | undefined {
  return /--sha256-([a-f0-9]{16})(?:\.|$)/i.exec(fileName)?.[1]?.toLowerCase()
}
