/* global document, window */
import { readFile } from 'node:fs/promises'
import process from 'node:process'

import { chromium } from 'playwright-core'

const BASE_URL = process.env.SRL_AUDIT_BASE_URL || 'http://127.0.0.1:4180/'
const EDGE_PATH =
  process.env.SRL_AUDIT_BROWSER ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browserStorageSource = await readFile('src/services/BrowserStorageService.ts', 'utf8')
const noticeVersion = browserStorageSource.match(/PROJECT_NOTICE_VERSION\s*=\s*'([^']+)'/)?.[1]
if (!noticeVersion) throw new Error('无法读取 PROJECT_NOTICE_VERSION')
const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
})
await context.addInitScript(
  ({ version }) => {
    window.localStorage.setItem('srl.projectNotice.acknowledgedVersion', version)
  },
  { version: noticeVersion },
)
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
const checks = []

await page.route('**/api/auth/session', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { id: 'viewport-audit', username: '视口验收', role: 'admin' },
      deviceId: 'viewport-audit-device',
    }),
  }),
)

async function dismissNotice() {
  const notice = page.locator('.project-notice__overlay:visible').first()
  if (
    !(await notice
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false))
  )
    return
  const confirm = notice.getByRole('button').last()
  if (await confirm.count()) await confirm.click({ timeout: 10_000 })
}

async function addCanvasNode(label, kindClass) {
  await page.getByRole('button', { name: '快速添加' }).click()
  await page.locator('.fw-popover--quick > div button').getByText(label, { exact: true }).click()
  const node = page.locator(`.frontend-workbench__canvas-node.is-${kindClass}`).last()
  await node.waitFor({ state: 'visible' })
  await node.scrollIntoViewIfNeeded()
  await node.click()
  return node
}

async function currentZoom() {
  return (await page.getByLabel('当前画布缩放').textContent())?.trim()
}

async function setZoom(target) {
  await page.getByRole('button', { name: '重置画布视角' }).click()
  const direction = target > 100 ? '放大画布' : '缩小画布'
  for (let zoom = 100; zoom !== target; zoom += target > 100 ? 25 : -25) {
    await page.getByRole('button', { name: direction }).click()
  }
  if ((await currentZoom()) !== `${target}%`) throw new Error(`缩放没有到达 ${target}%`)
}

function topFromStyle(style) {
  const match = /top:\s*(-?[\d.]+)px/u.exec(style || '')
  return Number(match?.[1])
}

function projectStyle(style) {
  return (style || '').replace(/z-index:\s*\d+;\s*/u, '')
}

async function dragNode(node, distance) {
  await node.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const box = await node.boundingBox()
  if (!box) throw new Error('元素没有可拖动区域')
  const dragPoint = await page.evaluate(({ x, y, width, height }) => {
    const left = Math.max(8, x + 8)
    const right = Math.min(window.innerWidth - 8, x + width - 8)
    const top = Math.max(8, y + 8)
    const bottom = Math.min(window.innerHeight - 8, y + height - 8)
    for (const yRatio of [0.5, 0.75, 0.25, 0.9, 0.1]) {
      for (const xRatio of [0.5, 0.75, 0.25, 0.9, 0.1]) {
        const candidate = {
          x: left + (right - left) * xRatio,
          y: top + (bottom - top) * yRatio,
        }
        if (document.elementFromPoint(candidate.x, candidate.y)?.closest('[data-node-id]')) {
          return candidate
        }
      }
    }
    return null
  }, box)
  if (!dragPoint)
    throw new Error(
      `元素可见拖动区域被固定界面完全遮挡：${JSON.stringify({ box, zoom: await currentZoom() })}`,
    )
  await page.mouse.move(dragPoint.x, dragPoint.y)
  await page.mouse.down()
  await page.mouse.move(dragPoint.x, dragPoint.y + distance, { steps: 5 })
  await page.mouse.up()
}

