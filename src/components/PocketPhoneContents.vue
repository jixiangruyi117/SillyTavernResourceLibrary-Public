<script setup lang="ts">
import { computed } from 'vue'
import type { PersonalResourceDocument } from '../types/PersonalResource'
import { formatBytes } from '../utils/LibraryFormatting'

const props = defineProps<{ document: PersonalResourceDocument; busy: boolean }>()
const emit = defineEmits<{ edit: []; download: [path: string] }>()
const icon = computed(
  () => props.document.icons?.find((item) => item.source === props.document.iconSource)?.dataUrl,
)
const host = computed(() => {
  try {
    return new URL(props.document.url).host
  } catch {
    return '访问网址'
  }
})
const groups = computed(() =>
  [
    {
      kind: 'apk',
      label: 'APK 安装包',
      files: props.document.attachments.filter((file) => file.kind === 'apk'),
    },
    {
      kind: 'source',
      label: '源码文件',
      files: props.document.attachments.filter((file) => file.kind === 'source'),
    },
  ].filter((group) => group.files.length),
)
</script>

<template>
  <section class="pocket-phone-contents" aria-label="小手机内容">
    <div class="pocket-phone-contents__link">
      <img v-if="icon" class="pocket-phone-contents__icon" :src="icon" alt="小手机图标" />
      <div class="pocket-phone-contents__address">
        <strong>{{ host }}</strong>
        <p class="pocket-phone-contents__url">{{ document.url || '未提供访问网址' }}</p>
      </div>
      <div class="pocket-phone-contents__actions">
        <a
          v-if="/^https?:\/\//i.test(document.url)"
          class="button button--primary pocket-phone-contents__open"
          :href="document.url"
          target="_blank"
          rel="noopener noreferrer"
          >打开小手机 ↗</a
        >
        <button class="button button--quiet" type="button" :disabled="busy" @click="emit('edit')">
          编辑
        </button>
      </div>
    </div>
    <div v-if="groups.length" class="helper-script-list">
      <details v-for="group in groups" :key="group.kind" :open="group.kind === 'apk'">
        <summary>
          <span
            ><strong>{{ group.label }}</strong></span
          ><i>{{ group.files.length }} 个文件</i>
        </summary>
        <ul class="pocket-phone-contents__files" :aria-label="group.label">
          <li v-for="file in group.files" :key="file.path">
            <span
              >{{ file.name }}<small>{{ formatBytes(file.size) }}</small></span
            >
            <button
              class="button button--quiet"
              type="button"
              :disabled="busy"
              @click="emit('download', file.path)"
            >
              下载
            </button>
          </li>
        </ul>
      </details>
    </div>
    <p v-else class="structured-record__empty">尚未收纳安装包或源码文件。</p>
    <section v-if="document.text" class="pocket-phone-contents__instructions">
      <h3>使用说明</h3>
      <p class="pocket-phone-contents__notes">{{ document.text }}</p>
    </section>
  </section>
</template>

<style scoped>
.pocket-phone-contents {
  display: grid;
  gap: 0.875rem;
}
.pocket-phone-contents__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.pocket-phone-contents__link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md, 12px);
  background: var(--color-surface-raised);
}
.pocket-phone-contents__address {
  flex: 1 1 160px;
  min-width: 0;
}
.pocket-phone-contents__address strong {
  display: block;
  margin-bottom: 6px;
  overflow-wrap: anywhere;
}
.pocket-phone-contents__icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: contain;
}
.pocket-phone-contents__url {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
.pocket-phone-contents .helper-script-list {
  padding: 0;
}
.pocket-phone-contents__open {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
.pocket-phone-contents__files {
  margin: 0;
  padding: 0 0.875rem 0.875rem;
  list-style: none;
}
.pocket-phone-contents__files li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-block: 0.625rem;
}
.pocket-phone-contents__files li + li {
  border-top: 1px solid var(--color-line);
}
.pocket-phone-contents__files span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pocket-phone-contents__files small {
  display: block;
  color: var(--color-ink-soft);
  font-size: 0.75rem;
}
.pocket-phone-contents__notes {
  margin: 0.5rem 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pocket-phone-contents__instructions h3 {
  margin: 0;
  font-size: 0.875rem;
}
</style>
