/* global document, navigator, window */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { URL } from 'node:url'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { auditEnvironment, launchAuditBrowser } from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'discord-handoff')
const token = 'a'.repeat(43)
const bundle = await build({
  entryPoints: ['workers/discord-source-bridge/src/index.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
})
const { default: worker } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
)
const server = createServer(async (request, response) => {
  try {
    const rendered = await worker.fetch(
      new globalThis.Request(new URL(request.url, environment.baseUrl)),
      {},
      {},
    )
    response.writeHead(rendered.status, Object.fromEntries(rendered.headers))
    response.end(await rendered.text())
  } catch (error) {
    response.writeHead(500)
    response.end(error.message)
  }
})
await new Promise((accept, reject) => {
  server.once('error', reject)
  server.listen(Number(new URL(environment.baseUrl).port), '127.0.0.1', accept)
})
await mkdir(environment.outputDir, { recursive: true })
let browser
try {
  browser = await launchAuditBrowser(environment)
  for (const width of [320, 390, 768, 1280])
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        colorScheme,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      let state = 'pending'
      let reads = 0
      await page.route('**/handoff/*/status', (route) => {
        reads++
        return route.fulfill({ json: { state, libraryName: '我的资源库' } })
      })
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value) => {
              window.copiedLink = value
            },
          },
        })
      })
      await page.goto(`${environment.baseUrl}/open/${token}`)
      await page.getByRole('status').filter({ hasText: '等待资源库保存' }).waitFor()
      const measure = async () => {
        const bounds = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll('.action,.refresh')].map((element) => {
            const rect = element.getBoundingClientRect()
            return { left: rect.left, right: rect.right, height: rect.height }
          }),
        }))
        assert.ok(bounds.scroll <= bounds.width, JSON.stringify(bounds))
        for (const control of bounds.controls) {
          assert.ok(control.left >= 0 && control.right <= width)
          assert.ok(control.height >= 44)
        }
      }
      await measure()
      const href = await page.locator('#open-native').getAttribute('href')
      const native = new URL(href)
      assert.equal(native.protocol, 'srl:')
      assert.equal(native.searchParams.get('token'), token)
      assert.equal(native.searchParams.get('worker'), environment.baseUrl)
      await page.screenshot({
        path: resolve(environment.outputDir, `${width}-${colorScheme}.png`),
        fullPage: true,
      })
      for (const [next, heading] of [
        ['saved', '帖子已保存'],
        ['waiting_binding', '等待关联资源'],
        ['expired', '链接已过期'],
      ]) {
        state = next
        await page.getByRole('button', { name: '刷新接收进度' }).tap()
        await page.getByRole('heading', { name: heading, exact: true }).waitFor()
        await measure()
      }
      assert.equal(reads, 4)
      await page.getByRole('button', { name: '复制领取链接', exact: true }).tap()
      await page.getByRole('status').filter({ hasText: '已复制' }).waitFor()
      assert.equal(
        await page.evaluate(() => window.copiedLink),
        `${environment.baseUrl}/open/${token}`,
      )
      // Platform clipboard failure fixture; the button is still operated with a real touch.
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new Error('clipboard unavailable')
        }
        document.execCommand = () => false
      })
      await page.getByRole('button', { name: '复制领取链接', exact: true }).tap()
      await page.getByRole('textbox', { name: '临时领取链接' }).waitFor()
      await measure()
      await page.route('**/handoff/*/status', (route) => route.abort())
      await page.getByRole('button', { name: '刷新接收进度' }).tap()
      await page.getByRole('status').filter({ hasText: '暂时无法读取状态' }).waitFor()
      assert.equal(await page.getByRole('button', { name: '刷新接收进度' }).isEnabled(), true)
      assert.deepEqual(errors, [])
      await context.close()
      console.log(
        `通过 ${environment.engine} ${width}px ${colorScheme}：无溢出、真实触控、状态与复制回退；原生链接仅校验参数`,
      )
    }
} finally {
  await browser?.close()
  await new Promise((accept) => server.close(accept))
}
