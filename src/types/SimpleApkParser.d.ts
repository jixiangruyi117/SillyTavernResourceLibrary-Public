declare module 'simple-apk-parser' {
  export function createBrowserParser(options?: {
    inflateRaw?: (bytes: Uint8Array) => Promise<Uint8Array>
  }): {
    parseApkFile(file: Blob): Promise<{ iconBlob: Blob | null }>
  }
}
