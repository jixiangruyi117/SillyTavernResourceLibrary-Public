import { describe, expect, it } from 'vitest'

import {
  detectVendorLibNeeds,
  loadPreviewVendorLibs,
  loadPreviewVendorLibsForSource,
  mergePreviewVendorLibNeeds,
} from './PreviewVendorLibs'

describe('detectVendorLibNeeds', () => {
  it('识别裸用 $() 与 jQuery 调用', () => {
    expect(detectVendorLibNeeds("$('#panel').show()").jquery).toBe(true)
    expect(detectVendorLibNeeds('jQuery(function(){})').jquery).toBe(true)
  })

  it('模板字符串插值 ${} 不误判为 jQuery', () => {
    expect(detectVendorLibNeeds('const s = `${value}`').jquery).toBe(false)
    expect(detectVendorLibNeeds('price.$ (美元)').jquery).toBe(false)
  })

  it('识别 Vue 全量构建用法', () => {
    expect(detectVendorLibNeeds('Vue.createApp({})').vue).toBe(true)
    expect(detectVendorLibNeeds('const app = createApp({ data })').vue).toBe(true)
    expect(detectVendorLibNeeds('普通文本 vue 单词').vue).toBe(false)
  })

  it('逐项合并 greeting 与 companion needs，并保留真实 TH message iframe 固定 vendor floor', () => {
    const needs = mergePreviewVendorLibNeeds([
      'const dynamicVue = window["V" + "ue"]',
      'const dynamicRouter = window["Vue" + "Router"]',
    ])

    expect(needs).toMatchObject({
      fontAwesome: true,
      jquery: true,
      jqueryUi: true,
      jqueryUiTouchPunch: true,
      lodash: true,
      showdown: true,
      tailwind: true,
      vue: true,
      vueRouter: true,
      yamlAndZod: true,
    })
  })

  it('显式关闭 compatibility floor 时仍只使用源码检测结果', () => {
    const needs = mergePreviewVendorLibNeeds(['<main>plain</main>'], false)
    expect(needs).toMatchObject({ jquery: false, vue: false })
    expect(needs.jqueryUi).toBe(false)
    expect(needs.vueRouter).toBe(false)
    expect(needs.tailwind).toBe(false)
    expect(needs.fontAwesome).toBe(false)
  })

  it('补全 optional vendor 的依赖闭包', () => {
    expect(mergePreviewVendorLibNeeds(['Touch Punch'], false)).toMatchObject({
      jquery: true,
      jqueryUi: true,
      jqueryUiTouchPunch: true,
    })
    expect(mergePreviewVendorLibNeeds(['VueRouter.createRouter({})'], false)).toMatchObject({
      vue: true,
      vueRouter: true,
    })
    expect(mergePreviewVendorLibNeeds(['toastr.success("ok")'], false)).toMatchObject({
      jquery: true,
      toastr: true,
    })
  })
})

describe('loadPreviewVendorLibs', () => {
  it('无需求时返回 undefined，不加载任何库', async () => {
    expect(await loadPreviewVendorLibs({ jquery: false, vue: false })).toBeUndefined()
  })

  it('按需加载真实的本地 jQuery 源码', async () => {
    const libs = await loadPreviewVendorLibs({ jquery: true, vue: false })
    expect(libs?.jquery).toContain('jQuery')
    expect(libs?.jquery?.length).toBeGreaterThan(50_000)
    expect(libs?.vue).toBeUndefined()
  })

  it('按需加载真实的本地 Vue 运行时', async () => {
    const libs = await loadPreviewVendorLibs({ jquery: false, vue: true })
    expect(libs?.vue?.length).toBeGreaterThan(50_000)
  })

  it('按酒馆助手父页面与脚本 iframe 需要加载 Lodash 和 Vue Router', async () => {
    const libs = await loadPreviewVendorLibs({
      jquery: false,
      lodash: true,
      vue: false,
      vueRouter: true,
    })
    expect(libs?.lodash?.length).toBeGreaterThan(50_000)
    expect(libs?.vueRouter?.length).toBeGreaterThan(20_000)
  })

  it('Source loader 不再依赖正则看见固定 TH globals', async () => {
    const libs = await loadPreviewVendorLibsForSource(
      '<script>const runtimeVue = window["V" + "ue"]; const jq = window["j" + "Query"]</script>',
    )
    expect(libs?.jquery).toContain('jQuery')
    expect(libs?.jqueryUi).toContain('jQuery UI')
    expect(libs?.jqueryUiTouchPunch).toContain('touch')
    expect(libs?.vue?.length).toBeGreaterThan(50_000)
    expect(libs?.vueRouter?.length).toBeGreaterThan(20_000)
    expect(libs?.tailwind?.length).toBeGreaterThan(100_000)
    expect(typeof libs?.fontAwesomeCss).toBe('string')
  })

  it('按需提供离线 TavernHelper 常用浏览器环境', async () => {
    const libs = await loadPreviewVendorLibs({
      fontAwesome: true,
      jquery: true,
      jqueryUi: true,
      jqueryUiTouchPunch: true,
      lodash: true,
      showdown: true,
      tailwind: true,
      toastr: true,
      vue: true,
      vueRouter: true,
      yamlAndZod: true,
    })

    expect(libs?.jqueryUi).toContain('jQuery UI')
    expect(libs?.jqueryUiTouchPunch).toContain('touch')
    expect(libs?.showdown).toContain('showdown')
    expect(libs?.toastr).toContain('toastr')
    expect(libs?.tailwind?.length).toBeGreaterThan(100_000)
    expect(typeof libs?.fontAwesomeCss).toBe('string')
    expect(libs?.vendorGlobals).toContain('Object.defineProperties')
    expect(libs?.vendorGlobals?.length).toBeGreaterThan(100_000)
  })
})
