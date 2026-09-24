/* global document, getComputedStyle, localStorage, navigator, window */
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { chromium, webkit } from 'playwright-core'

const PROJECT_ROOT = process.cwd()
const ENGINE = process.env.SRL_STITCH_BROWSER_ENGINE || 'chromium'
const BASE_URL = process.env.SRL_STITCH_AUDIT_BASE_URL || 'http://127.0.0.1:4173/'
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'artifacts', 'preset-stitcher-browser-ci', ENGINE)
const browserTypes = { chromium, webkit }
const browserType = browserTypes[ENGINE]

if (!browserType) {
  throw new Error(`不支持的缝了么浏览器门禁引擎：${ENGINE}`)
}

await mkdir(OUTPUT_DIR, { recursive: true })

const browserStorageSource = await readFile(
  path.join(PROJECT_ROOT, 'src', 'services', 'BrowserStorageService.ts'),
  'utf8',
)
const noticeVersion = browserStorageSource.match(/PROJECT_NOTICE_VERSION\s*=\s*'([^']+)'/)?.[1]
if (!noticeVersion) throw new Error('无法读取 PROJECT_NOTICE_VERSION')

function presetFile(name, prefix) {
  const prompts = [
    {
      identifier: `${prefix}-main`,
      name: `${name}条目 1`,
      role: 'system',
      content: `${name}原始正文 {{user}}`,
    },
    { identifier: `${prefix}-marker`, name: 'Chat History', marker: true },
  ]
  return {
    name: `${name}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        name,
        temperature: 0.7,
        prompts,
        prompt_order: [
          {
            character_id: 100001,
            order: prompts.map((prompt) => ({ identifier: prompt.identifier, enabled: true })),
          },
        ],
      }),
    ),
  }
}

async function tap(page, locator) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 })
  const box = await locator.boundingBox()
  if (!box) throw new Error('无法取得触控目标位置')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function readEditorState(page, label) {
  const state = await page.locator('.stitch-editor').evaluate((editor) => {
    const portal = document.querySelector('#stitch-entry-editor-portal')
    const backdrop = document.querySelector('.stitch-editor-backdrop')
    const rect = editor.getBoundingClientRect()
    const style = getComputedStyle(editor)
    return {
      portalContainsEditor: Boolean(portal?.contains(editor)),
      insideEntry: Boolean(editor.closest('.stitch-entry')),
      position: style.position,
      background: style.backgroundColor,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.visualViewport?.width ?? window.innerWidth,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      backdropVisible: Boolean(backdrop),
      backdropBackground: backdrop ? getComputedStyle(backdrop).backgroundColor : '',
    }
  })
  if (!state.portalContainsEditor || state.insideEntry) {
    throw new Error(`${label}编辑器仍位于滚动条目裁剪树中：${JSON.stringify(state)}`)
  }
  if (state.position !== 'fixed' || !state.backdropVisible) {
    throw new Error(`${label}移动编辑层结构异常：${JSON.stringify(state)}`)
  }
  if (
    state.left < -1 ||
    state.top < -1 ||
    state.right > state.viewportWidth + 1 ||
    state.bottom > state.viewportHeight + 1
  ) {
    throw new Error(`${label}编辑器超出可视视口：${JSON.stringify(state)}`)
  }
  if (
    state.background === 'transparent' ||
    state.background === 'rgba(0, 0, 0, 0)' ||
    state.backdropBackground === 'transparent' ||
    state.backdropBackground === 'rgba(0, 0, 0, 0)'
  ) {
    throw new Error(`${label}编辑器或遮罩背景透明：${JSON.stringify(state)}`)
  }
  return state
}

const browser = await browserType.launch({ headless: true })
let page
let failure
let failureUrl
let failureText
const checkpoints = []
const consoleErrors = []
const httpErrors = []

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: ENGINE === 'webkit' ? 3 : 1,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
    userAgent:
      ENGINE === 'webkit'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1 SRL-WebKit-Audit/1.0'
        : 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 SRL-Chromium-Audit/1.0',
  })
  await context.addInitScript((version) => {
    localStorage.setItem('srl.projectNotice.acknowledgedVersion', version)
  }, noticeVersion)
  page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('/api/auth/presence')) {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`)
  })
  await context.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: {
          id: 'browser-regression-user',
          username: '浏览器门禁',
          role: 'user',
          mustChangePassword: false,
          disabled: false,
        },
        deviceId: 'browser-regression-device',
      }),
    })
  })
  await context.route('**/api/access-policy*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'open' }),
    })
  })
  await context.route('**/api/feedback/notifications*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0 }),
    })
  })

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.locator('.app-shell').waitFor({ timeout: 20_000 })
  await page
    .locator('input.import-button__input[aria-label="批量选择资源文件或备份包"]')
    .setInputFiles([presetFile('主门禁预设', 'main'), presetFile('填充门禁预设', 'fill')])
  await page.getByText('主门禁预设', { exact: true }).first().waitFor({ timeout: 20_000 })
  const importButton = page.locator('.mobile-bottom-nav > button').nth(2)
  await importButton.waitFor({ state: 'visible', timeout: 20_000 })
  for (let attempt = 0; attempt < 80 && !(await importButton.isEnabled()); attempt += 1)
    await page.waitForTimeout(250)
  if (!(await importButton.isEnabled())) throw new Error('资源导入尚未完成，功能入口仍不可用')

  await page.locator('.mobile-bottom-nav > button').nth(1).click()
  await page.getByRole('button', { name: 'APP 管理' }).click()
  const stitchApp = page.locator('.official-app-manager li').filter({ hasText: '缝了么' })
  await stitchApp.waitFor({ state: 'visible', timeout: 20_000 })
  if ((await stitchApp.innerText()).includes('未安装')) {
    await tap(page, stitchApp.getByRole('button', { name: '下载', exact: true }))
    await page.getByRole('status').filter({ hasText: '安装成功' }).waitFor({ timeout: 45_000 })
    await page.evaluate(() =>
      navigator.serviceWorker ? navigator.serviceWorker.ready.then(() => true) : false,
    )
  }
  await tap(page, page.getByRole('button', { name: '返回功能桌面' }))
  await tap(page, page.getByRole('button', { name: /缝了么/ }))
  await page.locator('.stitch').waitFor({ timeout: 20_000 })
  await tap(page, page.getByRole('button', { name: /主门禁预设/ }))
  await page.getByRole('dialog', { name: '选择填充内容' }).waitFor()
  await tap(page, page.getByRole('button', { name: /填充门禁预设/ }))
  await page.locator('.stitch-workbench').waitFor()

  const sourceRow = page.locator('.stitch-pane--source .stitch-entry').first()
  await tap(page, sourceRow.locator('.stitch-entry__copy'))
  await tap(page, sourceRow.getByRole('button', { name: '编辑工作副本', exact: true }))
  await page.locator('.stitch-editor').waitFor()
  checkpoints.push({ kind: 'source', state: await readEditorState(page, '填充预设') })
  const sourceTextarea = page.locator('.stitch-editor textarea')
  await tap(page, sourceTextarea)
  await sourceTextarea.fill('门禁临时正文，不应保存')
  await tap(page, page.locator('.stitch-editor').getByRole('button', { name: '取消', exact: true }))
  await page.locator('.stitch-editor').waitFor({ state: 'detached' })
  const sourceContent = await sourceRow.locator('pre').innerText()
  if (!sourceContent.includes('填充门禁预设原始正文')) {
    throw new Error(`取消编辑后填充正文被意外修改：${sourceContent}`)
  }

  await tap(page, sourceRow.getByRole('button', { name: '收藏条目', exact: true }))
  await tap(page, page.locator('.stitch-pane--source .stitch-pane__preset-name'))
  await page.getByRole('dialog', { name: '选择填充内容' }).waitFor()
  await tap(page, page.getByRole('button', { name: /已收藏预设条目/ }))
  const favoriteRow = page.locator('.stitch-pane--source .stitch-entry').first()
  await tap(page, favoriteRow.locator('.stitch-entry__copy'))
  await tap(page, favoriteRow.getByRole('button', { name: '编辑', exact: true }))
  await page.locator('.stitch-editor').waitFor()
  checkpoints.push({ kind: 'favorite', state: await readEditorState(page, '收藏条目') })
  await tap(page, page.locator('.stitch-editor').getByRole('button', { name: '取消', exact: true }))
  await page.locator('.stitch-editor').waitFor({ state: 'detached' })

  const targetRow = page.locator('.stitch-pane--target .stitch-entry').first()
  await tap(page, targetRow.locator('.stitch-entry__copy'))
  await tap(page, targetRow.getByRole('button', { name: '编辑', exact: true }))
  await page.locator('.stitch-editor').waitFor()
  checkpoints.push({ kind: 'target', state: await readEditorState(page, '主预设') })
  const targetTextarea = page.locator('.stitch-editor textarea')
  await tap(page, targetTextarea)
  await targetTextarea.fill('浏览器门禁主提示 {{char}}')
  await tap(
    page,
    page.locator('.stitch-editor').getByRole('button', { name: '保存修改', exact: true }),
  )
  await page.locator('.stitch-editor').waitFor({ state: 'detached' })
  const targetContent = await targetRow.locator('pre').innerText()
  if (!targetContent.includes('浏览器门禁主提示 {{char}}')) {
    throw new Error(`保存编辑后主预设正文未更新：${targetContent}`)
  }

  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'passed.png'),
    animations: 'disabled',
    fullPage: false,
  })

  if (consoleErrors.length) {
    throw new Error(`浏览器控制台出现错误：${JSON.stringify(consoleErrors)}`)
  }
} catch (error) {
  failure = error instanceof Error ? error.stack || error.message : String(error)
  if (page) {
    failureUrl = page.url()
    failureText = await page
      .locator('body')
      .innerText({ timeoutMs: 2_000 })
      .catch(() => '')
    await page
      .screenshot({
        path: path.join(OUTPUT_DIR, 'failure.png'),
        animations: 'disabled',
        fullPage: false,
      })
      .catch(() => undefined)
  }
} finally {
  await writeFile(
    path.join(OUTPUT_DIR, 'report.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        engine: ENGINE,
        baseUrl: BASE_URL,
        noticeVersion,
        failureUrl,
        failureText,
        checkpoints,
        consoleErrors,
        httpErrors,
        failure,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await browser.close()
}

if (failure) throw new Error(`缝了么 ${ENGINE} 浏览器门禁失败：${failure}`)
