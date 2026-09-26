<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { noticeCenter, type NoticeRecord } from '../core/NoticeCenter'
import { taskCenter, type TaskRecord } from '../core/TaskCenter'

const props = withDefaults(
  defineProps<{
    suppressFocused?: boolean
    inlineTaskNames?: string[]
    hiddenTaskNames?: string[]
  }>(),
  {
    suppressFocused: false,
    inlineTaskNames: () => [],
    hiddenTaskNames: () => [],
  },
)

const tasks = ref<TaskRecord[]>([])
const notices = ref<NoticeRecord[]>([])
const open = ref(false)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
let unsubscribeTasks: (() => void) | undefined
let unsubscribeNotices: (() => void) | undefined

const inline = computed(() => props.inlineTaskNames.length > 0)
const displayedTasks = computed(() =>
  tasks.value.filter((task) => !props.hiddenTaskNames.includes(task.name)),
)
const activeTasks = computed(() =>
  displayedTasks.value.filter(
    (task) =>
      task.status === 'running' && (!inline.value || props.inlineTaskNames.includes(task.name)),
  ),
)
const centeredImportTask = computed(() =>
  activeTasks.value.find(
    (task) =>
      task.name.startsWith('导入') ||
      task.name.startsWith('识别分享') ||
      task.name === '恢复备份' ||
      task.name === '备份预检' ||
      task.name === '导出备份' ||
      task.name === '移入回收站' ||
      task.name === '彻底删除回收站资源' ||
      task.name === '清空回收站' ||
      task.name === '恢复历史版本',
  ),
)
const visibleTasks = computed(() =>
  displayedTasks.value
    .filter((task) => task.status === 'running' || task.status === 'failed')
    .slice(0, 8),
)
const visible = computed(() =>
  inline.value
    ? activeTasks.value.length > 0
    : visibleTasks.value.length > 0 || notices.value.length > 0,
)
const persistentNoticeCount = computed(
  () => notices.value.filter((notice) => notice.persistent).length,
)
const summary = computed(() => {
  const active = activeTasks.value[0]
  if (active) return `${active.name} · ${active.phase}`
  const failed = visibleTasks.value.find((task) => task.status === 'failed')
  if (failed) return `${failed.name} · 失败`
  return notices.value[0]?.message ?? '任务与通知'
})

function refreshTasks(): void {
  tasks.value = taskCenter.list()
}

function refreshNotices(): void {
  notices.value = noticeCenter.list()
}

function bytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${Math.round(value)} B`
}

function elapsed(task: TaskRecord): string {
  const seconds = Math.max(0, Math.floor((now.value - task.startedAt) / 1000))
  if (seconds < 60) return `已运行 ${seconds} 秒`
  return `已运行 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function waitingForProgress(task: TaskRecord): boolean {
  return task.status === 'running' && now.value - task.updatedAt >= 15_000
}

function stalled(task: TaskRecord): boolean {
  const transfer = task.transfer
  return Boolean(
    task.status === 'running' &&
    transfer &&
    (transfer.totalBytes === undefined || transfer.transferredBytes < transfer.totalBytes) &&
    now.value - transfer.lastProgressAt >= 15_000,
  )
}

function transferDescription(task: TaskRecord): string {
  const transfer = task.transfer
  if (!transfer) return ''
  const size = `${bytes(transfer.transferredBytes)}${transfer.totalBytes === undefined ? '' : ` / ${bytes(transfer.totalBytes)}`}`
  if (stalled(task)) return `${size} · 暂无新的传输进展，正在等待`
  const speed = transfer.bytesPerSecond
  const remaining = transfer.remainingSeconds
  return `${size}${speed === undefined ? '' : ` · ${bytes(speed)}/s`}${remaining === undefined ? '' : ` · 本阶段预计剩余约 ${Math.ceil(remaining)} 秒`}`
}

watch(
  () => visible.value && (open.value || centeredImportTask.value !== undefined),
  (enabled) => {
    if (clock !== undefined) clearInterval(clock)
    clock = undefined
    now.value = Date.now()
    if (enabled) clock = setInterval(() => (now.value = Date.now()), 1_000)
  },
)

async function runNoticeAction(action: NoticeRecord['actions'][number]): Promise<void> {
  await action.run()
}

onMounted(() => {
  refreshTasks()
  refreshNotices()
  unsubscribeTasks = taskCenter.subscribe(refreshTasks)
  unsubscribeNotices = noticeCenter.subscribe(refreshNotices)
})

onUnmounted(() => {
  if (clock !== undefined) clearInterval(clock)
  unsubscribeTasks?.()
  unsubscribeNotices?.()
})
</script>

