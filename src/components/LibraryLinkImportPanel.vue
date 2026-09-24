<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useApp } from '../composables/UseApp'

type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useApp>>,
  'handleLinkImport' | 'linkImportText' | 'linkImportUrls' | 'isBusy' | 'linkImportPreview'
>
const input = defineProps<{ model: PanelModel }>()
const handleLinkImport = toRef(input.model, 'handleLinkImport')
const linkImportText = toRef(input.model, 'linkImportText')
const linkImportUrls = toRef(input.model, 'linkImportUrls')
const isBusy = toRef(input.model, 'isBusy')
const linkImportPreview = toRef(input.model, 'linkImportPreview')
</script>
<template>
  <section id="link-import-panel" class="link-import-panel" aria-label="链接导入表单">
    <div class="link-import-panel__copy">
      <span
        >适合 GitHub 仓库、Release、raw 文件、文档或社区发布页。公开 GitHub 仓库会读取描述、README
        与扩展清单；始终不安装、不执行。</span
      >
    </div>
    <form class="link-import-panel__form" @submit.prevent="handleLinkImport">
      <label for="link-import-text">链接列表</label>
      <textarea
        id="link-import-text"
        v-model="linkImportText"
        rows="4"
        placeholder="每行一个链接，或用空格 / 逗号分隔&#10;https://github.com/owner/repo&#10;https://raw.githubusercontent.com/owner/repo/main/script.js"
      ></textarea>
      <div class="link-import-panel__footer">
        <span>{{ linkImportUrls.length }} 个待识别链接</span>
        <button type="submit" :disabled="isBusy || !linkImportUrls.length">
          {{ isBusy ? '正在读取并保存' : '读取说明并保存' }}
        </button>
      </div>
    </form>
    <div
      v-if="linkImportPreview"
      class="link-import-preview"
      :class="{ 'link-import-preview--invalid': !linkImportPreview.valid }"
    >
      <span class="link-import-preview__label">首个链接预览</span>
      <template v-if="linkImportPreview.valid">
        <strong>{{ linkImportPreview.url }}</strong>
        <p>
          {{ linkImportPreview.purposeLabel }} · {{ linkImportPreview.installTargetLabel }}
          <template v-if="linkImportPreview.versionRef?.value">
            · {{ linkImportPreview.versionRef.value }}
          </template>
        </p>
        <div v-if="linkImportPreview.github" class="link-import-preview__github">
          GitHub：{{ linkImportPreview.github.owner }}/{{ linkImportPreview.github.repo }}
          <template v-if="linkImportPreview.github.path">
            / {{ linkImportPreview.github.path }}
          </template>
        </div>
        <div v-if="linkImportPreview.badges.length" class="link-import-preview__badges">
          <span v-for="badge in linkImportPreview.badges" :key="badge">{{ badge }}</span>
        </div>
      </template>
      <template v-else>
        <strong>暂时无法识别这个链接</strong>
        <p>{{ linkImportPreview.url }}</p>
      </template>
    </div>
  </section>
</template>
