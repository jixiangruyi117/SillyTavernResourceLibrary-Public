<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type {
  PersonalResourceDocument,
  PhoneIcon,
  PhoneIconSource,
} from '../types/PersonalResource'
import {
  directPhoneIcon,
  preparePhoneIcon,
  readPhoneSourceZip,
  sourcePhoneIcon,
  websitePhoneIcon,
} from '../services/PocketPhoneIconService'

const props = defineProps<{
  document: PersonalResourceDocument
  readFile: (path: string) => Promise<Blob>
}>()
const emit = defineEmits<{ change: [icons: PhoneIcon[], selected?: PhoneIconSource] }>()
const labels: Record<PhoneIconSource, string> = {
  website: '网址图标',
  source: '源码图标',
  apk: 'APK 图标',
  image: '导入图片',
  url: '直链 URL',
}
const status = ref('')
const pending = ref(false)
const imageUrl = ref('')
const expanded = ref(false)
const sourceChoice = ref<PhoneIconSource | ''>(props.document.iconSource || '')
const availableSources = computed(() =>
  (Object.keys(labels) as PhoneIconSource[]).filter(
    (source) =>
      source === 'image' ||
      source === 'url' ||
      props.document.icons?.some((icon) => icon.source === source),
  ),
)
function changeSource(event: Event) {
  const source = (event.target as HTMLSelectElement).value as PhoneIconSource | ''
  sourceChoice.value = source
  const icon = props.document.icons?.find((item) => item.source === source)
  if (!source || icon) choose(source || undefined)
  if (source === 'url') imageUrl.value = icon?.origin || ''
}
function togglePicker() {
  expanded.value = !expanded.value
  if (expanded.value) {
    sourceChoice.value = props.document.iconSource || ''
    imageUrl.value = props.document.icons?.find((icon) => icon.source === 'url')?.origin || ''
  }
}
const selected = computed(() =>
  props.document.icons?.find((icon) => icon.source === props.document.iconSource),
)
let task: Promise<void> = Promise.resolve()
let generation = 0
let worker: Worker | undefined
let websiteController: AbortController | undefined
let websiteUrl = ''
function publish(icons: PhoneIcon[], source?: PhoneIconSource) {
  // Pass value records across the component boundary, never nested Vue proxies into a save draft.
  emit(
    'change',
    icons.map((icon) => ({ source: icon.source, origin: icon.origin, dataUrl: icon.dataUrl })),
    source,
  )
}
function choose(source?: PhoneIconSource) {
  publish(props.document.icons || [], source)
}
async function run(action: () => Promise<PhoneIcon>, selectResult = false, replace = false) {
  if (pending.value && !replace) return
  const current = ++generation
  pending.value = true
  status.value = '正在读取图标…'
  task = (async () => {
    try {
      const icon = await action()
      if (generation !== current) return
      if (icon.source === 'website' && icon.origin !== props.document.url.trim()) return
      if (
        ['source', 'apk'].includes(icon.source) &&
        !props.document.attachments.some((entry) => entry.path === icon.origin)
      )
        return
      const icons = [
        ...(props.document.icons || []).filter((item) => item.source !== icon.source),
        icon,
      ]
      publish(icons, selectResult ? icon.source : props.document.iconSource || icon.source)
      if (selectResult || !sourceChoice.value) sourceChoice.value = icon.source
      status.value = icon.dataUrl.startsWith('https:')
        ? '图标已读取；此来源不允许缓存，显示时需要联网'
        : '图标已读取'
    } catch (error) {
      if (generation === current)
        status.value = error instanceof Error ? error.message : '未读取到图标'
    } finally {
      if (generation === current) pending.value = false
    }
  })()
  await task
}
function cancelPending() {
  generation++
  websiteController?.abort()
  websiteController = undefined
  websiteUrl = ''
  worker?.terminate()
  worker = undefined
  pending.value = false
  task = Promise.resolve()
}
async function readWebsite() {
  const url = props.document.url.trim()
  if (
    !url ||
    (websiteUrl === url && pending.value) ||
    props.document.icons?.some((icon) => icon.source === 'website' && icon.origin === url)
  )
    return
  cancelPending()
  websiteUrl = url
  const controller = new AbortController()
  websiteController = controller
  await run(() => websitePhoneIcon(url, controller.signal), false, true)
}
async function readFiles(kind: 'apk' | 'source') {
  await task
  const entries = props.document.attachments.filter((file) => file.kind === kind)
  if (!entries.length) return
  await run(async () => {
    if (kind === 'apk') {
      const entry = entries.at(-1)!
      const file = await props.readFile(entry.path)
      if (file.size > 256 * 1024 * 1024) throw new Error('APK 过大，跳过图标提取；可以手动导入图片')
      const blob = await new Promise<Blob>((resolve, reject) => {
        worker = new Worker(new URL('../workers/PocketPhoneApkIcon.worker.ts', import.meta.url), {
          type: 'module',
        })
        worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>) => {
          worker?.terminate()
          worker = undefined
          if (data.blob) resolve(data.blob)
          else reject(new Error(data.error || 'APK 没有可解析的图片图标，可导入图片'))
        }
        worker.onerror = () => {
          worker?.terminate()
          worker = undefined
          reject(new Error('APK 图标解析失败'))
        }
        worker.postMessage(file)
      })
      return { source: 'apk', origin: entry.path, dataUrl: await preparePhoneIcon(blob) }
    }
    const files = new Map<string, Blob>()
    let total = 0
    for (const entry of entries) {
      if (!/\.(?:zip|html?|json|webmanifest|png|jpe?g|webp|svg|ico)$/i.test(entry.name)) continue
      const file = await props.readFile(entry.path)
      if (/\.zip$/i.test(entry.name)) {
        for (const [path, blob] of await readPhoneSourceZip(new File([file], entry.name))) {
          total += blob.size
          files.set(path, blob)
        }
      } else if (file.size <= 3 * 1024 * 1024) {
        total += file.size
        files.set(entry.name, file)
      }
      if (total > 16 * 1024 * 1024) throw new Error('源码图标候选过大，可手动导入图片')
    }
    return sourcePhoneIcon(files, entries[0]!.path)
  })
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file)
    await run(
      async () => ({
        source: 'image',
        origin: file.name,
        dataUrl: await preparePhoneIcon(file),
      }),
      true,
    )
}
watch(
  () => [props.document.url, props.document.attachments.map((entry) => entry.path).join(',')],
  () => {
    if (websiteUrl && websiteUrl !== props.document.url.trim()) cancelPending()
    const icons = (props.document.icons || []).filter((icon) =>
      icon.source === 'website'
        ? icon.origin === props.document.url.trim()
        : ['apk', 'source'].includes(icon.source)
          ? props.document.attachments.some((entry) => entry.path === icon.origin)
          : true,
    )
    if (icons.length !== props.document.icons?.length && props.document.icons)
      publish(
        icons,
        icons.some((icon) => icon.source === props.document.iconSource)
          ? props.document.iconSource
          : icons[0]?.source,
      )
  },
)
onBeforeUnmount(cancelPending)
defineExpose({ readWebsite, readFiles, cancelPending })
</script>

