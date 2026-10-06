<script setup lang="ts">
import { computed } from 'vue'

import type { FrontendWorkshopNode } from '../types/FrontendWorkshopProject'
import { FRONTEND_WORKSHOP_PARAMETER_REGISTRY } from '../utils/FrontendWorkshopParameterRegistry'
import {
  listFrontendWorkshopInspectorItems,
  type FrontendWorkshopInspectorItem,
  type FrontendWorkshopInspectorMode,
  type FrontendWorkshopInspectorTab,
} from '../utils/FrontendWorkshopInspectorRegistry'

export type FrontendWorkshopInspectorResolvedValue = string | number | boolean | null | undefined
type InspectorChoice = readonly [value: string, label: string]

const props = withDefaults(
  defineProps<{
    node?: FrontendWorkshopNode
    items?: readonly FrontendWorkshopInspectorItem[]
    mode: FrontendWorkshopInspectorMode
    activeTab: FrontendWorkshopInspectorTab
    query?: string
    disabledKeys?: readonly string[]
    hiddenKeys?: readonly string[]
    showTabs?: boolean
    textMaxLength?: number
    textareaMaxLength?: number
    resolveValue: (item: FrontendWorkshopInspectorItem) => FrontendWorkshopInspectorResolvedValue
    resolveChoices?: (item: FrontendWorkshopInspectorItem) => readonly InspectorChoice[]
    resolveLabel?: (item: FrontendWorkshopInspectorItem) => string
  }>(),
  {
    node: undefined,
    items: undefined,
    query: '',
    disabledKeys: () => [],
    hiddenKeys: () => [],
    showTabs: true,
    textMaxLength: 120,
    textareaMaxLength: 6000,
    resolveChoices: () => [],
    resolveLabel: (item: FrontendWorkshopInspectorItem) => item.label,
  },
)

const emit = defineEmits<{
  'update:activeTab': [tab: FrontendWorkshopInspectorTab]
  activate: [item: FrontendWorkshopInspectorItem]
  change: [payload: { item: FrontendWorkshopInspectorItem; value: string | number | boolean }]
}>()

const TABS: ReadonlyArray<{ id: FrontendWorkshopInspectorTab; label: string }> = [
  { id: 'content', label: '内容' },
  { id: 'appearance', label: '外观' },
  { id: 'layout', label: '布局' },
  { id: 'interaction', label: '交互' },
]
const GROUP_LABELS: Record<string, string> = {
  common: '常用',
  details: '详情',
  position: '位置',
  size: '尺寸',
  transform: '变换',
  layer: '图层',
}

const availableItems = computed<readonly FrontendWorkshopInspectorItem[]>(() => {
  if (props.items) {
    return props.items.filter(
      (item) => item.tab === props.activeTab && (props.mode === 'full' || item.level === 'quick'),
    )
  }
  return props.node
    ? listFrontendWorkshopInspectorItems(props.node, props.activeTab, props.mode)
    : []
})

const filteredItems = computed(() => {
  const needle = props.query.trim().toLocaleLowerCase()
  return availableItems.value.filter(
    (item) =>
      !props.hiddenKeys.includes(item.key) &&
      (needle ? `${item.label} ${item.key}`.toLocaleLowerCase().includes(needle) : true),
  )
})
const groups = computed(() => {
  const grouped = new Map<string, FrontendWorkshopInspectorItem[]>()
  for (const item of filteredItems.value) {
    const items = grouped.get(item.group) ?? []
    items.push(item)
    grouped.set(item.group, items)
  }
  return [...grouped.entries()].map(([id, items]) => ({
    id,
    label: GROUP_LABELS[id] ?? '设置',
    items,
  }))
})