try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('.app-shell').waitFor({ timeout: 25_000 })
  await dismissNotice()
  await page.locator('.mobile-bottom-nav button').nth(1).click()
  await page.locator('.feature-app--frontend').click()
  await page.locator('.fw-workbench').waitFor()
  await page.locator('.fw-home__create button').first().click()

  const textNode = await addCanvasNode('文字', 'text')
  for (const [zoom, expectedDelta] of [
    [50, 60],
    [100, 30],
    [150, 20],
  ]) {
    await setZoom(zoom)
    await textNode.scrollIntoViewIfNeeded()
    const before = topFromStyle(await textNode.getAttribute('style'))
    await dragNode(textNode, 30)
    const after = topFromStyle(await textNode.getAttribute('style'))
    if (Math.abs(after - before - expectedDelta) > 1)
      throw new Error(`${zoom}% 拖动坐标错误：${before} -> ${after}，期望 ${expectedDelta}`)
  }
  checks.push('50% / 100% / 150% 元素拖动坐标')

  const imageNode = await addCanvasNode('图片', 'image')
  await setZoom(50)
  const beforeResize = await imageNode.getAttribute('style')
  const scaleHandle = page.locator('.frontend-workbench__scale-handle.is-se')
  await scaleHandle.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const scaleBox = await scaleHandle.boundingBox()
  if (!scaleBox) throw new Error('50% 缩放手柄不可见')
  const scaleHitTarget = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('.frontend-workbench__scale-handle')?.className ||
      '',
    { x: scaleBox.x + scaleBox.width / 2, y: scaleBox.y + scaleBox.height / 2 },
  )
  if (!scaleHitTarget) throw new Error('50% 缩放手柄被固定界面遮挡')
  await page.mouse.move(scaleBox.x + scaleBox.width / 2, scaleBox.y + scaleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    scaleBox.x + scaleBox.width / 2 - 24,
    scaleBox.y + scaleBox.height / 2 - 24,
    {
      steps: 4,
    },
  )
  await page.mouse.up()
  if ((await imageNode.getAttribute('style')) === beforeResize)
    throw new Error('50% 缩放没有改变元素数据')

  await setZoom(150)
  const beforeRotate = await imageNode.getAttribute('style')
  const rotateHandle = page.locator('.frontend-workbench__rotate-handle')
  await rotateHandle.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const rotateBox = await rotateHandle.boundingBox()
  const imageBox = await imageNode.boundingBox()
  if (!rotateBox || !imageBox) throw new Error('150% 旋转手柄不可见')
  await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height + 30, {
    steps: 5,
  })
  await page.mouse.up()
  if ((await imageNode.getAttribute('style')) === beforeRotate)
    throw new Error('150% 旋转没有改变元素数据')
  checks.push('50% 缩放 / 150% 旋转')

  await page.getByRole('button', { name: '适合画布' }).click()
  const fitCanvasZoom = Number.parseInt((await currentZoom()) || '', 10)
  if (!(fitCanvasZoom >= 25 && fitCanvasZoom <= 100))
    throw new Error('适合画布没有回到可见缩放范围')
  await page.getByRole('button', { name: '适合选区' }).click()
  const fitSelectionZoom = Number.parseInt((await currentZoom()) || '', 10)
  if (!(fitSelectionZoom >= fitCanvasZoom && fitSelectionZoom <= 200))
    throw new Error('适合选区没有对准选中元素')
  await page.locator('.frontend-workbench__canvas').click({ position: { x: 4, y: 4 } })
  if (!(await page.getByRole('button', { name: '适合选区' }).isDisabled()))
    throw new Error('未选中元素时适合选区没有禁用')
  checks.push('适合画布 / 适合选区')

  await imageNode.click()
  await page.locator('.frontend-workbench__canvas-node.is-selected').waitFor()
  await setZoom(100)
  await imageNode.scrollIntoViewIfNeeded()
  const canvas = page.locator('.frontend-workbench__canvas')
  const nodeBox = await imageNode.boundingBox()
  if (!nodeBox) throw new Error('图片没有可触摸区域')
  const beforeGestureStyle = await imageNode.getAttribute('style')
  const beforePanStyle = await canvas.getAttribute('style')
  const first = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 }
  const second = { x: first.x + 56, y: first.y + 16 }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { ...first, id: 31 },
      { ...second, id: 32 },
    ],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: first.x - 24, y: first.y - 12, id: 31 },
      { x: second.x + 36, y: second.y + 18, id: 32 },
    ],
  })
  if ((await imageNode.getAttribute('style')) !== beforeGestureStyle)
    throw new Error('双指 pinch 误修改了元素布局')
  if ((await currentZoom()) === '100%') throw new Error('双指 pinch 没有改变视口缩放')
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: first.x + 18, y: first.y + 22, id: 31 },
      { x: second.x + 78, y: second.y + 52, id: 32 },
    ],
  })
  if ((await imageNode.getAttribute('style')) !== beforeGestureStyle)
    throw new Error('双指 pan 误修改了元素 x/y')
  if ((await canvas.getAttribute('style')) === beforePanStyle)
    throw new Error('双指 pan 没有改变视口位置')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  checks.push('浏览器真实双指 pinch / pan 不修改元素')

  const transformedStyle = projectStyle(await imageNode.getAttribute('style'))
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  if (projectStyle(await imageNode.getAttribute('style')) === transformedStyle)
    throw new Error('视口变换后 Undo 没有回退元素数据')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  if (projectStyle(await imageNode.getAttribute('style')) !== transformedStyle)
    throw new Error('视口变换后 Redo 没有恢复元素数据')
  checks.push('Zoom/Pan 后 Undo/Redo 元素数据')

  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(120)
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        window.innerWidth,
    )
    if (overflow > 1) throw new Error(`${width}px 出现横向页面溢出：${overflow}px`)
  }
  checks.push('320/375/390/430/768/1440 无横向页面溢出')

  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`)
} finally {
  await browser.close()
}
