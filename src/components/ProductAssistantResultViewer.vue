<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { AssistantImage, AssistantToolResult } from '../services/ProductAssistantService'
const image = ref<AssistantImage>()
const result = ref<AssistantToolResult>()
const imageDialog = ref<HTMLDialogElement>()
const resultDialog = ref<HTMLDialogElement>()
const reasoning = ref('')
const reasoningDialog = ref<HTMLDialogElement>()
const github = computed(() => {
  try {
    const value = JSON.parse(result.value?.json || '')
    if (value?.reader !== 'https://api.github.com' || !['file', 'directory'].includes(value.kind))
      return undefined
    const entries = Array.isArray(value.entries)
      ? value.entries.filter((item: unknown): item is { path: string; type: string } =>
          Boolean(
            item && typeof item === 'object' && 'path' in item && typeof item.path === 'string',
          ),
        )
      : []
    return {
      kind: value.kind as 'file' | 'directory',
      path: typeof value.path === 'string' ? value.path : '',
      ref: typeof value.ref === 'string' ? value.ref : '',
      source:
        typeof value.source === 'string' && /^https:\/\/github\.com\/[^\s]+$/u.test(value.source)
          ? value.source
          : '',
      text: typeof value.text === 'string' ? value.text : '',
      entries,
      offset: Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : 0,
      total: Number.isSafeInteger(value.totalCharacters) ? value.totalCharacters : 0,
      totalEntries: Number.isSafeInteger(value.totalEntries) ? value.totalEntries : entries.length,
      query: typeof value.query === 'string' ? value.query : '',
      directoryTotalEntries: Number.isSafeInteger(value.directoryTotalEntries)
        ? value.directoryTotalEntries
        : entries.length,
      complete: value.complete === true,
      hasNext: Number.isSafeInteger(value.nextOffset),
      possiblyTruncated: value.possiblyTruncated === true,
      sha: typeof value.sha === 'string' ? value.sha : '',
    }
  } catch {
    return undefined
  }
})
async function showImage(value: AssistantImage) {
  image.value = value
  await nextTick()
  imageDialog.value?.showModal()
}
async function showResult(value: AssistantToolResult | undefined) {
  result.value = value
  await nextTick()
  resultDialog.value?.showModal()
}
async function showReasoning(value: string) {
  if (!value.trim()) return
  reasoning.value = value
  await nextTick()
  reasoningDialog.value?.showModal()
}
function close() {
  imageDialog.value?.close()
  resultDialog.value?.close()
  reasoningDialog.value?.close()
  image.value = undefined
  result.value = undefined
  reasoning.value = ''
}
defineExpose({ showImage, showResult, showReasoning, close })
</script>
<template>
  <dialog
    ref="reasoningDialog"
    class="chat-reasoning-viewer"
    aria-label="思考内容"
    @click.self="reasoningDialog?.close()"
    @close="reasoning = ''"
  >
    <header>
      <strong>思考内容</strong>
      <button
        type="button"
        class="chat-tool-result-close"
        aria-label="关闭思考内容"
        @click="reasoningDialog?.close()"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </header>
    <pre>{{ reasoning }}</pre>
  </dialog>
  <dialog
    ref="imageDialog"
    class="chat-image-viewer"
    aria-label="查看聊天图片"
    @click.self="imageDialog?.close()"
  >
    <button type="button" aria-label="关闭图片" @click="imageDialog?.close()">×</button
    ><img v-if="image" :src="image.dataUrl" :alt="image.name" />
  </dialog>
  <dialog
    ref="resultDialog"
    class="chat-tool-result"
    aria-label="本机工具结果"
    @click.self="resultDialog?.close()"
  >
    <header>
      <strong>{{ result?.title }}</strong
      ><button
        type="button"
        class="chat-tool-result-close"
        aria-label="关闭"
        @click="resultDialog?.close()"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </header>
    <section v-if="github" class="chat-readable-result">
      <p class="chat-result-path">{{ github.path || '仓库根目录' }}</p>
      <p v-if="github.kind === 'file'" class="chat-result-status">
        <template v-if="github.complete">已读完整文件 · {{ github.total }} 字</template>
        <template v-else>已读片段 · {{ github.text.length }} / {{ github.total }} 字</template>
      </p>
      <p v-else class="chat-result-status">
        目录 · {{ github.entries.length ? github.offset + 1 : 0 }}～{{
          github.offset + github.entries.length
        }}
        项 / 共 {{ github.totalEntries }} 项
      </p>
      <p v-if="github.kind === 'directory' && github.query" class="chat-result-status">
        筛选：{{ github.query }} · 全目录 {{ github.directoryTotalEntries }} 项
      </p>
      <p
        v-if="github.kind === 'directory' && github.query && !github.totalEntries"
        class="chat-result-status"
      >
        没有匹配文件。
      </p>
      <p v-if="github.hasNext" class="chat-result-status">后面还有内容，这次未读完。</p>
      <p v-if="github.possiblyTruncated" class="chat-result-status">
        GitHub 目录返回数量已到上限，列表可能不全。
      </p>
      <a v-if="github.source" :href="github.source" target="_blank" rel="noopener noreferrer"
        >在 GitHub 查看原文</a
      >
      <ul v-if="github.kind === 'directory'" class="chat-result-files">
        <li v-for="entry in github.entries" :key="entry.path">
          <span>{{ entry.type === 'dir' ? '目录' : '文件' }}</span
          >{{ entry.path }}
        </li>
      </ul>
      <details v-else>
        <summary>查看源码</summary>
        <pre>{{ github.text || '（空文件）' }}</pre>
      </details>
      <details>
        <summary>技术详情</summary>
        <dl>
          <dt>分支 / 版本</dt>
          <dd>{{ github.ref }}</dd>
          <template v-if="github.sha"
            ><dt>文件校验值</dt>
            <dd>{{ github.sha }}</dd></template
          >
        </dl>
      </details>
    </section>
    <pre v-else>{{ result?.json }}</pre>
  </dialog>
</template>