function isDisabled(item: FrontendWorkshopInspectorItem): boolean {
  return props.disabledKeys.includes(item.key)
}
function resolved(item: FrontendWorkshopInspectorItem) {
  return props.resolveValue(item)
}
function label(item: FrontendWorkshopInspectorItem): string {
  return props.resolveLabel(item)
}
function stringValue(item: FrontendWorkshopInspectorItem): string {
  const value = resolved(item)
  return value === null || value === undefined ? '' : String(value)
}
function numberValue(item: FrontendWorkshopInspectorItem): number {
  const value = Number(resolved(item))
  return Number.isFinite(value) ? value : 0
}
function booleanValue(item: FrontendWorkshopInspectorItem): boolean {
  return Boolean(resolved(item))
}
function parameter(item: FrontendWorkshopInspectorItem) {
  return item.parameterKey ? FRONTEND_WORKSHOP_PARAMETER_REGISTRY[item.parameterKey] : undefined
}
function isDirectNumber(item: FrontendWorkshopInspectorItem): boolean {
  return item.control === 'number' || parameter(item)?.valueType === 'number'
}
function isDirectChoice(item: FrontendWorkshopInspectorItem): boolean {
  return item.control === 'choice' || parameter(item)?.valueType === 'choice'
}
function isDirectColor(item: FrontendWorkshopInspectorItem): boolean {
  return item.control === 'color' || parameter(item)?.valueType === 'color'
}
function choices(item: FrontendWorkshopInspectorItem): readonly InspectorChoice[] {
  const resolvedChoices = props.resolveChoices(item)
  if (resolvedChoices.length) return resolvedChoices
  return (parameter(item)?.choices ?? []).map((choice) => [choice, choice] as const)
}
function numberMinimum(item: FrontendWorkshopInspectorItem): number | undefined {
  return parameter(item)?.minimum
}
function numberMaximum(item: FrontendWorkshopInspectorItem): number | undefined {
  return parameter(item)?.maximum
}
function numberStep(item: FrontendWorkshopInspectorItem): number | undefined {
  return parameter(item)?.step
}
function hasSlider(item: FrontendWorkshopInspectorItem): boolean {
  return parameter(item)?.inputs.includes('slider') ?? false
}
function emitText(item: FrontendWorkshopInspectorItem, event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    emit('change', { item, value: target.value })
}
function emitNumber(item: FrontendWorkshopInspectorItem, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const value = Number(target.value)
  if (Number.isFinite(value)) emit('change', { item, value })
}
function emitNumberInput(item: FrontendWorkshopInspectorItem, event: Event): void {
  if ((item.numberCommit ?? 'input') === 'input') emitNumber(item, event)
}
function emitNumberChange(item: FrontendWorkshopInspectorItem, event: Event): void {
  if (item.numberCommit === 'change') emitNumber(item, event)
}
function emitChoice(item: FrontendWorkshopInspectorItem, event: Event): void {
  const target = event.target
  if (target instanceof HTMLSelectElement) emit('change', { item, value: target.value })
}
function emitBoolean(item: FrontendWorkshopInspectorItem, event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) emit('change', { item, value: target.checked })
}
function actionLabel(item: FrontendWorkshopInspectorItem): string {
  return item.key === 'layout.reset' ? '恢复' : '›'
}
</script>

