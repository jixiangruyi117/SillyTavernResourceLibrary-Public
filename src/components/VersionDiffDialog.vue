<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { Resource } from '../types/Resource'
import { diffResources, type LineDiffOp, type ResourceDiffResult } from '../utils/ResourceDiff'

const props = defineProps<{
  /** 当前展示版本。 */
  current: Resource
  /** 被对比的历史版本。 */
  other: Resource
}>()
const emit = defineEmits<{ close: [] }>()

const result = ref<ResourceDiffResult>()
const isComputing = ref(true)
const failure = ref('')

const otherLabel = computed(() => props.other.versionLabel || props.other.fileName)
const currentLabel = computed(
  () => props.current.versionLabel || props.current.fileName || '当前版本',
)
function changedLines(lines: LineDiffOp[], side: 'old' | 'new'): LineDiffOp[] {
  return lines.filter((line) => line.type === (side === 'old' ? 'removed' : 'added'))
}
const kindLabel = computed(() => {
  switch (result.value?.kind) {
    case 'identical':
      return '内容完全一致'
    case 'character':
      return '角色卡字段对比'
    case 'worldBook':
      return '世界书条目对比'
    case 'text':
      return '文本行对比'
    case 'binary':
      return '二进制文件'
    default:
      return ''
  }
})

async function compute(): Promise<void> {
  isComputing.value = true
  failure.value = ''
  try {
    // 方向固定为「历史版本 → 当前版本」：新增即当前版新加的内容。
    result.value = await diffResources(props.other, props.current)
  } catch (error) {
    failure.value = error instanceof Error ? error.message : '版本对比失败'
  } finally {
    isComputing.value = false
  }
}

