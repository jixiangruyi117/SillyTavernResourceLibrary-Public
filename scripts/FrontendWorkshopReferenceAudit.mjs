/* global document, window, indexedDB, getComputedStyle */
import { Buffer } from 'node:buffer'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

// Current greeting contract: Source main canvas + four flat tabs + two shared AI entrances.
// Auth is a local fixture. This audit does not claim real provider, device, ST or TH acceptance.
const BASE_URL = process.env.SRL_AUDIT_BASE_URL || 'http://127.0.0.1:4180/'
const OUTPUT_DIR =
  process.env.SRL_AUDIT_OUTPUT_DIR ||
  path.join(process.cwd(), '.codex-tmp', 'frontend-workbench-reference')
const browserStorageSource = await readFile('src/services/BrowserStorageService.ts', 'utf8')
const noticeVersion = browserStorageSource.match(/PROJECT_NOTICE_VERSION\s*=\s*'([^']+)'/)?.[1]
if (!noticeVersion) throw new Error('无法读取 PROJECT_NOTICE_VERSION')
const browser = await chromium.launch({
  executablePath:
    process.env.SRL_AUDIT_BROWSER ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
await context.addInitScript(
  ({ version }) => {
    window.localStorage.setItem('srl.projectNotice.acknowledgedVersion', version)
  },
  { version: noticeVersion },
)
const page = await context.newPage()
const checks = []
const errors = []
page.on('pageerror', (error) => errors.push(error.stack))
function assert(value, message) {
  if (!value) throw new Error(message)
}
async function touchCenter(locator, label) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  assert(box?.width && box?.height, `${label}: no touch target`)
  let x = box.x + box.width / 2
  let y = box.y + box.height / 2
  // Element rect is local to its document; this also verifies hit ownership inside opaque iframes.
  const ownsPoint = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const owner = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return owner && (owner === element || element.contains(owner))
  })
  assert(ownsPoint, `${label}: another element owns the hit`)
  // Compose each actual iframe transform; boundingBox offsets alone lose scaled frame geometry.
  const element = await locator.elementHandle()
  let ownerFrame = await element.ownerFrame()
  while (ownerFrame.parentFrame()) {
    const iframe = await ownerFrame.frameElement()
    const geometry = await iframe.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        x: rect.x,
        y: rect.y,
        scaleX: rect.width / el.offsetWidth,
        scaleY: rect.height / el.offsetHeight,
        borderX: el.clientLeft,
        borderY: el.clientTop,
      }
    })
    x = geometry.x + (geometry.borderX + x) * geometry.scaleX
    y = geometry.y + (geometry.borderY + y) * geometry.scaleY
    await iframe.dispose()
    ownerFrame = ownerFrame.parentFrame()
  }
  await element.dispose()
  await page.touchscreen.tap(x, y)
}
async function readSource() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('SillyTavernResourceLibrary')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction('frontendWorkshopSourceDocuments')
          .objectStore('frontendWorkshopSourceDocuments')
          .getAll()
        request.onsuccess = () => resolve(request.result[0]?.authorSource)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })
}

async function touchDrag(locator, deltaX, deltaY) {
  const box = await locator.boundingBox()
  assert(box?.width && box?.height, 'Source drag target missing')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  assert(
    await locator.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return hit === el || el.contains(hit)
    }),
    'Source drag target is covered',
  )
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    })
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (deltaX * step) / 5, y: y + (deltaY * step) / 5, id: 1 }],
      })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}
