<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { categoryService, historyService, resourceService } from '../core/AppContainer'
import {
  buildStoredVersionRecognitionReport,
  findHistoricalDuplicateGroups,
  findStoredVersionGroups,
  type HistoricalDuplicateGroup,
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
const historicalDuplicateGroups = ref<HistoricalDuplicateGroup[]>([])
const safeHistoricalDuplicateGroups = computed(() =>
  historicalDuplicateGroups.value.filter((group) => group.safeToDelete),
)
const protectedHistoricalVariantGroups = computed(() =>
  historicalDuplicateGroups.value.filter((group) => !group.safeToDelete),
)
const report = ref<StoredVersionRecognitionReport>()
const lastScanAt = ref(0)
const scanDuration = ref(0)
const selectedIds = ref(new Set<string>())
const selectedDuplicateIds = ref(new Set<string>())
const keeperChoices = ref<Record<string, string>>({})
const busy = ref(false)
const message = ref('')

const selectedGroups = computed(() =>
  groups.value.filter((group) => selectedIds.value.has(group.id)),
)
const selectedSourceCount = computed(() =>
  selectedGroups.value.reduce((total, group) => total + group.resources.length - 1, 0),
)
const selectedDuplicateGroups = computed(() =>
  safeHistoricalDuplicateGroups.value.filter((group) => selectedDuplicateIds.value.has(group.id)),
)
const selectedDuplicateCount = computed(() =>
  selectedDuplicateGroups.value.reduce((total, group) => total + group.duplicates.length, 0),
)

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
  historicalDuplicateGroups.value = scannedHistoricalDuplicateGroups
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
  const availableDuplicateIds = new Set(
    safeHistoricalDuplicateGroups.value.map((group) => group.id),
  )
  selectedDuplicateIds.value = selectedDuplicateIds.value.size
    ? new Set(Array.from(selectedDuplicateIds.value).filter((id) => availableDuplicateIds.has(id)))
    : new Set(availableDuplicateIds)
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

function toggleDuplicateGroup(groupId: string): void {
  const next = new Set(selectedDuplicateIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  selectedDuplicateIds.value = next
}

function toggleAllDuplicateGroups(): void {
  selectedDuplicateIds.value =
    selectedDuplicateIds.value.size === safeHistoricalDuplicateGroups.value.length
      ? new Set()
      : new Set(safeHistoricalDuplicateGroups.value.map((group) => group.id))
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString('zh-CN')
}

async function mergeSelected(): Promise<void> {
  if (!selectedGroups.value.length || busy.value) return
  const confirmed = await confirmAction({
    title: '重新识别历史版本',
    message: `将处理 ${selectedGroups.value.length} 组资源，把 ${selectedSourceCount.value} 个当前资源并入所选保留项的历史版本。\n\n只使用完整卡指纹、核心指纹或稳定来源 ID 等强证据；开始前会自动创建本地快照。确定继续吗？`,
    confirmLabel: '开始合并',
  })
  if (!confirmed) return

  busy.value = true
  message.value = '正在创建快照并整理版本…'
  let merged = 0
  try {
    await historyService.capture(
      await resourceService.list(),
      await categoryService.list(),
      '批量版本重识别前自动快照',
    )
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
      merged ? `；中断前已完成 ${merged} 个，可从刚创建的快照恢复。` : ''
    }`
    if (merged) emit('library-changed')
  } finally {
    busy.value = false
  }
}

function duplicateKindLabel(group: HistoricalDuplicateGroup): string {
  if (group.kind === 'exactFile') return '完全相同文件'
  if (group.kind === 'equivalentJson') return '等价 JSON'
  return '受保护封装变体'
}

async function cleanHistoricalDuplicates(): Promise<void> {
  if (!selectedDuplicateGroups.value.length || busy.value) return
  const confirmed = await confirmAction({
    title: '清理重复历史版本',
    message: `将从 ${selectedDuplicateGroups.value.length} 条时间线删除 ${selectedDuplicateCount.value} 个可安全确认的历史副本。\n\n只删除文件哈希完全相同，或完整卡数据相同的 JSON 历史项；PNG 等不同立绘/封装不会删除。开始前会创建本地快照。确定继续吗？`,
    confirmLabel: '清理重复项',
  })
  if (!confirmed) return

  busy.value = true
  message.value = '正在创建快照并清理重复历史项…'
  let deleted = 0
  try {
    await historyService.capture(
      await resourceService.list(),
      await categoryService.list(),
      '历史版本重复清理前自动快照',
    )
    const duplicateIdsByOwner = new Map<string, Set<string>>()
    for (const group of selectedDuplicateGroups.value) {
      const ids = duplicateIdsByOwner.get(group.ownerResourceId) ?? new Set<string>()
      group.duplicates.forEach((duplicate) => ids.add(duplicate.id))
      duplicateIdsByOwner.set(group.ownerResourceId, ids)
    }
    for (const [ownerResourceId, duplicateIds] of duplicateIdsByOwner) {
      deleted += await resourceService.deleteVersions(ownerResourceId, Array.from(duplicateIds))
    }
    await reloadHistory()
    selectedDuplicateIds.value = new Set()
    runScan()
    message.value = `清理完成：已删除 ${deleted} 个重复历史版本；不同立绘或不同二进制封装均保留。`
    emit('library-changed')
  } catch (error) {
    message.value = `${error instanceof Error ? error.message : '历史重复清理失败'}${
      deleted ? `；中断前已删除 ${deleted} 个，可从刚创建的快照恢复。` : ''
    }`
    if (deleted) {
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
  <section
    class="version-recognition"
    :class="{
      'has-historical-duplicates':
        safeHistoricalDuplicateGroups.length || protectedHistoricalVariantGroups.length,
    }"
  >
    <header class="version-recognition__header">
      <div>
        <h2>重新识别历史版本</h2>
        <p>
          扫描已经导入的资源，并按新规则重新分组。这里只列出强证据候选；同名、作者相似等模糊结果不会自动出现。
        </p>
      </div>
      <button type="button" aria-label="关闭版本重识别" @click="emit('close')">×</button>
    </header>

    <aside class="version-recognition__rules">
      <strong>本次会识别</strong>
      <span>稳定来源 ID 相同</span>
      <span>核心卡内容一致、附加内容不同</span>
      <span>卡数据相同但 PNG / JSON 封装不同</span>
      <p>
        完全相同的文件和两个等价 JSON
        仍交给“重复清理”，不会伪装成历史版本；旧版解析类型不同也不影响同一时间线去重。
      </p>
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
        <span>可靠候选组</span>
      </article>
      <p>
        已自动扫描，耗时 {{ scanDuration }}ms；现在只是展示候选，尚未修改任何资源。
        <template v-if="report.exactDuplicateGroups || report.equivalentJsonGroups">
          另有 {{ report.exactDuplicateGroups }} 组完全相同文件、{{ report.equivalentJsonGroups }}
          组等价 JSON 被正确留给“重复清理”。
        </template>
        <template v-if="report.sameGroupHistoricalFingerprintGroups">
          另有 {{ report.sameGroupHistoricalFingerprintGroups }}
          组相同完整指纹已经位于同一条历史时间线；其中
          {{ report.removableHistoricalDuplicateGroups }} 组可安全清理、
          {{ report.protectedContainerVariantGroups }} 组因可能是不同立绘而受保护。
        </template>
      </p>
    </section>

    <details
      v-if="safeHistoricalDuplicateGroups.length || protectedHistoricalVariantGroups.length"
      class="version-recognition__duplicates"
      open
    >
      <summary>
        <span>
          <strong>同一时间线里的重复项</strong>
          <small>
            {{ report?.removableHistoricalDuplicates ?? 0 }} 个可安全删除 ·
            {{ protectedHistoricalVariantGroups.length }} 组受保护
          </small>
        </span>
        <em>可执行清理</em>
      </summary>
      <div
        v-if="safeHistoricalDuplicateGroups.length"
        class="version-recognition__duplicate-toolbar"
      >
        <p>默认勾选全部安全重复项。这里只删除历史副本，当前版本不会删除。</p>
        <button type="button" :disabled="busy" @click="toggleAllDuplicateGroups">
          {{
            selectedDuplicateIds.size === safeHistoricalDuplicateGroups.length
              ? '取消全选'
              : '全选安全项'
          }}
        </button>
      </div>
      <div class="version-recognition__duplicate-list">
        <label
          v-for="group in safeHistoricalDuplicateGroups"
          :key="group.id"
          :class="{ 'is-selected': selectedDuplicateIds.has(group.id) }"
        >
          <input
            type="checkbox"
            :checked="selectedDuplicateIds.has(group.id)"
            :disabled="busy"
            @change="toggleDuplicateGroup(group.id)"
          />
          <span>
            <strong>{{ group.ownerName }} · {{ duplicateKindLabel(group) }}</strong>
            <small>
              保留「{{ group.keeper.fileName }}」，删除 {{ group.duplicates.length }} 个历史副本
            </small>
            <em>{{ group.reason }}</em>
          </span>
        </label>
        <article v-for="group in protectedHistoricalVariantGroups" :key="group.id">
          <span>保留</span>
          <div>
            <strong>{{ group.ownerName }} · {{ duplicateKindLabel(group) }}</strong>
            <small>{{ group.resources.length }} 个文件 · {{ group.reason }}</small>
          </div>
        </article>
      </div>
      <footer v-if="safeHistoricalDuplicateGroups.length">
        <span
          >已选 {{ selectedDuplicateGroups.length }} 组，共
          {{ selectedDuplicateCount }} 个历史副本</span
        >
        <button
          type="button"
          :disabled="busy || !selectedDuplicateGroups.length"
          @click="cleanHistoricalDuplicates"
        >
          {{ busy ? '处理中…' : '清理所选重复项' }}
        </button>
      </footer>
    </details>

    <div class="version-recognition__toolbar">
      <span>
        发现 {{ groups.length }} 组可靠候选
        <small v-if="lastScanAt">· {{ formatDate(lastScanAt) }}</small>
      </span>
      <div>
        <button type="button" :disabled="busy || loadingHistory" @click="reloadAndScan">
          {{ loadingHistory ? '读取中…' : '重新扫描' }}
        </button>
        <button v-if="groups.length" type="button" :disabled="busy" @click="toggleAll">
          {{ selectedIds.size === groups.length ? '取消全选' : '全选候选' }}
        </button>
      </div>
    </div>

    <p v-if="message" class="version-recognition__message" role="status">{{ message }}</p>
    <div v-if="loadingHistory" class="version-recognition__empty">
      <strong>正在扫描当前资源与历史版本…</strong>
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
                >候选 {{ groupIndex + 1 }} · {{ RESOURCE_TYPE_LABELS[group.resources[0]!.type] }} ·
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
      <strong>
        {{
          safeHistoricalDuplicateGroups.length
            ? '没有新的跨资源合并候选'
            : '没有发现可安全自动整理的版本组'
        }}
      </strong>
      <p>
        {{
          safeHistoricalDuplicateGroups.length
            ? `上方仍有 ${safeHistoricalDuplicateGroups.length} 组同一时间线重复项可以清理；“0 组可靠候选”只表示没有需要跨资源合并的新版本组。`
            : '这不代表没有相似资源；同一时间线里的历史版本本来已经归组，只有不同资源组之间出现强证据时才会列为可合并候选。'
        }}
      </p>
    </div>

    <footer>
      <span>已选 {{ selectedGroups.length }} 组，将并入 {{ selectedSourceCount }} 个资源</span>
      <button type="button" @click="emit('close')">取消</button>
      <button type="button" :disabled="busy || !selectedGroups.length" @click="mergeSelected">
        {{ busy ? '处理中…' : '合并所选版本' }}
      </button>
    </footer>
  </section>
</template>

<style scoped src="../styles/VersionRecognitionPanel.css"></style>
