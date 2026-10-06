<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import '../styles/CharacterCardMigrationReview.css'
import {
  useCharacterCardMigrationReviewState,
  type CharacterCardMigrationReviewSelection,
} from '../services/CharacterCardMigrationReview'

const { activeReview, activeSelection, select, respond } = useCharacterCardMigrationReviewState()
const selectedIds = ref<string[]>([])
const selectionQuery = ref('')
const selectionPage = ref(1)
const filteredSelection = computed(
  () =>
    activeSelection.value?.edits.filter((edit) =>
      edit.label.toLocaleLowerCase().includes(selectionQuery.value.trim().toLocaleLowerCase()),
    ) ?? [],
)
const selectionPages = computed(() => Math.max(1, Math.ceil(filteredSelection.value.length / 20)))
watch(selectionQuery, () => {
  selectionPage.value = 1
})
watch(activeSelection, async (value) => {
  selectedIds.value = value?.edits.map((edit) => edit.id) ?? []
  selectionQuery.value = ''
  selectionPage.value = 1
  await nextTick()
  dialog.value?.focus({ preventScroll: true })
})
const choices = ref<Record<string, 'keep-current' | 'use-incoming' | 'manual'>>({})
const manualValues = ref<Record<string, string>>({})
const dialog = ref<HTMLElement>()

watch(activeReview, async (items) => {
  if (!items) return
  choices.value = Object.fromEntries(items.map((item) => [item.key, 'keep-current']))
  manualValues.value = Object.fromEntries(
    items.map((item) => [item.key, typeof item.currentValue === 'string' ? item.currentValue : '']),
  )
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('select')?.focus({ preventScroll: true })
})

function handleKeydown(event: KeyboardEvent): void {
  if (activeSelection.value && event.key === 'Escape') {
    event.stopPropagation()
    select(undefined)
    return
  }
  if (!activeReview.value || event.key !== 'Escape') return
  event.stopPropagation()
  respond(undefined)
}

onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))

