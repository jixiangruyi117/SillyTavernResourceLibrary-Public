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
import Pending from '${source('src/components/DiscordPendingSources.vue')}'
import Settings from '${source('src/components/LayoutSettingsPanel.vue')}'
import Activity from '${source('src/components/ProjectActivityCenter.vue')}'
import {noticeCenter} from '${source('src/core/NoticeCenter.ts')}'
import '${source('src/styles/Foundation.css')}'
import '${source('src/styles/GlassRefinement.css')}'
import '${source('src/styles/LayoutAndResponsive.css')}'
document.documentElement.dataset.theme = new URL(location.href).searchParams.get('theme') || 'light'
let posts
const bindingNotices=()=>{for(const id of ['A','B'])noticeCenter.push({id:'discord-auto-binding:fixture:'+id,type:'success',persistent:true,message:'帖子“测试帖子'+id+'”已绑定角色卡“测试角色'+id+'”'})}
const settingsProps={vaultEnabled:false,allowRemotePreviews:true,allowScriptPreviews:false,preloadGreetingPreviews:true,preloadBeautificationPreviews:true,extractCharacterAssets:false,hideCharacterAssets:false,hideChatDisplayRegex:true,showManuallyBoundResources:true,blurThumbnails:false,autoDownloadDiscordShareLinks:false,persistResourceVersionMatchCache:true,skipVersionComparisonOnImport:false,showPerformanceMonitor:false,hiddenCharacterAssetCount:0}
createApp({render:()=>new URL(location.href).searchParams.get('view')==='health'?h(Settings,settingsProps):h('main',[h(Mode),h('button',{onClick:()=>posts.openCloudCleanup()},'清理云端'),h('button',{onClick:bindingNotices},'模拟绑定完成'),h(Activity),h(Posts,{ref:value=>{posts=value}}),h(Resources),h(Pending,{pageView:true})])}).mount('#app')
`,
)
const mocks = {
  ResourcePicker: `export default {render:()=>null};`,
  AppContainer: `export const resourceService={listResourceListSummaries:async()=>[]};
    export const browserStorageService={getHealth:async()=>({}),getModifiedResourceSyncTags:()=>[],setModifiedResourceSyncTags:()=>{}};
    export const communitySourceService={downloadedMediaUsage:async()=>({count:0,bytes:0})};
    export const nativeResourceRecoveryService={listCandidates:async()=>({candidates:[],scanned:0}),storageAccounting:async()=>({}),nativeMirrorDuplicationSummary:async()=>({currentCount:0,versionCount:0,reclaimableBytes:0})};`,
  HealthCenter: `export const healthCenter={scan:async()=>[],repairSafe:async()=>0};`,
  PlatformService: `export const platform={update:{isAndroidApk:()=>true},security:{getState:async()=>null},backup:{getStatus:async()=>null},systemUi:{getState:async()=>null}};export const getPlatformInfo=async()=>({kind:'android'});`,
  NativeResourceFileMirror: `export const getNativeResourceStorageInfo=async()=>({path:'/storage/emulated/0/Android/data/buzz.jixiangruyi1207.srl/files/Documents/SillyTavernResourceLibrary/objects',currentCount:263,versionCount:99,objectCount:361,objectBytes:444176794,totalBytes:444176794,recoveryMetadataVersion:1});export const clearNativeTemporaryCaches=async()=>0;`,
  PerformanceMonitor: `export const resetPerformanceMonitorPosition=()=>{};`,
  OfflineResources: `export const getOfflineResourceStatus=async()=>null;export const downloadFullOfflineResources=async()=>{};export const removeFullOfflineResources=async()=>{};`,
  NativeHaptics: `export const isNativeHapticsEnabled=()=>false;export const setNativeHapticsEnabled=()=>{};`,
  ServiceWorkerUpdate: `export const forceRefresh=()=>{};export const manualCheckForUpdate=async()=>{};`,
  MainApiSettings: `export default {render:()=>null};`,
  SecretProtectionSettings: `export default {render:()=>null};`,
  LibraryContainer: `
    export const browserStorageService={getModifiedResourceSyncTags:()=>[],setModifiedResourceSyncTags:()=>{}};
    export const communitySourceService={listRecentAutoBindings:async()=>[],listAutoBindReviews:async()=>[],countPendingSources:async()=>1};
    export const discordInboxAutomationSettingsService={load:async()=>({})};`,
  CommunitySourceRuntime: `export const communitySourceService={
    repairInvalidResourceBindings:async()=>0,
    listPendingSources:async()=>[{source:{id:'pending-long-url',title:'含长链接的待整理来源',updatedAt:1791345600000,canonicalUrl:'https://discord.com/channels/123/456/789'},
      messages:[{authorName:'作者',content:'# 图片说明：'+'https://discord.com/channels/'+ '1234567890'.repeat(20),attachments:[],embeds:[]}]}]
  };`,
  NativeDiscordInboxService: `
    let running=true;
    export const isNativeDiscordInboxAvailable=()=>true;
    export const notifyNativeDiscordAutoBinding=async()=>{};
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
        const name = id
          .split('/')
          .at(-1)
          ?.replace(/\.(?:ts|vue)$/u, '')
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
        await page.getByText('含长链接的待整理来源', { exact: true }).waitFor()
        const pendingPreview = page.locator('.discord-pending__summary p')
        if (await pendingPreview.evaluate((element) => element.scrollWidth > element.clientWidth))
          throw new Error('Pending source URL overflow')
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
        await page.getByRole('dialog').getByRole('button', { name: '继续', exact: true }).tap()
        await page.getByText('已清理：帖子 1 条，资源 1 项。').waitFor()
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
        await page.clock.install()
        await page.getByRole('button', { name: '模拟绑定完成', exact: true }).tap()
        await page.clock.fastForward(5000)
        const activityTrigger = page.locator('.activity-center__trigger')
        await activityTrigger.tap()
        const bindingMessages = page
          .locator('.activity-card strong')
          .filter({ hasText: '已绑定角色卡' })
        if ((await bindingMessages.count()) !== 2)
          throw new Error('Binding notices expired or replaced each other')
        for (const id of ['A', 'B'])
          await page
            .locator('#srl-activity-panel')
            .getByText('帖子“测试帖子' + id + '”已绑定角色卡“测试角色' + id + '”', { exact: true })
            .waitFor()
        await page.getByRole('button', { name: '清理完成项', exact: true }).tap()
        await activityTrigger.waitFor({ state: 'detached' })
        await page.clock.resume()
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
          throw new Error('Horizontal overflow')
        if (errors.length) throw new Error(errors.join('\n'))
        await page.screenshot({
          path: resolve(output, `${engine}-${width}-${theme}.png`),
          fullPage: true,
        })
        await page.goto(url + '?view=health&theme=' + theme)
        const nativePath = page
          .locator('.settings-number-row small')
          .filter({ hasText: '/storage/emulated/0/' })
        await nativePath.waitFor()
        if (await nativePath.evaluate((element) => element.scrollWidth > element.clientWidth))
          throw new Error('Native directory path overflow')
        const scan = page.getByRole('button', { name: '扫描', exact: true })
        await scan.tap()
        await page.getByText('索引与引用未发现问题', { exact: true }).waitFor()
        if (await scan.isDisabled()) throw new Error('Health scan did not release busy state')
        await scan.tap()
        await page.getByText('索引与引用未发现问题', { exact: true }).waitFor()
        if (await scan.isDisabled()) throw new Error('Repeated health scan did not complete')
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
          throw new Error('Settings horizontal overflow')
        if (errors.length) throw new Error(errors.join('\n'))
        await page.screenshot({
          path: resolve(output, `${engine}-${width}-${theme}-health.png`),
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
