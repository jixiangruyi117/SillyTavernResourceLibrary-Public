export interface SrlBuildInfo {
  webVersion: string
  androidVersionName: string
  androidVersionCode: number
  buildId: string
  workerDeployVersion: string
  databaseVersion: number
  bridgeProtocolVersion: number
  nativeApiVersion: number
}

declare global {
  var __SRL_BUILD_INFO__: SrlBuildInfo | undefined
}

// Runtime build metadata is injected by Vite into index.html. Keeping it out of
// this shared module prevents a worker version bump from changing every APP chunk.
const fallbackBuildInfo: SrlBuildInfo = {
  webVersion: '0.0.0',
  androidVersionName: '0.0.0',
  androidVersionCode: 0,
  buildId: 'srl-dev-v0',
  workerDeployVersion: 'v0',
  databaseVersion: 25,
  bridgeProtocolVersion: 2,
  nativeApiVersion: 1,
}

export const BUILD_INFO: Readonly<SrlBuildInfo> = Object.freeze(
  globalThis.__SRL_BUILD_INFO__ ?? fallbackBuildInfo,
)
