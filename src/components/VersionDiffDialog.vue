<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { ImportVersionComparison } from '../types/Import'
import { RESOURCE_TYPE, RESOURCE_TYPE_LABELS, type Resource } from '../types/Resource'
import { diffResources, type LineDiffOp, type ResourceDiffResult } from '../utils/ResourceDiff'

const props = defineProps<{
  /** 当前展示版本。 */
  current: Resource
  /** 被对比的历史版本。 */
  other: Resource
  mode?: 'history' | 'import-candidate'
  matchDetails?: Pick<ImportVersionComparison, 'score' | 'reasons' | 'matchedHistorical'>
}>()
const emit = defineEmits<{ close: [] }>()

const result = ref<ResourceDiffResult>()
const isComputing = ref(true)
const failure = ref('')

const otherLabel = computed(() => props.other.versionLabel || props.other.fileName)
const currentLabel = computed(
  () => props.current.versionLabel || props.current.fileName || '当前版本',
)
const oldSideLabel = computed(() =>
  props.mode === 'import-candidate' ? '接近的已有资源' : '历史版本',
)
const newSideLabel = computed(() => (props.mode === 'import-candidate' ? '待导入版本' : '当前版本'))
const sourceDiffTitle = computed(() => `${RESOURCE_TYPE_LABELS[props.other.type]}内容变化`)
const sourceDiffIntro = computed(() => {
  if (result.value?.regexRules?.length || props.other.type === RESOURCE_TYPE.REGEX)
    return '识别到的规则会按名称、启用状态、作用位置、匹配效果等信息整理；原始表达式默认收起。'
  if (result.value?.scriptItems?.length || props.other.type === RESOURCE_TYPE.SCRIPT)
    return '若文件中包含可识别的脚本配置，会列出名称、文件夹、启用状态、按钮等变化；源码默认收起。'
  return '检测到原始文本内容有变化。详细文本默认收起，展开后可查看逐行差异。'
})
const regexRuleCounts = computed(() => {
  const rules = result.value?.regexRules ?? []
  return {
    added: rules.filter((rule) => rule.status === 'added').length,
    removed: rules.filter((rule) => rule.status === 'removed').length,
    changed: rules.filter((rule) => rule.status === 'changed').length,
  }
})
const scriptItemCounts = computed(() => {
  const items = result.value?.scriptItems ?? []
  return {
    added: items.filter((item) => item.status === 'added').length,
    removed: items.filter((item) => item.status === 'removed').length,
    changed: items.filter((item) => item.status === 'changed').length,
  }
})
function changedLines(lines: LineDiffOp[], side: 'old' | 'new'): LineDiffOp[] {
  return lines.filter((line) => line.type === (side === 'old' ? 'removed' : 'added'))
}
const kindLabel = computed(() => {
  if (result.value?.regexRules?.length) return '正则规则对比'
  if (result.value?.scriptItems?.length) return '脚本配置对比'
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
  <div
    class="editor-overlay version-diff-overlay"
    :class="{ 'version-diff-overlay--import': mode === 'import-candidate' }"
    role="presentation"
    @click.self="emit('close')"
  >
    <section class="version-diff" role="dialog" aria-modal="true" aria-label="版本对比">
      <header class="version-diff__header">
        <div>
          <small>VERSION DIFF</small>
          <h3>版本对比</h3>
          <p>
            「{{ otherLabel }}」 → 「{{ currentLabel }}」。<span v-if="kindLabel"
              >{{ kindLabel }}。</span
            >
            左栏为{{ oldSideLabel }}，右栏为{{ newSideLabel }}；只列出实际变化的内容。
          </p>
        </div>
        <button type="button" aria-label="关闭版本对比" @click="emit('close')">×</button>
      </header>

      <p v-if="matchDetails" class="version-diff__match">
        <strong>系统匹配 {{ matchDetails.score }}%</strong>
        <span>{{ matchDetails.reasons.join('、') }}</span>
        <span v-if="matchDetails.matchedHistorical">匹配依据来自已有资源的历史版本</span>
      </p>

      <div class="version-diff__legend" aria-label="差异颜色说明">
        <span><i data-tone="added"></i>绿色：{{ newSideLabel }}新增</span>
        <span><i data-tone="removed"></i>红色：{{ oldSideLabel }}移除</span>
      </div>

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
                      <small>{{ oldSideLabel }}</small
                      ><strong>{{ otherLabel }}</strong>
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
                      <small>{{ newSideLabel }}</small
                      ><strong>{{ currentLabel }}</strong>
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
                <div v-if="entry.details?.length" class="version-diff__entry-details">
                  <article
                    v-for="detail in entry.details"
                    :key="detail.label"
                    class="version-diff__entry-detail"
                    :data-status="detail.status"
                  >
                    <strong>{{ detail.label }}</strong>
                    <div class="version-diff__columns">
                      <section data-side="old">
                        <header>
                          <small>{{ oldSideLabel }}</small
                          ><strong>{{ otherLabel }}</strong>
                        </header>
                        <div v-if="detail.lines" class="version-diff__lines">
                          <p
                            v-for="(op, index) in changedLines(detail.lines, 'old')"
                            :key="index"
                            data-op="removed"
                          >
                            {{ op.text || ' ' }}
                          </p>
                          <p v-if="!changedLines(detail.lines, 'old').length" class="is-empty">
                            无
                          </p>
                        </div>
                        <p v-else-if="detail.oldText" data-op="removed">{{ detail.oldText }}</p>
                        <p v-else class="is-empty">无</p>
                      </section>
                      <section data-side="new">
                        <header>
                          <small>{{ newSideLabel }}</small
                          ><strong>{{ currentLabel }}</strong>
                        </header>
                        <div v-if="detail.lines" class="version-diff__lines">
                          <p
                            v-for="(op, index) in changedLines(detail.lines, 'new')"
                            :key="index"
                            data-op="added"
                          >
                            {{ op.text || ' ' }}
                          </p>
                          <p v-if="!changedLines(detail.lines, 'new').length" class="is-empty">
                            无
                          </p>
                        </div>
                        <p v-else-if="detail.newText" data-op="added">{{ detail.newText }}</p>
                        <p v-else class="is-empty">无</p>
                      </section>
                    </div>
                  </article>
                </div>
                <p v-else class="version-diff__entry-note">其他高级配置有变化。</p>
              </article>
            </section>

            <section v-if="result.regexRules?.length" class="version-diff__section">
              <h4>正则规则变化</h4>
              <p class="version-diff__status">
                新增 {{ regexRuleCounts.added }} 条 · 移除 {{ regexRuleCounts.removed }} 条 · 修改
                {{ regexRuleCounts.changed }} 条。下面用易读说明展示规则变化。
              </p>
              <article
                v-for="rule in result.regexRules"
                :key="rule.key"
                class="version-diff__field version-diff__rule"
                :data-status="rule.status"
              >
                <header>
                  <strong>{{ rule.label }}</strong>
                  <em>{{
                    rule.status === 'added' ? '新增' : rule.status === 'removed' ? '移除' : '修改'
                  }}</em>
                </header>
                <div v-if="rule.details?.length" class="version-diff__entry-details">
                  <div
                    v-for="detail in rule.details"
                    :key="detail.label"
                    class="version-diff__readable-change"
                    :data-status="detail.status"
                  >
                    <strong>{{ detail.label }}</strong>
                    <div>
                      <span>{{ detail.oldText || '无' }}</span>
                      <i aria-hidden="true">→</i>
                      <span>{{ detail.newText || '无' }}</span>
                    </div>
                  </div>
                </div>
              </article>
            </section>

            <section v-if="result.scriptItems?.length" class="version-diff__section">
              <h4>脚本配置变化</h4>
              <p class="version-diff__status">
                新增 {{ scriptItemCounts.added }} 个 · 移除 {{ scriptItemCounts.removed }} 个 · 修改
                {{ scriptItemCounts.changed }} 个。脚本代码只标注是否变化，不自动推断代码行为。
              </p>
              <article
                v-for="item in result.scriptItems"
                :key="item.key"
                class="version-diff__field version-diff__rule"
                :data-status="item.status"
              >
                <header>
                  <strong>{{ item.label }}</strong>
                  <em>{{
                    item.status === 'added' ? '新增' : item.status === 'removed' ? '移除' : '修改'
                  }}</em>
                </header>
                <div v-if="item.details?.length" class="version-diff__entry-details">
                  <div
                    v-for="detail in item.details"
                    :key="detail.label"
                    class="version-diff__readable-change"
                    :data-status="detail.status"
                  >
                    <strong>{{ detail.label }}</strong>
                    <div>
                      <span>{{ detail.oldText || '无' }}</span>
                      <i aria-hidden="true">→</i>
                      <span>{{ detail.newText || '无' }}</span>
                    </div>
                  </div>
                </div>
              </article>
            </section>

            <section v-if="result.kind === 'text'" class="version-diff__section">
              <h4>{{ sourceDiffTitle }}</h4>
              <p class="version-diff__status">{{ sourceDiffIntro }}</p>
              <details class="version-diff__raw">
                <summary>查看原始代码 / 文本差异（技术细节）</summary>
                <div class="version-diff__columns">
                  <section data-side="old">
                    <header>
                      <small>{{ oldSideLabel }}</small
                      ><strong>{{ otherLabel }}</strong>
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
                      <small>{{ newSideLabel }}</small
                      ><strong>{{ currentLabel }}</strong>
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
              </details>
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
