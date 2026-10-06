/**
 * Shared TavernHelper-compatible vendor environment for isolated previews.
 *
 * Resource Preview and FrontendWorkshop Source Preview use this single owner. TavernHelper's
 * message iframe has a fixed browser-vendor floor; additional helpers outside that floor are still
 * detected from source so ordinary compatibility work does not grow a second vendor owner.
 */

export interface PreviewVendorLibs {
  fontAwesomeCss?: string
  jquery?: string
  jqueryUi?: string
  jqueryUiCss?: string
  jqueryUiTouchPunch?: string
  lodash?: string
  showdown?: string
  tailwind?: string
  toastr?: string
  toastrCss?: string
  vue?: string
  vueRouter?: string
  vendorGlobals?: string
}

export interface PreviewVendorLibNeeds {
  jquery: boolean
  jqueryUi?: boolean
  jqueryUiTouchPunch?: boolean
  lodash?: boolean
  showdown?: boolean
  tailwind?: boolean
  toastr?: boolean
  vue: boolean
  vueRouter?: boolean
  fontAwesome?: boolean
  yamlAndZod?: boolean
}

/**
 * Current TavernHelper 4.9.3 message iframe third_party_message.html loads Font Awesome, Tailwind,
 * jQuery, jQuery UI, Touch Punch, Vue and Vue Router before author content. The existing broader
 * preview host also exposes Lodash / Showdown / YAML / Zod; keep those compatibility globals here
 * until their separate host surfaces are retired or narrowed by real-host evidence.
 */
const TAVERN_HELPER_COMPATIBILITY_CORE_FLOOR: PreviewVendorLibNeeds = {
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
}

