/* global document, localStorage, window */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { URL } from 'node:url'
import { chromium, webkit } from 'playwright-core'

export function auditEnvironment(env = process.env, suite = 'browser') {
  const base = new URL(env.SRL_PREVIEW_URL || env.SRL_AUDIT_BASE_URL || 'http://127.0.0.1:5173')
  const mode = env.SRL_AUDIT_MODE || 'fixture'
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/')
    throw new Error('本地审计只接受 http://127.0.0.1:<端口>/；线上回读请使用发布验证脚本')
  if (!['fixture', 'auth'].includes(mode)) throw new Error(`未知认证测试模式：${mode}`)
  const run = env.SRL_AUDIT_RUN || `local-${suite}`
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(run)) throw new Error('无效的测试运行名称')
  if (mode === 'auth' && !env.SRL_AUDIT_STORAGE_STATE)
    throw new Error('认证联调需要独立测试账号的 SRL_AUDIT_STORAGE_STATE；功能测试使用 fixture')
  const engine = env.SRL_AUDIT_ENGINE || 'chromium'
  if (!['chromium', 'webkit'].includes(engine)) throw new Error(`未知浏览器引擎：${engine}`)
  const fixtureTransport = env.SRL_AUDIT_FIXTURE_TRANSPORT || 'browser'
  if (!['browser', 'http'].includes(fixtureTransport)) throw new Error('无效的认证夹具传输方式')
  return {
    baseUrl: base.origin,
    mode,
    run,
    engine,
    fixtureTransport,
    outputDir: resolve(env.SRL_AUDIT_OUTPUT_DIR || `.codex-tmp/${run}/results/${suite}`),
    storageState: mode === 'auth' ? env.SRL_AUDIT_STORAGE_STATE : undefined,
  }
}

export function auditBrowserOptions(env = process.env, engine = 'chromium') {
  const explicit = env.SRL_AUDIT_BROWSER || env.EDGE_PATH
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const executablePath =
    engine === 'chromium'
      ? explicit || (process.platform === 'win32' && existsSync(edge) ? edge : undefined)
      : undefined
  return { headless: true, ...(executablePath ? { executablePath } : {}) }
}

export async function launchAuditBrowser(environment = auditEnvironment(), options = {}) {
  const browser = await { chromium, webkit }[environment.engine].launch({
    ...auditBrowserOptions(process.env, environment.engine),
    ...options,
  })
  // Only this script's browser is closed when its owning runner is interrupted.
  const stop = () => void browser.close().finally(() => process.exit(130))
  process.once('SIGTERM', stop)
  browser.on('disconnected', () => process.removeListener('SIGTERM', stop))
  return browser
}

let networkRequestId = 0
export async function setAuditOffline(context, environment, offline) {
  if (environment.engine !== 'webkit') return context.setOffline(offline)
  // Playwright #42775: WebKit's offline emulation also rejects responses served solely by SW.
  // Block this run's real HTTP origin instead, retaining the actual worker/cache path.
  if (process.env.SRL_AUDIT_NETWORK_CONTROL !== 'ipc' || !process.send)
    throw new Error('WebKit 离线验收必须通过 audit:isolated 控制本次测试服务')
  const id = ++networkRequestId
  await new Promise((accept, reject) => {
    const receive = (message) => {
      if (message?.type !== 'srl-audit-network-ready' || message.id !== id) return
      process.removeListener('message', receive)
      accept()
    }
    process.on('message', receive)
    process.send({ type: 'srl-audit-network', id, offline }, (error) => {
      if (!error) return
      process.removeListener('message', receive)
      reject(error)
    })
  })
  if (offline) {
    let unavailable = false
    try {
      await context.request.get(
        `${environment.baseUrl}/assets/srl-audit-network-probe-${environment.run}.js`,
      )
    } catch {
      unavailable = true
    }
    if (!unavailable) throw new Error('未缓存网络探针仍可访问，不能声明离线验收')
  }
}

