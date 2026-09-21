<script setup lang="ts">
import { computed, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { categoryService, historyService, resourceService } from '../core/AppContainer'
import {
  isUserPersonaAvatarAttachment,
  RESOURCE_TYPE_LABELS,
  type ResourceSummary,
} from '../types/Resource'
import { createResourceArchiveSource } from '../services/ExportService'
import { findContainerVariantGroups, findDuplicateGroups } from '../utils/DuplicateGroups'
import FeatureAppHeader from './FeatureAppHeader.vue'

const props = defineProps<{ resources: ResourceSummary[] }>()
const emit = defineEmits<{
  back: []
  openResource: [resource: ResourceSummary]
  'library-changed': []
}>()

const isBusy = ref(false)
const message = ref('')
/** 每组用户选定的保留项；默认第一项（最新）。 */
const keepChoices = ref<Record<string, string>>({})

const groups = computed(() => findDuplicateGroups(props.resources))
const variantGroups = computed(() => findContainerVariantGroups(props.resources))
const duplicateFileCount = computed(() =>
  groups.value.reduce((total, group) => total + group.resources.length - 1, 0),
)
const reclaimableBytes = computed(() =>
  groups.value.reduce(
    (total, group) => total + group.resources[0].fileSize * (group.resources.length - 1),
    0,
  ),
)

function keeperOf(contentHash: string, resources: ResourceSummary[]): string {
  return keepChoices.value[contentHash] ?? resources[0].id
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString('zh-CN')
}

async function cleanGroup(contentHash: string): Promise<void> {
  const group = groups.value.find((item) => item.contentHash === contentHash)
  if (!group || isBusy.value) return
  const keepId = keeperOf(contentHash, group.resources)
  const keeper = group.resources.find((item) => item.id === keepId) ?? group.resources[0]
  const removeIds = group.resources.filter((item) => item.id !== keeper.id).map((item) => item.id)
  const confirmed = await confirmAction({
    title: '清理重复副本',
    message: `保留「${keeper.name}」，删除其余 ${removeIds.length} 个内容相同的副本吗？\n副本的标签、文件夹、关联和收藏会先合并到保留项，清理前会自动创建历史快照。`,
    confirmLabel: '清理',
    danger: true,
  })
  if (!confirmed) return
  isBusy.value = true
  message.value = ''
  try {
    await historyService.capture(
      await createResourceArchiveSource(resourceService),
      await categoryService.list(),
      '查重清理前自动快照',
    )
    const removed = await resourceService.mergeDuplicates(keeper.id, removeIds)
    message.value = `已保留「${keeper.name}」，删除 ${removed} 个重复副本；标签与文件夹已合并。`
    emit('library-changed')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '查重清理失败'
  } finally {
    isBusy.value = false
  }
}

/** 同卡不同封装：把其余封装并入保留项的历史版本，不删除任何文件内容。 */
async function mergeVariantGroup(cardContentHash: string): Promise<void> {
  const group = variantGroups.value.find((item) => item.cardContentHash === cardContentHash)
  if (!group || isBusy.value) return
  const keepId = keepChoices.value[`variant:${cardContentHash}`] ?? group.resources[0].id
  const keeper = group.resources.find((item) => item.id === keepId) ?? group.resources[0]
  const others = group.resources.filter((item) => item.id !== keeper.id)
  const confirmed = await confirmAction({
    title: '合并封装为历史版本',
    message: `保留「${keeper.name}」（${keeper.fileName}），把其余 ${others.length} 个封装并入它的历史版本吗？\n原文件全部保留在版本历史里，可随时切换或单独下载。`,
    confirmLabel: '并入历史',
  })
  if (!confirmed) return
  isBusy.value = true
  message.value = ''
  try {
    await historyService.capture(
      await createResourceArchiveSource(resourceService),
      await categoryService.list(),
      '封装合并前自动快照',
    )
    for (const other of others) {
      await resourceService.mergeExistingResourceAsVersion(keeper.id, other.id, '同卡不同封装合并')
    }
    message.value = `已把 ${others.length} 个封装并入「${keeper.name}」的历史版本。`
    emit('library-changed')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '封装合并失败'
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <section class="duplicate-cleaner" aria-label="重复资源清理">
    <FeatureAppHeader title="重复清理" @back="emit('back')" />

    <p v-if="message" class="duplicate-cleaner__message" role="status">{{ message }}</p>

    <p v-if="!groups.length && !variantGroups.length" class="duplicate-cleaner__empty">
      没有发现内容重复的资源。导入时的内容指纹与版本识别已经拦下了大部分重复。
    </p>

    <template v-else>
      <p class="duplicate-cleaner__summary">
        共 {{ groups.length }} 组重复，可清理 {{ duplicateFileCount }} 个多余副本，约释放
        {{ formatBytes(reclaimableBytes) }}。
      </p>

      <article v-for="group in groups" :key="group.contentHash" class="duplicate-cleaner__group">
        <header>
          <strong
            >{{
              isUserPersonaAvatarAttachment(group.resources[0])
                ? '人设头像附件'
                : RESOURCE_TYPE_LABELS[group.resources[0].type]
            }}
            · {{ group.resources.length }} 个相同副本</strong
          >
          <small
            >指纹 {{ group.resources[0].contentHash.slice(0, 12) }} · 单份
            {{ formatBytes(group.resources[0].fileSize) }}</small
          >
        </header>
        <ul>
          <li v-for="resource in group.resources" :key="resource.id">
            <label>
              <input
                type="radio"
                :name="`keep-${group.contentHash}`"
                :value="resource.id"
                :checked="keeperOf(group.contentHash, group.resources) === resource.id"
                :disabled="isBusy"
                @change="keepChoices[group.contentHash] = resource.id"
              />
              <span class="duplicate-cleaner__name">
                <strong>{{ resource.name }}</strong>
                <small>
                  {{ resource.fileName }} · 更新于 {{ formatDate(resource.updatedAt) }}
                  <template v-if="resource.favorite"> · 已收藏</template>
                  <template v-if="resource.tags.length"> · {{ resource.tags.join('、') }}</template>
                </small>
              </span>
            </label>
            <button type="button" :disabled="isBusy" @click="emit('openResource', resource)">
              查看
            </button>
          </li>
        </ul>
        <footer>
          <span>选中的一项将被保留（默认最新）。</span>
          <button
            type="button"
            class="duplicate-cleaner__clean"
            :disabled="isBusy"
            @click="cleanGroup(group.contentHash)"
          >
            清理本组
          </button>
        </footer>
      </article>
    </template>

    <template v-if="variantGroups.length">
      <p class="duplicate-cleaner__summary">
        另有 {{ variantGroups.length }} 组「同卡不同封装」：卡内数据完全一致，只是分别以 PNG 与 JSON
        等不同文件保存。可以并入同一个版本组，原文件全部保留。
      </p>

      <article
        v-for="group in variantGroups"
        :key="`variant:${group.cardContentHash}`"
        class="duplicate-cleaner__group"
      >
        <header>
          <strong>同卡不同封装 · {{ group.resources.length }} 个文件</strong>
          <small>卡内容指纹 {{ group.cardContentHash.slice(0, 12) }}</small>
        </header>
        <ul>
          <li v-for="resource in group.resources" :key="resource.id">
            <label>
              <input
                type="radio"
                :name="`variant-keep-${group.cardContentHash}`"
                :value="resource.id"
                :checked="
                  (keepChoices[`variant:${group.cardContentHash}`] ?? group.resources[0].id) ===
                  resource.id
                "
                :disabled="isBusy"
                @change="keepChoices[`variant:${group.cardContentHash}`] = resource.id"
              />
              <span class="duplicate-cleaner__name">
                <strong>{{ resource.name }}</strong>
                <small>
                  {{ resource.fileName }} · {{ formatBytes(resource.fileSize) }} · 更新于
                  {{ formatDate(resource.updatedAt) }}
                </small>
              </span>
            </label>
            <button type="button" :disabled="isBusy" @click="emit('openResource', resource)">
              查看
            </button>
          </li>
        </ul>
        <footer>
          <span>选中的一项保留为当前版（默认 PNG，保留立绘）。</span>
          <button
            type="button"
            class="duplicate-cleaner__clean"
            :disabled="isBusy"
            @click="mergeVariantGroup(group.cardContentHash)"
          >
            并入历史版本
          </button>
        </footer>
      </article>
    </template>
  </section>
</template>
