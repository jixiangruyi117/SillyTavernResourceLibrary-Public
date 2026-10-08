/* global window, document, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import console from 'node:console'
import { auditEnvironment, launchAuditBrowser, prepareAuditContext } from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'reader-startup')
const browser = await launchAuditBrowser(environment)
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
await prepareAuditContext(context, environment, { trace: false })
await mkdir(environment.outputDir, { recursive: true })
// Delay the actual SDK preferences response, and observe the existing readiness handoff.
await context.addInitScript(() => {
  if (window === window.top) {
    window.__readerHostPaints = []
    window.__readerPreparingPaints = []
    const sample = () => {
      const preparing = document.querySelector(
        '.chat-reader-startup, .external-app-host__workspace--starting',
      )
      if (preparing) {
        const paper = preparing.style.getPropertyValue('--reader-paper')
        const paints = window.__readerPreparingPaints
        if (paints.length < 128 && paints.at(-1) !== paper) paints.push(paper)
      }
      const workspace = document.querySelector('.external-app-host__workspace--builtin-reader')
      if (workspace && !workspace.classList.contains('external-app-host__workspace--starting')) {
        const value = {
          page: workspace.dataset.readerPage,
          paper: workspace.style.getPropertyValue('--reader-paper'),
          header: !!workspace.querySelector('[data-srl-feature-header]'),
        }
        const key = JSON.stringify(value)
        const paints = window.__readerHostPaints
        if (paints.length < 128 && JSON.stringify(paints.at(-1)) !== key) paints.push(value)
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    return
  }
  let api
  Object.defineProperty(window, 'srlApp', {
    configurable: true,
    get: () => api,
    set(value) {
      const audit = { waiting: false, navigation: [], handoffs: [] }
      window.__readerStartup = audit
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      audit.release = release
      api = {
        ...value,
        storage: {
          ...value.storage,
          async get(key) {
            if (key === 'preferences-v1') {
              audit.waiting = true
              await gate
            }
            return value.storage.get(key)
          },
        },
        ui: {
          ...value.ui,
          setReaderNavigation(state) {
            audit.navigation.push(state.page)
            return value.ui.setReaderNavigation(state)
          },
          setLoading(label) {
            if (!label)
              audit.handoffs.push({
                starting: document.documentElement.hasAttribute('data-reader-starting'),
                font: document.documentElement.style.getPropertyValue('--font'),
                leading: document.documentElement.style.getPropertyValue('--leading'),
                paper: document.documentElement.style.getPropertyValue('--paper'),
                topbar: getComputedStyle(document.querySelector('.topbar')).display,
                library: !document.querySelector('#library').hidden,
                reader: !document.querySelector('#reader').hidden,
                floor: document
                  .querySelector('#readingFlow')
                  .shadowRoot.querySelector('[data-floor]')?.dataset.floor,
              })
            return value.ui.setLoading(label)
          },
        },
      }
    },
  })
})
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const app = page.frameLocator('.external-app-host__frame')
const open = async (screenshot, expectedStartupPaper) => {
  await page.evaluate(() => {
    window.__readerHostPaints = []
    window.__readerPreparingPaints = []
  })
  await page.locator('.feature-app--reader').tap()
  const frame = await (
    await page.locator('.external-app-host__frame').elementHandle()
  ).contentFrame()
  await frame.waitForFunction(() => window.__readerStartup?.waiting)
  const workspace = page.locator('.external-app-host__workspace--builtin-reader')
  assert.equal(await workspace.getAttribute('aria-busy'), 'true')
  if (expectedStartupPaper) {
    assert.equal(
      await workspace.evaluate((el) => el.style.getPropertyValue('--reader-paper')),
      expectedStartupPaper,
    )
    const paints = await page.evaluate(() => window.__readerPreparingPaints)
    assert.ok(paints.length)
    assert.ok(paints.every((paper) => paper === expectedStartupPaper))
  }
  assert.equal(
    await page.locator('.external-app-host__frame').evaluate((el) => getComputedStyle(el).opacity),
    '0',
  )
  assert.equal(
    await app.locator('body').evaluate((el) => getComputedStyle(el).visibility),
    'hidden',
  )
  assert.equal(await app.locator('.topbar').evaluate((el) => getComputedStyle(el).display), 'none')
  if (screenshot)
    await page.screenshot({ path: resolve(environment.outputDir, screenshot + '-preparing.png') })
  await frame.evaluate(() => window.__readerStartup.release())
  await workspace.locator('.external-app-host__frame:not([inert])').waitFor()
  await frame.waitForFunction(() => window.__readerStartup.handoffs.length === 1)
  return frame
}
const appearance = async () => {
  if (await app.locator('#reader').evaluate((el) => el.classList.contains('reader-hide')))
    await app.locator('#readerMenu').tap()
  await app.locator('#reader.reader-show').waitFor()
  await app.locator('[data-panel="appearance"]').tap()
}
const swipeUp = async () => {
  const rect = await app.locator('#readingViewport').boundingBox()
  const frame = await (
    await page.locator('.external-app-host__frame').elementHandle()
  ).contentFrame()
  await frame.evaluate(() => {
    window.__readerScrollEnded = new Promise((resolve) =>
      document
        .querySelector('#readingViewport')
        .addEventListener('scrollend', resolve, { once: true }),
    )
  })
  const touch = await context.newCDPSession(page)
  const x = rect.x + rect.width / 2,
    y = rect.y + Math.min(rect.height - 60, 350)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 8; step++)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - (220 * step) / 8 }],
    })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await touch.detach()
  // A tap during inertial scrolling stops the fling instead of activating the menu.
  await frame.evaluate(() => window.__readerScrollEnded)
}
try {
  await page.addLocatorHandler(
    page.locator('#srl-update-notice').getByRole('button', { name: '稍后', exact: true }),
    (el) => el.tap(),
  )
  await page.goto(environment.baseUrl)
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '启动验收角色',
      description: '隔离夹具',
      first_mes: '你好',
      personality: '',
      scenario: '',
      mes_example: '',
      extensions: {},
    },
  }
  const rows = Array.from({ length: 12 }, (_, i) => ({
    name: '启动验收角色',
    is_user: false,
    mes: `第${i + 1}楼\n` + '用于首次排版和真实触控滚动验证。\n\n'.repeat(120),
  }))
  await page.getByLabel('选择单个资源文件，可多选').setInputFiles([
    {
      name: '启动验收角色.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(card)),
    },
    {
      name: '启动验收聊天.jsonl',
      mimeType: 'application/x-ndjson',
      buffer: Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n')),
    },
  ])
  await page.getByText('启动验收角色', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '功能', exact: true }).tap()
  await page.getByRole('button', { name: 'APP 管理', exact: true }).tap()
  const manager = page.locator('.official-app-manager li').filter({ hasText: '读了么' })
  await manager.getByRole('button', { name: '下载', exact: true }).tap()
  await manager.getByText(/已安装/).waitFor()
  await page.getByRole('button', { name: '返回功能桌面', exact: true }).tap()
  await page.addLocatorHandler(
    page.getByRole('button', { name: '以后允许此权限', exact: true }),
    (el) => el.tap(),
  )
  const first = await open(undefined, '#f6f3ec')
  assert.deepEqual(await first.evaluate(() => window.__readerStartup.navigation), ['roles'])
  await app.locator('[data-role="unbound"]').tap()
  await app.locator('[data-chat]').tap()
  await app
    .locator('#bindSelect')
    .selectOption({ label: await app.locator('#bindSelect option').nth(1).innerText() })
  await app.locator('#bindConfirm').tap()
  await app.locator('#toast').filter({ hasText: '角色绑定已保存到资源库' }).waitFor()
  await page.getByRole('button', { name: '返回角色列表', exact: true }).tap()
  await app.locator('[data-role]').first().tap()
  await app.locator('[data-chat]').tap()
  await app.locator('#readerSubtitle').filter({ hasText: '启动验收角色' }).waitFor()
  await appearance()
  await app.locator('#appearanceScope').selectOption('character')
  await app.locator('#fontPlus').tap()
  await app.locator('#fontValue').filter({ hasText: '19px' }).waitFor()
  await app.locator('#sheetClose').tap()
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
  ]) {
    for (const theme of ['paper', 'night']) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: theme === 'night' ? 'dark' : 'light' })
      await appearance()
      await app.locator(`[data-theme="${theme}"]`).tap()
      await app.locator(`[data-theme="${theme}"].active`).waitFor()
      await app.locator('#sheetClose').tap()
      await app.locator('[data-panel="progress"]').tap()
      await app.locator('#floorNumber').fill('8')
      await app.locator('#jump').tap()
      await app.locator('[data-floor="7"]').waitFor()
      await page.reload()
      await page.getByRole('button', { name: '功能', exact: true }).tap()
      const frame = await open(`startup-${width}-${theme}`)
      const audit = await frame.evaluate(() => window.__readerStartup)
      assert.deepEqual(audit.navigation, ['reader', 'reader'])
      assert.equal(audit.handoffs[0].starting, false)
      assert.equal(audit.handoffs[0].topbar, 'none')
      assert.equal(audit.handoffs[0].library, false)
      assert.equal(audit.handoffs[0].reader, true)
      assert.equal(audit.handoffs[0].floor, '7')
      assert.equal(audit.handoffs[0].font, '19px')
      const paper = audit.handoffs[0].paper
      assert.equal(
        await page
          .locator('.external-app-host__workspace')
          .evaluate((el) => el.style.getPropertyValue('--reader-paper')),
        paper,
      )
      const before = await app.locator('#readingViewport').evaluate((el) => el.scrollTop)
      await swipeUp()
      await frame.waitForFunction(
        (before) => document.querySelector('#readingViewport').scrollTop > before,
        before,
      )
      const paints = await page.evaluate(() => window.__readerHostPaints)
      assert.ok(paints.length)
      assert.ok(
        paints.every((paint) => paint.page === 'reader' && !paint.header && paint.paper === paper),
      )
      assert.ok(await app.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth + 1))
      await page.screenshot({
        path: resolve(environment.outputDir, `startup-${width}-${theme}-ready.png`),
      })
    }
  }
  await appearance()
  await app.locator('#appearanceScope').selectOption('default')
  await app.locator('[data-theme="night"]').tap()
  await app.locator('#sheetClose').tap()
  await app.locator('#readerBack').tap()
  await page.getByRole('button', { name: '返回角色列表', exact: true }).tap()
  await page.getByRole('button', { name: '返回功能桌面', exact: true }).tap()
  const reentry = await open(undefined, '#202622')
  assert.deepEqual(await reentry.evaluate(() => window.__readerStartup.navigation), ['roles'])
  assert.deepEqual(errors, [])
  console.log(
    'PASS continuous paper during preparation and night reentry, first visible final theme/header/font, direct floor restoration and touch scrolling at four widths in both themes',
  )
} catch (error) {
  await page.screenshot({ path: resolve(environment.outputDir, 'failure.png') })
  throw error
} finally {
  await context.close()
  await browser.close()
}
