/* global document, getComputedStyle, localStorage */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import console from 'node:console'
import { strFromU8, unzipSync } from 'fflate'
import {
  createAuditStorageContext,
  prepareAuditContext,
  auditEnvironment,
  launchAuditBrowser,
  saveAuditFailure,
  openAuditFeature,
} from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'resource-detail-layout')
const detailStyles = await readFile('src/styles/ResourceDetails.css', 'utf8')
const browser = await launchAuditBrowser(environment)
const nativeFixtures = [
  [
    '单文件角色',
    {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '单文件角色', first_mes: '已保存的开场白' },
    },
    'png',
  ],
  [
    '单文件世界书',
    { name: '单文件世界书', entries: { 0: { uid: 0, key: ['test'], content: '当前世界书内容' } } },
    'json',
  ],
  ['单文件预设', { name: '单文件预设', prompts: [], prompt_order: [], temperature: 0.7 }, 'json'],
  [
    '单文件正则',
    {
      sourceName: '单文件正则',
      global: [{ scriptName: '当前规则', findRegex: 'a', replaceString: 'b', disabled: true }],
      scoped: [{ scriptName: '角色规则', findRegex: 'x', replaceString: 'y', disabled: false }],
    },
    'regex',
  ],
  [
    '单文件快速回复',
    { name: '单文件快速回复', version: 2, qrList: [{ label: '回复', message: '当前内容' }] },
    'json',
  ],
  [
    '单文件主题',
    { name: '单文件主题', main_text_color: '#fff', custom_css: 'body{color:red}' },
    'json',
  ],
  [
    '单文件脚本',
    {
      type: 'script',
      id: 'native-script',
      name: '单文件脚本',
      content: 'return 2',
      button: { buttons: [] },
    },
    'json',
  ],
  [
    '单文件人设',
    {
      personas: { 'avatar.png': '单文件人设' },
      persona_descriptions: {
        'avatar.png': { description: '当前人设', position: 0, depth: 2, role: 0 },
      },
    },
    'json',
  ],
  [
    '单文件聊天',
    [
      { user_name: '用户', character_name: '角色', chat_metadata: { keep: true } },
      { name: '角色', is_user: false, mes: '当前聊天', swipes: ['甲', '乙'], unknown: true },
    ],
    'jsonl',
  ],
]
async function downloadedBytes(download) {
  const stream = await download.createReadStream()
  assert.ok(stream)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}
