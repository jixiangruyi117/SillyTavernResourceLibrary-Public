/**
 * 互传组件安装配置：仓库地址、安装命令与版本号统一在这里维护，
 * 界面与提示文案一律引用常量，不散落硬编码。
 */

/** 所有既有互传能力所需的最低页面扩展版本。 */
export const BRIDGE_EXTENSION_VERSION = '0.3.20'

/** 当前离线安装包版本，与最低兼容版本分开维护。 */
export const BRIDGE_DOWNLOAD_VERSION = '0.3.35'

/** 仅 APK 同机本机直传所需的页面扩展版本，不影响网页和旧设备码传输。 */
export const LOCAL_DIRECT_BRIDGE_EXTENSION_VERSION = '0.3.22'

/** 页面扩展 Git 仓库（酒馆「安装扩展」直接粘贴此链接）。 */
export const BRIDGE_REPO_URL = 'https://github.com/jixiangruyi117/SillyTavern-SRL-Bridge'

/** 安装成功后酒馆扩展列表中显示的名称（来自 manifest.json display_name）。 */
export const BRIDGE_EXTENSION_NAME = 'SRL 酒馆互传'

const BRIDGE_RAW_REPO_URL = BRIDGE_REPO_URL.replace(
  'https://github.com/',
  'https://raw.githubusercontent.com/',
)

/** 服务端插件一键安装命令（在 SillyTavern 主机上执行）。 */
export const BRIDGE_SERVER_PLUGIN_INSTALL_COMMAND = `bash <(curl -fsSL ${BRIDGE_RAW_REPO_URL}/main/scripts/install-server-plugin.sh)`

/** 一键脚本源码地址，供用户先阅读再执行。 */
export const BRIDGE_SERVER_PLUGIN_SCRIPT_URL = `${BRIDGE_REPO_URL}/blob/main/scripts/install-server-plugin.sh`

function versionParts(version: string): number[] {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i)
  return match ? match.slice(1).map(Number) : []
}

/** 握手版本低于资源库要求时返回 true；无法识别的版本按过旧处理。 */
export function isBridgeExtensionOutdated(
  actualVersion: string,
  requiredVersion = BRIDGE_EXTENSION_VERSION,
): boolean {
  const actual = versionParts(actualVersion)
  const required = versionParts(requiredVersion)
  if (actual.length !== 3 || required.length !== 3) return true
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] !== required[index]) return actual[index] < required[index]
  }
  return false
}