export function detectVendorLibNeeds(source: string): PreviewVendorLibNeeds {
  const jqueryUi = /\.\s*(?:draggable|droppable|sortable|dialog|slider|tabs)\s*\(/.test(source)
  const jqueryUiTouchPunch = /touch(?:start|move|end)|Touch Punch/i.test(source)
  const vueRouter = /\bVueRouter\b|createRouter\s*\(/.test(source)
  const toastr = /\btoastr\b/.test(source)
  return {
    jquery:
      /\bjQuery\b|(?<![\w$.])\$\s*\(/.test(source) || jqueryUi || jqueryUiTouchPunch || toastr,
    jqueryUi,
    jqueryUiTouchPunch,
    lodash: /(?<![\w$])_\s*\./.test(source),
    showdown: /\bshowdown\b/.test(source),
    tailwind: /\b(?:class|className)\s*=\s*["'][^"']*(?:flex|grid|p-|m-|w-|h-|text-|bg-)/.test(
      source,
    ),
    toastr,
    vue: /\bVue\.\w|createApp\s*\(|petite-vue/i.test(source) || vueRouter,
    vueRouter,
    fontAwesome: /\bfa(?:s|r|b|l|d)?\s+fa-|\bfa-[\w-]+/.test(source),
    yamlAndZod: /\bYAML\b|(?<![\w$])z\s*\./.test(source),
  }
}

export function mergePreviewVendorLibNeeds(
  sources: Iterable<string>,
  includeCompatibilityCore = true,
): PreviewVendorLibNeeds {
  const merged: PreviewVendorLibNeeds = {
    ...detectVendorLibNeeds(''),
    ...(includeCompatibilityCore ? TAVERN_HELPER_COMPATIBILITY_CORE_FLOOR : {}),
  }

  for (const source of sources) {
    const detected = detectVendorLibNeeds(source)
    for (const [name, needed] of Object.entries(detected) as Array<
      [keyof PreviewVendorLibNeeds, boolean]
    >) {
      if (needed) merged[name] = true
    }
  }

  if (merged.jqueryUiTouchPunch) {
    merged.jqueryUi = true
    merged.jquery = true
  }
  if (merged.jqueryUi) merged.jquery = true
  if (merged.vueRouter) merged.vue = true
  if (merged.toastr) merged.jquery = true
  return merged
}

export function loadedPreviewVendorNames(libs: PreviewVendorLibs | undefined): string[] {
  if (!libs) return []
  const names: string[] = []
  if (libs.jquery) names.push('jquery')
  if (libs.jqueryUi) names.push('jquery-ui')
  if (libs.jqueryUiTouchPunch) names.push('jquery-ui-touch-punch')
  if (libs.lodash) names.push('lodash')
  if (libs.showdown) names.push('showdown')
  if (libs.tailwind) names.push('tailwind')
  if (libs.toastr) names.push('toastr')
  if (libs.vue) names.push('vue')
  if (libs.vueRouter) names.push('vue-router')
  if (libs.fontAwesomeCss) names.push('font-awesome')
  if (libs.vendorGlobals) names.push('yaml-zod')
  return names
}

export async function loadPreviewVendorLibsForSource(
  source: string,
): Promise<PreviewVendorLibs | undefined> {
  return loadPreviewVendorLibs(mergePreviewVendorLibNeeds([source]))
}

export async function loadPreviewVendorLibs(
  needs: PreviewVendorLibNeeds,
): Promise<PreviewVendorLibs | undefined> {
  if (!Object.values(needs).some(Boolean)) return undefined
  const [
    fontAwesomeCssSource,
    fontBrands,
    fontRegular,
    fontSolid,
    fontV4,
    jquery,
    jqueryUi,
    jqueryUiCss,
    jqueryUiTouchPunch,
    lodash,
    showdown,
    tailwind,
    toastr,
    toastrCss,
    vue,
    vueRouter,
    vendorGlobals,
  ] = await Promise.all([
    needs.fontAwesome
      ? import('@fortawesome/fontawesome-free/css/all.min.css?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.fontAwesome
      ? import('@fortawesome/fontawesome-free/webfonts/fa-brands-400.woff2?inline').then(
          (module) => module.default,
        )
      : Promise.resolve(undefined),
    needs.fontAwesome
      ? import('@fortawesome/fontawesome-free/webfonts/fa-regular-400.woff2?inline').then(
          (module) => module.default,
        )
      : Promise.resolve(undefined),
    needs.fontAwesome
      ? import('@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?inline').then(
          (module) => module.default,
        )
      : Promise.resolve(undefined),
    needs.fontAwesome
      ? import('@fortawesome/fontawesome-free/webfonts/fa-v4compatibility.woff2?inline').then(
          (module) => module.default,
        )
      : Promise.resolve(undefined),
    needs.jquery
      ? import('jquery/dist/jquery.min.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.jqueryUi
      ? import('jquery-ui-dist/jquery-ui.min.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.jqueryUi
      ? import('jquery-ui-dist/jquery-ui.min.css?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.jqueryUiTouchPunch
      ? import('jquery-ui-touch-punch/jquery.ui.touch-punch.min.js?raw').then(
          (module) => module.default,
        )
      : Promise.resolve(undefined),
    needs.lodash
      ? import('lodash/lodash.min.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.showdown
      ? import('showdown/dist/showdown.min.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.tailwind
      ? import('@tailwindcss/browser?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.toastr
      ? import('toastr/build/toastr.min.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.toastr
      ? import('toastr/build/toastr.min.css?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.vue
      ? import('vue/dist/vue.runtime.global.prod.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.vueRouter
      ? import('vue-router/dist/vue-router.global.prod.js?raw').then((module) => module.default)
      : Promise.resolve(undefined),
    needs.yamlAndZod
      ? import('virtual:srl-preview-vendor-globals-source').then((module) => module.default)
      : Promise.resolve(undefined),
  ])
  const fontAwesomeCss = fontAwesomeCssSource
    ?.replaceAll('../webfonts/fa-brands-400.woff2', fontBrands ?? '')
    .replaceAll('../webfonts/fa-regular-400.woff2', fontRegular ?? '')
    .replaceAll('../webfonts/fa-solid-900.woff2', fontSolid ?? '')
    .replaceAll('../webfonts/fa-v4compatibility.woff2', fontV4 ?? '')
  return {
    fontAwesomeCss,
    jquery,
    jqueryUi,
    jqueryUiCss,
    jqueryUiTouchPunch,
    lodash,
    showdown,
    tailwind,
    toastr,
    toastrCss,
    vue,
    vueRouter,
    vendorGlobals,
  }
}
