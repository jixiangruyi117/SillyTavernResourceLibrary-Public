import buildInfo from '../../build-info.json'

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

export const BUILD_INFO: Readonly<SrlBuildInfo> = Object.freeze(buildInfo)