function displayValue(value: unknown): string {
  if (value === undefined) return '（该字段不存在）'
  if (typeof value === 'string') return value || '（空字符串）'
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function incomingLabel(item: NonNullable<typeof activeReview.value>[number]): string {
  if (item.edit.operation !== 'delete') return displayValue(item.incomingValue)
  if (item.edit.section === 'greeting')
    return item.edit.targetKey === 'primary' ? '删除主开场白' : '删除此备用开场白'
  if (item.edit.section === 'helperScript') return '删除此脚本'
  if (item.edit.section === 'regex') return '删除此正则'
  return '删除整个条目'
}

function deleteChoiceLabel(item: NonNullable<typeof activeReview.value>[number]): string {
  if (item.edit.operation !== 'delete') return '采用我的修改'
  if (item.edit.section === 'greeting')
    return item.edit.targetKey === 'primary' ? '删除主开场白' : '删除备用开场白'
  if (item.edit.section === 'helperScript') return '删除脚本'
  if (item.edit.section === 'regex') return '删除正则'
  return '删除此条目'
}

function submit(): void {
  if (!activeReview.value) return
  const selections: CharacterCardMigrationReviewSelection[] = activeReview.value.map((item) => {
    const choice = choices.value[item.key] ?? 'keep-current'
    return {
      key: item.key,
      choice:
        choice === 'manual' ? { choice, value: manualValues.value[item.key] ?? '' } : { choice },
    }
  })
  respond(selections)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="activeSelection"
      class="migration-review__overlay"
      role="presentation"
      @click.self="select(undefined)"
    >
      <section
        ref="dialog"
        class="migration-review"
        role="dialog"
        aria-modal="true"
        aria-label="选择迁移修改"
        tabindex="-1"
      >
        <header class="migration-review__header">
          <h2>选择迁移修改</h2>
          <p>目标：{{ activeSelection.target }}。选好后统一检查冲突，未选修改仍保留在原版本。</p>
        </header>
        <div class="migration-review__items">
          <input
            v-model="selectionQuery"
            class="migration-review__search"
            type="search"
            placeholder="搜索修改名称"
            aria-label="搜索迁移修改"
          />
          <div class="migration-review__selection-tools">
            <span>已选 {{ selectedIds.length }} / {{ activeSelection.edits.length }}</span>
            <button
              type="button"
              @click="
                selectedIds = [
                  ...new Set([...selectedIds, ...filteredSelection.map((edit) => edit.id)]),
                ]
              "
            >
              选择筛选结果
            </button>
            <button type="button" @click="selectedIds = []">清空选择</button>
          </div>
          <label
            v-for="edit in filteredSelection.slice((selectionPage - 1) * 20, selectionPage * 20)"
            :key="edit.id"
            class="migration-review__selection-row"
          >
            <input v-model="selectedIds" type="checkbox" :value="edit.id" />
            <span
              ><strong>{{ edit.label }}</strong
              ><small
                >{{
                  edit.operation === 'delete' ? '删除' : edit.operation === 'add' ? '新增' : '修改'
                }}
                ·
                {{
                  { greeting: '开场白', worldBook: '世界书', regex: '正则', helperScript: '脚本' }[
                    edit.section
                  ]
                }}</small
              ></span
            >
          </label>
          <div v-if="selectionPages > 1" class="migration-review__selection-tools">
            <button type="button" :disabled="selectionPage === 1" @click="selectionPage--">
              上一页
            </button>
            <span>{{ selectionPage }} / {{ selectionPages }}</span>
            <button
              type="button"
              :disabled="selectionPage === selectionPages"
              @click="selectionPage++"
            >
              下一页
            </button>
          </div>
        </div>
        <footer class="migration-review__footer">
          <button type="button" @click="select(undefined)">取消</button>
          <button type="button" class="migration-review__apply" @click="select(selectedIds)">
            {{ selectedIds.length ? `迁移 ${selectedIds.length} 项并继续` : '不迁移，继续' }}
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="activeReview"
      class="migration-review__overlay"
      role="presentation"
      @click.self="respond(undefined)"
    >
      <section
        ref="dialog"
        class="migration-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-review-title"
      >
        <header class="migration-review__header">
          <span class="migration-review__eyebrow">版本迁移 · 字段冲突</span>
          <h2 id="migration-review-title">这几处内容两边都改过</h2>
          <p>
            没有冲突的字段会自动合并。每处冲突可保留新版、采用你的修改；文本字段还可以手动合并。
          </p>
        </header>

        <div class="migration-review__items">
          <article v-for="item in activeReview" :key="item.key" class="migration-review__item">
            <div class="migration-review__item-title">
              <strong>{{ item.edit.label }}</strong>
              <span>{{ item.sectionLabel }} · {{ item.fieldLabel }}</span>
            </div>
            <div class="migration-review__values">
              <div>
                <span>修改前</span>
                <pre>{{ displayValue(item.baseValue) }}</pre>
              </div>
              <div>
                <span>新版作者内容</span>
                <pre>{{ displayValue(item.currentValue) }}</pre>
              </div>
              <div>
                <span>你的修改</span>
                <pre>{{ incomingLabel(item) }}</pre>
              </div>
            </div>
            <label class="migration-review__choice">
              这一项怎么处理
              <select v-model="choices[item.key]">
                <option value="keep-current">保留新版内容</option>
                <option value="use-incoming">
                  {{ deleteChoiceLabel(item) }}
                </option>
                <option v-if="item.manualAllowed" value="manual">手动合并</option>
              </select>
            </label>
            <label v-if="choices[item.key] === 'manual'" class="migration-review__manual">
              合并后的内容
              <textarea v-model="manualValues[item.key]" rows="5" />
            </label>
          </article>
        </div>

        <footer class="migration-review__footer">
          <button type="button" @click="respond(undefined)">取消迁移</button>
          <button type="button" class="migration-review__apply" @click="submit">
            应用选择并继续
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
