<script setup lang="ts">
import '../styles/VersionArchive.css'
import { computed, ref, watch } from 'vue'

import type { ImportVersionCandidate, ImportVersionComparison } from '../types/Import'
import { getResourceCategoryIds, RESOURCE_TYPE_LABELS, type Category } from '../types/Resource'
import VersionDiffDialog from './VersionDiffDialog.vue'

const props = defineProps<{
  candidate: ImportVersionCandidate
  remaining: number
  busy: boolean
  comparingId?: string
  comparison?: ImportVersionComparison
  categories?: Category[]
}>()
const emit = defineEmits<{
  compare: [matchedResourceId: string]
  'close-comparison': []
  resolve: [
    decision: {
      action:
        | 'activate'
        | 'archive'
        | 'replace'
        | 'replaceCurrent'
        | 'replaceHistory'
        | 'independent'
        | 'existing'
        | 'skip'
      targetId?: string
      note?: string
    },
  ]
}>()

const selectedId = ref('')
const versionNote = ref('')
const existingChoiceOpen = ref(false)
const pngComparisonDone = ref(false)
const query = ref('')
const categoryId = ref('all')
const page = ref(1)
const pageSize = 10
const filteredCandidates = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  return props.candidate.candidates.filter((item) => {
    const ids = getResourceCategoryIds(item.resource)
    if (categoryId.value === 'uncategorized' && ids.length) return false
    if (
      categoryId.value !== 'all' &&
      categoryId.value !== 'uncategorized' &&
      !ids.includes(categoryId.value)
    )
      return false
    const text =
      `${item.resource.name}\n${item.resource.fileName}\n${item.resource.tags.join(' ')}`.toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredCandidates.value.length / pageSize)))
const visibleCandidates = computed(() =>
  filteredCandidates.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)
watch(filteredCandidates, () => {
  page.value = 1
})
const isActionBusy = computed(
  () => props.busy || Boolean(props.comparingId) || Boolean(props.comparison),
)
const selectedCandidate = computed(() =>
  props.candidate.candidates.find((item) => item.resource.id === selectedId.value),
)
const isContainerVariant = computed(() => selectedCandidate.value?.matchKind === 'containerVariant')
const isExistingContent = computed(() => selectedCandidate.value?.matchKind === 'contentDuplicate')
const isHistoricalMatch = computed(() => selectedCandidate.value?.matchedHistorical === true)
const requiresPngComparison = computed(() => {
  const existing = selectedCandidate.value?.matchedResource
  const incomingIsPng = /\.png$/iu.test(props.candidate.file.name)
  const existingIsPng = Boolean(
    existing && (existing.mimeType === 'image/png' || /\.png$/iu.test(existing.fileName)),
  )
  return isContainerVariant.value && incomingIsPng && existingIsPng
})
const isPngComparisonPending = computed(
  () => requiresPngComparison.value && !pngComparisonDone.value && !props.comparison,
)

watch(
  () => props.candidate,
  (candidate) => {
    query.value = ''
    categoryId.value = 'all'
    pngComparisonDone.value = false
    existingChoiceOpen.value = false
    selectedId.value = candidate.candidates[0]?.resource.id ?? ''
    versionNote.value =
      candidate.candidates[0]?.matchKind === 'containerVariant' ? '同内容，不同立绘或文件封装' : ''
  },
  { immediate: true },
)

function decide(
  action:
    | 'activate'
    | 'archive'
    | 'replace'
    | 'replaceCurrent'
    | 'replaceHistory'
    | 'independent'
    | 'existing'
    | 'skip',
): void {
  if (
    ['activate', 'archive', 'replace', 'replaceCurrent', 'replaceHistory'].includes(action) &&
    !selectedId.value
  )
    return
  existingChoiceOpen.value = false
  emit('resolve', {
    action,
    targetId: action === 'independent' || action === 'skip' ? undefined : selectedId.value,
    note: ['activate', 'archive', 'replace', 'replaceCurrent', 'replaceHistory'].includes(action)
      ? versionNote.value.trim()
      : undefined,
  })
}

function requestExistingChoice(): void {
  pngComparisonDone.value = true
  existingChoiceOpen.value = true
  emit('close-comparison')
}

function closeComparison(): void {
  pngComparisonDone.value = true
  existingChoiceOpen.value = false
  emit('close-comparison')
}

function closeExistingChoice(): void {
  existingChoiceOpen.value = false
}
</script>

