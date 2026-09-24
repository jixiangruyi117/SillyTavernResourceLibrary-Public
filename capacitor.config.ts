import type { CapacitorConfig } from '@capacitor/cli'

const liveServerUrl = process.env.CAPACITOR_SERVER_URL?.trim()

const config: CapacitorConfig = {
  appId: 'buzz.jixiangruyi1207.srl',
  appName: 'SRL 酒馆资源库',
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
    : { androidScheme: 'https' },
}

export default config
