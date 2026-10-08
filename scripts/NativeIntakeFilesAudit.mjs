/* global window, document, localStorage */
import assert from 'node:assert/strict'
import console from 'node:console'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  auditEnvironment,
  launchAuditBrowser,
  prepareAuditContext,
  saveAuditFailure,
} from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'intake-files')
const browser = await launchAuditBrowser(environment)
const results = []
await mkdir(environment.outputDir, { recursive: true })
try {
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
  ]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
      })
      await prepareAuditContext(context, environment, { trace: false })
      await context.addInitScript(() => {
        if (window !== window.top) return
        window.__intakeFixture = {
          entries: [
            {
              token: 'old',
              name: '很长的旧附件名称用于确认在窄屏中能够换行并正常逐项清理.json',
              bytes: 26843545,
              modifiedAt: 1700000000000,
              fileCount: 3,
              state: '未完成或缺少记录的暂存',
              snapshot: 'old-fingerprint',
              protectedReason: '',
            },
            {
              token: 'active',
              name: '正在接收的附件.json',
              bytes: 2048,
              modifiedAt: 1700000000000,
              fileCount: 2,
              state: '待导入或待确认',
              snapshot: 'active-fingerprint',
              protectedReason: '正在下载或导入',
            },
            ...Array.from({ length: 130 }, (_, index) => ({
              token: `receipt-${index}`,
              name: `已处理收件回执 ${index}`,
              bytes: 13,
              modifiedAt: 1700000000000,
              fileCount: 1,
              state: '已处理回执（防止重复接收）',
              snapshot: `receipt-fingerprint-${index}`,
              protectedReason: '',
              receiptOnly: true,
            })),
          ],
          removals: [],
          receiptRemovals: [],
          receiptCalls: 0,
          reads: 0,
          previewConcurrency: [],
        }
        window.Capacitor = {
          PluginHeaders: [
            {
              name: 'NativePreviewAsset',
              methods: [{ name: 'configure', rtype: 'promise' }],
            },
            {
              name: 'NativeLibrary',
              methods: ['getStorageInfo', 'listRecoveryCandidates'].map((name) => ({
                name,
                rtype: 'promise',
              })),
            },
            {
              name: 'ShareReceiver',
              methods: ['listIntakeFiles', 'removeIntakeFile', 'removeIntakeReceipts'].map(
                (name) => ({
                  name,
                  rtype: 'promise',
                }),
              ),
            },
          ],
          nativePromise: async (plugin, method, options) => {
            const fixture = window.__intakeFixture
            if (plugin === 'NativePreviewAsset' && method === 'configure') {
              fixture.previewConcurrency.push(options.increaseDownloadConcurrency)
              return {}
            }
            if (plugin === 'NativeLibrary' && method === 'getStorageInfo')
              return {
                storageVersion: 1,
                objectBytes: 0,
                objectCount: 0,
                totalBytes: 26845593,
                recoveryMetadataVersion: 1,
                internalBreakdown: {
                  filesBytes: 26845593,
                  fileGroups: { 'srl-shared-intake': 26845593 },
                },
              }
            if (plugin === 'NativeLibrary' && method === 'listRecoveryCandidates')
              return { candidates: [], scanned: 0 }
            if (plugin === 'ShareReceiver' && method === 'listIntakeFiles') {
              fixture.reads++
              return { entries: fixture.entries }
            }
            if (plugin === 'ShareReceiver' && method === 'removeIntakeFile') {
              assertFixture(options.token === 'old' && options.snapshot === 'old-fingerprint')
              fixture.removals.push(options)
              fixture.entries = fixture.entries.filter((entry) => entry.token !== 'old')
              return { removedBytes: 26843545 }
            }
            if (plugin === 'ShareReceiver' && method === 'removeIntakeReceipts') {
              fixture.receiptCalls++
              assertFixture(
                options.items.length <= 64 &&
                  options.items.every((item) =>
                    fixture.entries.some(
                      (entry) =>
                        entry.token === item.token &&
                        entry.receiptOnly &&
                        entry.snapshot === item.snapshot,
                    ),
                  ),
              )
              if (fixture.receiptCalls === 1)
                await new Promise((resolve) => {
                  fixture.finishReceiptBatch = resolve
                })
              const tokens = options.items.map((item) => item.token)
              fixture.receiptRemovals.push(...tokens)
              fixture.entries = fixture.entries.filter((entry) => !tokens.includes(entry.token))
              return { removedTokens: tokens, removedBytes: tokens.length * 13, skipped: [] }
            }
            throw new Error(`Unexpected native fixture request ${plugin}.${method}`)
          },
        }
        function assertFixture(condition) {
          if (!condition) throw new Error('Unexpected cleanup target')
        }
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      const tap = async (locator) => {
        await locator.scrollIntoViewIfNeeded()
        await locator.tap()
      }
      try {
        await page.goto(environment.baseUrl)
        await page.getByRole('button', { name: '设置', exact: true }).waitFor()
        // Start as Web so the real isolated IndexedDB stays the storage owner. Only explicit
        // inspection/cleanup uses the native bridge fixture; no product fixture flags exist.
        await page.evaluate((value) => {
          window.androidBridge = {}
          document.documentElement.dataset.theme = value
        }, theme)
        await tap(page.getByRole('button', { name: '设置', exact: true }))
        const settings = page.getByRole('dialog', { name: '设置', exact: true })
        const downloads = settings.locator('label').filter({ hasText: '增加多线路下载' })
        assert.equal(await downloads.locator('input').isChecked(), false)
        await tap(downloads)
        const downloadConfirm = page.getByRole('alertdialog', {
          name: '增加多线路下载',
          exact: true,
        })
        await downloadConfirm.waitFor()
        assert.equal(await downloads.locator('input').isChecked(), false)
        await tap(downloadConfirm.getByRole('button', { name: '取消', exact: true }))
        await downloadConfirm.waitFor({ state: 'hidden' })
        assert.equal(await downloads.locator('input').isChecked(), false)
        assert.deepEqual(await page.evaluate(() => window.__intakeFixture.previewConcurrency), [])
        await tap(downloads)
        await tap(downloadConfirm.getByRole('button', { name: '确定', exact: true }))
        await downloadConfirm.waitFor({ state: 'hidden' })
        await page.waitForFunction(
          () => localStorage.getItem('srl.preview.increaseDownloadConcurrency') === 'true',
        )
        assert.equal(await downloads.locator('input').isChecked(), true)
        await tap(settings.getByRole('button', { name: '关闭设置', exact: true }))
        await tap(page.getByRole('button', { name: '设置', exact: true }))
        assert.equal(await downloads.locator('input').isChecked(), true)
        await tap(downloads)
        await page.waitForFunction(
          () => localStorage.getItem('srl.preview.increaseDownloadConcurrency') === 'false',
        )
        assert.equal(await downloads.locator('input').isChecked(), false)
        assert.equal(await downloadConfirm.count(), 0)
        assert.deepEqual(await page.evaluate(() => window.__intakeFixture.previewConcurrency), [
          true,
          false,
        ])
        await tap(settings.getByRole('button', { name: '检查原件与空间', exact: true }))
        await tap(settings.getByRole('button', { name: '查看文件', exact: true }))
        const list = settings.getByRole('region', { name: '接收暂存文件列表' })
        await list.getByText('正在下载或导入', { exact: true }).waitFor()
        assert.equal(
          await list
            .getByRole('button', { name: '清理 正在接收的附件.json', exact: true })
            .isDisabled(),
          true,
        )
        const cleanup = list.getByRole('button', { name: /^清理 很长的旧附件/ })
        await tap(cleanup)
        let confirmation = page.getByRole('alertdialog', {
          name: '清理这份接收暂存？',
          exact: true,
        })
        await confirmation.waitFor()
        assert.ok((await confirmation.innerText()).includes('将放弃这次导入'))
        await tap(confirmation.getByRole('button', { name: '取消', exact: true }))
        await confirmation.waitFor({ state: 'hidden' })
        assert.equal(await page.evaluate(() => window.__intakeFixture.removals.length), 0)
        await tap(cleanup)
        confirmation = page.getByRole('alertdialog', { name: '清理这份接收暂存？', exact: true })
        await tap(confirmation.getByRole('button', { name: '清理这份暂存', exact: true }))
        await list.getByText('已清理 25.6 MiB', { exact: true }).waitFor()
        assert.equal(await cleanup.count(), 0)
        assert.equal(await page.evaluate(() => window.__intakeFixture.removals.length), 1)
        const bulk = list.getByRole('button', { name: '一键清理已处理回执', exact: true })
        await tap(bulk)
        const receiptConfirm = page.getByRole('alertdialog', {
          name: '清理全部已处理回执？',
          exact: true,
        })
        await receiptConfirm.waitFor()
        assert.ok((await receiptConfirm.innerText()).includes('130 项已处理回执'))
        await tap(receiptConfirm.getByRole('button', { name: '取消', exact: true }))
        await receiptConfirm.waitFor({ state: 'hidden' })
        assert.equal(await page.evaluate(() => window.__intakeFixture.receiptCalls), 0)
        await tap(bulk)
        await tap(receiptConfirm.getByRole('button', { name: '清理全部回执', exact: true }))
        await page.waitForFunction(() => !!window.__intakeFixture.finishReceiptBatch)
        await tap(list.getByRole('button', { name: '暂停清理', exact: true }))
        await page.evaluate(() => window.__intakeFixture.finishReceiptBatch())
        await list.getByText('已暂停，等待手动继续', { exact: true }).waitFor()
        assert.equal(await page.evaluate(() => window.__intakeFixture.receiptCalls), 1)
        await tap(list.getByRole('button', { name: '继续清理', exact: true }))
        await list.getByText('已清理 130 项回执 · 1.7 KiB', { exact: true }).waitFor()
        assert.equal(await page.evaluate(() => window.__intakeFixture.receiptCalls), 3)
        assert.equal(
          await page.evaluate(() => new Set(window.__intakeFixture.receiptRemovals).size),
          130,
        )
        assert.equal(await list.getByText('正在下载或导入', { exact: true }).count(), 1)
        const layout = await list.evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
        assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout))
        assert.deepEqual(errors, [])
        await list.screenshot({ path: `${environment.outputDir}/intake-${width}-${theme}.png` })
        await tap(settings.getByRole('button', { name: '关闭设置', exact: true }))
        await page.evaluate(() => {
          delete window.androidBridge
        })
        await tap(page.getByRole('button', { name: '功能', exact: true }))
        await tap(page.getByRole('button', { name: 'APP 管理', exact: true }))
        assert.equal(
          await page.getByRole('button', { name: '检查 APP 状态', exact: true }).count(),
          0,
        )
        await tap(page.getByRole('button', { name: '查看 APP 管理说明', exact: true }))
        const help = page.getByRole('dialog', { name: 'APP 管理说明', exact: true })
        await tap(help.getByRole('button', { name: '检查 APP 状态', exact: true }))
        await help.getByRole('status').filter({ hasText: '程序文件完整' }).waitFor()
        const helpLayout = await help.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return { left: bounds.left, right: bounds.right, width: window.innerWidth }
        })
        assert.ok(helpLayout.left >= 0 && helpLayout.right <= helpLayout.width + 1)
        await help.screenshot({ path: `${environment.outputDir}/app-help-${width}-${theme}.png` })
        await tap(help.getByRole('button', { name: '知道了', exact: true }))
        await help.waitFor({ state: 'hidden' })
        assert.deepEqual(errors, [])
        results.push({
          width,
          height,
          theme,
          layout,
          helpLayout,
          removedFixtureOnly: true,
          receiptPauseResume: true,
          rootPreviewDownloadControls: true,
        })
      } catch (error) {
        await saveAuditFailure(context, environment, error)
        throw error
      } finally {
        await context.close()
      }
    }
  }
  await writeFile(`${environment.outputDir}/results.json`, JSON.stringify(results, null, 2) + '\n')
  console.log(`PASS: ${results.length} mobile touch intake scenarios; native bridge fixture only`)
} finally {
  await browser.close()
}
