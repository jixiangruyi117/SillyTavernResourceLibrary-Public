<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'
import { categoryService, historyService, resourceService } from '../core/AppContainer'
import {
  buildStoredVersionRecognitionReport,
  findHistoricalDuplicateGroups,
  findStoredVersionGroups,
  type StoredVersionRecognitionReport,
  type StoredVersionRecognitionGroup,
} from '../services/ResourceVersionMatcher'
import { RESOURCE_TYPE_LABELS, type ResourceSummary } from '../types/Resource'

const props = defineProps<{ resources: ResourceSummary[] }>()
const emit = defineEmits<{ close: []; 'library-changed': [] }>()
const currentResources = ref<ResourceSummary[]>(props.resources)
const historicalVersions = ref<ResourceSummary[]>([])
const loadingHistory = ref(true)
const groups = computed(() =>
  findStoredVersionGroups(currentResources.value, historicalVersions.value),
)
const historicalCleanupGroups = computed(() => {
  const currentById = new Map(currentResources.value.map((resource) => [resource.id, resource]))
  const versionsByOwner = new Map<string, ResourceSummary[]>()
  for (const version of historicalVersions.value) {
    const ownerId = version.versionGroupId
    if (!ownerId || !currentById.has(ownerId)) continue
    versionsByOwner.set(ownerId, [...(versionsByOwner.get(ownerId) ?? []), version])
  }
  return Array.from(versionsByOwner, ([ownerId, versions]) => ({
    owner: currentById.get(ownerId)!,
    versions: versions.sort(
      (left, right) =>
        (right.versionImportedAt ?? right.createdAt) - (left.versionImportedAt ?? left.createdAt),
    ),
  })).sort((left, right) => left.owner.name.localeCompare(right.owner.name, 'zh-CN'))
})
const historyCleanupCandidateCount = computed(() =>
  historicalCleanupGroups.value.reduce((total, group) => total + group.versions.length, 0),
)
const report = ref<StoredVersionRecognitionReport>()
const lastScanAt = ref(0)
const scanDuration = ref(0)
const selectedIds = ref(new Set<string>())
const selectedHistoryVersionIds = ref(new Set<string>())
const keeperChoices = ref<Record<string, string>>({})
const activeWorkflow = ref<'cleanup' | 'merge'>('cleanup')
const busy = ref(false)
const message = ref('')

const selectedGroups = computed(() =>
  groups.value.filter((group) => selectedIds.value.has(group.id)),
)
const selectedSourceCount = computed(() =>
  selectedGroups.value.reduce((total, group) => total + group.resources.length - 1, 0),
)
const selectedHistoryVersionCount = computed(() => selectedHistoryVersionIds.value.size)

onMounted(async () => {
  await reloadAndScan()
})

watch(
  () => props.resources,
  (resources) => {
    currentResources.value = resources
  },
)

async function reloadAndScan(): Promise<void> {
  if (busy.value) return
  loadingHistory.value = true
  try {
    await resourceService.backfillCardFingerprints()
    await reloadHistory()
    runScan()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '历史版本摘要读取失败'
  } finally {
    loadingHistory.value = false
  }
}

async function reloadHistory(): Promise<void> {
  const [resources, versions] = await Promise.all([
    resourceService.listSummaries(),
    resourceService.listVersionSummaries(),
  ])
  currentResources.value = resources
  historicalVersions.value = versions
}

function runScan(): void {
  const startedAt = performance.now()
  const scannedHistoricalDuplicateGroups = findHistoricalDuplicateGroups(
    currentResources.value,
    historicalVersions.value,
  )
  report.value = buildStoredVersionRecognitionReport(
    currentResources.value,
    historicalVersions.value,
    groups.value,
    scannedHistoricalDuplicateGroups,
  )
  scanDuration.value = Math.max(1, Math.round(performance.now() - startedAt))
  lastScanAt.value = Date.now()
  selectedIds.value = new Set(
    Array.from(selectedIds.value).filter((id) => groups.value.some((group) => group.id === id)),
  )
  const availableHistoryVersionIds = new Set(
    historicalCleanupGroups.value.flatMap((group) => group.versions.map((version) => version.id)),
  )
  selectedHistoryVersionIds.value = new Set(
    Array.from(selectedHistoryVersionIds.value).filter((id) => availableHistoryVersionIds.has(id)),
  )
}

function keeperOf(group: StoredVersionRecognitionGroup): string {
  return keeperChoices.value[group.id] ?? group.recommendedKeeperId
}

function toggleGroup(groupId: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  selectedIds.value = next
}

function toggleAll(): void {
  selectedIds.value =
    selectedIds.value.size === groups.value.length
      ? new Set()
      : new Set(groups.value.map((group) => group.id))
}

