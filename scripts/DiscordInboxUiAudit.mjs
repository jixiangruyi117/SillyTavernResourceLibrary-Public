/* global getComputedStyle, document, innerWidth */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import console from 'node:console'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { auditEnvironment, launchAuditBrowser } from './AuditEnvironment.mjs'
import { startAuditPreview } from './AuditPreviewServer.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = process.env.SRL_AUDIT_RUN
const output = process.env.SRL_AUDIT_OUTPUT_DIR
if (!run || !output) throw new Error('Use audit:isolated with an explicit run and output')
const fixture = resolve(root, '.codex-tmp', run, 'inbox-ui')
const source = (path) => resolve(root, path).replaceAll('\\', '/')
await mkdir(fixture, { recursive: true })
await writeFile(
  resolve(fixture, 'index.html'),
  '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script>',
)
await writeFile(
  resolve(fixture, 'main.js'),
  `
import {createApp,h} from 'vue'
import Mode from '${source('src/components/DiscordNativeInboxMode.vue')}'
import Posts from '${source('src/components/DiscordInboxPanel.vue')}'
import Resources from '${source('src/components/DiscordResourceDownloadPanel.vue')}'
import '${source('src/styles/Foundation.css')}'
import '${source('src/styles/GlassRefinement.css')}'
document.documentElement.dataset.theme = new URL(location.href).searchParams.get('theme') || 'light'
createApp({render:()=>h('main',[h(Mode),h(Posts),h(Resources)])}).mount('#app')
`,
)
const mocks = {
  NativeDiscordInboxService: `
    let running=true;
    export const isNativeDiscordInboxAvailable=()=>true;
    export const readNativeDiscordInboxState=async()=>running;
    const state=value=>{running=value;window.dispatchEvent(new CustomEvent('srl:cloud-inbox-state',{detail:{running}}))};
    export const startNativeDiscordInbox=async()=>state(true);
    export const stopNativeDiscordInbox=async()=>state(false);`,
  DiscordSourceSettingsService: `export const loadDiscordSourceConnectionSettings=()=>({workerBaseUrl:'https://worker.example',inboxLibraryId:'fixture-library',inboxSecret:'fixture-only',inboxName:'测试资源库'});`,
  DiscordHandoffService: `
    let postJobs=[];
    let postHistory=[{id:'post',state:'saved',title:'已保存的测试帖子'}];
    export const inboxConnection=()=>({workerUrl:'https://worker.example',libraryId:'fixture-library'});
    export const readDiscordInboxStatus=async()=>({paired:true,isDefault:true,name:'测试资源库'});
    export const listDiscordInboxJobs=async()=>({jobs:postJobs,hasMore:false,recent:postHistory});
    export const pairDiscordInbox=async()=>{throw Error('Not part of this fixture')};
    export const cancelDiscordInboxJob=async(id)=>{postJobs=postJobs.filter(job=>job.id!==id)};
    export const clearDiscordInboxCloudHistory=async()=>{postHistory=[];return {posts:1,resources:1}};
    export const clearDiscordInboxPairing=async()=>{throw Error('Not part of this fixture')};`,
  DiscordResourceInboxService: `
    const jobs=[
      {id:'downloading',name:'正在下载.json',state:'downloading',updatedAt:3},
      {id:'cancelled',name:'失败记录.json',state:'cancelled',updatedAt:2},
      {id:'wait',name:'待确认.json',state:'waiting_version',updatedAt:1},
    ];
    export const listDiscordResourceJobs=async()=>({hasMore:false,jobs,recent:[{id:'saved',name:'已保存.json',state:'imported',updatedAt:0}]});
    export const acknowledgeDiscordResource=async(id,state)=>{const job=jobs.find(item=>item.id===id);if(job)job.state=state};
    export const cancelDiscordResourceJob=async(id)=>{const job=jobs.find(item=>item.id===id);if(job)job.state='cancelled'};
    export const deleteDiscordResourceJob=async(id)=>{const index=jobs.findIndex(item=>item.id===id);if(index>=0)jobs.splice(index,1)};`,
  UseConfirmDialog: `export const confirmAction=async()=>true;`,
}
await build({
  configFile: false,
  root: fixture,
  plugins: [
    {
      name: 'inbox-ui-fixture',
      enforce: 'pre',
      resolveId(id) {
        const name = id.split('/').at(-1)?.replace(/\.ts$/u, '')
        return Object.hasOwn(mocks, name) ? '\0fixture:' + name : undefined
      },
      load(id) {
        return id.startsWith('\0fixture:') ? mocks[id.slice(9)] : undefined
      },
    },
    vue(),
  ],
  build: { outDir: resolve(fixture, 'dist') },
})
await mkdir(output, { recursive: true })
const url = process.env.SRL_PREVIEW_URL
const preview = await startAuditPreview({
  directory: resolve(fixture, 'dist'),
  port: Number(new URL(url).port),
  run,
})
const engine = process.env.SRL_AUDIT_ENGINE || 'chromium'
const browser = await launchAuditBrowser(auditEnvironment(undefined, 'discord-inbox'))
let scenarios = 0
try {
  for (const width of [320, 375, 390, 430])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto(url + '?theme=' + theme)
        const stop = page.getByRole('button', { name: '停止收件', exact: true })
        await stop.waitFor()
        const box = await stop.boundingBox()
        if (!box || box.height < 44 || box.width < 44) throw new Error('Stop button touch size')
        const style = await stop.evaluate((element) => ({
          appearance: getComputedStyle(element).appearance,
          border: getComputedStyle(element).borderTopStyle,
        }))
        if (style.appearance !== 'none' || style.border !== 'solid')
          throw new Error('Native default button style')
        const histories = page.locator(
          'details.discord-inbox__history, details.discord-downloads__history',
        )
        if ((await histories.count()) !== 2) throw new Error('Missing receipt history')
        for (const history of await histories.all()) {
          if ((await history.getAttribute('open')) !== null)
            throw new Error('Completed history starts expanded')
          const summary = history.locator('summary')
          await summary.tap()
          if ((await history.getAttribute('open')) === null)
            throw new Error('Touch did not expand history')
          await summary.tap()
          if ((await history.getAttribute('open')) !== null)
            throw new Error('Touch did not collapse history')
        }
        await page.getByRole('button', { name: '清理云端', exact: true }).tap()
        await page.getByText('已清理云端记录：帖子 1 条，资源 1 项。').waitFor()
        await page.getByRole('button', { name: '取消 正在下载.json', exact: true }).tap()
        await page
          .locator('li')
          .filter({ hasText: '正在下载.json' })
          .getByText('已取消', { exact: true })
          .waitFor()
        await page.getByRole('button', { name: '清理 失败记录.json', exact: true }).tap()
        await page
          .getByRole('button', { name: '清理 失败记录.json', exact: true })
          .waitFor({ state: 'detached' })
        await stop.tap()
        const start = page.getByRole('button', { name: '开启收件模式', exact: true })
        await start.waitFor()
        await start.tap()
        await stop.waitFor()
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
          throw new Error('Horizontal overflow')
        if (errors.length) throw new Error(errors.join('\n'))
        await page.screenshot({
          path: resolve(output, `${engine}-${width}-${theme}.png`),
          fullPage: true,
        })
        scenarios += 1
      } finally {
        await context.close()
      }
    }
  await writeFile(
    resolve(output, 'inbox-ui.json'),
    JSON.stringify({
      engine,
      scenarios,
      input: 'real touch',
      authentication: 'fixture',
      native: 'fixture',
    }),
  )
  console.log(`Inbox UI passed: ${engine}, ${scenarios} scenarios`)
} finally {
  await browser.close()
  await preview.close()
}
