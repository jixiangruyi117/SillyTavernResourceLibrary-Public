<script setup lang="ts">
import { RESOURCE_TYPE, type Resource } from '../types/Resource'
import type { ResourceVersionView } from '../types/ResourceOperations'

defineProps<{
  version: ResourceVersionView
  currentResourceId: string
  busy: boolean
  editingCarrierNoteId?: string
  versionNotes: Record<string, string>
}>()

const emit = defineEmits<{
  download: [resource: Resource]
  activateVersion: [versionId: string]
  detachVersion: [versionId: string]
  deleteVersion: [versionId: string]
  updateVersionNote: [versionId: string, note: string]
  updateNote: [versionId: string, note: string]
  compareCarrierImage: [images: { current: Resource; other: Resource }]
  editCarrierNote: [carrier: { id: string; versionNote?: string }]
  cancelCarrierNote: [carrier: { id: string; versionNote?: string }]
}>()

function handleNoteInput(versionId: string, event: Event): void {
  emit('updateNote', versionId, (event.target as HTMLTextAreaElement).value)
}

function isPngCarrier(carrier: Resource): boolean {
  return carrier.type === RESOURCE_TYPE.CHARACTER_CARD && /\.png$/iu.test(carrier.fileName)
}

function hasMultiplePngCarriers(carriers: Resource[] | undefined): boolean {
  return (carriers?.filter(isPngCarrier).length ?? 0) > 1
}

function compareCarrierImage(carriers: Resource[] | undefined, carrier: Resource): void {
  const other = carriers?.find((item) => item.id !== carrier.id && isPngCarrier(item))
  if (other) emit('compareCarrierImage', { current: carrier, other })
}
</script>

<template>
  <section
    v-if="(version.carriers?.length ?? 0) > 1"
    class="resource-version-carriers"
    aria-label="这个版本的封装文件"
  >
    <strong>封装与卡面 · {{ version.carriers?.length }}</strong>
    <article
      v-for="carrier in version.carriers"
      :key="carrier.id"
      :class="{ 'is-current': carrier.id === currentResourceId }"
    >
      <span>
        <b :title="carrier.fileName">{{ carrier.fileName }}</b>
        <small>
          {{ /\.png$/i.test(carrier.fileName) ? 'PNG' : 'JSON' }}
          <template v-if="carrier.metadata.artworkVariantKind === 'custom'"> · 自定义卡面</template>
          <template v-if="carrier.id === currentResourceId"> · 当前使用</template>
        </small>
      </span>
      <details class="resource-version-carrier__more">
        <summary aria-label="展示更多操作" title="展示更多操作">更多</summary>
        <small v-if="carrier.versionNote" class="resource-version-carrier__note">
          备注：{{ carrier.versionNote }}
        </small>
        <div>
          <button
            class="button button--quiet"
            type="button"
            :disabled="busy"
            :aria-expanded="editingCarrierNoteId === carrier.id"
            @click="
              editingCarrierNoteId === carrier.id
                ? emit('cancelCarrierNote', carrier)
                : emit('editCarrierNote', carrier)
            "
          >
            {{ editingCarrierNoteId === carrier.id ? '收起备注' : '备注' }}
          </button>
          <button
            v-if="isPngCarrier(carrier) && hasMultiplePngCarriers(version.carriers)"
            class="button button--quiet"
            type="button"
            :disabled="busy"
            :aria-label="`对比 ${carrier.fileName} 与同版本另一张 PNG`"
            @click="compareCarrierImage(version.carriers, carrier)"
          >
            对比图片
          </button>
          <button
            class="button button--quiet"
            type="button"
            :disabled="busy"
            @click="emit('download', carrier)"
          >
            下载
          </button>
          <button
            v-if="carrier.id !== currentResourceId"
            class="button button--quiet"
            type="button"
            :disabled="busy"
            @click="emit('activateVersion', carrier.id)"
          >
            设为当前封装
          </button>
          <button
            v-if="carrier.id !== currentResourceId"
            class="button button--quiet"
            type="button"
            :disabled="busy"
            @click="emit('detachVersion', carrier.id)"
          >
            解除绑定
          </button>
          <button
            v-if="
              carrier.id !== currentResourceId && carrier.metadata.artworkVariantKind === 'custom'
            "
            class="button button--quiet button--danger"
            type="button"
            :disabled="busy"
            @click="emit('deleteVersion', carrier.id)"
          >
            删除卡面
          </button>
        </div>
        <div
          v-if="editingCarrierNoteId === carrier.id"
          class="resource-version-carrier__note-editor"
        >
          <label>
            <span>封装备注 · {{ carrier.fileName }}</span>
            <textarea
              :value="versionNotes[carrier.id] ?? ''"
              rows="2"
              maxlength="240"
              placeholder="例如：透明底立绘、作者原版卡面"
              @input="handleNoteInput(carrier.id, $event)"
            ></textarea>
          </label>
          <small>{{ (versionNotes[carrier.id] ?? '').length }}/240</small>
          <div>
            <button
              class="button button--primary"
              type="button"
              :disabled="
                busy || (versionNotes[carrier.id] ?? '').trim() === (carrier.versionNote ?? '')
              "
              @click="emit('updateVersionNote', carrier.id, versionNotes[carrier.id] ?? '')"
            >
              保存封装备注
            </button>
            <button
              class="button button--quiet"
              type="button"
              :disabled="busy"
              @click="emit('cancelCarrierNote', carrier)"
            >
              取消
            </button>
          </div>
        </div>
      </details>
    </article>
  </section>
</template>
