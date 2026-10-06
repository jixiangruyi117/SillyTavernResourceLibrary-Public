/* global document, innerWidth, indexedDB, getComputedStyle */
import assert from 'node:assert/strict'
import console from 'node:console'
import process from 'node:process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  auditEnvironment,
  launchAuditBrowser,
  prepareAuditContext,
  openAuditFeature,
  saveAuditFailure,
} from './AuditEnvironment.mjs'

const environment = auditEnvironment(undefined, 'assistant')
const quickWindowOnly = process.env.SRL_ASSISTANT_AUDIT_SCOPE === 'quick-window'
const browser = await launchAuditBrowser(environment)
let context
await mkdir(environment.outputDir, { recursive: true })
try {
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
  ]) {
    for (const theme of ['light', 'dark']) {
      context = await browser.newContext({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
        colorScheme: theme,
        serviceWorkers: 'block',
      })
      await prepareAuditContext(context, environment, { trace: false })
      const page = await context.newPage()
      await page.clock.install()
      page.setDefaultTimeout(15000)
      let requests = 0
      let chooseExpression = true
      let contextReplies = false
      let replyText = '继续制作日记 APP。'
      let holdReply = false
      let releaseReply
      let replyStarted
      let compressionRequests = 0
      const calls = []
      let onlineCommand
      let nativeSearches = 0
      let webpageReads = 0
      await context.route('https://r.jina.ai/**', async (route) => {
        webpageReads++
        await route.fulfill({
          body: 'Title: 公开网页\nURL Source: https://example.com/docs\nMarkdown Content:\n公开资料正文',
          contentType: 'text/plain',
        })
      })
      await context.route('https://assistant-pet-test.invalid/**', async (route) => {
        const body = route.request().postDataJSON()
        calls.push(body)
        if (body.tools?.some((tool) => tool.type === 'web_search')) {
          nativeSearches++
          await route.fulfill({
            json: {
              status: 'completed',
              output: [
                { type: 'web_search_call', status: 'completed' },
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: '公开搜索资料',
                      annotations: [
                        {
                          type: 'url_citation',
                          url: 'https://example.com/docs',
                          title: '公开来源',
                        },
                      ],
                    },
                  ],
                },
              ],
              usage: { input_tokens: 12, output_tokens: 12 },
            },
          })
          return
        }
        if (String(body.messages?.[0]?.content).includes('你负责压缩资源库助手')) {
          compressionRequests++
          await route.fulfill({
            json: {
              id: 'compressed',
              choices: [
                {
                  message: { role: 'assistant', content: '用户正在制作日记 APP，下一步增加搜索。' },
                  finish_reason: 'stop',
                },
              ],
            },
          })
          return
        }
        requests++
        if (holdReply) {
          replyStarted()
          await new Promise((resolve) => {
            releaseReply = resolve
          })
        }
        const assistantCall = requests % 2 === 1
        const pending = onlineCommand
        onlineCommand = undefined
        const message = pending
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `online-${requests}`,
                  type: 'function',
                  function: {
                    name: pending,
                    arguments: JSON.stringify(
                      pending === 'search_web'
                        ? { query: '公开搜索验证' }
                        : { url: 'https://example.com/docs' },
                    ),
                  },
                },
              ],
            }
          : contextReplies
            ? { role: 'assistant', content: replyText }
            : assistantCall
              ? {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: `pet-${requests}`,
                      type: 'function',
                      function: {
                        name: chooseExpression ? 'set_pet_expression' : 'open_feature',
                        arguments: JSON.stringify(
                          chooseExpression
                            ? { expression: 'curious', message: '我吗？我在呢～' }
                            : { target: 'library', guide: 'library-search' },
                        ),
                      },
                    },
                  ],
                }
              : { role: 'assistant', content: '我在呢，想继续做哪个 APP？' }
        await route.fulfill({
          json: {
            id: `reply-${requests}`,
            choices: [
              {
                message,
                finish_reason:
                  pending || (!contextReplies && assistantCall) ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          },
        })
      })
      const tap = async (locator) => {
        await locator.scrollIntoViewIfNeeded()
        await locator.tap()
      }
      const chat = () => page.locator('.product-assistant:visible')
      const pet = () => page.locator('.assistant-pet')
      const openPetChat = async () => {
        await pet().waitFor()
        // Measure once so locator round trips do not separate the two genuine taps.
        const box = await pet().boundingBox()
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
        await page.locator('.assistant-pet-dialog[open]').waitFor()
      }
      const cancelReview = async () => {
        await tap(page.getByRole('button', { name: '取消', exact: true }))
        await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
        await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
      }
      await page.goto(environment.baseUrl, { waitUntil: 'domcontentloaded' })
      await tap(page.getByRole('button', { name: '功能', exact: true }))
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      )
      await openAuditFeature(page, '蒜惹菈')
      await tap(chat().getByRole('button', { name: '聊天设置' }))
      await chat().getByRole('switch', { name: '启用蒜惹菈桌宠' }).check()
      await chat().getByRole('switch', { name: 'AI 控制表情', exact: true }).check()
      await tap(chat().getByRole('button', { name: '助手 API', exact: true }))
      await tap(chat().getByRole('button', { name: '新增', exact: true }))
      await chat().getByLabel('配置名称', { exact: true }).fill('隔离测试 API')
      await chat()
        .getByLabel('API URL', { exact: true })
        .fill('https://assistant-pet-test.invalid/v1')
      await chat().locator('.inline-model-picker input').fill('pet-fixture')
      const apiPanel = chat().locator('.main-api-settings')
      const advancedApi = apiPanel.locator('.main-api-settings__advanced')
      assert.equal(
        await advancedApi.getAttribute('open'),
        null,
        'advanced API settings start collapsed',
      )
      const compactApiHeight = (await apiPanel.boundingBox()).height
      await page.screenshot({
        path: resolve(environment.outputDir, `assistant-api-compact-${width}-${theme}.png`),
      })
      await tap(advancedApi.locator(':scope > summary'))
      const expandedApiHeight = (await apiPanel.boundingBox()).height
      assert.ok(
        expandedApiHeight > compactApiHeight + 200,
        'collapsed parameters recover meaningful vertical space',
      )
      await advancedApi.locator('input[type="number"]').first().fill('2048')
      await tap(advancedApi.locator(':scope > summary'))
      await tap(apiPanel.locator('.main-api-settings__profiletools summary'))
      assert.ok(
        await apiPanel.getByRole('button', { name: '复制', exact: true }).isVisible(),
        'profile management remains discoverable',
      )
      await tap(apiPanel.locator('.main-api-settings__profiletools summary'))
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'compact API has no horizontal overflow',
      )
      const apiControls = await apiPanel
        .locator(
          '.main-api-settings__basic input,.main-api-settings__basic select,.main-api-settings__profilebar > button,.main-api-settings__profiletools summary,.main-api-settings__actions button',
        )
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
      assert.ok(
        apiControls.every((height) => height >= 44),
        'compact API preserves 44px touch targets',
      )
      await tap(chat().getByRole('button', { name: '保存并用于助手', exact: true }))
      await apiPanel.getByRole('status').filter({ hasText: '已保存' }).waitFor()
      await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
      await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
      await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
      if (width === 390)
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-settings-${theme}.png`),
        })
      await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
      await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
      await pet().waitFor()
      await page.clock.runFor(10000)
      await page.locator('.assistant-pet-run').waitFor()
      const run = page.locator('.assistant-pet-run')
      const frames = await run.evaluate((element) => ({
        image: getComputedStyle(element).backgroundImage,
        positions: element
          .getAnimations()[0]
          .effect.getKeyframes()
          .map(
            (frame) =>
              frame.backgroundPosition ||
              `${frame.backgroundPositionX} ${frame.backgroundPositionY}`,
          ),
      }))
      assert.match(frames.image, /assistant-pet-run\.png/u)
      assert.equal(new Set(frames.positions).size, 6, 'six distinct running frames')
      const first = await run.evaluate((element) => getComputedStyle(element).backgroundPosition)
      await page.waitForTimeout(120)
      assert.notEqual(
        await run.evaluate((element) => getComputedStyle(element).backgroundPosition),
        first,
        'running frames actually advance',
      )
      if (width === 390)
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-run-${theme}.png`),
        })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(
        () => document.querySelector('.assistant-pet')?.dataset.pose === 'idle',
      )
      await page.clock.runFor(30000)
      assert.equal(await run.count(), 0, 'reduced motion stops running frames')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      // Real touch taps, rather than synthetic dblclick or calling Vue handlers.
      await pet().tap()
      assert.equal(
        await page.locator('.assistant-pet-dialog[open]').count(),
        0,
        'one tap only greets',
      )
      await pet().tap()
      await page.locator('.assistant-pet-dialog[open]').waitFor()
      assert.equal(await pet().getAttribute('data-pose'), 'chat')
      await chat().getByRole('textbox', { name: '发送消息' }).fill('蒜惹菈，是你吗？')
      await tap(chat().getByRole('button', { name: '发送', exact: true }))
      assert.equal(requests, 0, 'send alone must not request the model')
      await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
      const consent = page.getByRole('button', { name: '确认发送', exact: true })
      await tap(consent)
      await page.waitForFunction(
        () => document.querySelector('.assistant-pet')?.dataset.pose === 'curious',
      )
      assert.ok(calls[0].tools.some((tool) => tool.function.name === 'set_pet_expression'))
      await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
      await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
      await page.getByRole('button', { name: '打开详细对话' }).waitFor()
      assert.match(await page.locator('.assistant-pet-bubble').innerText(), /我在呢/u)
      const tail = await page.locator('.assistant-pet-bubble').evaluate((element) => {
        const pet = document.querySelector('.assistant-pet').getBoundingClientRect()
        const bubble = element.getBoundingClientRect()
        const tip = getComputedStyle(element, '::after')
        return {
          content: tip.content,
          width: tip.width,
          distance: Math.abs(
            bubble.left +
              parseFloat(getComputedStyle(element).getPropertyValue('--pet-tail-x')) -
              pet.left -
              44,
          ),
        }
      })
      assert.equal(tail.content, '""', 'visible speech tail')
      assert.equal(tail.width, '12px')
      assert.ok(tail.distance < 2, 'tail points at the pet even near the viewport edge')
      if (width === 390)
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-bubble-${theme}.png`),
        })
      // Keep a real pending HTTP request alive while hiding/reopening the UI.
      contextReplies = true
      for (const long of [false, true]) {
        await openPetChat()
        replyText = long ? '长回复原文'.repeat(20) : '收起后也想好啦'
        holdReply = true
        const started = new Promise((resolve) => {
          replyStarted = resolve
        })
        await chat().getByRole('textbox', { name: '发送消息' }).fill('收起继续生成的隔离验收')
        await tap(chat().getByRole('button', { name: '发送', exact: true }))
        const before = requests
        const requestStarted = page.waitForRequest('https://assistant-pet-test.invalid/**')
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await page.waitForFunction(
          () => !!document.querySelector('.product-assistant [aria-label="停止生成"]'),
        )
        await requestStarted
        await started
        await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
        assert.equal(await page.locator('.assistant-pet-dialog[open]').count(), 0)
        assert.equal(await pet().getAttribute('data-pose'), 'thinking')
        holdReply = false
        releaseReply()
        await page
          .locator('.assistant-pet-bubble')
          .getByRole('status')
          .filter({ hasText: long ? '对话内容太长啦，请点开再看' : replyText })
          .waitFor()
        await openPetChat()
        assert.equal(await chat().locator('.chat-message--assistant').last().innerText(), replyText)
        assert.equal(requests, before + 1, 'reopening does not generate another request')
        const handle = page.getByRole('button', { name: '调整快捷对话大小' })
        const start = await page.locator('.assistant-pet-dialog[open]').boundingBox()
        const above = (
          await page.locator('.assistant-pet-dialog[open]').getAttribute('class')
        ).includes('assistant-pet-dialog--above')
        const targetY = (origin) => origin.y + (above ? 40 : -40)
        const handleBox = await handle.boundingBox()
        const origin = {
          x: handleBox.x + handleBox.width / 2,
          y: handleBox.y + handleBox.height / 2,
        }
        if (environment.engine === 'chromium') {
          const resizeTouch = await context.newCDPSession(page)
          await resizeTouch.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ ...origin, id: 1 }],
          })
          await resizeTouch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: origin.x - 30, y: targetY(origin), id: 1 }],
          })
          await resizeTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await resizeTouch.detach()
        } else {
          await page.mouse.move(origin.x, origin.y)
          await page.mouse.down()
          await page.mouse.move(origin.x - 30, targetY(origin), { steps: 6 })
          await page.mouse.up()
        }
        const resized = await page.locator('.assistant-pet-dialog[open]').boundingBox()
        assert.ok(
          resized.width < start.width && resized.height < start.height,
          'real pointer resizing changes both dimensions',
        )
        const cat = await pet().boundingBox()
        assert.ok(
          resized.y + resized.height <= cat.y || resized.y >= cat.y + cat.height,
          'window never covers the cat',
        )
        const navigation = await page.locator('.mobile-bottom-nav').boundingBox()
        assert.ok(
          resized.x >= 0 &&
            resized.x + resized.width <= width &&
            resized.y >= 0 &&
            resized.y + resized.height <= (navigation?.y ?? height),
          'window avoids screen edges and bottom navigation',
        )
        await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
        await openPetChat()
        const reopened = await page.locator('.assistant-pet-dialog[open]').boundingBox()
        assert.equal(reopened.width, resized.width)
        assert.equal(reopened.height, resized.height)
        await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
      }
      if (quickWindowOnly) {
        await openPetChat()
        const beforeDrag = await page.locator('.assistant-pet-dialog[open]').boundingBox()
        const catBefore = await pet().boundingBox()
        const origin = { x: catBefore.x + 44, y: catBefore.y + 44 }
        if (environment.engine === 'chromium') {
          const drag = await context.newCDPSession(page)
          await drag.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ ...origin, id: 1 }],
          })
          await drag.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: origin.x + 30, y: origin.y - 150, id: 1 }],
          })
          await drag.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await drag.detach()
        } else {
          await page.mouse.move(origin.x, origin.y)
          await page.mouse.down()
          await page.mouse.move(origin.x + 30, origin.y - 150, { steps: 6 })
          await page.mouse.up()
        }
        const afterDrag = await page.locator('.assistant-pet-dialog[open]').boundingBox()
        const catAfter = await pet().boundingBox()
        assert.ok(
          afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y,
          'window follows cat drag',
        )
        assert.ok(
          afterDrag.y + afterDrag.height <= catAfter.y ||
            afterDrag.y >= catAfter.y + catAfter.height,
          'drag keeps cat visible',
        )
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-quick-follow-${width}-${theme}.png`),
        })

        await openPetChat()
        assert.equal(
          await page.locator('.assistant-pet-look').count(),
          0,
          'no screenshot switch in quick-chat footer',
        )
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        const screenshots = chat().getByRole('switch', { name: '允许小助手截图', exact: true })
        assert.equal(await screenshots.isChecked(), true)
        await screenshots.uncheck()
        await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
        await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
        await page.screenshot({
          path: resolve(
            environment.outputDir,
            `assistant-screenshot-setting-${width}-${theme}.png`,
          ),
        })
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
        await openPetChat()
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        assert.equal(
          await screenshots.isChecked(),
          false,
          'screenshot permission survives reopening',
        )
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-quick-window-${width}-${theme}.png`),
        })
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await tap(chat().getByRole('button', { name: '偏好记忆', exact: true }))
        for (const [index, text] of [
          '喜欢蓝白配色，回复简短。',
          '外观使用柔和的蓝色。',
        ].entries()) {
          await tap(chat().getByRole('button', { name: '添加偏好', exact: true }))
          await chat()
            .getByLabel(`偏好 ${index + 1}`, { exact: true })
            .fill(text)
        }
        await chat().getByLabel('偏好 2 适用范围', { exact: true }).selectOption('appearance')
        await tap(chat().getByRole('button', { name: '保存偏好', exact: true }))
        await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
        const memoryHeights = await chat()
          .locator('.chat-memory-row')
          .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
        assert.ok(
          memoryHeights.every((value) => value < 140),
          'compact memory rows',
        )
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-memory-quick-${width}-${theme}.png`),
        })
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        const beforeReview = requests
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        const review = page.getByRole('alertdialog')
        await review.waitFor()
        assert.equal(await review.locator('details').count(), 0, 'sending-scope section removed')
        assert.ok(
          (await review.locator(':scope > p').innerText()).length < 180,
          'short default send confirmation',
        )
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-send-review-${width}-${theme}.png`),
        })
        await cancelReview()
        assert.equal(requests, beforeReview, 'cancelling scope review sends nothing')
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await chat().getByRole('switch', { name: '发送前预估 token', exact: true }).check()
        await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
        await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await page.locator('.assistant-token-review__pie').waitFor()
        assert.equal(await review.locator('details').count(), 0, 'no sending scope in token review')
        assert.equal(
          await review.locator(':scope > p').count(),
          0,
          'same token chart in quick chat',
        )
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-token-quick-${width}-${theme}.png`),
        })
        await tap(review.locator('.assistant-token-review__legend button[data-part=history]'))
        const historyDetail = await review.locator('.assistant-token-review__content').innerText()
        assert.ok(
          historyDetail.includes('你：') && historyDetail.includes('蒜惹菈：'),
          'readable dialogue in token details',
        )
        assert.ok(
          !historyDetail.includes('"role":'),
          'no JSON message wrappers in dialogue preview',
        )
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-token-history-${width}-${theme}.png`),
        })
        await tap(review.getByRole('button', { name: '返回 token 预估', exact: true }))
        await cancelReview()
        assert.equal(requests, beforeReview, 'cancelling token review sends nothing')
        await tap(chat().getByRole('button', { name: '展开完整对话', exact: true }))
        await page.locator('.assistant-pet-dialog[open]').waitFor({ state: 'hidden' })
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await tap(chat().getByRole('button', { name: '偏好记忆', exact: true }))
        assert.equal(
          await chat().getByLabel('偏好 1', { exact: true }).inputValue(),
          '喜欢蓝白配色，回复简短。',
        )
        const memoryType = await chat()
          .locator('.chat-memory-row')
          .first()
          .evaluate((row) => ({
            body: getComputedStyle(row.querySelector('textarea')).fontSize,
            scope: getComputedStyle(row.querySelector('select')).fontSize,
            resize: getComputedStyle(row.querySelector('textarea')).resize,
          }))
        assert.equal(memoryType.body, '14px', 'mobile form baseline does not override memory body')
        assert.equal(memoryType.scope, '12px', 'compact scope label')
        assert.equal(memoryType.resize, 'none', 'no native resize corner')
        const longMemory =
          '喜欢蓝白配色；回复偏好简短中文；只有真实工具回执才可声称操作成功。'.repeat(5)
        await chat().getByLabel('偏好 1', { exact: true }).fill(longMemory)
        const memorySize = await chat()
          .getByLabel('偏好 1', { exact: true })
          .evaluate((field) => ({
            scroll: field.scrollHeight,
            client: field.clientHeight,
          }))
        assert.ok(
          memorySize.scroll <= memorySize.client + 2,
          'long memory fits without inner scrolling',
        )
        await chat().getByLabel('偏好 1', { exact: true }).fill('喜欢蓝白配色，回复简短。')
        const memoryButtons = await chat()
          .locator('.chat-memory-actions button')
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              hit: node.getBoundingClientRect().height,
              inset: getComputedStyle(node, '::before').top,
            })),
          )
        assert.ok(
          memoryButtons.every((button) => button.hit >= 44 && button.inset === '6px'),
          'compact visible buttons retain real 44px targets',
        )
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-memory-full-${width}-${theme}.png`),
        })
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        const petSwitch = chat().getByRole('switch', { name: '启用蒜惹菈桌宠', exact: true })
        await petSwitch.uncheck()
        assert.equal(
          await chat().getByRole('switch', { name: '桌宠走动动画', exact: true }).count(),
          0,
        )
        assert.equal(
          await chat().getByRole('switch', { name: 'AI 控制表情', exact: true }).count(),
          0,
        )
        assert.equal(await screenshots.count(), 1, 'screenshot permission stays independent')
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-off-${width}-${theme}.png`),
        })
        await petSwitch.check()
        assert.equal(
          await chat().getByRole('switch', { name: 'AI 控制表情', exact: true }).isChecked(),
          true,
        )
        const archive = chat().getByRole('button', { name: /归档并开始新对话/u })
        await tap(archive)
        await page.getByRole('alertdialog', { name: '归档并开始新对话', exact: true }).waitFor()
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-archive-confirm-${width}-${theme}.png`),
        })
        await tap(page.getByRole('button', { name: '取消', exact: true }))
        assert.equal(await archive.isVisible(), true, 'cancel retains current chat/settings')
        await tap(archive)
        await tap(page.getByRole('button', { name: '归档并新建', exact: true }))
        await chat().getByRole('textbox', { name: '发送消息', exact: true }).waitFor()
        assert.equal(
          await chat().locator('.chat-message--user').count(),
          0,
          'confirmed archive starts an empty chat',
        )
        assert.equal(requests, beforeReview, 'UI workflow sends no extra model requests')
        console.log(
          `PASS ${environment.engine} ${width} ${theme}: pending reply, long bubble, native resize, cat visible, screenshot setting`,
        )
        await context.close()
        context = undefined
        continue
      }
      contextReplies = false
      replyText = '继续制作日记 APP。'
      await page.reload({ waitUntil: 'domcontentloaded' })
      await pet().waitFor()
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      )
      // Disable persisted expression control through the original settings UI.
      await openPetChat()
      await tap(chat().getByRole('button', { name: '聊天设置' }))
      assert.equal(
        await chat().getByRole('switch', { name: 'AI 控制表情', exact: true }).isChecked(),
        true,
      )
      await chat().getByRole('switch', { name: 'AI 控制表情', exact: true }).uncheck()
      await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
      await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
      requests = 0
      await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
      await tap(consent)
      await page.waitForFunction(
        () => document.querySelector('.assistant-pet')?.dataset.pose === 'chat',
      )
      assert.equal(
        calls.at(-2).tools.some((tool) => tool.function.name === 'set_pet_expression'),
        false,
      )
      await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
      // Native pointer hold/drag, plus native touch taps on both engines.
      const bounds = await pet().boundingBox()
      const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const touch =
        environment.engine === 'chromium' ? await context.newCDPSession(page) : undefined
      if (touch)
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: origin.x, y: origin.y, id: 1 }],
        })
      else {
        await page.mouse.move(origin.x, origin.y)
        await page.mouse.down()
      }
      await page.waitForTimeout(600)
      assert.equal(
        await pet().getAttribute('data-pose'),
        'lifted',
        'native hold uses the hanging pose',
      )
      if (width === 390)
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-lifted-${theme}.png`),
        })
      assert.equal(
        await page.locator('.assistant-pet-dialog[open]').count(),
        0,
        'holding must not open chat',
      )
      if (touch) {
        for (let step = 1; step <= 8; step++)
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              {
                x: origin.x + ((70 - origin.x) * step) / 8,
                y: origin.y + ((200 - origin.y) * step) / 8,
                id: 1,
              },
            ],
          })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await touch.detach()
      } else {
        await page.mouse.move(70, 200, { steps: 8 })
        await page.mouse.up()
      }
      const dragged = await pet().boundingBox()
      assert.ok(
        Math.abs(dragged.x + 44 - 70) < 5 && Math.abs(dragged.y + 44 - 200) < 5,
        `native drag reaches destination: ${JSON.stringify(dragged)}`,
      )
      // Observe the isolated database's committed postcondition before a hard
      // browser reload, which otherwise can abort the still-pending IDB write.
      await page.waitForFunction(
        ({ width, height }) =>
          new Promise((accept, reject) => {
            const opened = indexedDB.open('SillyTavernResourceLibrary')
            opened.onerror = () => reject(opened.error)
            opened.onsuccess = () => {
              const db = opened.result
              const read = db
                .transaction('settings', 'readonly')
                .objectStore('settings')
                .get('assistant.preferences')
              read.onsuccess = () => {
                const saved = read.result?.value?.petPosition
                accept(
                  Boolean(
                    saved &&
                    Math.abs(saved.x * (width - 96) + 44 - 70) < 5 &&
                    Math.abs(saved.y * (height - 154) + 44 - 200) < 5,
                  ),
                )
                db.close()
              }
              read.onerror = () => {
                db.close()
                reject(read.error)
              }
            }
          }),
        { width, height },
      )
      assert.equal(
        await page.locator('.assistant-pet-dialog[open]').count(),
        0,
        'dragging must not open chat',
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      await pet().waitFor()
      const restored = await pet().boundingBox()
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      )
      assert.ok(
        Math.abs(restored.x + 44 - 70) < 5 && Math.abs(restored.y + 44 - 200) < 5,
        'drag position survives reload',
      )
      // open_feature is terminal, so subsequent mode uses its first tool only.
      await openPetChat()
      await page.locator('.assistant-pet-dialog[open]').waitFor()
      chooseExpression = false
      requests = 0
      await chat().getByRole('textbox', { name: '发送消息' }).fill('资源搜索在哪里？')
      await tap(chat().getByRole('button', { name: '发送', exact: true }))
      await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
      await tap(consent)
      await page.getByRole('status').filter({ hasText: '查找资源在这里哦' }).waitFor()
      const placement = await page.evaluate(() => {
        const target = document.querySelector('.assistant-guide-target').getBoundingClientRect()
        const pet = document.querySelector('.assistant-pet').getBoundingClientRect()
        const bubble = document.querySelector('.assistant-pet-bubble').getBoundingClientRect()
        const coveredControls = Array.from(
          document.querySelectorAll('.toolbar button,.toolbar input,.toolbar select'),
        ).filter((element) => {
          const rect = element.getBoundingClientRect()
          return [pet, bubble].some(
            (area) =>
              area.left < rect.right &&
              area.right > rect.left &&
              area.top < rect.bottom &&
              area.bottom > rect.top,
          )
        }).length
        return {
          coveredControls,
          overlap:
            pet.left < target.right &&
            pet.right > target.left &&
            pet.top < target.bottom &&
            pet.bottom > target.top,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert.equal(placement.overlap, false, 'guiding pet does not cover target')
      assert.equal(placement.coveredControls, 0, 'pet and bubble avoid nearby toolbar controls')
      assert.equal(
        await pet().getAttribute('data-pose'),
        'chat',
        'speaking uses the sitting chat pose',
      )
      assert.equal(placement.overflow, false)
      if (width === 390)
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-guidance-${theme}.png`),
        })
      assert.equal(await page.locator('.assistant-guidance').count(), 0, 'no step-by-step card')
      await page.clock.runFor(8100)
      assert.equal(await page.locator('.assistant-guide-target').count(), 0, 'highlight expires')
      const edgeStart = await pet().boundingBox()
      await page.mouse.move(edgeStart.x + 44, edgeStart.y + 44)
      await page.mouse.down()
      await page.mouse.move(52, 52, { steps: 8 })
      await page.mouse.up()
      await pet().tap()
      await page.locator('.assistant-pet-bubble--below').waitFor()
      const below = await page.locator('.assistant-pet-bubble').boundingBox()
      const edgePet = await pet().boundingBox()
      assert.ok(below.y >= edgePet.y + 88, 'near top edge speech appears below the pet')
      assert.ok(below.x >= 0 && below.x + below.width <= width, 'edge speech stays inside viewport')
      if (width === 390)
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-pet-bubble-edge-${theme}.png`),
        })
      if (width === 390) {
        contextReplies = true
        await openPetChat()
        await page.locator('.assistant-pet-dialog[open]').waitFor()
        for (let i = 0; i < 8; i++) {
          await chat()
            .getByRole('textbox', { name: '发送消息' })
            .fill(`日记制作补充 ${i}：${'公开事项'.repeat(200)}需要搜索功能。`)
          await tap(chat().getByRole('button', { name: '发送', exact: true }))
        }
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await chat().getByRole('switch', { name: '发送前预估 token', exact: true }).check()
        await chat().getByRole('switch', { name: '桌宠走动动画', exact: true }).uncheck()
        await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-context-settings-${theme}.png`),
        })
        await tap(chat().getByRole('button', { name: '压缩当前对话', exact: true }))
        await tap(page.getByRole('button', { name: '确认压缩', exact: true }))
        await chat().getByRole('status').filter({ hasText: '已压缩' }).waitFor()
        assert.ok(compressionRequests > 0, 'manual compression called configured provider')
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        const before = requests,
          compressedBefore = compressionRequests
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await page.getByRole('heading', { name: /预计输入约/u }).waitFor()
        await page.locator('.assistant-token-review__pie').waitFor()
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-token-review-${theme}.png`),
        })
        const sector = page.locator('.assistant-token-review__pie path').first()
        const angle = Number(await sector.getAttribute('data-angle'))
        const pie = await page.locator('.assistant-token-review__pie').boundingBox()
        await page.touchscreen.tap(
          pie.x + pie.width / 2 + Math.cos(angle) * pie.width * 0.3,
          pie.y + pie.height / 2 + Math.sin(angle) * pie.height * 0.3,
        )
        await page.locator('.assistant-token-review__content').waitFor()
        assert.ok(
          (await page.locator('.assistant-token-review__content').innerText()).includes('你是'),
          'sector reveals actual system prompt',
        )
        assert.equal(requests, before, 'reading prompt is local')
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-token-detail-${theme}.png`),
        })
        await tap(page.getByRole('button', { name: '返回 token 预估', exact: true }))
        await cancelReview()
        assert.equal(requests, before, 'cancelled star sends no reply request')
        assert.equal(
          compressionRequests,
          compressedBefore,
          'cancelled star sends no compression request',
        )
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await tap(consent)
        await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
        assert.equal(requests, before + 1, 'confirmed star sends once')
        assert.ok(JSON.stringify(calls.at(-1).messages).includes('较早会话摘要'))
        // Remembered consent cannot bypass the optional per-send estimate.
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await page.getByRole('heading', { name: /预计输入约/u }).waitFor()
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-token-review-${theme}.png`),
        })
        await cancelReview()
        assert.equal(requests, before + 1)
        for (let i = 0; i < 8; i++) {
          await chat()
            .getByRole('textbox', { name: '发送消息' })
            .fill(`新的制作需求 ${i}：${'公开事项'.repeat(200)}`)
          await tap(chat().getByRole('button', { name: '发送', exact: true }))
        }
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await chat().getByRole('switch', { name: '自动压缩上下文', exact: true }).check()
        await chat().getByLabel('上下文 token 阈值', { exact: true }).fill('4000')
        await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
        await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
        await chat()
          .getByRole('switch', { name: '自动压缩上下文', exact: true })
          .scrollIntoViewIfNeeded()
        await page.screenshot({
          path: resolve(environment.outputDir, `assistant-context-settings-${theme}.png`),
        })
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await page.getByRole('heading', { name: /预计输入约/u }).waitFor()
        assert.ok(
          await page
            .getByRole('alertdialog', { name: /预计输入约/u })
            .innerText()
            .then((text) => /压缩 \d+ 条 · \d+ 次请求/u.test(text)),
          'preflight plans automatic compression after saved preferences',
        )
        await cancelReview()
        assert.equal(
          compressionRequests,
          compressedBefore,
          'cancelled automatic preflight is free of provider requests',
        )
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        const automaticResponse = page.waitForResponse(
          (response) =>
            response.url().startsWith('https://assistant-pet-test.invalid/') &&
            String(response.request().postDataJSON().messages?.[0]?.content).includes(
              '你负责压缩资源库助手',
            ),
        )
        await tap(consent)
        await automaticResponse
        await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
        assert.ok(compressionRequests > compressedBefore, 'automatic compression precedes reply')
        await tap(chat().getByRole('button', { name: '关闭快捷对话' }))
        await page.clock.runFor(40000)
        assert.equal(
          await page.locator('.assistant-pet-run').count(),
          0,
          'walking switch stops autonomous animation',
        )
        await page.reload({ waitUntil: 'domcontentloaded' })
        await pet().waitFor()
        await openPetChat()
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        assert.equal(
          await chat().getByRole('switch', { name: '自动压缩上下文', exact: true }).isChecked(),
          true,
        )
        assert.equal(
          await chat().getByRole('switch', { name: '发送前预估 token', exact: true }).isChecked(),
          true,
        )
        assert.equal(
          await chat().getByRole('switch', { name: '桌宠走动动画', exact: true }).isChecked(),
          false,
        )
        assert.ok(
          (await chat().getByRole('status').filter({ hasText: '已压缩' }).count()) > 0,
          'checkpoint survives reload',
        )
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        )
      }
      if (width !== 390) {
        await openPetChat()
        await page.locator('.assistant-pet-dialog[open]').waitFor()
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await chat().getByRole('switch', { name: '发送前预估 token', exact: true }).check()
        await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
        await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
        const before = requests
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        await page.locator('.assistant-token-review__pie').waitFor()
        const panel = await page.locator('.confirm-dialog').boundingBox()
        const cancel = await page.getByRole('button', { name: '取消', exact: true }).boundingBox()
        assert.ok(
          panel.x >= 0 && panel.x + panel.width <= width && cancel.y + cancel.height <= height,
          'token review and actions fit mobile viewport',
        )
        await tap(page.locator('.assistant-token-review__legend button').first())
        await page.locator('.assistant-token-review__content').waitFor()
        await tap(page.getByRole('button', { name: '返回 token 预估', exact: true }))
        await cancelReview()
        assert.equal(requests, before, 'compact token review cancellation sends nothing')
      }
      // The same real chat, preferences and confirm queue; no hidden fixture handler calls.
      contextReplies = true
      if (await chat().locator('.chat-settings').count())
        await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
      await chat().getByRole('textbox', { name: '发送消息' }).fill('PRIVATE_CONTEXT_EXCLUDED')
      await tap(chat().getByRole('button', { name: '发送', exact: true }))
      const excludedBubble = chat().locator('.chat-message--user .chat-bubble').last()
      await excludedBubble.click({ button: 'right' })
      const menuBox = await page.locator('.chat-message-menu').boundingBox()
      assert.ok(
        menuBox.x >= 0 && menuBox.x + menuBox.width <= width,
        'small six-action menu fits viewport',
      )
      await tap(page.getByRole('menuitem', { name: '隐藏', exact: true }))
      assert.ok(
        (await excludedBubble.innerText()).includes('不参与上下文和总结'),
        'excluded message stays visible',
      )
      await tap(chat().getByRole('button', { name: '聊天设置' }))
      await chat().getByRole('switch', { name: '联网工具', exact: true }).check()
      await chat().getByRole('switch', { name: '模型原生搜索', exact: true }).check()
      await chat().getByRole('switch', { name: '发送前预估 token', exact: true }).uncheck()
      await chat().getByRole('switch', { name: '自动压缩上下文', exact: true }).uncheck()
      await chat().getByLabel('上下文 token 阈值', { exact: true }).fill('12000')
      await tap(chat().getByRole('button', { name: '保存设置', exact: true }))
      await chat().getByRole('status').filter({ hasText: '已保存' }).waitFor()
      await tap(chat().getByRole('button', { name: '返回功能桌面', exact: true }))
      const generateOnline = async (name) => {
        onlineCommand = name
        await tap(chat().getByRole('button', { name: '生成回复', exact: true }))
        if (await consent.isVisible()) await tap(consent)
        await page.getByRole('button', { name: '确认读取', exact: true }).waitFor()
      }
      await generateOnline('read_webpage')
      const readsBeforeCancel = webpageReads
      await tap(page.getByRole('button', { name: '取消', exact: true }))
      await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
      assert.equal(
        webpageReads,
        readsBeforeCancel,
        'cancelled webpage read makes zero reader requests',
      )
      await generateOnline('read_webpage')
      await tap(page.getByRole('button', { name: '确认读取', exact: true }))
      await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
      assert.equal(
        webpageReads,
        readsBeforeCancel + 1,
        'accepted read has one actual reader request',
      )
      await generateOnline('search_web')
      await tap(page.getByRole('button', { name: '确认读取', exact: true }))
      await chat().getByRole('button', { name: '生成回复', exact: true }).waitFor()
      assert.equal(nativeSearches, 1, 'native Responses search uses original API exactly once')
      const toolEvidence = calls
        .flatMap((body) => body.messages ?? [])
        .filter((message) => message.role === 'tool')
        .map((message) => message.content)
        .join('\n')
      assert.ok(
        toolEvidence.includes('公开资料正文'),
        'actual webpage body reaches the next model round',
      )
      assert.ok(
        toolEvidence.includes('公开搜索资料'),
        'actual native search body reaches the next model round',
      )
      const native = calls.find((call) => call.tools?.some((tool) => tool.type === 'web_search'))
      assert.equal(native.input.length, 2, 'native search receives only core search rule and query')
      assert.ok(
        !JSON.stringify(calls).includes('PRIVATE_CONTEXT_EXCLUDED'),
        'excluded text never enters any model request',
      )
      await tap(chat().locator('.chat-sources summary').last())
      const sourceLink = chat().locator('.chat-sources a').last()
      assert.equal(
        await sourceLink.getAttribute('href'),
        'https://example.com/docs',
        'source is clickable and persistent',
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'new settings/menu/source UI does not overflow',
      )
      await page.screenshot({
        path: resolve(environment.outputDir, `assistant-context-online-${width}-${theme}.png`),
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await pet().waitFor()
      await openPetChat()
      await chat().locator('.chat-sources').last().waitFor()
      assert.ok(
        (await chat().innerText()).includes('PRIVATE_CONTEXT_EXCLUDED'),
        'excluded original remains visible after reload',
      )
      await tap(chat().locator('.chat-sources summary').last())
      assert.equal(
        await chat().locator('.chat-sources a').last().getAttribute('href'),
        'https://example.com/docs',
        'source survives reload',
      )
      if (width === 390) {
        assert.equal(
          await chat().locator('.chat-history-summary').getAttribute('open'),
          null,
          'summarized originals start collapsed',
        )
        await tap(chat().getByRole('button', { name: '聊天设置' }))
        await tap(chat().getByRole('button', { name: '历史对话' }))
        await chat().getByLabel('搜索聊天记录').fill('日记制作补充 0')
        await tap(chat().getByRole('button', { name: '搜索对话', exact: true }))
        await tap(
          chat().locator('.chat-history-open').filter({ hasText: '日记制作补充 0' }).first(),
        )
        await chat().locator('.chat-message--found').waitFor()
        assert.ok(
          (await chat().locator('.chat-message--found').innerText()).includes('日记制作补充 0'),
          'search locates summarized original',
        )
        assert.notEqual(
          await chat().locator('.chat-history-summary').getAttribute('open'),
          null,
          'search expands summary section',
        )
      }
      console.log(
        `PASS ${environment.engine} ${width} ${theme}: persisted switch, touch taps, ${environment.engine === 'chromium' ? 'touch' : 'mouse'} hold/drag, tool gate, bubble, actual navigation target`,
      )
      await context.close()
      context = undefined
    }
  }
} catch (error) {
  await saveAuditFailure(context, environment, error)
  throw error
} finally {
  await browser.close()
}
