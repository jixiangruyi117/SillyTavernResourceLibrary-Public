/* eslint-disable vue/one-component-per-file -- The audit intentionally mounts the production component in isolated scenarios. */
import { createApp, defineComponent, h, ref, type App, type Ref } from 'vue'

import RichContentPreview from '../components/RichContentPreview.vue'
import type { PreviewRuntimeScript } from './RichContentPreview'

type CanonicalResumeAuditState = {
  companionBoots: number
  frontendMounts: { a: number; b: number }
  hostInitialGreetingIndices: number[]
  outerMounts: number
  swipeEvents: number
}

type CanonicalResumeAuditWindow = Window & {
  __SRL_CANONICAL_RESUME_COMPONENT_AUDIT__?: Record<string, CanonicalResumeAuditState>
  __SRL_HEAVY_OPENING_COMPONENT_AUDIT__?: Record<string, HeavyOpeningAuditState>
  __SRL_PREVIEW_PERFORMANCE_AUDIT__?: (event: PreviewPerformanceAuditEvent) => void
}

type PreviewPerformanceAuditEvent = {
  at: number
  durationMs?: number
  formatterKind?: 'current' | 'alternate' | 'prewarm' | 'compatibility'
  greetingIndex?: number
  stage: string
  title: string
  vendorNames?: string[]
}

type HeavyOpeningAuditState = {
  companionBoots: number
  events: PreviewPerformanceAuditEvent[]
  frontendMounts: number[]
  frontendReadyAt: number[][]
  outerMounts: number
  swipeEvents: number
}

type MountedAudit = {
  app: App
  greetingIndex: Ref<number>
  greetings: string[]
  observer: MutationObserver
  root: HTMLElement
  source: Ref<string>
}

type MountedHeavyAudit = MountedAudit & {
  previousPerformanceHook?: (event: PreviewPerformanceAuditEvent) => void
}

const mountedAudits = new Map<string, MountedAudit>()
const mountedHeavyAudits = new Map<string, MountedHeavyAudit>()
const budgetCompetitors: Array<{ app: App; root: HTMLElement }> = []

function auditWindow(): CanonicalResumeAuditWindow {
  return window as CanonicalResumeAuditWindow
}

function frontend(body: string): string {
  return `\`\`\`html\n<html><body>${body}</body></html>\n\`\`\``
}

function heavyOpeningBody(stateAccess: string, index: number): string {
  const repeated = Array.from(
    { length: 48 },
    (_, item) =>
      `<article class="heavy-card"><b>${index}-${item}</b><span>synthetic heavy opening content</span></article>`,
  ).join('')
  const optionalVendorFixture =
    index === 1
      ? '<div id="heavy-vue">Vue</div><script>Vue.createApp({data:()=>({ready:true})}).mount("#heavy-vue")</script>'
      : index === 2
        ? '<div id="heavy-drag">drag</div><script>$("#heavy-drag").draggable()</script>'
        : index === 3
          ? '<i class="fa-solid fa-star"></i>'
          : index === 4
            ? '<div class="flex p-4">tailwind</div>'
            : index === 5
              ? '<script>toastr.info("heavy audit")</script>'
              : ''
  return `<style>.heavy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.heavy-card{display:grid;padding:8px;border:1px solid #789;border-radius:8px}@media(max-width:430px){.heavy-grid{grid-template-columns:1fr}}</style>
<script>${stateAccess}.frontendMounts[${index}]+=1;${stateAccess}.frontendReadyAt[${index}].push(top.performance.now())</script>
<main data-heavy-opening="${index}"><section class="heavy-grid">${repeated}</section>${optionalVendorFixture}</main>`
}

function countOuterFrames(node: Node): number {
  if (!(node instanceof Element)) return 0
  return (
    Number(node.matches('.rich-content-preview__frame > iframe')) +
    node.querySelectorAll('.rich-content-preview__frame > iframe').length
  )
}