<template>
  <Teleport to="body">
    <div class="version-import-overlay mobile-dialog-viewport" role="presentation">
      <section
        class="version-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-import-title"
      >
        <header>
          <div>
            <small>版本识别 · {{ remaining }} 待确认</small>
            <h2 id="version-import-title">
              {{
                isContainerVariant
                  ? '发现同内容的立绘或封装变体'
                  : isExistingContent
                    ? '这份卡内容已经存在'
                    : '发现可能的新版本'
              }}
            </h2>
          </div>
          <button
            type="button"
            :disabled="isActionBusy"
            aria-label="跳过这个文件"
            @click="decide('skip')"
          >
            ×
          </button>
        </header>

        <div class="version-import-dialog__file">
          <span>准备导入</span>
          <strong>{{ candidate.fileName }}</strong>
          <small v-if="isContainerVariant">
            卡内数据完全一致，但文件本身不同。它可能换了立绘，也可能只是重新封装。
          </small>
          <small v-else-if="isExistingContent">
            角色卡文本数据完全一致。确认后可保留库内原件，并记住新文件哈希以便下次自动跳过。
          </small>
          <small v-else-if="selectedCandidate?.matchKind === 'sameName'"
            >此候选仅名称相同，不能证明版本关系。请先查看差异，再确认是否归组。</small
          >
          <small v-else>文件尚未写入资源库，请确认它应该归到哪里。</small>
        </div>

        <fieldset>
          <legend>选择最接近的已有资源 <small>点右侧“比”查看差异</small></legend>
          <div class="version-import-dialog__filters">
            <input
              v-model="query"
              class="field__control"
              type="search"
              aria-label="搜索版本候选"
              placeholder="搜索名称、文件名或标签"
              :disabled="isActionBusy"
            />
            <select
              v-if="categories"
              v-model="categoryId"
              class="field__control"
              aria-label="候选文件夹"
              :disabled="isActionBusy"
            >
              <option value="all">全部文件夹</option>
              <option value="uncategorized">未分类</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
            </select>
          </div>
          <small v-if="selectedCandidate"
            >已选：{{ selectedCandidate.resource.name }} ·
            {{ selectedCandidate.resource.fileName }}</small
          >
          <p v-if="!filteredCandidates.length">没有匹配的候选，调整搜索词或文件夹后再试。</p>
          <div
            v-for="item in visibleCandidates"
            :key="item.resource.id"
            class="version-import-dialog__candidate"
            :class="{ 'is-selected': selectedId === item.resource.id }"
          >
            <label class="version-import-dialog__candidate-choice">
              <input
                v-model="selectedId"
                type="radio"
                :value="item.resource.id"
                :disabled="isActionBusy"
              />
              <span class="version-import-dialog__candidate-content">
                <span class="version-import-dialog__candidate-title">
                  <strong>{{ item.resource.name }}</strong>
                  <span class="version-import-dialog__score">{{
                    item.matchKind === 'sameName' ? '同名' : `${item.score} 分`
                  }}</span>
                </span>
                <small
                  >{{ RESOURCE_TYPE_LABELS[item.resource.type] }} ·
                  {{ item.reasons.join('、') }}</small
                >
                <small v-if="item.matchedHistorical">
                  命中历史版本：{{
                    item.matchedResource.versionLabel || item.matchedResource.fileName
                  }}
                </small>
              </span>
            </label>
            <button
              type="button"
              class="version-import-dialog__compare"
              :class="{ 'is-loading': comparingId === item.matchedResource.id }"
              :disabled="isActionBusy"
              :aria-label="`对比待导入文件与${item.matchedHistorical ? '历史版本' : ''}${item.matchedResource.name || item.matchedResource.fileName}`"
              :title="`对比待导入文件与${item.matchedHistorical ? '历史版本' : ''}${item.matchedResource.name || item.matchedResource.fileName}`"
              @click="emit('compare', item.matchedResource.id)"
            >
              <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
                <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" />
                <text x="16" y="20" text-anchor="middle">比</text>
              </svg>
            </button>
          </div>
          <nav v-if="pageCount > 1" class="version-import-dialog__filters" aria-label="候选分页">
            <button
              class="button button--quiet"
              type="button"
              :disabled="isActionBusy || page === 1"
              @click="page -= 1"
            >
              上一页
            </button>
            <span>{{ page }} / {{ pageCount }} · {{ filteredCandidates.length }} 项</span>
            <button
              class="button button--quiet"
              type="button"
              :disabled="isActionBusy || page === pageCount"
              @click="page += 1"
            >
              下一页
            </button>
          </nav>
        </fieldset>

        <label class="version-import-dialog__note">
          <span
            >{{ isContainerVariant ? '变体备注' : '版本备注' }}
            <small>可选，之后还能修改</small></span
          >
          <textarea
            v-model="versionNote"
            maxlength="240"
            rows="2"
            placeholder="例如：2026 夏季版、修复开场白、作者原版"
          ></textarea>
          <small>{{ versionNote.length }}/240</small>
        </label>

        <div class="version-import-dialog__actions">
          <button type="button" :disabled="isActionBusy" @click="decide('independent')">
            作为独立资源
          </button>
          <button
            v-if="!isExistingContent"
            type="button"
            :disabled="isActionBusy"
            @click="decide('archive')"
          >
            {{
              isContainerVariant
                ? isHistoricalMatch
                  ? '绑定为历史版本的不同封装'
                  : '设为不同封装'
                : '加入历史，不切换'
            }}
          </button>
          <button
            v-if="!isHistoricalMatch && !isPngComparisonPending"
            type="button"
            class="version-import-dialog__replace"
            :disabled="isActionBusy"
            @click="decide('replace')"
          >
            {{
              isExistingContent
                ? '覆盖当前版本'
                : isContainerVariant
                  ? '覆盖当前封装'
                  : '覆盖当前版本'
            }}
          </button>
          <button
            v-if="!isExistingContent && !isHistoricalMatch && !isPngComparisonPending"
            class="button--primary"
            type="button"
            :disabled="isActionBusy"
            @click="decide('activate')"
          >
            {{ busy ? '正在保存…' : isContainerVariant ? '绑定并设为当前封装' : '设为当前版本' }}
          </button>
          <button
            v-if="isHistoricalMatch && !isPngComparisonPending && !isContainerVariant"
            type="button"
            class="version-import-dialog__replace"
            :disabled="isActionBusy"
            @click="decide('replaceCurrent')"
          >
            覆盖当前版本
          </button>
          <button
            v-if="isHistoricalMatch && !isPngComparisonPending"
            type="button"
            class="version-import-dialog__replace"
            :disabled="isActionBusy"
            @click="decide('replaceHistory')"
          >
            {{ isContainerVariant ? '覆盖命中的历史封装' : '覆盖命中的历史版本' }}
          </button>
          <button
            v-if="isPngComparisonPending"
            type="button"
            class="button--primary"
            :disabled="isActionBusy"
            @click="emit('compare', selectedCandidate!.matchedResource.id)"
          >
            对比 PNG 卡面
          </button>
        </div>
        <p v-if="isContainerVariant">
          {{
            isHistoricalMatch
              ? '操作只作用于命中的历史版本，不会切换当前版本。覆盖会清理旧文件并保留旧哈希。'
              : '加入不同封装不会额外占用版本数量；覆盖会清理旧文件并保留旧哈希；设为当前封装会保留原封装。'
          }}
        </p>
        <p v-else-if="!isExistingContent">
          “设为当前版本”会把旧版收入历史，不会删除；文件夹、标签、收藏和关联关系继续保留。
        </p>
      </section>
    </div>
  </Teleport>

  <VersionDiffDialog
    v-if="comparison"
    :current="comparison.incoming"
    :other="comparison.existing"
    mode="import-candidate"
    :allow-mark-existing="isContainerVariant || isExistingContent"
    :allow-archive-import="isContainerVariant && !isExistingContent"
    :allow-activate-import="isContainerVariant && !isHistoricalMatch && !isExistingContent"
    :allow-replace-import="requiresPngComparison"
    :match-details="comparison"
    @mark-existing="requestExistingChoice"
    @archive-import="decide('archive')"
    @activate-import="decide('activate')"
    @replace-import="decide(isHistoricalMatch ? 'replaceHistory' : 'replace')"
    @close="closeComparison"
  />
  <Teleport to="body">
    <div
      v-if="existingChoiceOpen && selectedCandidate"
      class="version-import-overlay mobile-dialog-viewport"
      role="presentation"
    >
      <section
        class="version-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="保留哪份图片"
      >
        <header>
          <div>
            <small>图片已确认相同</small>
            <h2>选择保留哪张 PNG</h2>
          </div>
          <button type="button" aria-label="关闭" @click="closeExistingChoice">×</button>
        </header>
        <p>
          库内：{{ selectedCandidate.matchedResource.fileName }} ·
          {{ (selectedCandidate.matchedResource.fileSize / 1024).toFixed(1) }} KB
        </p>
        <p>新文件：{{ candidate.fileName }} · {{ (candidate.file.size / 1024).toFixed(1) }} KB</p>
        <div class="version-import-dialog__actions">
          <button type="button" :disabled="isActionBusy" @click="decide('existing')">
            保留库内图片，只记新文件哈希
          </button>
          <button
            type="button"
            class="version-import-dialog__replace"
            :disabled="isActionBusy"
            @click="decide(isHistoricalMatch ? 'replaceHistory' : 'replace')"
          >
            使用新图片替换库内图片
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