<template>
  <section class="frontend-workshop-node-inspector" :data-mode="mode" :data-active-tab="activeTab">
    <nav v-if="showTabs" class="frontend-workshop-node-inspector__tabs" aria-label="属性分类">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        :data-tab="tab.id"
        :class="{ 'is-active': activeTab === tab.id }"
        :aria-pressed="activeTab === tab.id"
        @click="emit('update:activeTab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>
    <slot name="toolbar"></slot>
    <div class="frontend-workshop-node-inspector__body">
      <section
        v-for="group in groups"
        :key="group.id"
        class="frontend-workshop-node-inspector__group"
        :data-group="group.id"
      >
        <h2>{{ group.label }}</h2>
        <div class="frontend-workshop-node-inspector__rows">
          <template v-for="item in group.items" :key="item.key">
            <label
              v-if="item.control === 'text'"
              class="frontend-workshop-node-inspector__field"
              :data-item-key="item.key"
            >
              <span>{{ label(item) }}</span>
              <input
                :value="stringValue(item)"
                :disabled="isDisabled(item)"
                :maxlength="textMaxLength"
                @change="emitText(item, $event)"
              />
            </label>
            <label
              v-else-if="item.control === 'textarea'"
              class="frontend-workshop-node-inspector__field"
              :data-item-key="item.key"
            >
              <span>{{ label(item) }}</span>
              <textarea
                :value="stringValue(item)"
                :disabled="isDisabled(item)"
                rows="5"
                :maxlength="textareaMaxLength"
                @change="emitText(item, $event)"
              ></textarea>
            </label>
            <label
              v-else-if="isDirectNumber(item)"
              class="frontend-workshop-node-inspector__field frontend-workshop-node-inspector__field--number"
              :data-item-key="item.key"
            >
              <span>{{ label(item) }}</span>
              <div class="frontend-workshop-node-inspector__number-control">
                <input
                  v-if="hasSlider(item)"
                  type="range"
                  :value="numberValue(item)"
                  :min="numberMinimum(item)"
                  :max="numberMaximum(item)"
                  :step="numberStep(item)"
                  :disabled="isDisabled(item)"
                  @input="emitNumberInput(item, $event)"
                  @change="emitNumberChange(item, $event)"
                />
                <input
                  type="number"
                  :value="numberValue(item)"
                  :min="numberMinimum(item)"
                  :max="numberMaximum(item)"
                  :step="numberStep(item)"
                  :disabled="isDisabled(item)"
                  @input="emitNumberInput(item, $event)"
                  @change="emitNumberChange(item, $event)"
                />
              </div>
            </label>
            <label
              v-else-if="isDirectChoice(item)"
              class="frontend-workshop-node-inspector__field frontend-workshop-node-inspector__field--select"
              :data-item-key="item.key"
            >
              <span>{{ label(item) }}</span>
              <select
                :value="stringValue(item)"
                :disabled="isDisabled(item)"
                @change="emitChoice(item, $event)"
              >
                <option v-for="choice in choices(item)" :key="choice[0]" :value="choice[0]">
                  {{ choice[1] }}
                </option>
              </select>
            </label>
            <label
              v-else-if="isDirectColor(item)"
              class="frontend-workshop-node-inspector__field frontend-workshop-node-inspector__field--color"
              :data-item-key="item.key"
            >
              <span>{{ label(item) }}</span>
              <input
                type="color"
                :value="stringValue(item)"
                :disabled="isDisabled(item)"
                @input="emitText(item, $event)"
              />
              <code>{{ stringValue(item) }}</code>
            </label>
            <label
              v-else-if="item.control === 'toggle'"
              class="frontend-workshop-node-inspector__toggle"
              :data-item-key="item.key"
            >
              <span>{{ label(item) }}</span>
              <input
                type="checkbox"
                :checked="booleanValue(item)"
                :disabled="isDisabled(item)"
                @change="emitBoolean(item, $event)"
              />
            </label>
            <button
              v-else
              type="button"
              class="frontend-workshop-node-inspector__row"
              :class="{ 'is-action': item.control === 'action' }"
              :data-item-key="item.key"
              :disabled="isDisabled(item)"
              @click="emit('activate', item)"
            >
              <span>
                <b>{{ label(item) }}</b>
                <small v-if="stringValue(item)">{{ stringValue(item) }}</small>
              </span>
              <em aria-hidden="true">{{ actionLabel(item) }}</em>
            </button>
          </template>
        </div>
      </section>
      <p v-if="!groups.length" class="frontend-workshop-node-inspector__empty">
        {{ query ? '没有匹配的设置' : '当前元素没有这一类设置' }}
      </p>
    </div>
  </section>
</template>

<style scoped src="../styles/FrontendWorkshopNodeInspector.css"></style>
