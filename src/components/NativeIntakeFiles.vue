<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { taskCenter } from '../core/TaskCenter'
import { confirmAction } from '../composables/UseConfirmDialog'
import {
  listNativeIntakeFiles,
  removeNativeIntakeFile,
  removeNativeIntakeReceipts,
  type NativeIntakeFile,
} from '../utils/ShareTargetIntake'

const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ changed: [remainingBytes: number]; busy: [value: boolean]; close: [] }>()
const entries = ref<NativeIntakeFile[]>([])
const busy = ref(false)
const error = ref('')
const message = ref('')
const page = ref(0)
const pageSize = 20
const receipts = computed(() =>
  entries.value.filter((entry) => entry.receiptOnly && !entry.protectedReason),
)
const bulkPhase = ref('')
const paused = ref(false)
let disposed = false
let stopBulk: (() => void) | undefined
let toggleBulk: (() => void) | undefined
function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  return value < 1024 ** 2
    ? `${(value / 1024).toFixed(1)} KiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`
}
function setBusy(value: boolean): void {
  busy.value = value
  emit('busy', value)
}
async function refresh(): Promise<void> {
  if (busy.value || disposed) return
  setBusy(true)
  error.value = ''
  try {
    entries.value = await listNativeIntakeFiles()
    page.value = Math.min(page.value, Math.max(0, Math.ceil(entries.value.length / pageSize) - 1))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取接收暂存列表'
  } finally {
    setBusy(false)
  }
}
async function remove(entry: NativeIntakeFile): Promise<void> {
  if (busy.value || props.disabled || entry.protectedReason) return
  setBusy(true)
  error.value = ''
  message.value = ''
  let attempted = false
  let removalError = ''
  try {
    if (
      !(await confirmAction({
        title: '清理这份接收暂存？',
        message: `${entry.name}\n${bytes(entry.bytes)} · ${entry.state}\n\n删除这份接收副本及其记录；已入库的资源与历史版本保留。若尚未入库，将放弃这次导入，需要重新分享或下载。`,
        confirmLabel: '清理这份暂存',
        cancelLabel: '取消',
        danger: true,
      }))
    )
      return
    attempted = true
    const removed = await removeNativeIntakeFile(entry)
    message.value = `已清理 ${bytes(removed)}`
  } catch (cause) {
    removalError = cause instanceof Error ? cause.message : '清理失败，请刷新列表'
  } finally {
    setBusy(false)
    // Failed/partial cleanup and cancellation both recheck live ownership without reading payloads.
    await refresh()
    if (attempted && !error.value)
      emit(
        'changed',
        entries.value.reduce((total, entry) => total + entry.bytes, 0),
      )
    if (removalError) error.value = removalError
  }
}
async function clearReceipts(): Promise<void> {
  if (busy.value || props.disabled || !receipts.value.length) return
  setBusy(true)
  error.value = ''
  message.value = ''
  let taskId: string | undefined
  let finished: Promise<void> = Promise.resolve()
  const controller = new AbortController()
  let wake: (() => void) | undefined
  const phase = (value: string) => {
    bulkPhase.value = value
    if (taskId) taskCenter.update(taskId, { phase: value })
  }
  stopBulk = () => {
    controller.abort()
    paused.value = false
    wake?.()
    wake = undefined
    phase('正在停止；当前批次完成后停止')
  }
  toggleBulk = () => {
    if (controller.signal.aborted || !taskId) return
    paused.value = !paused.value
    phase(paused.value ? '正在暂停；当前批次完成后暂停' : '正在清理已处理回执')
    if (!paused.value) {
      wake?.()
      wake = undefined
    }
    taskCenter.setAction(taskId, {
      label: paused.value ? '继续清理' : '暂停清理',
      run: () => toggleBulk?.(),
    })
  }
  try {
    const selected = [...receipts.value]
    if (
      !(await confirmAction({
        title: '清理全部已处理回执？',
        message: `将清理 ${selected.length} 项已处理回执（${bytes(selected.reduce((sum, entry) => sum + entry.bytes, 0))}）。\n只删除没有附件的完成标记；资源原件、历史版本及仍在使用的任务保留。`,
        confirmLabel: '清理全部回执',
        cancelLabel: '取消',
        danger: true,
      })) ||
      disposed
    )
      return
    phase('正在清理已处理回执')
    taskId = taskCenter.start({
      name: '清理已处理回执',
      phase: bulkPhase.value,
      cancelable: true,
      cancel: () => {
        stopBulk?.()
        return finished
      },
      action: { label: '暂停清理', run: () => toggleBulk?.() },
    })
    finished = (async () => {
      try {
        const result = await removeNativeIntakeReceipts(selected, {
          signal: controller.signal,
          beforeBatch: async () => {
            if (paused.value) phase('已暂停，等待手动继续')
            while (paused.value && !controller.signal.aborted)
              await new Promise<void>((resolve) => {
                wake = resolve
              })
          },
          progress: (completed, result) => {
            taskCenter.update(taskId!, { itemProgress: { completed, total: selected.length } })
            message.value = `已清理 ${result.removedTokens.length} 项回执 · ${bytes(result.removedBytes)}${result.skipped.length ? `；${result.skipped.length} 项有变化或正在使用，已保留` : ''}`
          },
        })
        if (controller.signal.aborted) {
          message.value = `已停止。${message.value || '未删除回执'}`
          taskCenter.cancelled(taskId!)
        } else {
          if (result.skipped.length) error.value = result.skipped[0]!.message
          taskCenter.complete(taskId!)
        }
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '回执清理失败，剩余项已保留'
        taskCenter.fail(taskId!, error.value)
      }
    })()
    await finished
  } finally {
    if (taskId) taskCenter.setAction(taskId)
    const cleanupError = error.value
    stopBulk = undefined
    toggleBulk = undefined
    paused.value = false
    bulkPhase.value = ''
    setBusy(false)
    await refresh()
    if (!disposed && taskId && !error.value)
      emit(
        'changed',
        entries.value.reduce((sum, entry) => sum + entry.bytes, 0),
      )
    if (cleanupError) error.value = cleanupError
  }
}
onBeforeUnmount(() => {
  disposed = true
  stopBulk?.()
})
onMounted(refresh)
</script>

