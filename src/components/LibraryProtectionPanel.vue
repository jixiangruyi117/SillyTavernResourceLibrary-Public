<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useApp } from '../composables/UseApp'

type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useApp>>,
  | 'isDataProtectionOpen'
  | 'openVaultPanel'
  | 'recycleBinEntries'
  | 'formatBytes'
  | 'recycleBinSize'
  | 'openRecycleBin'
  | 'isNativeApk'
  | 'storageHealth'
  | 'isRequestingPersistence'
  | 'requestPersistentStorage'
  | 'displayedStorageUsage'
  | 'displayedStorageAvailable'
  | 'storageUsagePercent'
  | 'isClearingNativeCache'
  | 'clearNativeTemporaryStorage'
  | 'formatBackupDate'
  | 'lastFullBackupAt'
  | 'backupOverdue'
  | 'backupRecommended'
  | 'isExportPanelOpen'
  | 'duplicateGroupCounts'
  | 'isDuplicateCleanerOpen'
  | 'extractedCleanupCount'
  | 'isExtractedCleanerOpen'
  | 'isParsedTagCleanerOpen'
>
const input = defineProps<{ model: PanelModel }>()
const isDataProtectionOpen = toRef(input.model, 'isDataProtectionOpen')
const openVaultPanel = toRef(input.model, 'openVaultPanel')
const recycleBinEntries = toRef(input.model, 'recycleBinEntries')
const formatBytes = toRef(input.model, 'formatBytes')
const recycleBinSize = toRef(input.model, 'recycleBinSize')
const openRecycleBin = toRef(input.model, 'openRecycleBin')
const isNativeApk = toRef(input.model, 'isNativeApk')
const storageHealth = toRef(input.model, 'storageHealth')
const isRequestingPersistence = toRef(input.model, 'isRequestingPersistence')
const requestPersistentStorage = toRef(input.model, 'requestPersistentStorage')
const displayedStorageUsage = toRef(input.model, 'displayedStorageUsage')
const displayedStorageAvailable = toRef(input.model, 'displayedStorageAvailable')
const storageUsagePercent = toRef(input.model, 'storageUsagePercent')
const isClearingNativeCache = toRef(input.model, 'isClearingNativeCache')
const clearNativeTemporaryStorage = toRef(input.model, 'clearNativeTemporaryStorage')
const formatBackupDate = toRef(input.model, 'formatBackupDate')
const lastFullBackupAt = toRef(input.model, 'lastFullBackupAt')
const backupOverdue = toRef(input.model, 'backupOverdue')
const backupRecommended = toRef(input.model, 'backupRecommended')
const isExportPanelOpen = toRef(input.model, 'isExportPanelOpen')
const duplicateGroupCounts = toRef(input.model, 'duplicateGroupCounts')
const isDuplicateCleanerOpen = toRef(input.model, 'isDuplicateCleanerOpen')
const extractedCleanupCount = toRef(input.model, 'extractedCleanupCount')
const isExtractedCleanerOpen = toRef(input.model, 'isExtractedCleanerOpen')
const isParsedTagCleanerOpen = toRef(input.model, 'isParsedTagCleanerOpen')
</script>
<template>
  <section
    v-if="isDataProtectionOpen"
    id="data-protection-panel"
    class="protection-panel"
    aria-label="本地数据保护"
  >
    <header class="protection-panel__header">
      <div>
        <p>DEVICE VAULT / LOCAL</p>
        <h2>数据保护</h2>
      </div>
      <div class="protection-panel__header-actions">
        <button class="protection-panel__manage" type="button" @click="openVaultPanel">
          加密与历史版本
        </button>
        <button type="button" aria-label="关闭数据保护面板" @click="isDataProtectionOpen = false">
          ×
        </button>
      </div>
    </header>

    <div class="protection-panel__grid">
      <article class="protection-card protection-card--recycle">
        <span class="protection-card__label">回收站</span>
        <div class="protection-card__space">
          <strong>{{ recycleBinEntries.length }}</strong>
          <span>{{ formatBytes(recycleBinSize) }}</span>
        </div>
        <p>删除资源会先进入本地回收站；恢复只读取本次删除的资源和历史版本，不再创建整库快照。</p>
        <button class="protection-card__action" type="button" @click="openRecycleBin">
          {{ recycleBinEntries.length ? '打开回收站' : '查看回收站' }}
        </button>
      </article>
      <article class="protection-card protection-card--status">
        <span class="protection-card__label">存储状态</span>
        <div class="protection-card__headline">
          <span
            class="protection-card__signal"
            :class="{
              'protection-card__signal--active': isNativeApk || storageHealth.persisted,
            }"
          ></span>
          <strong>{{
            isNativeApk
              ? 'Android 本机存储'
              : storageHealth.persisted
                ? '已持久保护'
                : '普通浏览器存储'
          }}</strong>
        </div>
        <p>
          {{
            isNativeApk
              ? '资源与设置保存在此 APK 的私有目录，不会按网页配额显示为 0。'
              : storageHealth.persisted
                ? '浏览器会尽量避免在空间不足时自动清理本库。'
                : '可请求持久化保护，最终是否授权由浏览器决定。'
          }}
        </p>
        <button
          v-if="!isNativeApk && storageHealth.supported && !storageHealth.persisted"
          class="protection-card__action"
          type="button"
          :disabled="isRequestingPersistence"
          @click="requestPersistentStorage"
        >
          {{ isRequestingPersistence ? '正在请求…' : '开启持久保护' }}
        </button>
      </article>

      <article class="protection-card protection-card--storage">
        <span class="protection-card__label">{{ isNativeApk ? 'APK 应用数据' : '本机存储' }}</span>
        <div class="protection-card__space">
          <strong>{{ formatBytes(displayedStorageUsage) }}</strong>
          <span> 剩余 {{ formatBytes(displayedStorageAvailable) }} </span>
        </div>
        <div class="protection-card__meter" aria-hidden="true">
          <span :style="{ width: `${storageUsagePercent}%` }"></span>
        </div>
        <p v-if="isNativeApk">统计本 APK 的资源、设置与临时缓存；不含 APK 安装包。</p>
        <p v-else>资源保存在当前浏览器的 IndexedDB 中，不会自动上传。</p>
        <button
          v-if="isNativeApk"
          class="protection-card__action"
          type="button"
          :disabled="isClearingNativeCache"
          @click="clearNativeTemporaryStorage"
        >
          {{ isClearingNativeCache ? '正在清理…' : '清理临时缓存' }}
        </button>
      </article>

      <article class="protection-card protection-card--backup">
        <span class="protection-card__label">最近完整备份</span>
        <strong>{{ formatBackupDate(lastFullBackupAt) }}</strong>
        <p v-if="backupOverdue || backupRecommended">建议现在导出，避免浏览器数据意外丢失。</p>
        <p v-else>完整备份会保留资源、标签和文件夹结构。</p>
        <button class="protection-card__backup" type="button" @click="isExportPanelOpen = true">
          创建完整备份
        </button>
      </article>

      <article class="protection-card protection-card--dedupe">
        <span class="protection-card__label">重复清理</span>
        <strong>{{
          duplicateGroupCounts.content
            ? `发现 ${duplicateGroupCounts.content} 组内容重复`
            : duplicateGroupCounts.variants
              ? `发现 ${duplicateGroupCounts.variants} 组同卡封装`
              : '没有发现重复'
        }}</strong>
        <p>内容重复与同卡不同封装（PNG / JSON）分开统计；封装合并会保留所有原文件。</p>
        <button
          class="protection-card__action"
          type="button"
          @click="isDuplicateCleanerOpen = true"
        >
          打开重复清理
        </button>
      </article>

      <article class="protection-card protection-card--extracted">
        <span class="protection-card__label">拆分副本清理</span>
        <strong>{{
          extractedCleanupCount
            ? `发现 ${extractedCleanupCount} 个可清理副本`
            : '没有可清理的拆分副本'
        }}</strong>
        <p>「拆分配套」提取的世界书与正则副本可以批量删除；角色卡内嵌内容不受影响。</p>
        <button
          class="protection-card__action"
          type="button"
          @click="isExtractedCleanerOpen = true"
        >
          打开拆分副本清理
        </button>
      </article>

      <article class="protection-card protection-card--extracted">
        <span class="protection-card__label">自动解析标签</span>
        <strong>逐项查看后清理</strong>
        <p>重新读取角色卡原件，只清理你勾选的解析标签；同一卡的其它标签与原件保留。</p>
        <button
          class="protection-card__action"
          type="button"
          @click="isParsedTagCleanerOpen = true"
        >
          查看解析标签
        </button>
      </article>
    </div>
    <div class="protection-panel__index-note">
      <span aria-hidden="true"></span>
      <div>
        <strong>轻量索引已启用</strong>
        <p>浏览与筛选不读取高清原文件；详情、下载和备份时才按需载入。</p>
      </div>
    </div>
  </section>
</template>