function toggleHistoryVersion(versionId: string): void {
  const next = new Set(selectedHistoryVersionIds.value)
  if (next.has(versionId)) next.delete(versionId)
  else next.add(versionId)
  selectedHistoryVersionIds.value = next
}

function toggleAllHistoryVersions(): void {
  const allIds = historicalCleanupGroups.value.flatMap((group) =>
    group.versions.map((version) => version.id),
  )
  selectedHistoryVersionIds.value =
    allIds.length > 0 && selectedHistoryVersionIds.value.size === allIds.length
      ? new Set()
      : new Set(allIds)
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString('zh-CN')
}

async function mergeSelected(): Promise<void> {
  if (!selectedGroups.value.length || busy.value) return
  const confirmed = await confirmAction({
    title: '并入跨资源版本',
    message: `将处理 ${selectedGroups.value.length} 组资源，把 ${selectedSourceCount.value} 个独立资源并入所选保留项的历史时间线。来源记录会从当前资源列表移出，原文件及已有历史会保留在目标时间线。\n\n只使用完整卡指纹、核心指纹或稳定来源 ID 等强证据。`,
    confirmLabel: '开始并入',
    centered: true,
  })
  if (!confirmed) return

  busy.value = true
  message.value = '正在整理版本…'
  let merged = 0
  try {
    for (const group of selectedGroups.value) {
      const keeperId = keeperOf(group)
      for (const resource of group.resources) {
        if (resource.id === keeperId) continue
        await resourceService.mergeExistingResourceAsVersion(
          keeperId,
          resource.id,
          group.matchKind === 'containerVariant'
            ? '批量重识别：同卡不同封装'
            : '批量重识别：历史版本',
        )
        merged += 1
      }
    }
    message.value = `已完成：${selectedGroups.value.length} 组、${merged} 个资源并入历史版本。`
    selectedIds.value = new Set()
    emit('library-changed')
  } catch (error) {
    message.value = `${error instanceof Error ? error.message : '版本重识别失败'}${
      merged ? `；中断前已完成 ${merged} 个，原文件仍保留在版本时间线。` : ''
    }`
    if (merged) emit('library-changed')
  } finally {
    busy.value = false
  }
}