<template>
  <section class="intake-files" aria-label="接收暂存文件列表">
    <header>
      <strong>接收暂存文件</strong>
      <div>
        <button class="button button--quiet" type="button" :disabled="busy" @click="refresh">
          刷新
        </button>
        <button class="button button--quiet" type="button" :disabled="busy" @click="emit('close')">
          收起
        </button>
      </div>
    </header>
    <p>分享、下载与失败的接收副本会暂存于此。查看不会删除文件；清理只处理你确认的这一项。</p>
    <div class="receipt-actions">
      <button
        class="button button--quiet"
        type="button"
        :disabled="busy || disabled || !receipts.length"
        @click="clearReceipts"
      >
        一键清理已处理回执
      </button>
      <small>完成回执用于防止重复领取；保留7天，超过期限后在读取待接收队列时清理。</small>
    </div>
    <div v-if="bulkPhase" class="receipt-actions" role="status">
      <span>{{ bulkPhase }}</span>
      <button class="button button--quiet" type="button" @click="toggleBulk?.()">
        {{ paused ? '继续清理' : '暂停清理' }}
      </button>
      <button class="button button--quiet" type="button" @click="stopBulk?.()">停止清理</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <small
      >{{ entries.length }} 项 · {{ bytes(entries.reduce((total, entry) => total + entry.bytes, 0))
      }}{{ busy ? ' · 正在核对…' : '' }}</small
    >
    <ul>
      <li v-for="entry in entries.slice(page * pageSize, (page + 1) * pageSize)" :key="entry.token">
        <div>
          <strong>{{ entry.name }}</strong
          ><small
            >{{ bytes(entry.bytes) }} · {{ entry.fileCount }} 个文件 ·
            {{ new Date(entry.modifiedAt).toLocaleString() }}</small
          >
          <small>{{ entry.state }}</small
          ><small v-if="entry.protectedReason">{{ entry.protectedReason }}</small>
        </div>
        <button
          class="button button--quiet"
          type="button"
          :disabled="busy || disabled || !!entry.protectedReason"
          :aria-label="`清理 ${entry.name}`"
          @click="remove(entry)"
        >
          清理
        </button>
      </li>
    </ul>
    <p v-if="!busy && !error && !entries.length">没有接收暂存文件。</p>
    <nav v-if="entries.length > pageSize" aria-label="暂存列表翻页">
      <button
        class="button button--quiet"
        type="button"
        :disabled="busy || page === 0"
        @click="page--"
      >
        上一页
      </button>
      <span>{{ page + 1 }} / {{ Math.ceil(entries.length / pageSize) }}</span>
      <button
        class="button button--quiet"
        type="button"
        :disabled="busy || (page + 1) * pageSize >= entries.length"
        @click="page++"
      >
        下一页
      </button>
    </nav>
  </section>
</template>

<style scoped>
.intake-files {
  display: grid;
  gap: var(--space-2, 8px);
  padding-block: var(--space-3, 12px);
  border-block: 1px solid var(--color-line);
}
header,
header > div,
nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2, 8px);
}
.receipt-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 8px);
}
p,
ul {
  margin: 0;
}
ul {
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2, 8px);
  padding-block: var(--space-2, 8px);
  border-bottom: 1px solid var(--color-line);
}
li > div {
  display: grid;
  gap: 4px;
  overflow-wrap: anywhere;
  min-width: 0;
}
small,
p {
  color: var(--color-ink-soft);
  font-size: var(--font-size-sm, 12px);
}
nav {
  justify-content: flex-end;
}
</style>
