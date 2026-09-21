<script setup lang="ts">
import { computed, ref } from 'vue'

import { BUILD_INFO } from '../core/BuildInfo'
import { healthCenter, type HealthIssue } from '../core/HealthCenter'
import { noticeCenter } from '../core/NoticeCenter'
import { confirmAction } from '../composables/UseConfirmDialog'
import { getPlatformInfo } from '../core/PlatformService'
import { isSafeModeActive } from '../core/SafeStartup'
import { taskCenter } from '../core/TaskCenter'
import { nativeResourceRecoveryService } from '../core/AppContainer'
import { RESOURCE_TYPE_LABELS } from '../types/Resource'
import type {
  NativeRecoveryPreview,
  NativeRecoveryReport,
} from '../services/NativeResourceRecoveryService'
import {
  getNativeResourceStorageInfo,
  type NativeRecoveryCandidate,
} from '../storage/NativeResourceFileMirror'

const emit = defineEmits<{ 'library-changed': [] }>()
const issues = ref<HealthIssue[]>([])
const scanning = ref(false)
const repairing = ref(false)
const scanned = ref(false)
const nativeStorage = ref<Awaited<ReturnType<typeof getNativeResourceStorageInfo>>>(null)
const recoveryCandidates = ref<Array<NativeRecoveryCandidate & Partial<NativeRecoveryPreview>>>([])
const accounting =
  ref<Awaited<ReturnType<typeof nativeResourceRecoveryService.storageAccounting>>>()
const mirrorDuplication =
  ref<Awaited<ReturnType<typeof nativeResourceRecoveryService.nativeMirrorDuplicationSummary>>>()
const recoveryScanBusy = ref(false)
const accountingStale = ref(false)
const recoveryScanned = ref(0)
const recoveryNextCursor = ref<string>()
const selectedRecoveryHashes = ref<string[]>([])
const recovering = ref(false)
const reclaimingMirrors = ref(false)
const recoveryCandidateByHash = computed(
  () => new Map(recoveryCandidates.value.map((item) => [item.contentHash, item])),
)

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

async function scanNativeRecovery(reset = true, includeAccounting = false): Promise<void> {
  if (recoveryScanBusy.value) return
  recoveryScanBusy.value = true
  try {
    const cursor = reset ? undefined : recoveryNextCursor.value
    if (!reset && !cursor) return
    const info = await getNativeResourceStorageInfo()
    const page = await nativeResourceRecoveryService.listCandidates(cursor, 100)
    if (!page || !info) {
      nativeStorage.value = null
      return
    }
    nativeStorage.value = info
    const previews: typeof recoveryCandidates.value = []
    for (const candidate of page.candidates) {
      const preview = info.recoveryMetadataVersion
        ? await nativeResourceRecoveryService
            .preview(candidate)
            .catch(() => ({ name: '暂无法识别（保留原件）' }))
        : { name: '需要更新 APK 后识别原件' }
      previews.push({ ...candidate, ...preview })
    }
    recoveryCandidates.value = reset ? previews : [...recoveryCandidates.value, ...previews]
    if (reset) selectedRecoveryHashes.value = []
    recoveryScanned.value = page.scanned
    recoveryNextCursor.value = page.nextCursor
    if (includeAccounting) {
      ;[accounting.value, mirrorDuplication.value] = await Promise.all([
        nativeResourceRecoveryService.storageAccounting(),
        nativeResourceRecoveryService.nativeMirrorDuplicationSummary(),
      ])
      accountingStale.value = false
    }
  } catch (error) {
    noticeCenter.push({
      type: 'error',
      message: error instanceof Error ? error.message : '原件检查失败，未修改或清理文件',
    })
  } finally {
    recoveryScanBusy.value = false
  }
}

