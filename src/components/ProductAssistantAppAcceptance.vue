<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { ExternalAppTrialSession } from '../services/ExternalAppTrialSession'
import { runAssistantAppAcceptance, type AssistantAppTask } from '../services/ExternalAppAcceptance'
import type { ExternalAppPreview } from '../types/ExternalApp'
const props = defineProps<{ preview: ExternalAppPreview; revision: number }>()
const emit = defineEmits<{ running: [value: boolean] }>()
const active = ref(false)
const frameKey = ref(0)
const frame = useTemplateRef<HTMLIFrameElement>('frame')
let keepStorage = false
let ready: ((error?: Error) => void) | undefined
let controller: AbortController | undefined
const trial = new ExternalAppTrialSession({
  permissions: () => props.preview.requestedPermissions,
  active: () => active.value,
  running: () => {},
  diagnostic: () => {},
  notify: () => {},
  loading: () => {},
})
function connected(event: Event) {
  const element = event.currentTarget as HTMLIFrameElement
  if (element !== frame.value || !element.contentWindow) return
  trial.connect(element.contentWindow, keepStorage)
  ready?.()
}
async function load(signal: AbortSignal, preserve: boolean) {
  if (!preserve) trial.disconnect()
  keepStorage = preserve
  const loaded = new Promise<void>((resolve, reject) => {
    const abort = () => finish(new DOMException('已停止', 'AbortError'))
    const finish = (error?: Error) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      ready = undefined
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('验收预览未在 15 秒内加载')), 15_000)
    ready = finish
    signal.addEventListener('abort', abort, { once: true })
  })
  frameKey.value++
  await nextTick()
  await loaded
}
async function run(tasks: AssistantAppTask[], revision: number, signal: AbortSignal) {
  if (active.value || revision !== props.revision) throw new Error('验收仍在运行或草稿版本已变化')
  controller = new AbortController()
  const abort = () => controller?.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const runSignal = controller.signal
  active.value = true
  emit('running', true)
  try {
    return await runAssistantAppAcceptance(tasks, revision, runSignal, {
      reset: () => load(runSignal, false),
      reload: () => load(runSignal, true),
      check: (step) => trial.check(step, runSignal),
    })
  } finally {
    signal.removeEventListener('abort', abort)
    trial.disconnect()
    active.value = false
    emit('running', false)
    controller = undefined
  }
}
onBeforeUnmount(() => {
  controller?.abort()
  ready?.(new Error('验收已关闭'))
  trial.disconnect()
})
defineExpose({ run })
</script>
<template>
  <iframe
    v-if="active"
    ref="frame"
    :key="frameKey"
    :srcdoc="preview.runtimeHtml"
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    title="APP 验收预览"
    @load="connected"
    @error="ready?.(new Error('验收预览加载失败'))"
  />
</template>
