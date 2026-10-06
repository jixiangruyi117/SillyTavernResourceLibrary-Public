// SRL-PUBLIC-SYNC: BEGIN REPLACE id=public-apk-update-service
import { Capacitor } from '@capacitor/core'

export function isAndroidApk(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function checkForAndroidAppUpdate(): Promise<string> {
  return 'Public 自部署版不连接官版更新服务；请同步仓库代码后自行构建安装。'
}

export function installAndroidAppUpdateChecks(): void {}
// SRL-PUBLIC-SYNC: END REPLACE id=public-apk-update-service
