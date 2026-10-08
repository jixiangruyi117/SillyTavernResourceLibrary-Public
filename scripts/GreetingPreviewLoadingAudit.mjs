/* global document, getComputedStyle, innerHeight, localStorage */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import process from 'node:process'
import console from 'node:console'
import { build, loadConfigFromFile } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { auditEnvironment, launchAuditBrowser } from './AuditEnvironment.mjs'
import { startAuditPreview } from './AuditPreviewServer.mjs'

const environment = auditEnvironment(undefined, 'preview-loading')
const run = process.env.SRL_AUDIT_RUN
if (!run || !process.env.SRL_AUDIT_OUTPUT_DIR)
  throw new Error('Use audit:isolated with --run/--port')
const fixture = resolve('.codex-tmp', run, 'preview-loading')
const source = (file) => resolve(file).replaceAll('\\', '/')
await mkdir(fixture, { recursive: true })
await writeFile(
  resolve(fixture, 'index.html'),
  '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script>',
)
await writeFile(
  resolve(fixture, 'main.js'),
  `import {createApp,h,ref} from 'vue'
import Dialog from '${source('src/components/GreetingPreviewDialog.vue')}'
import BeautificationPreview from '${source('src/components/BeautificationPreview.vue')}'
import Settings from '${source('src/components/LayoutSettingsPanel.vue')}'
import ConfirmDialog from '${source('src/components/ConfirmDialog.vue')}'
import {useAppearanceSettings} from '${source('src/composables/UseAppearanceSettings.ts')}'
import '${source('src/styles/Foundation.css')}'
import '${source('src/styles/ResourceDetails.css')}'
import '${source('src/styles/LayoutAndResponsive.css')}'
import '${source('src/styles/ConfirmDialog.css')}'
localStorage.setItem('srl.preview.allowRemoteResources','true')
localStorage.setItem('srl.preview.allowScripts','true')
document.documentElement.dataset.theme=new URL(location.href).searchParams.get('theme')||'light'
const items=['A','B','C'].map(label=>({label:'开场 '+label,content:'\x60\x60\x60html\\n<html><body><p>正文 '+label+'</p>'+[1,2,3].map(id=>'<img width="180" height="500" alt="图片 '+label+id+'" src="https://preview-assets.example/'+label+id+'.svg">').join('')+'<section hidden><img src="https://preview-assets.example/'+label+'H.svg"></section><p>末尾 '+label+'</p></body></html>\\n\x60\x60\x60'}))
const runtimeScripts=[{id:'loading-audit',name:'loading-audit',source:'character',content:'void 0'}]
const trackedBlob=css=>{const blob=new Blob([JSON.stringify({custom_css:css})],{type:'application/json'});const read=blob.text.bind(blob);blob.text=()=>{document.body.dataset.sourceReads=String(Number(document.body.dataset.sourceReads||0)+1);return read()};return blob}
const themeResource={id:'beauty-audit',name:'美化审计',fileName:'theme.json',originalBlob:trackedBlob('#chat{border-color:red}'),tags:[],favorite:false}
if(new URL(location.href).searchParams.has('settings')) {
createApp({setup(){const control=useAppearanceSettings(()=>{});return()=>h('main',[h(Settings,{vaultEnabled:false,allowRemotePreviews:control.previewPolicy.value.allowRemoteResources,allowScriptPreviews:control.previewPolicy.value.allowScripts,preloadGreetingPreviews:false,preloadBeautificationPreviews:false,increasePreviewDownloads:control.previewPolicy.value.increaseDownloadConcurrency,extractCharacterAssets:false,hideCharacterAssets:false,hideChatDisplayRegex:true,showManuallyBoundResources:true,blurThumbnails:false,autoDownloadDiscordShareLinks:false,persistResourceVersionMatchCache:false,skipVersionComparisonOnImport:false,showPerformanceMonitor:false,hiddenCharacterAssetCount:0,'onUpdate:increasePreviewDownloads':control.applyIncreasedPreviewDownloads}),h(ConfirmDialog)])}}).mount('#app')
} else createApp({setup(){const index=ref(0);const resource=ref(themeResource);return()=>new URL(location.href).searchParams.has('beauty')?h('main',[h('button', {onClick:()=>resource.value={...resource.value,tags:['标签更新'],favorite:true}},'更新标签'),h('button',{onClick:()=>resource.value={...resource.value,originalBlob:trackedBlob('#chat{border-color:tan}')}},'替换内容'),h(BeautificationPreview,{resource:resource.value})]):h(Dialog,{modelValue:index.value,'onUpdate:modelValue':value=>index.value=value,items,runtimeScripts})}}).mount('#app')`,
)
const projectConfig = await loadConfigFromFile({ command: 'build', mode: 'audit' })
const vendorPlugin = projectConfig.config.plugins
  .flat(Infinity)
  .find((plugin) => plugin?.name === 'srl-preview-vendor-globals-source')
