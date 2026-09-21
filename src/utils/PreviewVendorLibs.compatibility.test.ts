import { describe, expect, it } from 'vitest'
import { detectVendorLibNeeds } from './PreviewVendorLibs'

describe('shared preview vendor environment', () => {
  it('keeps fixture-basic-html vendor-free', () => {
    expect(detectVendorLibNeeds('<main class="fixture-basic-html">ready</main>')).toEqual({
      jquery: false,
      jqueryUi: false,
      jqueryUiTouchPunch: false,
      lodash: false,
      showdown: false,
      tailwind: false,
      toastr: false,
      vue: false,
      vueRouter: false,
      fontAwesome: false,
      yamlAndZod: false,
    })
  })

  it('detects fixture-vue-frontend and transitive vendor requirements', () => {
    const needs = detectVendorLibNeeds(`
      const app = Vue.createApp({});
      const router = VueRouter.createRouter({});
      $('.fixture-vue-frontend').draggable();
      toastr.info('ready');
      const schema = z.object({ value: z.number() });
    `)
    expect(needs.vue).toBe(true)
    expect(needs.vueRouter).toBe(true)
    expect(needs.jquery).toBe(true)
    expect(needs.jqueryUi).toBe(true)
    expect(needs.toastr).toBe(true)
    expect(needs.yamlAndZod).toBe(true)
  })
})