async function cleanSelectedHistoryVersions(): Promise<void> {
  const selectedByOwner = historicalCleanupGroups.value
    .map((group) => ({
      ownerId: group.owner.id,
      versionIds: group.versions
        .filter((version) => selectedHistoryVersionIds.value.has(version.id))
        .map((version) => version.id),
    }))
    .filter((group) => group.versionIds.length > 0)
  const selectedCount = selectedByOwner.reduce((total, group) => total + group.versionIds.length, 0)
  if (!selectedCount || busy.value) return
  const choice = await chooseAction({
    title: '删除已存历史版本',
    message: `将从 ${selectedByOwner.length} 条资源时间线永久删除 ${selectedCount} 个已存历史版本。当前版本不会删除。整库快照可能很大，请选择是否额外创建。`,
    confirmLabel: '创建完整快照并删除',
    alternativeLabel: '不建快照，直接删除',
    cancelLabel: '取消',
    danger: true,
    centered: true,
  })
  if (choice === 'cancel') return

  busy.value = true
  message.value = choice === 'confirm' ? '正在创建快照并删除所选历史版本…' : '正在删除所选历史版本…'
  let deleted = 0
  let deletionStarted = false
  try {
    if (choice === 'confirm') {
      await historyService.capture(
        await resourceService.list(),
        await categoryService.list(),
        '清理已存历史版本前用户选择的完整快照',
      )
    }
    for (const group of selectedByOwner) {
      deletionStarted = true
      deleted += await resourceService.deleteVersions(group.ownerId, group.versionIds)
    }
    await reloadHistory()
    selectedHistoryVersionIds.value = new Set()
    runScan()
    message.value = `清理完成：已从 ${selectedByOwner.length} 条时间线删除 ${deleted} 个历史版本；当前版本保留。`
    emit('library-changed')
  } catch (error) {
    message.value = `${error instanceof Error ? error.message : '历史版本清理失败'}${
      deletionStarted
        ? `；已重新读取资源状态，请核对结果${deleted ? `（已确认删除 ${deleted} 个）` : ''}。`
        : ''
    }`
    if (deletionStarted) {
      await reloadHistory()
      runScan()
      emit('library-changed')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="version-recognition">
    <header class="version-recognition__header">
      <div>
        <h2>历史版本管理</h2>
        <p>查看并清理时间线中已存档的版本，或识别资源库里尚未归组的跨资源版本。</p>
      </div>
      <button type="button" aria-label="关闭历史版本管理" @click="emit('close')">×</button>
    </header>

    <aside class="version-recognition__rules">
      <strong>操作边界</strong>
      <span>清理：只处理时间线中已存档的历史项，当前版保留</span>
      <span>并入：只处理仍独立存放且有强版本证据的资源</span>
      <p>扫描仅展示候选；不会自动删除、合并或覆盖资源。</p>
    </aside>

    <section v-if="report" class="version-recognition__report" aria-label="本次扫描结果">
      <article>
        <strong>{{ report.currentResources }}</strong>
        <span>当前资源</span>
      </article>
      <article>
        <strong>{{ report.linkedHistoricalVersions }} / {{ report.historicalVersions }}</strong>
        <span>已读取历史版本</span>
      </article>
      <article>
        <strong>{{ report.fingerprintedCards }} / {{ report.totalCards }}</strong>
        <span>角色卡有强指纹</span>
      </article>
      <article class="is-accent">
        <strong>{{ report.candidateGroups }}</strong>
        <span>跨资源候选组</span>
      </article>
      <p
        v-if="
          report.exactDuplicateGroups ||
          report.equivalentJsonGroups ||
          report.sameGroupHistoricalFingerprintGroups ||
          report.historicalVersions > report.linkedHistoricalVersions
        "
      >
        <template v-if="report.exactDuplicateGroups || report.equivalentJsonGroups">
          另有 {{ report.exactDuplicateGroups }} 组完全相同文件、{{ report.equivalentJsonGroups }}
          组等价 JSON 留给独立的“重复清理”。
        </template>
        <template v-if="report.sameGroupHistoricalFingerprintGroups">
          时间线中有 {{ report.sameGroupHistoricalFingerprintGroups }} 组相同指纹项：
          {{ report.removableHistoricalDuplicateGroups }} 组是可确认重复，
          {{ report.protectedContainerVariantGroups }} 组可能是不同立绘；可在清理页逐项核对后选择。
        </template>
        <template v-if="report.historicalVersions > report.linkedHistoricalVersions">
          另有
          {{ report.historicalVersions - report.linkedHistoricalVersions }}
          个历史记录未关联当前资源，暂不列入清理候选。
        </template>
      </p>
    </section>

    <div class="version-recognition__toolbar">
      <span>
        扫描结果
        <small v-if="lastScanAt">· {{ formatDate(lastScanAt) }} · 耗时 {{ scanDuration }}ms</small>
      </span>
      <button type="button" :disabled="busy || loadingHistory" @click="reloadAndScan">
        {{ loadingHistory ? '正在扫描…' : '重新扫描' }}
      </button>
    </div>

    <p v-if="message" class="version-recognition__message" role="status">{{ message }}</p>

    <div class="version-recognition__workflows" role="group" aria-label="选择版本处理方式">
      <button
        id="version-workflow-cleanup-button"
        type="button"
        :aria-pressed="activeWorkflow === 'cleanup'"
        :disabled="busy || loadingHistory"
        @click="activeWorkflow = 'cleanup'"
      >
        <span class="version-recognition__workflow-title">清理历史版本</span>
        <small>删除时间线内已存版本 · 当前版保留</small>
        <em>{{ historyCleanupCandidateCount }} 项</em>
      </button>
      <button
        id="version-workflow-merge-button"
        type="button"
        :aria-pressed="activeWorkflow === 'merge'"
        :disabled="busy || loadingHistory"
        @click="activeWorkflow = 'merge'"
      >
        <span class="version-recognition__workflow-title">并入历史版本</span>
        <small>合并独立资源 · 原文件转入目标时间线</small>
        <em>{{ groups.length }} 组</em>
      </button>
    </div>

    <section
      v-if="activeWorkflow === 'cleanup'"
      id="version-workflow-cleanup"
      class="version-recognition__workflow-pane"
      aria-labelledby="version-workflow-cleanup-button"
    >
      <header class="version-recognition__workflow-heading">
        <div>
          <h3>清理已存历史版本</h3>
          <p>这里只列出已经归入资源时间线的版本。删除前会创建本地快照；当前版本始终保留。</p>
        </div>
        <button
          v-if="historyCleanupCandidateCount"
          type="button"
          :disabled="busy"
          @click="toggleAllHistoryVersions"
        >
          {{
            selectedHistoryVersionCount === historyCleanupCandidateCount
              ? '取消全选'
              : '全选历史版本'
          }}
        </button>
      </header>
      <div v-if="loadingHistory" class="version-recognition__empty">
        <strong>正在扫描资源…</strong>
        <p>只读取轻量摘要，不加载高清原文件。</p>
      </div>
      <div v-else-if="historicalCleanupGroups.length" class="version-recognition__history-list">
        <article
          v-for="group in historicalCleanupGroups"
          :key="`history:${group.owner.id}`"
          class="version-recognition__history-group"
        >
          <header>
            <strong>{{ group.owner.name }}</strong>
            <span>当前版本 · 不会删除</span>
            <small>{{ group.versions.length }} 个已存历史版本</small>
          </header>
          <div class="version-recognition__history-items">
            <label
              v-for="version in group.versions"
              :key="version.id"
              :class="{ 'is-selected': selectedHistoryVersionIds.has(version.id) }"
            >
              <input
                type="checkbox"
                :checked="selectedHistoryVersionIds.has(version.id)"
                :disabled="busy"
                @change="toggleHistoryVersion(version.id)"
              />
              <span>
                <strong>{{ version.versionLabel || version.name }}</strong>
                <small>
                  {{ version.fileName }} · 存档于
                  {{ formatDate(version.versionImportedAt ?? version.createdAt) }} ·
                  {{ (version.fileSize / 1024).toFixed(1) }} KB
                </small>
              </span>
              <em v-if="version.metadata.versionVariantKind === 'container'">封装变体</em>
            </label>
          </div>
        </article>
      </div>
      <div v-else class="version-recognition__empty">
        <strong>目前没有已存档的历史版本</strong>
        <p>如果要把资源库里尚未归入时间线的不同版本整理起来，请切换到“并入历史版本”。</p>
      </div>
      <footer v-if="historyCleanupCandidateCount">
        <span
          >已选 {{ selectedHistoryVersionCount }} /
          {{ historyCleanupCandidateCount }} 个历史版本</span
        >
        <button
          type="button"
          :disabled="busy || !selectedHistoryVersionCount"
          @click="cleanSelectedHistoryVersions"
        >
          {{ busy ? '处理中…' : '删除选中的历史版本' }}
        </button>
      </footer>
    </section>

    <section
      v-else
      id="version-workflow-merge"
      class="version-recognition__workflow-pane"
      aria-labelledby="version-workflow-merge-button"
    >
      <header class="version-recognition__workflow-heading">
        <div>
          <h3>并入历史版本</h3>
          <p>
            把尚未归组的独立资源并入所选资源；来源记录会从当前列表移出，原文件与已有历史保留在目标时间线。
          </p>
        </div>
        <button v-if="groups.length" type="button" :disabled="busy" @click="toggleAll">
          {{ selectedIds.size === groups.length ? '取消全选' : '全选候选组' }}
        </button>
      </header>
      <div v-if="loadingHistory" class="version-recognition__empty">
        <strong>正在扫描资源…</strong>
        <p>只读取轻量摘要，不加载高清原文件。</p>
      </div>
      <div v-else-if="groups.length" class="version-recognition__groups">
        <article
          v-for="(group, groupIndex) in groups"
          :key="group.id"
          :class="{ 'is-selected': selectedIds.has(group.id) }"
        >
          <header>
            <label>
              <input
                type="checkbox"
                :checked="selectedIds.has(group.id)"
                :disabled="busy"
                @change="toggleGroup(group.id)"
              />
              <span>
                <strong
                  >候选 {{ groupIndex + 1 }} ·
                  {{ RESOURCE_TYPE_LABELS[group.resources[0]!.type] }} ·
                  {{ group.resources.length }} 个文件</strong
                >
                <small>{{
                  group.matchKind === 'containerVariant' ? '同卡不同封装' : '历史版本'
                }}</small>
              </span>
            </label>
            <p>{{ group.reasons.join('；') }}</p>
          </header>
          <ul>
            <li v-for="resource in group.resources" :key="resource.id">
              <label>
                <input
                  type="radio"
                  :name="`version-keeper-${groupIndex}`"
                  :checked="keeperOf(group) === resource.id"
                  :disabled="busy"
                  @change="keeperChoices[group.id] = resource.id"
                />
                <span>
                  <strong>{{ resource.name }}</strong>
                  <small
                    >{{ resource.fileName }} · {{ formatDate(resource.updatedAt) }} ·
                    {{ resource.versionCount ?? 1 }} 个现有版本</small
                  >
                </span>
                <em>{{ keeperOf(group) === resource.id ? '保留为当前版' : '并入历史' }}</em>
              </label>
            </li>
          </ul>
        </article>
      </div>
      <div v-else class="version-recognition__empty">
        <strong>没有可并入历史版本的跨资源候选</strong>
        <p>
          需要不同资源之间存在强版本证据才会列在这里。已归入资源时间线的版本请到“清理历史版本”中查看。
        </p>
      </div>
      <footer v-if="groups.length">
        <span
          >已选 {{ selectedGroups.length }} 组，将
          {{ selectedSourceCount }} 个资源并入所选资源的历史时间线</span
        >
        <button type="button" :disabled="busy || !selectedGroups.length" @click="mergeSelected">
          {{ busy ? '处理中…' : '并入所选版本' }}
        </button>
      </footer>
    </section>
  </section>
</template>

<style scoped src="../styles/VersionRecognitionPanel.css"></style>