try {
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
    [1280, 900],
  ]) {
    const context = await createAuditStorageContext(browser, environment, {
      viewport: { width, height },
      hasTouch: width < 500,
    })
    let auditStep = `${width}/layout`
    try {
      await prepareAuditContext(context, environment)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(environment.baseUrl)
      const interact = (locator) => (width < 500 ? locator.tap() : locator.click())
      for (const theme of ['light', 'dark']) {
        auditStep = `${width}/${theme}/modified-tags-system-settings`
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value
        }, theme)
        await interact(page.getByRole('button', { name: /^(打开设置|设置)$/u }))
        const tags = page.getByRole('checkbox', { name: /修改版是否更改标签/u })
        assert.equal(await tags.isChecked(), false)
        await interact(tags.locator('..'))
        assert.equal(await tags.isChecked(), true)
        await page.screenshot({
          path: resolve(environment.outputDir, `modified-tags-${width}-${theme}.png`),
        })
        const rect = await tags.locator('..').boundingBox()
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width)
        await interact(page.getByRole('button', { name: '关闭设置', exact: true }))
        await interact(page.getByRole('button', { name: /^(打开设置|设置)$/u }))
        assert.equal(await tags.isChecked(), true)
        await interact(tags.locator('..'))
        assert.equal(await tags.isChecked(), false)
        await interact(page.getByRole('button', { name: '关闭设置', exact: true }))
      }
      await interact(page.getByRole('button', { name: '功能', exact: true }))
      await interact(page.getByRole('button', { name: 'APP 管理', exact: true }))
      const bridgeApp = page.locator('.official-app-manager li').filter({ hasText: '酒馆互传' })
      await interact(bridgeApp.getByRole('button', { name: '下载', exact: true }))
      await page.getByRole('status').filter({ hasText: '安装成功' }).waitFor()
      await interact(page.locator('.feature-app-header__back').first())
      await openAuditFeature(page, '酒馆互传')
      const settings = page.getByRole('button', { name: '酒馆互传设置', exact: true })
      for (const theme of ['light', 'dark']) {
        auditStep = `${width}/${theme}/tavern-settings`
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme
        }, theme)
        const gear = await settings.boundingBox()
        assert.ok(gear && gear.width >= 44 && gear.height >= 44 && gear.x + gear.width <= width)
        const title = await page.locator('#tavern-bridge-title').boundingBox()
        assert.ok(title && title.x + title.width <= gear.x)
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        if (width === 375)
          await page.screenshot({
            path: resolve(environment.outputDir, `tavern-header-${width}-${theme}.png`),
          })
        await interact(settings)
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        assert.equal(
          await dialog
            .getByRole('button', { name: '修改版', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        )
        assert.equal(await settings.getAttribute('title'), '发送修改版')
        const box = await dialog.boundingBox()
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1)
        await mkdir(environment.outputDir, { recursive: true })
        await page.screenshot({
          path: resolve(environment.outputDir, `tavern-settings-${width}-${theme}.png`),
        })
        await interact(dialog.getByRole('button', { name: '原版', exact: true }))
        assert.equal(await settings.getAttribute('title'), '发送原版')
        assert.equal(
          await page.evaluate(() => localStorage.getItem('srl.tavern.sendContent')),
          'original',
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: '原版', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        )
        await interact(dialog.getByRole('button', { name: '关闭互传设置', exact: true }))
        await interact(page.getByRole('button', { name: '返回功能桌面', exact: true }))
        await openAuditFeature(page, '酒馆互传')
        assert.equal(await settings.getAttribute('title'), '发送原版')
        await interact(settings)
        assert.equal(
          await dialog
            .getByRole('button', { name: '原版', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        )
        await interact(dialog.getByRole('button', { name: '关闭互传设置', exact: true }))
        assert.equal(await settings.getAttribute('title'), '发送原版')
        await interact(settings)
        await interact(dialog.getByRole('button', { name: '修改版', exact: true }))
        assert.equal(
          await page.evaluate(() => localStorage.getItem('srl.tavern.sendContent')),
          'modified',
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: '修改版', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        )
        await interact(dialog.getByRole('button', { name: '关闭互传设置', exact: true }))
      }
      await interact(page.getByRole('button', { name: '返回功能桌面', exact: true }))
      await interact(page.getByRole('button', { name: '返回资源库', exact: true }))
      await page
        .locator('.import-button__input')
        .first()
        .setInputFiles([
          {
            name: '酒馆助手.srl-link.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
              JSON.stringify({ description: '未识别的 JSON 资源', example: '布局样本' }),
            ),
          },
          {
            name: '关联布局样本.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ description: '供关联操作的第二份资源' })),
          },
        ])
      await page.locator('.resource-card').nth(1).waitFor()
      const detailButton = page
        .locator('.resource-card')
        .filter({ hasText: '酒馆助手.srl-link' })
        .getByRole('button', { name: '查看并编辑资源详情', exact: true })
      if (width < 500) await detailButton.tap()
      else await detailButton.click()
      const stats = page.locator('.resource-detail__stats')
      const statsLayout = await stats.evaluate((element) => {
        const style = getComputedStyle(element)
        const first = element.firstElementChild?.getBoundingClientRect()
        const second = element.children.item(1)?.getBoundingClientRect()
        return {
          display: style.display,
          columns: style.gridTemplateColumns.split(/\s+/u).length,
          firstTop: first?.top,
          secondTop: second?.top,
        }
      })
      const statsLabel = `${width}/resource statistics: ${JSON.stringify(statsLayout)}`
      assert.equal(statsLayout.display, 'grid', statsLabel)
      assert.equal(statsLayout.columns, 4, statsLabel)
      assert.equal(statsLayout.secondTop, statsLayout.firstTop, statsLabel)
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          (theme) => document.documentElement.setAttribute('data-theme', theme),
          theme,
        )
        for (const lateStyles of [false, true]) {
          // Model the panel stylesheet arriving after the shell's responsive rules.
          const style = lateStyles ? await page.addStyleTag({ content: detailStyles }) : undefined
          const geometry = await page.locator('.resource-detail__layout').evaluate((element) => {
            const folio = element.querySelector('.resource-detail__folio').getBoundingClientRect()
            const content = element
              .querySelector('.resource-detail__content')
              .getBoundingClientRect()
            return {
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
              folioBottom: folio.bottom,
              folioRight: folio.right,
              contentTop: content.top,
              contentLeft: content.left,
              contentRight: content.right,
            }
          })
          const label = `${width}/${theme}/lateStyles=${lateStyles}: ${JSON.stringify(geometry)}`
          assert.ok(geometry.scrollWidth <= geometry.width + 1, label)
          assert.ok(geometry.contentRight <= width + 1, label)
          if (width < 500) assert.ok(geometry.contentTop >= geometry.folioBottom - 1, label)
          else assert.ok(geometry.contentLeft >= geometry.folioRight - 1, label)
          if (style) await style.evaluate((element) => element.remove())
        }
        await page.getByRole('tab', { name: /^关联/ }).click()
        const relation = page.locator('.resource-relation').first()
        await relation.locator('.resource-relation__select input').check()
        for (const lateStyles of [false, true]) {
          const style = lateStyles ? await page.addStyleTag({ content: detailStyles }) : undefined
          const geometry = await relation.evaluate((element) => {
            const select = element
              .querySelector('.resource-relation__select')
              .getBoundingClientRect()
            const actions = element
              .querySelector('.resource-relation__actions')
              .getBoundingClientRect()
            return {
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
              selectBottom: select.bottom,
              selectRight: select.right,
              actionsTop: actions.top,
              actionsLeft: actions.left,
            }
          })
          const label = `relations/${width}/${theme}/lateStyles=${lateStyles}: ${JSON.stringify(geometry)}`
          assert.ok(geometry.scrollWidth <= geometry.width + 1, label)
          if (width < 500) assert.ok(geometry.actionsTop >= geometry.selectBottom - 1, label)
          else assert.ok(geometry.actionsLeft >= geometry.selectRight - 1, label)
          if (style) await style.evaluate((element) => element.remove())
        }
        await page.getByRole('tab', { name: '概览', exact: true }).click()
      }
      await page.getByLabel('资源名称', { exact: true }).fill('布局保存样本')
      const save = page.getByRole('button', { name: '保存修改', exact: true })
      if (width < 500) await save.tap()
      else await save.click()
      await page.locator('.resource-detail-overlay').waitFor({ state: 'detached' })
      await page.reload()
      await page.locator('.resource-card').filter({ hasText: '布局保存样本' }).waitFor()
      const tap = (locator) => (width < 500 ? locator.tap() : locator.click())
      const closeDetail = () =>
        tap(
          page
            .locator('.resource-detail__header')
            .getByRole('button', { name: width < 500 ? '返回资源库' : '关闭', exact: true }),
        )
      await tap(
        page
          .locator('.resource-card')
          .filter({ hasText: '布局保存样本' })
          .getByRole('button', { name: '查看并编辑资源详情', exact: true }),
      )
      const downloadResource = page
        .locator('.resource-detail__summary-actions')
        .getByRole('button', { name: '下载资源', exact: true })
      let downloadCount = 0
      page.on('download', () => downloadCount++)
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          (value) => document.documentElement.setAttribute('data-theme', value),
          theme,
        )
        await tap(downloadResource)
        const choice = page.locator('.confirm-dialog')
        await choice.waitFor()
        const layout = await choice.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            left: bounds.left,
            right: bounds.right,
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }
        })
        assert.ok(
          layout.left >= 0 && layout.right <= width && layout.scrollWidth <= layout.width + 1,
          `${width}/${theme}/download dialog: ${JSON.stringify(layout)}`,
        )
        const beforeCancel = downloadCount
        await tap(choice.getByRole('button', { name: '取消', exact: true }))
        await choice.waitFor({ state: 'detached' })
        assert.equal(downloadCount, beforeCancel, 'cancel does not download')
        for (const version of ['原版', '修改版']) {
          await tap(downloadResource)
          const waiting = page.waitForEvent('download')
          await tap(
            choice.getByRole('button', {
              name: version === '原版' ? '下载原版' : '完整修改包',
              exact: true,
            }),
          )
          const download = await waiting
          const stream = await download.createReadStream()
          assert.ok(stream, 'download stream exists')
          const chunks = []
          for await (const chunk of stream) chunks.push(chunk)
          const bytes = Buffer.concat(chunks)
          if (version === '原版') {
            assert.deepEqual(JSON.parse(bytes.toString('utf8')), {
              description: '未识别的 JSON 资源',
              example: '布局样本',
            })
            assert.equal(download.suggestedFilename(), '酒馆助手.srl-link.json')
          } else {
            assert.equal(download.suggestedFilename(), '布局保存样本-修改版.zip')
            const entries = unzipSync(bytes)
            const manifest = JSON.parse(strFromU8(entries['manifest.json']))
            assert.equal(manifest.resources[0].name, '布局保存样本')
            assert.equal(manifest.resources[0].relatedResourceIds.length, 1)
            assert.deepEqual(JSON.parse(strFromU8(entries[manifest.resources[0].archivePath])), {
              description: '未识别的 JSON 资源',
              example: '布局样本',
            })
          }
          await choice.waitFor({ state: 'detached' })
        }
      }
      await closeDetail()
      await page.locator('.resource-detail-overlay').waitFor({ state: 'detached' })
      await page
        .locator('.import-button__input')
        .first()
        .setInputFiles(
          nativeFixtures.map(([name, data]) => ({
            name: `${name}.json`,
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(data)),
          })),
        )
      await page.locator('.resource-card').filter({ hasText: '单文件聊天' }).waitFor()
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          (value) => document.documentElement.setAttribute('data-theme', value),
          theme,
        )
        for (const [name, data, format] of nativeFixtures) {
          auditStep = `${width}/${theme}/${name}`
          const card = page.locator('.resource-card').filter({ hasText: name })
          // Render content-visibility:auto cards before measuring their nested button in WebKit.
          await card.scrollIntoViewIfNeeded()
          await tap(card.getByRole('button', { name: '查看并编辑资源详情', exact: true }))
          await tap(downloadResource)
          const choice = page.locator('.confirm-dialog')
          await choice.waitFor()
          assert.equal(await choice.getByRole('button').count(), 4)
          const geometry = await choice.evaluate((element) => ({
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
            bounds: [...element.querySelectorAll('button')].map((button) => {
              const r = button.getBoundingClientRect()
              return { left: r.left, right: r.right, height: r.height }
            }),
          }))
          assert.ok(geometry.scrollWidth <= geometry.width + 1)
          for (const button of geometry.bounds)
            assert.ok(button.left >= 0 && button.right <= width && button.height >= 44)
          if (name === '单文件角色') {
            await mkdir(environment.outputDir, { recursive: true })
            await page.screenshot({
              path: resolve(environment.outputDir, `download-${width}-${theme}.png`),
            })
          }
          const waiting = page.waitForEvent('download')
          await tap(choice.getByRole('button', { name: '修改版单文件', exact: true }))
          const download = await waiting
          const bytes = await downloadedBytes(download)
          assert.equal(
            download.suggestedFilename(),
            `${name}-修改版.${format === 'regex' ? 'json' : format}`,
          )
          if (format === 'png') {
            assert.equal(bytes.readUInt32BE(0), 0x89504e47)
            let embedded
            for (let offset = 8; offset + 12 <= bytes.length;) {
              const length = bytes.readUInt32BE(offset)
              const type = bytes.toString('ascii', offset + 4, offset + 8)
              if (type === 'tEXt') {
                const chunk = bytes.subarray(offset + 8, offset + 8 + length)
                const zero = chunk.indexOf(0)
                if (chunk.subarray(0, zero).toString() === 'chara')
                  embedded = JSON.parse(
                    Buffer.from(chunk.subarray(zero + 1).toString(), 'base64').toString(),
                  )
              }
              offset += length + 12
            }
            assert.deepEqual(embedded, data)
          } else if (format === 'jsonl')
            assert.deepEqual(
              bytes
                .toString()
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line)),
              data,
            )
          else
            assert.deepEqual(
              JSON.parse(bytes.toString()),
              format === 'regex' ? [...data.global, ...data.scoped] : data,
            )
          await choice.waitFor({ state: 'detached' })
          await closeDetail()
          await page.locator('.resource-detail-overlay').waitFor({ state: 'detached' })
        }
      }
      assert.deepEqual(errors, [])
    } catch (error) {
      const failure = new Error(`${auditStep}: ${error.message}`, { cause: error })
      await saveAuditFailure(context, environment, failure)
      throw failure
    } finally {
      await context.close()
    }
  }
  console.log(
    `PASS: ${environment.engine}, four mobile sizes and desktop, light/dark, cold Tavern SVG settings, version choice/cancel/reopen persistence, late panel CSS, selected relation actions, no horizontal overflow, edit/save/reload, download choice/cancel, original/modified ZIP and nine native standalone files.`,
  )
} finally {
  await browser.close()
}