export function mountCanonicalResumeAudit(name: string): void {
  unmountCanonicalResumeAudit(name)
  const cases = (auditWindow().__SRL_CANONICAL_RESUME_COMPONENT_AUDIT__ ??= {})
  cases[name] = {
    companionBoots: 0,
    frontendMounts: { a: 0, b: 0 },
    hostInitialGreetingIndices: [],
    outerMounts: 0,
    swipeEvents: 0,
  }
  const stateAccess = `top.__SRL_CANONICAL_RESUME_COMPONENT_AUDIT__[${JSON.stringify(name)}]`
  const greetings = [
    frontend(
      `<script>${stateAccess}.frontendMounts.a+=1</script><main data-canonical-resume-opening="A">开场 A</main>`,
    ),
    frontend(
      `<script>${stateAccess}.frontendMounts.b+=1</script><main data-canonical-resume-opening="B">开场 B</main>`,
    ),
  ]
  const runtimeScripts: PreviewRuntimeScript[] = [
    {
      id: `canonical-resume-${name}`,
      name: `canonical-resume-${name}`,
      source: 'character',
      content: `
const state=${stateAccess};
state.companionBoots+=1;
state.hostInitialGreetingIndices.push(Number(getChatMessages(0)[0]?.swipe_id));
eventOn(tavern_events.MESSAGE_SWIPED,()=>{state.swipeEvents+=1});
`,
    },
  ]
  const source = ref(greetings[0])
  const greetingIndex = ref(0)
  const root = document.createElement('section')
  root.dataset.canonicalResumeAudit = name
  root.style.cssText =
    'position:fixed;inset:0 auto auto 0;width:320px;height:240px;z-index:2147483647;background:white'
  document.querySelector('#audit')?.append(root)
  const observer = new MutationObserver((records) => {
    const state = auditWindow().__SRL_CANONICAL_RESUME_COMPONENT_AUDIT__?.[name]
    if (!state) return
    state.outerMounts += records.reduce(
      (total, record) =>
        total +
        Array.from(record.addedNodes).reduce((sum, node) => sum + countOuterFrames(node), 0),
      0,
    )
  })
  observer.observe(root, { childList: true, subtree: true })
  const app = createApp(
    defineComponent({
      name: 'CanonicalResumeComponentAudit',
      setup: () => () =>
        h(RichContentPreview, {
          active: true,
          greetingContents: greetings,
          greetingIndex: greetingIndex.value,
          renderShell: 'content',
          runtimeScripts,
          source: source.value,
          title: `${name} canonical resume audit`,
        }),
    }),
  )
  app.mount(root)
  mountedAudits.set(name, { app, greetingIndex, greetings, observer, root, source })
}

export function setCanonicalResumeOpening(name: string, target: 0 | 1): void {
  const audit = mountedAudits.get(name)
  if (!audit) throw new Error(`Canonical resume audit is not mounted: ${name}`)
  audit.source.value = audit.greetings[target] ?? audit.source.value
  audit.greetingIndex.value = target
}

export function unmountCanonicalResumeAudit(name: string): void {
  const audit = mountedAudits.get(name)
  if (!audit) return
  mountedAudits.delete(name)
  audit.app.unmount()
  audit.observer.disconnect()
  audit.root.remove()
}

