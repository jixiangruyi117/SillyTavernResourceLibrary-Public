<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { ImportVersionCandidate } from '../types/Import'
import { RESOURCE_TYPE_LABELS } from '../types/Resource'

const props = defineProps<{ candidate: ImportVersionCandidate; remaining: number; busy: boolean }>()
const emit = defineEmits<{
  resolve: [
    decision: {
      action: 'activate' | 'archive' | 'replace' | 'independent' | 'skip'
      targetId?: string
      note?: string
    },
  ]
}>()

const selectedId = ref('')
const versionNote = ref('')
const selectedCandidate = computed(() =>
  props.candidate.candidates.find((item) => item.resource.id === selectedId.value),
)
const isContainerVariant = computed(() => selectedCandidate.value?.matchKind === 'containerVariant')
const isExistingContent = computed(() => selectedCandidate.value?.matchKind === 'contentDuplicate')

watch(
  () => props.candidate,
  (candidate) => {
    selectedId.value = candidate.candidates[0]?.resource.id ?? ''
    versionNote.value =
      candidate.candidates[0]?.matchKind === 'containerVariant' ? '同内容，不同立绘或文件封装' : ''
  },
  { immediate: true },
)

function decide(action: 'activate' | 'archive' | 'replace' | 'independent' | 'skip'): void {
  if ((action === 'activate' || action === 'archive' || action === 'replace') && !selectedId.value)
    return
  emit('resolve', {
    action,
    targetId:
      action === 'activate' || action === 'archive' || action === 'replace'
        ? selectedId.value
        : undefined,
    note:
      action === 'activate' || action === 'archive' || action === 'replace'
        ? versionNote.value.trim()
        : undefined,
  })
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
            <small>VERSION CHECK · {{ remaining }} 待确认</small>
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
          <button type="button" :disabled="busy" aria-label="跳过这个文件" @click="decide('skip')">
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
            相同卡数据已存在于多个资源组，系统不会自动重复保存，请人工确认。
          </small>
          <small v-else>文件尚未写入资源库，请确认它应该归到哪里。</small>
        </div>

        <fieldset>
          <legend>选择最接近的已有资源</legend>
          <label
            v-for="item in candidate.candidates"
            :key="item.resource.id"
            :class="{ 'is-selected': selectedId === item.resource.id }"
          >
            <input v-model="selectedId" type="radio" :value="item.resource.id" />
            <span class="version-import-dialog__score">{{ item.score }}%</span>
            <span>
              <strong>{{ item.resource.name }}</strong>
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
          <button type="button" :disabled="busy" @click="decide('independent')">
            作为独立资源
          </button>
          <button
            v-if="!isExistingContent"
            type="button"
            :disabled="busy"
            @click="decide('archive')"
          >
            {{ isContainerVariant ? '绑定封装，不切换' : '加入历史，不切换' }}
          </button>
          <button
            v-if="!isExistingContent"
            type="button"
            class="version-import-dialog__replace"
            :disabled="busy"
            @click="decide('replace')"
          >
            {{ isContainerVariant ? '覆盖当前封装' : '覆盖当前版本' }}
          </button>
          <button
            v-if="!isExistingContent"
            class="button--primary"
            type="button"
            :disabled="busy"
            @click="decide('activate')"
          >
            {{ busy ? '正在保存…' : isContainerVariant ? '绑定并设为当前封装' : '设为当前版本' }}
          </button>
          <button
            v-else
            class="button--primary"
            type="button"
            :disabled="busy"
            @click="decide('skip')"
          >
            跳过，不重复保存
          </button>
        </div>
        <p v-if="isContainerVariant">
          保存后会绑定到同一个逻辑版本，不会额外占用版本数量；设为当前时，原文件仍作为另一份封装完整保留。
        </p>
        <p v-else-if="!isExistingContent">
          “设为当前版本”会把旧版收入历史，不会删除；文件夹、标签、收藏和关联关系继续保留。
        </p>
      </section>
    </div>
  </Teleport>
</template>