<template>
  <div class="phone-icon-picker">
    <div class="phone-icon-picker__current">
      <img v-if="selected" :src="selected.dataUrl" alt="当前图标" referrerpolicy="no-referrer" />
      <span v-else class="phone-icon-picker__placeholder" aria-hidden="true">◇</span>
      <span class="phone-icon-picker__description"
        ><strong>图标</strong
        ><small role="status" :title="status">{{
          pending ? '正在读取…' : selected ? labels[selected.source] : status || '未设置'
        }}</small></span
      >
      <button
        type="button"
        class="button button--quiet"
        :aria-expanded="expanded"
        @click="togglePicker"
      >
        {{ expanded ? '收起' : '更换图标' }}
      </button>
    </div>
    <div v-if="expanded" class="phone-icon-picker__editor">
      <label class="field"
        ><span>图标来源</span>
        <select
          aria-label="图标来源"
          class="field__control"
          :value="sourceChoice"
          @change="changeSource"
        >
          <option value="">不显示图标</option>
          <option v-for="source in availableSources" :key="source" :value="source">
            {{ labels[source] }}
          </option>
        </select>
      </label>
      <label v-if="sourceChoice === 'image'" class="button button--quiet phone-icon-picker__upload"
        >选择图片
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          :disabled="pending"
          @change="upload"
        />
      </label>
      <template v-else-if="sourceChoice === 'url'">
        <label class="field"
          ><span>图片直链 URL</span
          ><input
            v-model="imageUrl"
            type="url"
            class="field__control"
            placeholder="https://…/icon.png"
        /></label>
        <button
          type="button"
          class="button button--quiet"
          :disabled="pending || !imageUrl.trim()"
          @click="run(() => directPhoneIcon(imageUrl.trim()), true)"
        >
          使用直链图片
        </button>
      </template>
      <button
        v-else-if="sourceChoice === 'website'"
        type="button"
        class="button button--quiet"
        :disabled="pending"
        @click="readWebsite"
      >
        重新读取
      </button>
    </div>
  </div>
</template>

<style scoped>
.phone-icon-picker {
  min-width: 0;
}
.phone-icon-picker__current {
  display: flex;
  align-items: center;
  gap: 12px;
}
.phone-icon-picker__current img,
.phone-icon-picker__placeholder {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  object-fit: contain;
  border-radius: 10px;
}
.phone-icon-picker__placeholder {
  display: grid;
  place-items: center;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.phone-icon-picker__description {
  display: grid;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.phone-icon-picker small {
  color: var(--color-ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phone-icon-picker__editor {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
.phone-icon-picker__editor > .button {
  justify-self: start;
}
.phone-icon-picker__upload {
  position: relative;
  overflow: hidden;
}
.phone-icon-picker input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
</style>