export function isExpectedOfflineApiError(error, environment, offline) {
  if (!offline || environment.engine !== 'webkit') return false
  // These read-only background services catch unavailable-network errors in their owners.
  // WebKit additionally reports SW fetch rejections as page errors; assets and app exceptions fail.
  return ['/api/image-hosting/membership', '/api/feedback/notifications'].some((path) => {
    const url = environment.baseUrl + path
    return (
      (error.name === 'FetchEvent.respondWith received an error' &&
        error.message.includes(`"url":"${url}"`)) ||
      (error.name === 'Fetch API cannot load http' &&
        error.message === `/${new URL(url).host}${path}.`)
    )
  })
}

export function createAuditApiFixture(run) {
  let signedIn = true
  const session = {
    user: {
      id: run,
      username: run,
      role: 'user',
      authProvider: 'password',
      mustChangePassword: false,
      disabled: false,
    },
    deviceId: run,
  }
  return (path) => {
    if (path === '/api/auth/session')
      return { status: signedIn ? 200 : 401, json: signedIn ? session : {} }
    if (path === '/api/access-policy') return { json: { mode: 'required', accessAllowed: false } }
    if (path === '/api/auth/logout') {
      signedIn = false
      return { json: { ok: true } }
    }
    if (path === '/api/feedback/notifications') return { json: { count: 0 } }
    return { status: 404, json: { error: `未声明的测试接口：${path}` } }
  }
}

export async function prepareAuditContext(
  context,
  environment = auditEnvironment(),
  { trace = true } = {},
) {
  const noticeSource = readFileSync(resolve('src/services/BrowserStorageService.ts'), 'utf8')
  const noticeVersion = noticeSource.match(/PROJECT_NOTICE_VERSION\s*=\s*'([^']+)'/u)?.[1]
  if (!noticeVersion) throw new Error('无法读取当前项目说明版本')
  await context.addInitScript((version) => {
    if (window.top === window)
      localStorage.setItem('srl.projectNotice.acknowledgedVersion', version)
  }, noticeVersion)
  if (environment.mode !== 'fixture') return
  if (trace) await context.tracing?.start({ screenshots: true, snapshots: true, sources: false })
  // SW-owned fetches bypass browser routes. The isolated runner serves the same fixture over HTTP.
  if (environment.fixtureTransport !== 'http') {
    const fixture = createAuditApiFixture(environment.run)
    await context.route(`${environment.baseUrl}/api/**`, (route) =>
      route.fulfill(fixture(new URL(route.request().url()).pathname)),
    )
  }
  await context.routeWebSocket(
    `${environment.baseUrl.replace('http:', 'ws:')}/api/auth/presence`,
    (socket) => socket.onMessage(() => {}),
  )
}

export async function findAuditFeature(page, name) {
  await page.locator('.feature-desktop').waitFor({ state: 'visible' })
  const dots = page.getByRole('button', { name: /^第 \d+ 页应用$/u })
  const count = await dots.count()
  for (let index = 0; index < Math.max(1, count); index++) {
    if (count) {
      await dots.nth(index).click()
      await page.waitForFunction(
        (index) =>
          document
            .querySelectorAll('.feature-desktop__page-dot')
            .item(index)
            ?.getAttribute('aria-current') === 'page',
        index,
      )
    }
    const app = page.locator('.feature-app').filter({ hasText: name })
    if (await app.count()) {
      return app
    }
  }
  return null
}

export async function openAuditFeature(page, name) {
  const app = await findAuditFeature(page, name)
  if (!app) throw new Error(`当前桌面全部页面均没有 APP：${name}`)
  await app.click()
}

export async function saveAuditFailure(context, environment, error) {
  if (!context || environment.mode !== 'fixture') return
  await mkdir(environment.outputDir, { recursive: true })
  await writeFile(
    resolve(environment.outputDir, 'failure.json'),
    JSON.stringify({ message: error.message, stack: error.stack }, null, 2) + '\n',
  )
  for (const [index, page] of context.pages().entries())
    await page
      .screenshot({ path: resolve(environment.outputDir, `failure-${index}.png`) })
      .catch(() => {})
  await context.tracing
    ?.stop({ path: resolve(environment.outputDir, 'failure-trace.zip') })
    .catch(() => {})
}
