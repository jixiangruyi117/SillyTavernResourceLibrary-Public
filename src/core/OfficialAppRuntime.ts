import type { Component } from 'vue'
import { entries } from 'virtual:srl-official-app-entries'
import { BUILD_INFO } from './BuildInfo'
import { appDatabase } from './AppDatabaseInstance'
import { InstalledOfficialAppStorage } from '../storage/InstalledOfficialAppStorage'
import { clearOfficialAppData } from '../storage/OfficialAppDataStorage'
import { OfficialAppService } from '../services/OfficialAppService'
import { OFFICIAL_APP_IDS, type OfficialAppId } from '../types/OfficialApp'
import { isCapacitorApp } from '../utils/CapacitorDetection'

const expectedEntries = Object.fromEntries(
  Object.entries(entries).map(([id, entry]) => [
    id,
    entry.url ? new URL(entry.url, location.href).pathname : '',
  ]),
)
export const fetchOfficialAppAsset: typeof fetch = (input, init) => {
  const nativeFetch = (window as Window & { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch
  if (isCapacitorApp() && !nativeFetch) throw new Error('原生下载通道不可用，请更新 APK')
  return (nativeFetch ?? window.fetch).call(window, input, init)
}
const dataRevisions = new Map(
  OFFICIAL_APP_IDS.map((id) => [id, localStorage.getItem(`srl.officialApps.dataRevision.${id}`)]),
)
export const officialAppService = new OfficialAppService(
  new InstalledOfficialAppStorage(appDatabase),
  BUILD_INFO.buildId,
  expectedEntries,
  fetchOfficialAppAsset,
  location.origin,
  async (id) => {
    await clearOfficialAppData(appDatabase, id)
  },
  async (id) => {
    const { clearOfficialAppAppearance } = await import('../services/AppearanceScopeService')
    clearOfficialAppAppearance(id)
  },
)

export async function acquireOfficialAppUse(id: OfficialAppId): Promise<() => void> {
  if (import.meta.env.DEV) return () => {}
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(
        `srl-official-app-use:${id}`,
        { mode: 'shared' },
        () => new Promise<void>((release) => resolve(release)),
      )
      .catch(reject)
  })
}

export async function loadOfficialApp(id: OfficialAppId): Promise<Component> {
  if (dataRevisions.get(id) !== localStorage.getItem(`srl.officialApps.dataRevision.${id}`))
    throw new Error('APP 数据已清除，请刷新页面后重新打开')
  const entry = entries[id]!
  let module: { default: Component; prepare?: () => Promise<void> }
  if (import.meta.env.DEV && entry.load) module = await entry.load()
  else {
    if (!(await officialAppService.ready(id))) throw new Error('请先下载或更新这个 APP')
    if (!isCapacitorApp() && !navigator.serviceWorker?.controller)
      throw new Error('离线加载尚未就绪，请刷新页面后打开 APP')
    const installed = (await officialAppService.list()).find((app) => app.id === id)!
    await Promise.all(
      installed.styles.map((path) => {
        const href = new URL(path, location.origin).href
        if ([...document.styleSheets].some((sheet) => sheet.href === href)) return
        return new Promise<void>((resolve, reject) => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href
          link.dataset.srlOfficialApp = id
          link.onload = () => resolve()
          link.onerror = () => {
            link.remove()
            reject(new Error('APP 样式加载失败，请重新下载'))
          }
          document.head.append(link)
        })
      }),
    )
    module = await import(/* @vite-ignore */ entry.url!)
  }
  await module.prepare?.()
  return module.default
}