if (!vendorPlugin) throw new Error('Missing canonical preview vendor source plugin')
await build({
  root: fixture,
  configFile: false,
  // Exercise settings without installing a service worker for an ephemeral fixture build.
  plugins: [vue(), vendorPlugin, VitePWA({ disable: true })],
  resolve: { dedupe: ['vue'] },
  logLevel: 'warn',
  build: { outDir: resolve(fixture, 'dist') },
})
const preview = await startAuditPreview({
  directory: resolve(fixture, 'dist'),
  port: Number(new URL(environment.baseUrl).port),
  run,
})
let browser
let scenarios = 0
try {
  browser = await launchAuditBrowser(environment)
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [390, 844],
    [430, 932],
  ]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true })
      const page = await context.newPage()
      const pending = new Map()
      const registration = new Map()
      const requestsReady = new Map()
      for (const label of ['A', 'B', 'C'])
        for (let id = 1; id <= 3; id++) {
          const key = label + id + '.svg'
          requestsReady.set(key, new Promise((accept) => registration.set(key, accept)))
        }
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('https://preview-assets.example/**', async (route) => {
        const key = new URL(route.request().url()).pathname.slice(1)
        if (key.endsWith('H.svg')) return // Future-scene assets deliberately remain pending.
        await new Promise((resolveRequest) => {
          pending.set(key, resolveRequest)
          registration.get(key)?.()
        })
        await route
          .fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="500"><rect width="180" height="500" fill="#64ad93"/></svg>',
          })
          .catch(() => undefined)
      })
      const release = (label, ids = [1, 2, 3]) => {
        for (const id of ids) {
          const key = label + id + '.svg'
          const finish = pending.get(key)
          if (!finish) throw new Error('Missing request: ' + key)
          finish()
          pending.delete(key)
        }
      }
      const waitForRequests = async (label) => {
        for (let id = 1; id <= 3; id++) {
          const key = label + id + '.svg'
          await requestsReady.get(key)
        }
      }
      try {
        await page.goto(environment.baseUrl + '/?theme=' + theme)
        const loading = page.locator('.rich-content-preview__loading-status')
        const reader = () =>
          page.frameLocator('iframe[title^="开场 "]').frameLocator('div.TH-render > iframe')
        await waitForRequests('A')
        await loading.waitFor({ state: 'visible' })
        await reader().getByText('正文 A', { exact: true }).waitFor({ state: 'visible' })
        const state = await page.locator('.rich-content-preview__frame').evaluate((element) => {
          const iframe = element.querySelector('iframe')
          const indicator = element.querySelector('.rich-content-preview__loading-status')
          const frame = element.getBoundingClientRect()
          const box = indicator.getBoundingClientRect()
          return {
            visibility: getComputedStyle(iframe).visibility,
            busy: element.getAttribute('aria-busy'),
            centerError: Math.abs((box.left + box.right - frame.left - frame.right) / 2),
            onScreen: box.top >= 0 && box.bottom <= innerHeight,
            transparentToInput: getComputedStyle(indicator).pointerEvents === 'none',
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          }
        })
        if (
          state.visibility !== 'visible' ||
          state.busy !== 'true' ||
          state.centerError > 1 ||
          !state.onScreen ||
          !state.transparentToInput ||
          state.overflow
        )
          throw new Error('Loading layout: ' + JSON.stringify(state))
        if (width === 390 && theme === 'light')
          await page.screenshot({ path: resolve(environment.outputDir, 'loading-390-light.png') })
        const stage = page.locator('.greeting-preview-overlay__stage')
        const stageBox = await stage.boundingBox()
        await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
        await page.mouse.wheel(0, 350)
        await page.waitForFunction(
          () => document.querySelector('.greeting-preview-overlay__stage').scrollTop > 0,
        )
        const scrolledIndicator = await loading.boundingBox()
        if (
          !scrolledIndicator ||
          scrolledIndicator.y < stageBox.y ||
          scrolledIndicator.y + scrolledIndicator.height > stageBox.y + stageBox.height
        )
          throw new Error('Long opening lost its centered indicator while scrolling')
        await page.mouse.wheel(0, -10000)
        await page.waitForFunction(
          () => document.querySelector('.greeting-preview-overlay__stage').scrollTop === 0,
        )
        release('A', [1])
        await reader()
          .getByAltText('图片 A1')
          .evaluate((image) => image.decode())
        if (!(await loading.isVisible())) throw new Error('Loading ended after only one image')
        release('A', [2, 3])
        await loading.waitFor({ state: 'hidden' })
        const openingFrame = page.locator('iframe[title^="开场 "]')
        await openingFrame.evaluate((frame) => (frame.dataset.auditIdentity = 'retained'))
        await page.getByRole('button', { name: '下一条', exact: true }).tap()
        await waitForRequests('B')
        if ((await openingFrame.getAttribute('data-audit-identity')) !== 'retained')
          throw new Error('Opening label change rebuilt the preview session')
        await reader().getByText('正文 B', { exact: true }).waitFor({ state: 'visible' })
        if (!(await loading.isVisible())) throw new Error('Swipe media lost its loading indicator')
        await page.getByRole('button', { name: '下一条', exact: true }).tap()
        await waitForRequests('C')
        await reader().getByText('正文 C', { exact: true }).waitFor({ state: 'visible' })
        release('B')
        if (!(await loading.isVisible())) throw new Error('Late B completion ended C loading')
        release('C')
        await loading.waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: '返回开场白列表', exact: true }).tap()
        await page.locator('.greeting-preview-overlay').waitFor({ state: 'hidden' })
        await page.goto(environment.baseUrl + '/?beauty&theme=' + theme)
        const beautyFrame = page.locator('.beauty-preview__frame')
        const beautyBody = page.frameLocator('.beauty-preview__frame').locator('body')
        await beautyBody.waitFor({ state: 'visible' })
        await page.locator('.beauty-preview__loading').waitFor({ state: 'hidden' })
        await page.getByRole('combobox', { name: '预览场景' }).selectOption('welcome')
        await beautyBody.locator('.welcomePanel').waitFor({ state: 'visible' })
        await beautyFrame.evaluate((frame) => {
          frame.dataset.auditIdentity = 'retained'
        })
        await page.getByRole('button', { name: '更新标签', exact: true }).tap()
        if (
          (await beautyFrame.getAttribute('data-audit-identity')) !== 'retained' ||
          (await beautyBody.getAttribute('data-preview-scene')) !== 'welcome' ||
          (await page.locator('body').getAttribute('data-source-reads')) !== '1'
        )
          throw new Error('Metadata update reread source or reset the beauty preview')
        await page.getByRole('button', { name: '替换内容', exact: true }).tap()
        await beautyBody.locator('#chat').waitFor({ state: 'visible' })
        await page.waitForFunction(() =>
          document
            .querySelector('iframe.beauty-preview__frame')
            ?.srcdoc.includes('#chat{border-color:tan}'),
        )
        if (
          (await beautyFrame.getAttribute('data-audit-identity')) ||
          (await page.locator('body').getAttribute('data-source-reads')) !== '2'
        )
          throw new Error('Replacement source did not produce one fresh beauty preview')
        await page.goto(environment.baseUrl + '/?settings&theme=' + theme)
        const increased = page.getByRole('checkbox', { name: /增加多线路下载/ })
        const increaseTrigger = page.getByText('增加多线路下载', { exact: true })
        await increased.waitFor({ state: 'visible' })
        if (await increased.isChecked()) throw new Error('Extra concurrency enabled by default')
        await increaseTrigger.tap()
        const confirmation = page.getByRole('alertdialog', { name: '增加多线路下载' })
        await confirmation.waitFor({ state: 'visible' })
        if (
          (await increased.isChecked()) ||
          (await page.evaluate(() =>
            localStorage.getItem('srl.preview.increaseDownloadConcurrency'),
          )) === 'true'
        )
          throw new Error('Setting applied before confirmation')
        const box = await confirmation.boundingBox()
        if (
          !box ||
          box.x < 0 ||
          box.y < 0 ||
          box.x + box.width > width + 1 ||
          box.y + box.height > height + 1
        )
          throw new Error('Confirmation overflows mobile viewport')
        if (width === 390 && theme === 'light')
          await page.screenshot({
            path: resolve(environment.outputDir, 'download-confirmation-390-light.png'),
          })
        await confirmation.getByRole('button', { name: '取消', exact: true }).tap()
        await confirmation.waitFor({ state: 'hidden' })
        if (await increased.isChecked()) throw new Error('Cancel enabled downloads')
        await increaseTrigger.tap()
        await confirmation.waitFor({ state: 'visible' })
        await page.keyboard.press('Escape')
        await confirmation.waitFor({ state: 'hidden' })
        if (await increased.isChecked()) throw new Error('Dismissal enabled downloads')
        await increaseTrigger.tap()
        await confirmation.getByRole('button', { name: '确定', exact: true }).tap()
        await page.waitForFunction(
          () => localStorage.getItem('srl.preview.increaseDownloadConcurrency') === 'true',
        )
        if (!(await increased.isChecked())) throw new Error('Confirm did not enable downloads')
        await page.reload()
        if (!(await increased.isChecked())) throw new Error('Setting not retained after reload')
        await increaseTrigger.tap()
        await page.waitForFunction(
          () => localStorage.getItem('srl.preview.increaseDownloadConcurrency') === 'false',
        )
        if (await confirmation.isVisible()) throw new Error('Disabling prompted a confirmation')
        if (errors.length) throw new Error(errors.join('\n'))
        scenarios++
        console.log('开场/美化与加速开关确认、取消、刷新保留、关闭通过：' + width + ' ' + theme)
      } finally {
        for (const finish of pending.values()) finish()
        await context.close()
      }
    }
  }
  console.log('开场白/美化加载审计通过：' + scenarios + ' 组尺寸/主题，共两类预览')
} finally {
  if (browser) await browser.close()
  await preview.close()
}
