<script setup lang="ts">
import { toRefs, type ShallowUnwrapRef } from 'vue'
import type { usePresetStitcherApp } from '../composables/UsePresetStitcherApp'

type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof usePresetStitcherApp>>,
  | 'candidateSheetOpen'
  | 'candidates'
  | 'candidateCharacterCount'
  | 'candidateConflicts'
  | 'compareCandidateId'
  | 'insertCandidate'
  | 'removeCandidate'
  | 'comparisonCandidate'
  | 'selectedComparisonEntry'
  | 'templateName'
  | 'saveCandidateTemplate'
  | 'stitchTemplates'
  | 'applyCandidateTemplate'
  | 'removeCandidateTemplate'
  | 'insertAllCandidates'
>
const props = defineProps<{ model: PanelModel }>()
const {
  candidateSheetOpen,
  candidates,
  candidateCharacterCount,
  candidateConflicts,
  compareCandidateId,
  insertCandidate,
  removeCandidate,
  comparisonCandidate,
  selectedComparisonEntry,
  templateName,
  saveCandidateTemplate,
  stitchTemplates,
  applyCandidateTemplate,
  removeCandidateTemplate,
  insertAllCandidates,
} = toRefs(props.model)
</script>
<template>
  <div
    v-if="candidateSheetOpen"
    class="stitch-sheet mobile-dialog-viewport"
    role="dialog"
    aria-modal="true"
    aria-label="本次候选篮子"
    @click.self="candidateSheetOpen = false"
  >
    <section class="stitch-sheet__panel stitch-sheet__panel--candidates">
      <header>
        <span><strong>本次候选</strong></span>
        <button
          class="button button--quiet"
          type="button"
          aria-label="关闭"
          @click="candidateSheetOpen = false"
        >
          ×
        </button>
      </header>
      <p class="stitch-candidates__summary">
        将加入 <strong>{{ candidates.length }}</strong> 条 · 预计 +{{ candidateCharacterCount }}
        字
      </p>
      <p class="stitch__hint">选中主预设插入位置后，可逐条加入；批量加入保持候选顺序。</p>
      <ul class="stitch-candidates__list">
        <li v-for="candidate in candidates" :key="candidate.id">
          <div>
            <strong>{{ candidate.name }}</strong>
            <small>{{ candidate.sourceName }} · {{ candidate.content.length }} 字</small>
            <small v-if="candidateConflicts.get(candidate.id)?.similar" class="is-warning">
              正文相似：{{
                Math.round((candidateConflicts.get(candidate.id)?.similar?.score ?? 0) * 100)
              }}% · {{ candidateConflicts.get(candidate.id)?.similar?.entry.name }}
            </small>
            <small
              v-if="candidateConflicts.get(candidate.id)?.repeatedVariables.length"
              class="is-warning"
            >
              重复写入：{{ candidateConflicts.get(candidate.id)?.repeatedVariables.join('、') }}
            </small>
          </div>
          <div class="stitch-candidates__actions">
            <button
              type="button"
              class="button button--quiet"
              @click="compareCandidateId = candidate.id"
            >
              对比
            </button>
            <button
              type="button"
              class="button button--primary"
              @click="insertCandidate(candidate)"
            >
              加入此处
            </button>
            <button
              type="button"
              class="button button--quiet"
              @click="removeCandidate(candidate.id)"
            >
              移除
            </button>
          </div>
        </li>
        <li v-if="!candidates.length" class="stitch__empty">从填充预设点“加入候选”收集条目。</li>
      </ul>
      <section v-if="comparisonCandidate" class="stitch-candidates__compare">
        <header>
          <strong>对比阅读</strong>
          <small>当前插入点前一条：{{ selectedComparisonEntry?.name ?? '无' }}</small>
        </header>
        <div>
          <article>
            <small>候选 · {{ comparisonCandidate.name }}</small>
            <pre>{{ comparisonCandidate.content || '（没有正文）' }}</pre>
          </article>
          <article>
            <small>主预设 · {{ selectedComparisonEntry?.name ?? '无' }}</small>
            <pre>{{ selectedComparisonEntry?.content || '（插入点前没有正文）' }}</pre>
          </article>
        </div>
      </section>
      <section class="stitch-candidates__templates">
        <header><strong>候选模板</strong><small>只保存本机，不影响预设文件</small></header>
        <div class="stitch-candidates__template-save">
          <input v-model="templateName" type="text" maxlength="80" placeholder="例如：常用文风包" />
          <button
            type="button"
            class="button button--quiet"
            :disabled="!templateName.trim() || !candidates.length"
            @click="saveCandidateTemplate"
          >
            存为模板
          </button>
        </div>
        <ul>
          <li v-for="template in stitchTemplates" :key="template.id">
            <span
              ><strong>{{ template.name }}</strong
              ><small>{{ template.entries.length }} 条</small></span
            >
            <div>
              <button
                class="button button--quiet"
                type="button"
                @click="applyCandidateTemplate(template)"
              >
                加入候选</button
              ><button
                class="button button--quiet"
                type="button"
                @click="removeCandidateTemplate(template.id)"
              >
                删除
              </button>
            </div>
          </li>
        </ul>
      </section>
      <button
        type="button"
        class="button button--primary stitch-candidates__all"
        :disabled="!candidates.length"
        @click="insertAllCandidates"
      >
        按候选顺序加入
      </button>
    </section>
  </div>
</template>
<style scoped src="../styles/PresetStitcherApp.css"></style>