watch(() => [props.current.id, props.other.id], compute, { immediate: true })

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="editor-overlay" role="presentation" @click.self="emit('close')">
    <section class="version-diff" role="dialog" aria-modal="true" aria-label="版本对比">
      <header class="version-diff__header">
        <div>
          <small>VERSION DIFF</small>
          <h3>版本对比</h3>
          <p>
            「{{ otherLabel }}」 → 当前版本。<span v-if="kindLabel">{{ kindLabel }}。</span>
            左栏为历史版本，右栏为当前版本；只列出实际变化的内容。
          </p>
        </div>
        <button type="button" aria-label="关闭版本对比" @click="emit('close')">×</button>
      </header>

      <p v-if="isComputing" class="version-diff__status">正在对比两个版本……</p>
      <p v-else-if="failure" class="version-diff__status version-diff__status--error">
        {{ failure }}
      </p>

      <template v-else-if="result">
        <p v-if="result.note" class="version-diff__status">{{ result.note }}</p>
        <p v-if="result.kind === 'identical'" class="version-diff__status">
          两个版本的文件内容完全一致（内容指纹相同），差异可能只在名称、标签或备注等整理信息。
        </p>
        <p v-else-if="result.kind === 'binary'" class="version-diff__status">
          这两个版本是无法按文本比较的二进制文件，内容指纹不同说明文件确实发生了变化；可分别下载后在本机比较。
        </p>

        <template v-else>
          <p class="version-diff__summary">
            <span class="version-diff__count version-diff__count--added"
              >+{{ result.summary.added }}</span
            >
            <span class="version-diff__count version-diff__count--removed"
              >-{{ result.summary.removed }}</span
            >
            <span class="version-diff__count">改 {{ result.summary.changed }}</span>
          </p>

          <div class="version-diff__scroll">
            <section v-if="result.fields.length" class="version-diff__section">
              <h4>字段变化</h4>
              <article
                v-for="field in result.fields"
                :key="field.label"
                class="version-diff__field"
                :data-status="field.status"
              >
                <header>
                  <strong>{{ field.label }}</strong>
                  <em>{{
                    field.status === 'added' ? '新增' : field.status === 'removed' ? '移除' : '修改'
                  }}</em>
                </header>
                <div class="version-diff__columns">
                  <section data-side="old">
                    <header>
                      <small>历史版本</small><strong>{{ otherLabel }}</strong>
                    </header>
                    <div v-if="field.lines" class="version-diff__lines">
                      <p
                        v-for="(op, index) in changedLines(field.lines, 'old')"
                        :key="index"
                        data-op="removed"
                      >
                        {{ op.text || ' ' }}
                      </p>
                      <p v-if="!changedLines(field.lines, 'old').length" class="is-empty">无</p>
                    </div>
                    <p v-else-if="field.oldText" data-op="removed">{{ field.oldText }}</p>
                    <p v-else class="is-empty">无</p>
                  </section>
                  <section data-side="new">
                    <header>
                      <small>当前版本</small><strong>{{ currentLabel }}</strong>
                    </header>
                    <div v-if="field.lines" class="version-diff__lines">
                      <p
                        v-for="(op, index) in changedLines(field.lines, 'new')"
                        :key="index"
                        data-op="added"
                      >
                        {{ op.text || ' ' }}
                      </p>
                      <p v-if="!changedLines(field.lines, 'new').length" class="is-empty">无</p>
                    </div>
                    <p v-else-if="field.newText" data-op="added">{{ field.newText }}</p>
                    <p v-else class="is-empty">无</p>
                  </section>
                </div>
              </article>
            </section>

            <section v-if="result.entries.length" class="version-diff__section">
              <h4>世界书条目变化</h4>
              <article
                v-for="entry in result.entries"
                :key="entry.key"
                class="version-diff__field"
                :data-status="entry.status"
              >
                <header>
                  <strong>{{ entry.label }}</strong>
                  <em>{{
                    entry.status === 'added' ? '新增' : entry.status === 'removed' ? '移除' : '修改'
                  }}</em>
                </header>
                <div v-if="entry.lines" class="version-diff__columns">
                  <section data-side="old">
                    <header>
                      <small>历史版本</small><strong>{{ otherLabel }}</strong>
                    </header>
                    <div class="version-diff__lines">
                      <p
                        v-for="(op, index) in changedLines(entry.lines, 'old')"
                        :key="index"
                        data-op="removed"
                      >
                        {{ op.text || ' ' }}
                      </p>
                      <p v-if="!changedLines(entry.lines, 'old').length" class="is-empty">无</p>
                    </div>
                  </section>
                  <section data-side="new">
                    <header>
                      <small>当前版本</small><strong>{{ currentLabel }}</strong>
                    </header>
                    <div class="version-diff__lines">
                      <p
                        v-for="(op, index) in changedLines(entry.lines, 'new')"
                        :key="index"
                        data-op="added"
                      >
                        {{ op.text || ' ' }}
                      </p>
                      <p v-if="!changedLines(entry.lines, 'new').length" class="is-empty">无</p>
                    </div>
                  </section>
                </div>
              </article>
            </section>

            <section v-if="result.kind === 'text'" class="version-diff__section">
              <h4>文本差异</h4>
              <div class="version-diff__columns">
                <section data-side="old">
                  <header>
                    <small>历史版本</small><strong>{{ otherLabel }}</strong>
                  </header>
                  <div class="version-diff__lines">
                    <p
                      v-for="(op, index) in changedLines(result.lines, 'old')"
                      :key="index"
                      data-op="removed"
                    >
                      {{ op.text || ' ' }}
                    </p>
                  </div>
                </section>
                <section data-side="new">
                  <header>
                    <small>当前版本</small><strong>{{ currentLabel }}</strong>
                  </header>
                  <div class="version-diff__lines">
                    <p
                      v-for="(op, index) in changedLines(result.lines, 'new')"
                      :key="index"
                      data-op="added"
                    >
                      {{ op.text || ' ' }}
                    </p>
                  </div>
                </section>
              </div>
            </section>

            <p
              v-if="
                !result.fields.length &&
                !result.entries.length &&
                result.kind !== 'text' &&
                !result.note
              "
              class="version-diff__status"
            >
              没有检测到内容层差异。
            </p>
          </div>
        </template>
      </template>
    </section>
  </div>
</template>
