/* global document, getComputedStyle */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import console from 'node:console'
import { prepareAuditContext, auditEnvironment, launchAuditBrowser } from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'resource-detail-layout')
const detailStyles = await readFile('src/styles/ResourceDetails.css', 'utf8')
const browser = await launchAuditBrowser(environment)
try {
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
    [1280, 900],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 500 })
    try {
      await prepareAuditContext(context, environment, { trace: false })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(environment.baseUrl)
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
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  }
  console.log(
    `PASS: ${environment.engine}, four mobile sizes and desktop, light/dark, late panel CSS, selected relation actions, no horizontal overflow, edit/save/reload.`,
  )
} finally {
  await browser.close()
}
