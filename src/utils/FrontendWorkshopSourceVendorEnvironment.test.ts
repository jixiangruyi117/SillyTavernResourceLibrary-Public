import { describe, expect, it } from 'vitest'

import { createFrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import { createFrontendWorkshopSourceRuntimeInstance } from './FrontendWorkshopSourceRuntime'
import { detectVendorLibNeeds } from './PreviewVendorLibs'

describe('FrontendWorkshop Source shared vendor environment', () => {
  it('injects the already-loaded shared vendor set into the disposable runtime only', () => {
    const authorSource = '<main id="fixture-vendor">fixture-author-source</main>'
    const source = createFrontendWorkshopSourceDocument('fixture-project', authorSource, 100)
    const runtime = createFrontendWorkshopSourceRuntimeInstance(source, {
      instanceId: 'fixture-instance',
      runtimeNonce: 'fixture-nonce',
      vendorLibs: {
        fontAwesomeCss: 'fixture-font-awesome-css',
        jquery: 'fixture-jquery',
        jqueryUi: 'fixture-jquery-ui',
        jqueryUiCss: 'fixture-jquery-ui-css',
        jqueryUiTouchPunch: 'fixture-touch-punch',
        lodash: 'fixture-lodash',
        showdown: 'fixture-showdown',
        tailwind: 'fixture-tailwind',
        toastr: 'fixture-toastr',
        toastrCss: 'fixture-toastr-css',
        vue: 'fixture-vue',
        vueRouter: 'fixture-vue-router',
        vendorGlobals: 'window.YAML="fixture-yaml";window.z="fixture-zod";',
      },
    })

    for (const marker of [
      'fixture-font-awesome-css',
      'fixture-jquery',
      'fixture-jquery-ui',
      'fixture-jquery-ui-css',
      'fixture-touch-punch',
      'fixture-tailwind',
      'fixture-toastr',
      'fixture-toastr-css',
      'fixture-vue',
      'fixture-vue-router',
    ]) {
      expect(runtime.childDocument).toContain(marker)
    }
    for (const marker of ['fixture-lodash', 'fixture-showdown', 'fixture-yaml', 'fixture-zod']) {
      expect(runtime.childDocument).toContain(marker)
    }
    expect(runtime.childDocument).not.toContain('window._=window.parent._')
    expect(runtime.childDocument).not.toContain('window.YAML=window.parent.YAML')
    expect(runtime.childDocument).not.toContain('window.showdown=window.parent.showdown')
    expect(runtime.childDocument).not.toContain('window.z=window.parent.z')
    expect(source.authorSource).toBe(authorSource)
  })

  it('keeps ordinary source vendor-free and pulls jquery when toastr needs it', () => {
    expect(detectVendorLibNeeds('<div>fixture-basic-html</div>')).toEqual(
      expect.objectContaining({ jquery: false, vue: false, toastr: false }),
    )
    expect(detectVendorLibNeeds('<script>toastr.info("fixture")</script>')).toEqual(
      expect.objectContaining({ jquery: true, toastr: true }),
    )
  })
})