async function reclaimNativeMirrors(): Promise<void> {
  const preview = mirrorDuplication.value
  if (!preview?.reclaimableBytes || reclaimingMirrors.value) return
  const confirmed = await confirmAction({
    title: '释放已验证的重复原件',
    message: `将逐项校验 Android 原件索引、大小和 SHA-256。仅在全部一致时，才删除 IndexedDB 中的镜像副本；资源不会消失。\n\n预计释放 ${formatBytes(preview.reclaimableBytes)}（当前 ${preview.currentCount} 项，历史 ${preview.versionCount} 项）。系统实际占用的回落可能由 WebView 延后完成。`,
    confirmLabel: '校验并释放',
    cancelLabel: '取消',
    danger: true,
  })
  if (!confirmed) return
  reclaimingMirrors.value = true
  try {
    const report = await nativeResourceRecoveryService.reclaimVerifiedNativeMirrors()
    accountingStale.value = true
    noticeCenter.push({
      type: 'success',
      message: `已转为原生唯一副本：当前 ${report.convertedCurrent} 项，历史 ${report.convertedVersions} 项；释放 IndexedDB 镜像约 ${formatBytes(report.reclaimableBytes)}。`,
    })
    emit('library-changed')
    await scanNativeRecovery(true, true)
  } catch (error) {
    noticeCenter.push({
      type: 'error',
      message: error instanceof Error ? error.message : '镜像核验未通过，已保留所有网页副本',
    })
  } finally {
    reclaimingMirrors.value = false
  }
}

function reportRecovery(report: NativeRecoveryReport): void {
  accountingStale.value = true
  if (accounting.value) {
    accounting.value.recoveredPlaceholderCount = Math.max(
      0,
      accounting.value.recoveredPlaceholderCount - report.updated,
    )
    accounting.value.pendingNativeLinkCount = report.pendingLinks
  }
  noticeCenter.push({
    type: report.failed || report.pendingLinks ? 'warning' : 'success',
    message: `新增 ${report.created} 项，原位补全 ${report.updated} 项，已有 ${report.existing} 项；未识别保留 ${report.unsupported} 项，失败 ${report.failed} 项，待补写原生索引 ${report.pendingLinks} 项`,
  })
  if (report.created || report.updated) emit('library-changed')
}

async function repairRecovered(): Promise<void> {
  if (recovering.value) return
  recovering.value = true
  try {
    reportRecovery(await nativeResourceRecoveryService.repairExisting())
    await scanNativeRecovery(true)
  } catch (error) {
    noticeCenter.push({
      type: 'error',
      message: error instanceof Error ? error.message : '补全失败，原件仍保留',
    })
  } finally {
    recovering.value = false
  }
}

function toggleRecovery(hash: string): void {
  selectedRecoveryHashes.value = selectedRecoveryHashes.value.includes(hash)
    ? selectedRecoveryHashes.value.filter((item) => item !== hash)
    : [...selectedRecoveryHashes.value, hash]
}

async function recoverSelected(): Promise<void> {
  if (recovering.value || !selectedRecoveryHashes.value.length) return
  recovering.value = true
  try {
    const report = await nativeResourceRecoveryService.recover(
      selectedRecoveryHashes.value.flatMap((hash) => {
        const item = recoveryCandidateByHash.value.get(hash)
        return item
          ? [
              {
                contentHash: item.contentHash,
                size: item.size,
                nativeId: item.nativeId,
                nativeScope: item.nativeScope,
                fileName: item.fileName,
              },
            ]
          : []
      }),
    )
    reportRecovery(report)
    // Refresh only the native candidate page, not the full JSON/network/index/accounting audit.
    await scanNativeRecovery(true)
  } catch (error) {
    noticeCenter.push({
      type: 'error',
      message: error instanceof Error ? error.message : '找回失败，原件仍保留',
    })
  } finally {
    recovering.value = false
  }
}

async function scan(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  try {
    issues.value = await healthCenter.scan()
    await scanNativeRecovery(true, true).catch(() => undefined)
    scanned.value = true
  } finally {
    scanning.value = false
  }
}

async function repairSafe(): Promise<void> {
  if (repairing.value) return
  repairing.value = true
  try {
    await healthCenter.repairSafe(issues.value)
    await scan()
  } finally {
    repairing.value = false
  }
}