<template>
  <aside
    v-if="visible"
    class="activity-center"
    :class="{ 'is-open': open, 'activity-center--inline': inline }"
    aria-live="polite"
  >
    <button
      v-if="!inline"
      class="activity-center__trigger"
      type="button"
      :aria-expanded="open"
      aria-controls="srl-activity-panel"
      @click="open = !open"
    >
      <span class="activity-center__signal" :class="{ 'is-running': activeTasks.length }"></span>
      <span>{{ summary }}</span>
      <strong v-if="activeTasks.length">{{ activeTasks.length }}</strong>
      <strong v-else-if="persistentNoticeCount">{{ persistentNoticeCount }}</strong>
    </button>

    <section v-if="open && !inline" id="srl-activity-panel" class="activity-center__panel">
      <header>
        <div><strong>任务与通知</strong></div>
        <button type="button" aria-label="收起任务与通知" @click="open = false">×</button>
      </header>

      <div v-if="visibleTasks.length" class="activity-center__group">
        <h3>任务</h3>
        <article v-for="task in visibleTasks" :key="task.operationId" class="activity-card">
          <div>
            <strong>{{ task.name }}</strong
            ><small>{{ task.phase }}</small>
          </div>
          <small v-if="task.status === 'running'" class="activity-card__elapsed">{{
            elapsed(task)
          }}</small>
          <small v-if="waitingForProgress(task)" class="activity-card__waiting">
            当前步骤超过 15 秒没有新进度；大文件解析或写入可能较久，请等待结果或检查存储空间。
          </small>
          <progress
            v-if="task.status === 'running' || task.progress !== undefined"
            :value="task.progress"
            :aria-label="`${task.name}：${task.phase}`"
            max="1"
          ></progress>
          <p v-if="task.transfer" class="activity-card__transfer" aria-live="off">
            {{ transferDescription(task) }}
          </p>
          <p v-if="task.error">{{ task.error }}</p>
          <footer>
            <button
              v-if="task.status === 'running' && task.cancelable"
              type="button"
              @click="taskCenter.cancel(task.operationId)"
            >
              取消
            </button>
            <button
              v-if="task.status === 'failed' && task.retryable"
              type="button"
              @click="taskCenter.retry(task.operationId)"
            >
              重试
            </button>
            <button
              v-if="task.status !== 'running'"
              type="button"
              @click="taskCenter.dismiss(task.operationId)"
            >
              移除
            </button>
          </footer>
        </article>
      </div>

      <div v-if="notices.length" class="activity-center__group">
        <h3>通知</h3>
        <article
          v-for="notice in notices.slice(0, 8)"
          :key="notice.id"
          class="activity-card"
          :class="`is-${notice.type}`"
        >
          <div>
            <strong>{{ notice.message }}</strong
            ><small>{{ notice.type }}</small>
          </div>
          <details v-if="notice.details">
            <summary>查看详情</summary>
            <p>{{ notice.details }}</p>
          </details>
          <footer>
            <button
              v-for="action in notice.actions"
              :key="action.label"
              type="button"
              @click="runNoticeAction(action)"
            >
              {{ action.label }}
            </button>
            <button type="button" @click="noticeCenter.dismiss(notice.id)">关闭</button>
          </footer>
        </article>
      </div>
    </section>

    <section
      v-if="centeredImportTask && (inline || (!open && !suppressFocused))"
      class="activity-center__focused-progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <header>
        <span class="activity-center__signal is-running"></span>
        <strong>{{ centeredImportTask.name }}</strong>
        <span v-if="centeredImportTask.itemProgress">
          {{ centeredImportTask.itemProgress.completed }} /
          {{ centeredImportTask.itemProgress.total }} 项
        </span>
        <span v-else-if="centeredImportTask.progress !== undefined">
          {{ Math.round(centeredImportTask.progress * 100) }}%
        </span>
      </header>
      <progress
        :value="centeredImportTask.progress"
        :aria-label="`${centeredImportTask.name}：${centeredImportTask.phase}`"
        max="1"
      ></progress>
      <p>{{ centeredImportTask.phase }}</p>
      <small v-if="centeredImportTask.transfer">{{
        transferDescription(centeredImportTask)
      }}</small>
      <small>{{ elapsed(centeredImportTask) }}</small>
      <small v-if="waitingForProgress(centeredImportTask)" class="activity-center__focused-waiting">
        当前步骤超过 15 秒没有新进度，仍在处理中
      </small>
    </section>
  </aside>
</template>

<style scoped src="../styles/ProjectActivityCenter.css"></style>