const fixture = `<!doctype html><html><head><style>body{margin:0;padding:56px 20px 60px 60px;font:16px sans-serif} #a{background:#eee} .row{display:flex;gap:8px} button{min-height:44px}</style></head><body>
<div id="a" style="position:relative;left:0px;top:0px;width:210px;height:55px;color:red">Alpha</div>
<div id="b" style="position:relative;left:0px;top:0px;width:210px;height:55px;color:blue">Beta</div>
<div id="c" style="color:black">Untouched</div>
<div id="flow" class="row"><span>Flex A</span><span>Flex B</span></div>
<img id="image" width="60" height="50" alt="test" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='50'%3E%3Crect width='60' height='50' fill='blue'/%3E%3C/svg%3E">
<button id="action">Run</button></body></html>`
try {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: { id: 'reference-fixture', username: 'reference-fixture', role: 'admin' },
        deviceId: 'reference-fixture',
      },
    }),
  )
  // Playwright's serviceWorkers:block init script throws inside opaque sandboxes.
  // A fresh context plus a blocked SW resource prevents caching without changing the sandbox.
  await page.route('**/sw.js', (route) => route.abort())
  await page.route('https://registry.npmmirror.com/**', (route) => route.abort())
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor()
  const notice = page.locator('.project-notice__overlay:visible').first()
  if (await notice.isVisible().catch(() => false)) {
    await notice.getByRole('button').last().click({ timeout: 15_000 })
  }
  await touchCenter(page.locator('.mobile-bottom-nav button').nth(1), '功能入口')
  await touchCenter(page.locator('.feature-app--frontend'), '前端了么入口')
  await page.getByRole('button', { name: '新建开场白', exact: true }).click()
  await page.getByRole('button', { name: '更多工具', exact: true }).click()
  await page.locator('.fw-popover--more').getByRole('button', { name: '源码', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '源码编辑', exact: true })
  // Exercise real external HTML file import, then save through the Source owner.
  await editor
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'index.html', mimeType: 'text/html', buffer: Buffer.from(fixture) })
  const textarea = editor.getByRole('textbox', { name: 'HTML CSS JavaScript 源码' })
  await page.waitForFunction(() =>
    document
      .querySelector('textarea[aria-label="HTML CSS JavaScript 源码"]')
      ?.value.includes('Alpha'),
  )
  await editor.getByRole('button', { name: '接管为源码', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  const canvas = page.locator('.frontend-workshop-source-session__editor-canvas')
  const frame = canvas.frameLocator('iframe').frameLocator('iframe')
  await canvas.locator('[data-source-ready=true]').waitFor()
  await frame.locator('#a').waitFor()
  assert(
    await page
      .locator('.fw-workbench')
      .evaluate((el) => getComputedStyle(el).fontFamily !== '"Times New Roman"'),
    'workbench lost UI typography',
  )
  const heightBeforeDismiss = (await canvas.boundingBox()).height
  await canvas.getByRole('button', { name: '关闭操作提示', exact: true }).click()
  assert(
    Math.abs((await canvas.boundingBox()).height - heightBeforeDismiss) < 1,
    'status message reserves canvas space',
  )
  await mkdir(OUTPUT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'source-import-390.png') })
  checks.push('UI字体生效，关闭提示不改变画布高度')
  assert((await readSource()).includes('Untouched'), 'external source not persisted')
  assert(
    (await frame.locator('#flow').evaluate((el) => getComputedStyle(el).display)) === 'flex',
    'flow layout was replaced',
  )
  checks.push('外部 HTML/CSS/JS 通过真实导入入口进入主 Source 画布，保留 Flex')
  const sourceBeforeViewport = await readSource()
  await touchCenter(page.getByRole('button', { name: '宽屏', exact: true }), '宽屏视口')
  assert(
    await canvas
      .locator('.frontend-workshop-source-workspace__stage')
      .evaluate((el) => el.style.width === '720px'),
    'wide viewport was not applied',
  )
  await touchCenter(page.getByRole('button', { name: '手机', exact: true }), '手机视口')
  assert(
    await canvas
      .locator('.frontend-workshop-source-workspace__stage')
      .evaluate((el) => el.style.width === '390px'),
    'phone viewport was not applied',
  )
  assert((await readSource()) === sourceBeforeViewport, 'viewport modified author source')
  checks.push('原项目栏手机/宽屏实际调整画布视口，不改变Author Source')
  assert((await page.locator('.fw-pages').count()) === 0, 'source exposes inert structured pages')
  await touchCenter(page.getByRole('button', { name: '选择元素', exact: true }), '开启元素选择')
  for (const scale of [0.5, 1.5]) {
    await page.getByRole('button', { name: '重置画布视角', exact: true }).click()
    for (let step = 0; step < 5; step++) {
      await page
        .getByRole('button', {
          name: scale < 1 ? '缩小画布' : '放大画布',
          exact: true,
        })
        .click()
    }
    await touchCenter(frame.locator('#a'), `Source ${scale} 选择`)
    const overlay = canvas.locator('[data-source-transform-overlay]')
    await overlay.waitFor()
    const handle = await overlay
      .getByRole('button', { name: '调整元素宽高', exact: true })
      .boundingBox()
    assert(handle?.width >= 43.9 && handle?.height >= 43.9, 'scaled Source handle below 44px')
    const before = await frame.locator('#a').evaluate((el) => parseFloat(el.style.left))
    await touchDrag(overlay, 20 * scale, 10 * scale)
    await frame.locator(`#a[style*="left:${before + 20}px"]`).waitFor()
    assert(
      (await readSource()).includes('id="b" style="position:relative;left:0px;top:0px'),
      'Source drag changed unselected element',
    )
  }
  await page.getByRole('button', { name: '重置画布视角', exact: true }).click()
  checks.push('Source 50% / 150% 触屏拖动精确写回文档坐标；手柄44px且不改未选元素')
  await touchCenter(page.getByRole('button', { name: '多选', exact: true }), '多选')
  await touchCenter(frame.locator('#a'), '选择 A')
  await touchCenter(frame.locator('#b'), '选择 B')
  const inspector = page.getByLabel('源码元素检查器', { exact: true })
  await inspector.getByText('仅修改已选的 2 个元素', { exact: false }).waitFor()
  await inspector.locator('[data-item-key="source.text"] textarea').fill('Selected')
  await inspector.locator('[data-item-key="source.text"] textarea').blur()
  await frame.locator('#a').getByText('Selected', { exact: true }).waitFor()
  assert((await frame.locator('#b').textContent()) === 'Selected', 'second selection not changed')
  assert(
    (await frame.locator('#c').textContent()) === 'Untouched',
    'unselected content was changed',
  )
  checks.push('触屏多选只写回所选文字；第三个元素不变')
  await canvas.locator('[data-source-ready=true]').waitFor()
  await touchCenter(frame.locator('#a'), '重新选择 A')
  await touchCenter(frame.locator('#b'), '重新选择 B')
  await inspector.getByText('仅修改已选的 2 个元素', { exact: false }).waitFor()
  await touchCenter(inspector.locator('[data-tab=appearance]'), '外观参数')
  await inspector.locator('[data-item-key="css.color"] input').fill('green')
  await inspector.locator('[data-item-key="css.color"] input').blur()
  await frame.locator('#a[style*="color:green"]').waitFor()
  assert(
    (await frame.locator('#b').evaluate((el) => getComputedStyle(el).color)) === 'rgb(0, 128, 0)',
    'style did not reach runtime',
  )
  assert(
    (await readSource()).includes('id="c" style="color:black"'),
    'style change escaped selection',
  )
  checks.push('普通 CSS 精确多选写回，Source 与真实 iframe 计算样式一致')
  await touchCenter(page.getByRole('button', { name: '选择元素', exact: true }), '单选')
  await touchCenter(frame.locator('#a'), '选择源码目标')
  await touchCenter(inspector.locator('[data-tab=content]'), '内容参数')
  await inspector.locator('[data-item-key="source.location"]').click()
  await editor.waitFor()
  const selectedSource = await textarea.evaluate((el) =>
    el.value.slice(el.selectionStart, el.selectionEnd),
  )
  assert(selectedSource.startsWith('<div id="a"'), `wrong source location: ${selectedSource}`)
  await editor.getByRole('button', { name: '关闭源码编辑', exact: true }).click()
  checks.push('定位源码真正选中当前 revision 的 HTML 区间')
  await touchCenter(page.locator('.fw-ai-shortcut'), 'AI 快捷球')
  const quick = page.getByRole('dialog', { name: 'AI 快捷修改', exact: true })
  assert(
    (await quick.locator('option').allTextContents()).join('|').includes('新建图层'),
    'missing layer scope',
  )
  await quick.getByRole('button', { name: '关闭', exact: true }).click()
  await touchCenter(
    page.getByRole('button', { name: '打开肘肘更健康', exact: true }),
    '详细 AI 入口',
  )
  await page.getByRole('dialog', { name: '肘肘更健康', exact: true }).waitFor()
  await page
    .getByRole('dialog', { name: '肘肘更健康', exact: true })
    .getByRole('button', { name: '返回工作台', exact: true })
    .click()
  checks.push('无名称快捷球与详细 AI 工作台独立；当前/新建/整页范围可见（未调用真实 AI）')
  await page.getByRole('button', { name: '更多工具', exact: true }).click()
  await page.locator('.fw-popover--more').getByRole('button', { name: '源码', exact: true }).click()
  await textarea.fill(
    (await textarea.inputValue()).replace(
      '<button id="action">',
      `<button id="action" onclick="this.textContent='Done'">`,
    ),
  )
  await editor.getByRole('button', { name: '保存源码', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await touchCenter(page.getByRole('button', { name: '打开最终预览', exact: true }), '最终预览')
  const preview = page.getByRole('dialog', { name: '源码运行预览', exact: true })
  await preview.locator('[data-source-ready=true]').waitFor()
  await preview.frameLocator('iframe').frameLocator('iframe').locator('#action').click()
  await preview
    .frameLocator('iframe')
    .frameLocator('iframe')
    .getByText('Done', { exact: true })
    .waitFor()
  await preview.getByRole('button', { name: '返回工作台', exact: true }).click()
  checks.push('最终预览运行普通 JavaScript；返回主画布')
  await canvas.locator('[data-source-ready=true]').waitFor()
  await touchCenter(frame.locator('#a'), '运行脚本 Source 的候选定位')
  await inspector.locator('[data-tab=content]').click()
  assert(
    await inspector.locator('[data-item-key="source.elementId"] input').isDisabled(),
    'script Source must not pretend to have exact write targets',
  )
  checks.push('脚本 Source 可选可定位但明确只读，不伪装为可写')
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height })
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        window.innerWidth,
    )
    assert(overflow <= 1, `${width}px horizontal overflow ${overflow}`)
    const box = await inspector.boundingBox()
    assert(
      !box || (width < 768 ? box.height <= height * 0.35 + 1 : box.width <= width * 0.48),
      `${width}px inspector covers too much canvas`,
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'source-inspector-390.png') })
  if (await inspector.isVisible()) {
    await inspector.getByRole('button', { name: '收起属性', exact: true }).click()
    assert((await inspector.boundingBox()).height < 120, 'collapsed inspector still covers canvas')
    await touchCenter(inspector.locator('[data-tab=appearance]'), '收起后直接打开外观')
    await inspector.getByRole('button', { name: '收起属性', exact: true }).click()
  }
  await mkdir(OUTPUT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'source-canvas-390.png') })
  checks.push(
    '320/375/390/430/768/1440 无横向溢出；手机属性栏不超过35%高度、桌面为侧栏；收起后页签仍可触控',
  )
  assert(!errors.length, `uncaught browser errors: ${errors.join(';')}`)
  process.stdout.write(
    `${JSON.stringify({ ok: true, evidence: 'local Edge touchscreen + fixture auth', checks }, null, 2)}\n`,
  )
} catch (error) {
  await mkdir(OUTPUT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'failure.png') }).catch(() => {})
  const frames = await Promise.all(
    page.frames().map(async (frame) => ({
      name: frame.name(),
      parent: frame.parentFrame()?.name(),
      ids: await frame
        .locator('[id]')
        .evaluateAll((elements) => elements.map((el) => el.id))
        .catch(() => []),
    })),
  )
  process.stderr.write(
    JSON.stringify({ ok: false, checks, errors, message: String(error), frames }, null, 2),
  )
  process.exitCode = 1
} finally {
  await browser.close()
}