export function mountHeavyOpeningAudit(name: string, offscreen = false): void {
  unmountHeavyOpeningAudit(name)
  const cases = (auditWindow().__SRL_HEAVY_OPENING_COMPONENT_AUDIT__ ??= {})
  cases[name] = {
    companionBoots: 0,
    events: [],
    frontendMounts: Array.from({ length: 10 }, () => 0),
    frontendReadyAt: Array.from({ length: 10 }, () => []),
    outerMounts: 0,
    swipeEvents: 0,
  }
  const stateAccess = `top.__SRL_HEAVY_OPENING_COMPONENT_AUDIT__[${JSON.stringify(name)}]`
  const title = `${name} heavy opening audit`
  const greetings = Array.from({ length: 10 }, (_, index) =>
    frontend(heavyOpeningBody(stateAccess, index)),
  )
  const runtimeScripts: PreviewRuntimeScript[] = [
    {
      id: `heavy-${name}`,
      name: `heavy-${name}`,
      source: 'character',
      content: `
const state=${stateAccess};
state.companionBoots+=1;
eventOn(tavern_events.MESSAGE_SWIPED,()=>{state.swipeEvents+=1});
`,
    },
  ]
  const characterData = {
    first_mes: '<initvar>\nhp: 10\n</initvar>',
    character_book: {
      entries: [{ comment: '[initvar] heavy audit', content: 'hp: 1' }],
    },
  }
  const source = ref(greetings[1])
  const greetingIndex = ref(1)
  const root = document.createElement('section')
  root.dataset.heavyOpeningAudit = name
  root.style.cssText = offscreen
    ? `position:fixed;top:${window.innerHeight + 1000}px;left:0;width:390px;height:240px;background:white`
    : 'position:fixed;inset:0 auto auto 0;width:390px;height:320px;z-index:2147483647;background:white;overflow:auto'
  document.querySelector('#audit')?.append(root)
  const observer = new MutationObserver((records) => {
    const state = auditWindow().__SRL_HEAVY_OPENING_COMPONENT_AUDIT__?.[name]
    if (!state) return
    state.outerMounts += records.reduce(
      (total, record) =>
        total +
        Array.from(record.addedNodes).reduce((sum, node) => sum + countOuterFrames(node), 0),
      0,
    )
  })
  observer.observe(root, { childList: true, subtree: true })
  const previousPerformanceHook = auditWindow().__SRL_PREVIEW_PERFORMANCE_AUDIT__
  auditWindow().__SRL_PREVIEW_PERFORMANCE_AUDIT__ = (event) => {
    previousPerformanceHook?.(event)
    if (event.title === title) cases[name]?.events.push({ ...event })
  }
  const app = createApp(
    defineComponent({
      name: 'HeavyOpeningComponentAudit',
      setup: () => () =>
        h(RichContentPreview, {
          active: true,
          characterData,
          greetingContents: greetings,
          greetingIndex: greetingIndex.value,
          renderShell: 'content',
          runtimeScripts,
          source: source.value,
          title,
        }),
    }),
  )
  app.mount(root)
  mountedHeavyAudits.set(name, {
    app,
    greetingIndex,
    greetings,
    observer,
    previousPerformanceHook,
    root,
    source,
  })
}

export function setHeavyOpeningAudit(name: string, target: number): void {
  const audit = mountedHeavyAudits.get(name)
  if (!audit) throw new Error(`Heavy opening audit is not mounted: ${name}`)
  const normalized = Math.min(audit.greetings.length - 1, Math.max(0, Math.trunc(target)))
  audit.source.value = audit.greetings[normalized] ?? audit.source.value
  audit.greetingIndex.value = normalized
}

export function unmountHeavyOpeningAudit(name: string): void {
  const audit = mountedHeavyAudits.get(name)
  if (!audit) return
  mountedHeavyAudits.delete(name)
  audit.app.unmount()
  audit.observer.disconnect()
  audit.root.remove()
  auditWindow().__SRL_PREVIEW_PERFORMANCE_AUDIT__ = audit.previousPerformanceHook
}

export function mountPreviewBudgetCompetitors(count: number): void {
  unmountPreviewBudgetCompetitors()
  const host = document.createElement('section')
  host.dataset.previewBudgetCompetitors = ''
  host.style.cssText =
    'position:fixed;inset:0 auto auto 0;width:320px;height:240px;z-index:2147483646'
  document.querySelector('#audit')?.append(host)
  for (let index = 0; index < count; index += 1) {
    const root = document.createElement('div')
    root.style.cssText = 'position:absolute;inset:0'
    host.append(root)
    const app = createApp(RichContentPreview, {
      active: true,
      source: `PreviewBudget competitor ${index}`,
      title: `PreviewBudget competitor ${index}`,
    })
    app.mount(root)
    budgetCompetitors.push({ app, root })
  }
}

export function unmountOnePreviewBudgetCompetitor(): void {
  const competitor = budgetCompetitors.pop()
  if (!competitor) return
  competitor.app.unmount()
  competitor.root.remove()
}

export function unmountPreviewBudgetCompetitors(): void {
  while (budgetCompetitors.length) unmountOnePreviewBudgetCompetitor()
  document.querySelector('[data-preview-budget-competitors]')?.remove()
}
