import type { CapacitorConfig } from '@capacitor/cli'

const liveServerUrl = process.env.CAPACITOR_SERVER_URL?.trim()
const publicOrigin = process.env.SRL_PUBLIC_ORIGIN?.trim()
const publicUrl = publicOrigin ? new URL(publicOrigin) : undefined
if (
  publicUrl &&
  (publicUrl.protocol !== 'https:' ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.port ||
    publicUrl.pathname !== '/' ||
    publicUrl.search ||
    publicUrl.hash)
) {
  throw new Error('SRL_PUBLIC_ORIGIN 必须是无端口、路径、凭据或查询参数的 HTTPS 站点来源')
}

const config: CapacitorConfig = {
  appId: 'app.srl.publicedition',
  appName: 'SRL_Pubilc',
  webDir: 'dist',
  backgroundColor: '#f3efe5',
  loggingBehavior: 'production',
  plugins: {
    CapacitorHttp: {
      // APK 内的请求交给系统网络栈，允许访问局域网 HTTP 酒馆并避开 WebDAV CORS。
      enabled: true,
    },
  },
  server: liveServerUrl
    ? {
        // 仅显式 Remote 调试时加载线上站点；正式 APK 默认使用 webDir 内置的本地 Vue 产物。
        url: liveServerUrl,
        cleartext: false,
      }
    : {
        // 首页仍由 APK 本地提供；可选功能包从部署者自己的同源站点下载。
        // 首次安装后保持此 hostname，避免覆盖升级切换 WebView 数据库来源。
        ...(publicUrl ? { hostname: publicUrl.hostname } : {}),
        androidScheme: 'https',
      },
}

export default config
