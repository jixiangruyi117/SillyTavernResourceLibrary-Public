/* global document, innerWidth, localStorage, caches, window, indexedDB, fetch, getComputedStyle, Response */
import assert from 'node:assert/strict'
import console from 'node:console'
import { URL } from 'node:url'
import { officialAppIds } from './Check-FeatureContracts.mjs'
import {
  auditEnvironment,
  launchAuditBrowser,
  prepareAuditContext,
  openAuditFeature,
  findAuditFeature,
  saveAuditFailure,
  setAuditOffline,
  isExpectedOfflineApiError,
} from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'official-apps')
const previewUrl = environment.baseUrl
const browser = await launchAuditBrowser(environment)
let context
try {
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: environment.storageState,
  })
  await prepareAuditContext(context, environment)
  await context.addInitScript(() => {
    window.__srlInstallBufferReads = undefined
    const read = Response.prototype.arrayBuffer
    Response.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this)
      window.__srlInstallBufferReads?.push(bytes.byteLength)
      return bytes
    }
  })
  const page = await context.newPage()
  const errors = []
  let offline = false
  const expectedNetworkErrors = []
  let currentAppName = 'startup'
  page.on('pageerror', (error) => {
    if (isExpectedOfflineApiError(error, environment, offline)) {
      expectedNetworkErrors.push(`${error.name}: ${error.message}`)
      return
    }
    errors.push(`${currentAppName}: ${error.stack || `${error.name}: ${error.message}`}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().startsWith('[SRL:'))
      errors.push(`${currentAppName}: ${message.text()}`)
  })
  const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor()
  const back = () => page.locator('.feature-app-header__back').first().click()
  const manager = async () => {
    await page.getByRole('button', { name: 'APP 管理', exact: true }).click()
    await page.locator('.official-app-manager').waitFor()
  }
  await page.goto(previewUrl)
  await page.getByRole('button', { name: '功能', exact: true }).click()
  await manager()
  await page.getByRole('button', { name: '查看 APP 管理说明' }).click()
  const managerHelp = page.locator('.official-app-manager__help-dialog')
  await managerHelp.waitFor({ state: 'visible' })
  assert.ok((await managerHelp.innerText()).includes('原有数据保留'))
  const helpGeometry = await managerHelp.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect()
    return { top: bounds.top, height: bounds.height, viewportHeight: window.innerHeight }
  })
  const helpCenter = helpGeometry.top + helpGeometry.height / 2
  assert.ok(
    Math.abs(helpCenter - helpGeometry.viewportHeight / 2) <= 2,
    `APP help dialog is not centered: ${JSON.stringify(helpGeometry)}`,
  )
  await managerHelp.getByRole('button', { name: '知道了' }).click()
  await managerHelp.waitFor({ state: 'hidden' })
  const names = []
  for (const row of await page.locator('.official-app-manager li').all()) {
    const name = await row.locator('strong').innerText()
    names.push(name)
    const started = Date.now()
    await page.evaluate(() => {
      window.__srlInstallBufferReads = []
    })
    await row.getByRole('button', { name: '下载', exact: true }).tap()
    if (name === '前端了么') {
      await page.getByRole('button', { name: '查看 APP 管理说明' }).tap()
      await managerHelp.waitFor({ state: 'visible' })
      await managerHelp.getByRole('button', { name: '知道了' }).tap()
      await managerHelp.waitFor({ state: 'hidden' })
    }
    try {
      await status('安装成功')
    } catch (error) {
      const actual = await page.getByRole('status').allTextContents()
      throw new Error(`${name} 安装未完成；当前状态：${actual.join('；')}`, { cause: error })
    }
    const largeReads = await page.evaluate(() => {
      const reads = window.__srlInstallBufferReads
      window.__srlInstallBufferReads = undefined
      return reads.filter((size) => size > 4 * 1024 * 1024)
    })
    assert.deepEqual(largeReads, [], `${name} 安装时不得把大文件响应整体读进页面堆内存`)
    console.log(`安装通过：${name} / ${Date.now() - started} ms`)
  }
  assert.equal(names.length, officialAppIds().length)
  // An intact installation from before runtime identity metadata must never
  // reach Vue rendering. Repair replaces program bytes without clearing data.
  const legacyEntry = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('SillyTavernResourceLibrary')
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const database = opening.result
          const transaction = database.transaction('settings', 'readwrite')
          const settings = transaction.objectStore('settings')
          const getting = settings.get('official-app:draw')
          let entry
          getting.onsuccess = () => {
            const record = getting.result
            if (!record?.value?.runtimeEntry) {
              reject(new Error('Current runtime identity missing from installation'))
              return
            }
            entry = record.value.entry
            delete record.value.runtimeEntry
            settings.put(record)
          }
          transaction.oncomplete = () => {
            database.close()
            resolve(entry)
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
  )
  await page.evaluate(() => localStorage.setItem('srl.draw.showNames', 'true'))
  const legacyModuleRequests = []
  const captureLegacyModule = (request) => {
    if (new URL(request.url()).pathname === legacyEntry) legacyModuleRequests.push(request.url())
  }
  page.on('request', captureLegacyModule)
  await page.reload()
  await page.getByRole('button', { name: '功能', exact: true }).click()
  await openAuditFeature(page, '抽了么')
  await page.getByRole('button', { name: '下载兼容版本', exact: true }).waitFor()
  assert.deepEqual(legacyModuleRequests, [], 'Legacy component imported before compatibility check')
  assert.equal(await page.locator('#srl-fatal-error').count(), 0)
  page.off('request', captureLegacyModule)
  await page.getByRole('button', { name: '下载兼容版本', exact: true }).click()
  await page.locator('.draw-app__stats').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('srl.draw.showNames')), 'true')
  console.log('旧安装修复通过：导入前拦截、下载兼容包、原数据保留')
  await back()
  await openAuditFeature(page, '抽了么')
  await page.locator('.draw-app__stats').waitFor()
  const originalInstallations = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('SillyTavernResourceLibrary')
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const database = opening.result
          const transaction = database.transaction('settings', 'readwrite')
          const settings = transaction.objectStore('settings')
          const getting = settings.getAll()
          getting.onerror = () => reject(getting.error)
          getting.onsuccess = () => {
            const installed = getting.result.filter((record) =>
              String(record.id).startsWith('official-app:'),
            )
            if (!installed.some((record) => record.id === 'official-app:draw')) {
              reject(new Error('Draw APP installation fixture missing'))
              return
            }
            const original = window.structuredClone(installed)
            for (const record of installed) {
              const owned = record.value.files.find((file) => !file.bundled)
              if (!owned) {
                reject(new Error(`${record.id}: no APP-owned file in audit fixture`))
                return
              }
              owned.sha256 = '0'.repeat(64)
              settings.put(record)
            }
            transaction.oncomplete = () => {
              database.close()
              resolve(original)
            }
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
  )
  const updatePage = await context.newPage()
  let blockedUpdateDownloads = 0
  updatePage.on('request', (request) => {
    if (request.url().endsWith('.srlapp')) blockedUpdateDownloads++
  })
  await updatePage.goto(previewUrl)
  await updatePage.getByRole('button', { name: '功能', exact: true }).click()
  await updatePage.getByRole('button', { name: 'APP 管理', exact: true }).click()
  const updateDialog = updatePage.locator('.official-app-manager__updates-dialog')
  await updateDialog.waitFor({ state: 'visible' })
  assert.ok((await updateDialog.innerText()).includes('抽了么'))
  assert.equal(
    await updateDialog.locator('.official-app-manager__updates-list li').count(),
    officialAppIds().length,
  )
  assert.ok((await updateDialog.innerText()).includes('当前 APP 包版本：'))
  const latestVersion = await page.evaluate(
    async () =>
      (await (await fetch('/official-apps/api-1/catalog.json')).json()).apps.draw[0].shellVersion,
  )
  const latestVersionLabel = latestVersion.replace(/^srl-/u, '').replace(/-v(\d+)$/u, ' (v$1)')
  assert.ok((await updateDialog.innerText()).includes(latestVersionLabel))
  const dialogLayout = await updateDialog.evaluate((dialog) => {
    const list = dialog.querySelector('.official-app-manager__updates-list')
    return {
      dialogTop: dialog.getBoundingClientRect().top,
      dialogHeight: dialog.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      listOverflowY: getComputedStyle(list).overflowY,
    }
  })
  assert.ok(
    dialogLayout.dialogHeight < dialogLayout.viewportHeight,
    'Update dialog must stay bounded',
  )
  assert.ok(
    Math.abs(
      dialogLayout.dialogTop - (dialogLayout.viewportHeight - dialogLayout.dialogHeight) / 2,
    ) < 2,
    'Update dialog must be centered in the viewport',
  )
  assert.ok(
    dialogLayout.listScrollHeight > dialogLayout.listClientHeight,
    'Update list should scroll internally',
  )
  assert.equal(dialogLayout.listOverflowY, 'auto')
  await updateDialog
    .locator('.official-app-manager__updates-list li')
    .filter({ hasText: '抽了么' })
    .getByRole('button', { name: '去更新', exact: true })
    .click()
  await updatePage
    .getByRole('status')
    .filter({ hasText: '其他页面正在使用这个 APP，请关闭后再更新' })
    .waitFor()
  assert.equal(blockedUpdateDownloads, 0, 'An active APP must reject update before downloading')
  await updatePage.close()
  await back()
  await page.evaluate(
    (records) =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('SillyTavernResourceLibrary')
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const database = opening.result
          const transaction = database.transaction('settings', 'readwrite')
          const settings = transaction.objectStore('settings')
          for (const record of records) settings.put(record)
          transaction.oncomplete = () => {
            database.close()
            resolve(true)
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    originalInstallations,
  )
  offline = true
  await setAuditOffline(context, environment, true)
  for (const name of names) {
    currentAppName = name
    await openAuditFeature(page, name)
    await page.waitForFunction(
      () =>
        !document.querySelector('.async-panel-loading') &&
        !document.querySelector('.official-app-install[aria-busy="true"]'),
    )
    assert.equal(
      await page.locator('.official-app-install,.async-panel-error').count(),
      0,
      `First offline open failed: ${name}`,
    )
    const permissionDialog = page.locator('.external-app-permission')
    if (name === '读了么') await permissionDialog.waitFor({ state: 'visible' })
    if (await permissionDialog.count())
      await permissionDialog.getByRole('button', { name: '仅同意这次' }).click()
    assert.ok(
      (await page.locator('body').innerText()).includes(name),
      `APP did not render offline: ${name}`,
    )
    await back()
  }
  await setAuditOffline(context, environment, false)
  offline = false
  currentAppName = 'APP 管理'
  await manager()
  assert.equal(await page.locator('.official-app-manager__updates-dialog').count(), 0)
  assert.equal(await page.locator('.official-app-manager__update-dot').count(), 0)
  const draw = page.locator('.official-app-manager li').filter({ hasText: '抽了么' })
  await page.evaluate(() => localStorage.setItem('srl.draw.showNames', 'true'))
  const filesBefore = await page.evaluate(async () =>
    (await (await caches.open('srl-official-app-assets-v1')).keys()).map(
      (request) => new URL(request.url).pathname,
    ),
  )
  await draw.getByRole('button', { name: '卸载', exact: true }).click()
  await page.getByRole('button', { name: '确认仅卸载 APP', exact: true }).click()
  await status('已卸载')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  assert.equal(await page.evaluate(() => localStorage.getItem('srl.draw.showNames')), 'true')
  const filesAfter = await page.evaluate(async () =>
    (await (await caches.open('srl-official-app-assets-v1')).keys()).map(
      (request) => new URL(request.url).pathname,
    ),
  )
  const removed = filesBefore.filter((path) => !filesAfter.includes(path))
  assert.ok(removed.some((path) => path.includes('/DrawApp-')))
  assert.ok(
    filesAfter.some((path) => path.includes('/AppContainer-')),
    'Shared dependency removed',
  )
  await back()
  assert.equal(
    await findAuditFeature(page, '抽了么'),
    null,
    'Uninstalled app must leave the desktop',
  )
  await manager()
  assert.equal(await page.locator('.official-app-manager__updates-dialog').count(), 0)
  await draw.getByRole('button', { name: '下载', exact: true }).click()
  await status('安装成功')
  await back()
  await openAuditFeature(page, '抽了么')
  await page.locator('.draw-app__stats').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('srl.draw.showNames')), 'true')
  await back()
  await manager()
  assert.equal(await page.locator('.official-app-manager__updates-dialog').count(), 0)
  await draw.getByRole('button', { name: '卸载', exact: true }).click()
  await page.getByLabel('同时删除 APP 数据').check()
  await page.getByRole('button', { name: '确认卸载并清除数据', exact: true }).click()
  await status('已卸载')
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  assert.equal(await page.evaluate(() => localStorage.getItem('srl.draw.showNames')), null)
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
    }, theme)
    for (const [width, height] of [
      [320, 800],
      [375, 812],
      [390, 844],
      [430, 932],
    ]) {
      await page.setViewportSize({ width, height })
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        controls: [...document.querySelectorAll('.official-app-manager button')].every((button) => {
          const box = button.getBoundingClientRect()
          return box.left >= 0 && box.right <= innerWidth && box.height >= 44
        }),
      }))
      assert.equal(layout.overflow, false, `${theme} ${width}: overflow`)
      assert.equal(layout.controls, true, `${theme} ${width}: clipped controls`)
    }
  }
  assert.deepEqual(errors, [])
  console.log(
    `离线只读 API 的预期网络失败：${expectedNetworkErrors.length}；其他运行时异常：${errors.length}`,
  )
  console.log(
    `Passed: install all ${officialAppIds().length}; active cross-tab update rejected before download; first offline open; uninstall frees files and retains shared code; retained-data reinstall; explicit data clearing; light/dark 320/375/390/430 layouts.`,
  )
} catch (error) {
  await saveAuditFailure(context, environment, error)
  throw error
} finally {
  await browser.close()
}