async function exportDiagnostics(): Promise<void> {
  const platform = await getPlatformInfo().catch(() => undefined)
  const storage = await navigator.storage?.estimate?.().catch(() => undefined)
  const native = await getNativeResourceStorageInfo().catch(() => null)
  const payload = {
    generatedAt: new Date().toISOString(),
    location: window.location.origin,
    build: BUILD_INFO,
    databaseSchemaVersion: BUILD_INFO.databaseVersion,
    nativeApiVersion: BUILD_INFO.nativeApiVersion,
    platform,
    storage: storage
      ? { usageBytes: storage.usage ?? null, quotaBytes: storage.quota ?? null }
      : undefined,
    nativeStorage: native,
    logicalPayloadAccounting: await nativeResourceRecoveryService.storageAccounting(),
    accountingNote:
      '数据库为逻辑载荷字节，不等于磁盘占用；原生分项为 totalBytes 的子集，不可相加。',
    nativeRecovery: {
      scannedCount: recoveryScanned.value,
      candidateCount: recoveryCandidates.value.length,
    },
    safeMode: isSafeModeActive(),
    tasks: taskCenter.list().map(({ name, phase, status, startedAt, updatedAt, error }) => ({
      name,
      phase,
      status,
      startedAt,
      updatedAt,
      hasError: Boolean(error),
    })),
    noticesByType: noticeCenter.list().reduce<Record<string, number>>((counts, notice) => {
      counts[notice.type] = (counts[notice.type] ?? 0) + 1
      return counts
    }, {}),
    issues: issues.value.map(({ id, kind, label, details, severity, safeRepair }) => ({
      id,
      kind,
      label,
      details,
      severity,
      safeRepairAvailable: Boolean(safeRepair),
    })),
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `srl-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="resource-health">
    <div class="resource-health__summary">
      <span>
        <strong>资源库健康与修复</strong>
        <small v-if="scanning">正在扫描引用、摘要与本地状态…</small>
        <small v-else-if="scanned && !issues.length">资源库状态正常</small>
        <small v-else-if="issues.length">发现 {{ issues.length }} 项需要查看的问题</small>
        <small v-else>只报告问题，不会静默删除用户文件</small>
      </span>
      <button
        class="button button--quiet"
        type="button"
        :disabled="scanning || recovering || recoveryScanBusy"
        @click="scanNativeRecovery(true, true)"
      >
        检查原件与空间
      </button>
      <button
        class="button button--quiet"
        type="button"
        :disabled="scanning || recovering || recoveryScanBusy"
        @click="scan"
      >
        扫描
      </button>
    </div>

    <section v-if="nativeStorage" class="resource-health__native">
      <div class="resource-health__native-head">
        <span>
          <strong>Android 本地存储诊断</strong>
          <small>
            应用数据 {{ formatBytes(nativeStorage.totalBytes) }} · 原件对象
            {{ formatBytes(nativeStorage.objectBytes) }} · {{ nativeStorage.objectCount }} 个对象
          </small>
        </span>
        <span v-if="recoveryScanned" class="resource-health__candidate-count">
          已扫描 {{ recoveryScanned }} 项
        </span>
      </div>
      <p v-if="recoveryCandidates.length" class="resource-health__recovery-note">
        候选可能是数据库崩溃后仍保留的 Android
        索引，也可能包含旧备份分块。只识别完整资源；未识别内容原地保留，不当作垃圾。
      </p>
      <div v-if="recoveryCandidates.length" class="resource-health__candidates">
        <label v-for="item in recoveryCandidates" :key="item.contentHash">
          <input
            type="checkbox"
            :checked="selectedRecoveryHashes.includes(item.contentHash)"
            @change="toggleRecovery(item.contentHash)"
          />
          <span>
            <strong>{{ item.name || item.contentHash.slice(0, 12) }}</strong>
            <small v-if="item.type">{{ RESOURCE_TYPE_LABELS[item.type] }}</small>
            <small>{{ formatBytes(item.size) }}</small>
          </span>
        </label>
      </div>
      <div v-if="recoveryCandidates.length || recoveryNextCursor" class="resource-health__actions">
        <button
          v-if="recoveryNextCursor"
          class="button button--quiet"
          type="button"
          :disabled="recovering || recoveryScanBusy"
          @click="scanNativeRecovery(false)"
        >
          继续扫描
        </button>
        <button
          class="button button--primary"
          type="button"
          :disabled="
            recovering ||
            recoveryScanBusy ||
            !nativeStorage.recoveryMetadataVersion ||
            !selectedRecoveryHashes.length
          "
          @click="recoverSelected"
        >
          {{ recovering ? '正在找回' : `找回所选（${selectedRecoveryHashes.length}）` }}
        </button>
      </div>
      <small v-else-if="recoveryScanned"
        >没有发现脱离当前与历史索引的 Android 对象；这不代表数据库已完整恢复。</small
      >
      <p v-if="!nativeStorage.recoveryMetadataVersion" class="resource-health__recovery-note">
        原件识别需要安装包含本次修复的新 APK，仅更新网页无效。
      </p>
      <div class="resource-health__actions">
        <button
          v-if="mirrorDuplication?.reclaimableBytes"
          class="button button--quiet"
          type="button"
          :disabled="recovering || recoveryScanBusy || reclaimingMirrors"
          @click="reclaimNativeMirrors"
        >
          {{
            reclaimingMirrors
              ? '正在校验并释放'
              : `释放重复镜像（约 ${formatBytes(mirrorDuplication.reclaimableBytes)}）`
          }}
        </button>
        <button
          v-if="
            accounting &&
            (accounting.recoveredPlaceholderCount || accounting.pendingNativeLinkCount)
          "
          class="button button--quiet"
          type="button"
          :disabled="recovering || recoveryScanBusy || !nativeStorage.recoveryMetadataVersion"
          @click="repairRecovered"
        >
          补全以前找回的文件 / 重试索引
        </button>
        <button class="button button--quiet" type="button" @click="exportDiagnostics">
          导出只读占用报告
        </button>
      </div>
      <details v-if="accounting" class="resource-health__accounting">
        <summary>查看占用分项（不删除文件）</summary>
        <p v-if="accountingStale">资源已经变化；此处是上次盘点值，可用“检查原件与空间”刷新。</p>
        <p>以下原生分项是应用总量的子集，不能与总量相加。</p>
        <p v-if="nativeStorage.webViewBytes !== undefined">
          网页容器 {{ formatBytes(nativeStorage.webViewBytes) }}；应用缓存
          {{ formatBytes(nativeStorage.cacheBytes ?? 0) }}
          <template v-if="nativeStorage.appCacheBytes !== undefined">
            （缓存目录 {{ formatBytes(nativeStorage.appCacheBytes) }}，代码缓存
            {{ formatBytes(nativeStorage.codeCacheBytes ?? 0) }}）
          </template>
          ；原生库
          {{ formatBytes(nativeStorage.libraryBytes ?? 0) }}（其中原件
          {{ formatBytes(nativeStorage.objectBytes) }}，恢复暂存
          {{ formatBytes(nativeStorage.restoreTemporaryBytes ?? 0) }}）。
        </p>
        <p>
          数据库逻辑载荷：当前原件 {{ formatBytes(accounting.currentOriginalBytes) }}；历史原件
          {{ formatBytes(accounting.versionOriginalBytes) }}；本地安全快照
          {{ formatBytes(accounting.localSnapshotBytes) }}；恢复暂存
          {{ formatBytes(accounting.restoreStagingBytes) }}。
        </p>
        <p v-if="mirrorDuplication?.reclaimableBytes">
          已发现可校验的网页镜像：当前 {{ mirrorDuplication.currentCount }} 项、历史
          {{ mirrorDuplication.versionCount }} 项，预计可释放
          {{ formatBytes(mirrorDuplication.reclaimableBytes) }}。释放前会重新核验原生 SHA-256。
        </p>
        <p>
          素材库 {{ formatBytes(accounting.assetBytes) }} /
          {{ accounting.assetCount }} 项；其中缩略图
          {{ formatBytes(accounting.thumbnailAssetBytes) }} /
          {{ accounting.thumbnailAssetCount }} 项。
        </p>
        <p v-if="accounting.recoveredPlaceholderCount">
          旧版“找回文件”占位记录 {{ accounting.recoveredPlaceholderCount }} 项，对应原件引用约
          {{ formatBytes(accounting.recoveredPlaceholderBytes) }}。这是引用量，不与磁盘总量相加。
        </p>
        <p>
          逻辑载荷不等于磁盘文件大小，也不应与原生总量相加。历史快照是恢复点，不会作为重复原件自动清理。
        </p>
      </details>
    </section>

    <div v-if="issues.length" class="resource-health__issues">
      <article v-for="issue in issues" :key="issue.id" :class="`is-${issue.severity}`">
        <strong>{{ issue.label }}</strong>
        <p>{{ issue.details }}</p>
        <small>{{ issue.safeRepair ? '可安全修复' : '需要查看后手动处理' }}</small>
      </article>
      <div class="resource-health__actions">
        <button
          class="button button--primary"
          type="button"
          :disabled="repairing || !issues.some((issue) => issue.safeRepair)"
          @click="repairSafe"
        >
          {{ repairing ? '正在修复' : '自动修复安全项' }}
        </button>
        <button class="button button--quiet" type="button" @click="exportDiagnostics">
          导出诊断
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-health {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--color-line);
  border-radius: 0.8rem;
  background: var(--color-surface);
}

.resource-health__summary,
.resource-health__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.resource-health__summary span,
.resource-health__summary small {
  display: block;
}

.resource-health__summary small,
.resource-health__issues small {
  margin-top: 0.2rem;
  color: var(--color-ink-soft);
}

.resource-health__native {
  display: grid;
  gap: 0.55rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--color-line);
}

.resource-health__native-head {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: start;
}

.resource-health__native-head > span {
  min-width: 0;
}

.resource-health__native-head small,
.resource-health__candidate-count,
.resource-health__recovery-note {
  color: var(--color-ink-soft);
  font-size: 0.76rem;
}

.resource-health__native-head span > small {
  display: block;
  margin-top: 0.2rem;
}

.resource-health__recovery-note {
  margin: 0;
}

.resource-health__candidates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.35rem;
  max-height: 14rem;
  overflow: auto;
}

.resource-health__candidates label {
  display: flex;
  gap: 0.45rem;
  align-items: center;
  min-width: 0;
  padding: 0.45rem;
  border: 1px solid var(--color-line);
  border-radius: 0.55rem;
}

.resource-health__candidates span,
.resource-health__candidates small {
  display: block;
  min-width: 0;
}

.resource-health__summary,
.resource-health__actions {
  min-width: 0;
  flex-wrap: wrap;
}

.resource-health__summary > span {
  min-width: 0;
  flex: 1 1 12rem;
}

.resource-health__summary .button,
.resource-health__actions .button {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
}

@media (max-width: 22rem) {
  .resource-health__summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .resource-health__summary > span {
    grid-column: 1 / -1;
  }

  .resource-health__summary .button {
    width: 100%;
  }
}

.resource-health__candidates strong,
.resource-health__accounting {
  overflow-wrap: anywhere;
}

.resource-health__accounting {
  min-width: 0;
  color: var(--color-ink-soft);
  font-size: 0.8rem;
}

.resource-health__issues {
  display: grid;
  gap: 0.45rem;
}

.resource-health__issues article {
  padding: 0.6rem;
  border-left: 0.2rem solid #c78a34;
  background: rgb(255 255 255 / 42%);
}

.resource-health__issues article.is-error {
  border-left-color: #a63731;
}

.resource-health__issues p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
}

.resource-health__actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
