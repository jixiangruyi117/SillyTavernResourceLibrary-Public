<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  workshopEffects,
  workshopEffectCategories,
  workshopReferences,
} from '../utils/FrontendWorkshopEffectCatalog'
import {
  workshopStyles,
  buildWorkshopInspirationPrompt,
} from '../utils/FrontendWorkshopStyleCatalog'
import FrontendWorkshopEffectPreview from './FrontendWorkshopEffectPreview.vue'
import FrontendWorkshopStylePreview from './FrontendWorkshopStylePreview.vue'
import FeatureAppHeader from './FeatureAppHeader.vue'
import FrontendWorkshopReferenceResources from './FrontendWorkshopReferenceResources.vue'

const props = defineProps<{ canUseAi?: boolean }>()
const emit = defineEmits<{ usePrompt: [instruction: string] }>()
const tutorialOpen = ref(false)
const dialog = ref<HTMLDialogElement>()
const scrollArea = ref<HTMLElement>()
let directoryScrollTop = 0
type ReferenceTab = 'effects' | 'styles' | 'sites' | 'templates'
const tab = ref<ReferenceTab>('effects')
const search = ref('')
const category = ref('')
const detailOpen = ref(false)
const effectId = ref('carousel')
const styleId = ref('glass')
const chosenStyleId = ref('')
const chosenEffectIds = ref<string[]>([])
const status = ref('')
const fallbackCopy = ref(false)
const copyArea = ref<HTMLTextAreaElement>()
const currentEffect = computed(() => workshopEffects.find((item) => item.id === effectId.value)!)
const currentStyle = computed(() => workshopStyles.find((item) => item.id === styleId.value)!)
const selectedEntry = computed(() =>
  tab.value === 'effects' ? currentEffect.value : currentStyle.value,
)
const chosenStyle = computed(() => workshopStyles.find((item) => item.id === chosenStyleId.value))
const chosenEffects = computed(() =>
  chosenEffectIds.value.map((id) => workshopEffects.find((item) => item.id === id)!),
)
const hasPrompt = computed(() => Boolean(chosenEffects.value.length || chosenStyle.value))
const prompt = computed(() =>
  buildWorkshopInspirationPrompt(chosenStyle.value, chosenEffects.value),
)
const filteredItems = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase()
  const items =
    tab.value === 'effects'
      ? workshopEffects.filter((item) => !category.value || item.category === category.value)
      : workshopStyles
  return items.filter((item) =>
    `${item.name} ${item.en} ${item.desc} ${item.use} ${'category' in item ? workshopEffectCategories[item.category as keyof typeof workshopEffectCategories] : ''}`
      .toLocaleLowerCase()
      .includes(needle),
  )
})
const reference = computed(() =>
  tab.value === 'effects' ? workshopReferences[currentEffect.value.reference] : undefined,
)
function setTab(value: ReferenceTab): void {
  tab.value = value
  search.value = ''
  detailOpen.value = false
  directoryScrollTop = 0
  if (scrollArea.value) scrollArea.value.scrollTop = 0
}
async function selectItem(id: string): Promise<void> {
  const mobile = window.matchMedia?.('(max-width: 48rem)').matches
  if (mobile && !detailOpen.value) directoryScrollTop = scrollArea.value?.scrollTop ?? 0
  if (tab.value === 'effects') effectId.value = id
  else styleId.value = id
  detailOpen.value = true
  await nextTick()
  if (mobile && scrollArea.value) scrollArea.value.scrollTop = 0
}
async function showDirectory(): Promise<void> {
  detailOpen.value = false
  await nextTick()
  if (window.matchMedia?.('(max-width: 48rem)').matches && scrollArea.value)
    scrollArea.value.scrollTop = directoryScrollTop
}
function inPrompt(): boolean {
  return tab.value === 'effects'
    ? chosenEffectIds.value.includes(effectId.value)
    : chosenStyleId.value === styleId.value
}
function togglePromptItem(): void {
  if (tab.value === 'styles') chosenStyleId.value = inPrompt() ? '' : styleId.value
  else if (inPrompt())
    chosenEffectIds.value = chosenEffectIds.value.filter((id) => id !== effectId.value)
  else chosenEffectIds.value.push(effectId.value)
  status.value = ''
  fallbackCopy.value = false
}
async function open(): Promise<void> {
  detailOpen.value = false
  directoryScrollTop = 0
  tutorialOpen.value = true
  await nextTick()
  if (dialog.value && !dialog.value.open) dialog.value.showModal()
}
function close(): void {
  dialog.value?.close()
  tutorialOpen.value = false
  status.value = ''
  fallbackCopy.value = false
}
function back(): boolean {
  if (!tutorialOpen.value) return false
  if (detailOpen.value && window.matchMedia?.('(max-width: 48rem)').matches) void showDirectory()
  else close()
  return true
}
async function copyPrompt(): Promise<void> {
  const value = prompt.value
  try {
    await navigator.clipboard.writeText(value)
    if (tutorialOpen.value) status.value = '描述已复制，可以粘贴后继续补充要求。'
  } catch {
    if (!tutorialOpen.value) return
    fallbackCopy.value = true
    status.value = '当前环境无法直接复制，请长按下方文字或全选复制。'
    await nextTick()
    copyArea.value?.focus()
    copyArea.value?.select()
  }
}
function usePrompt(): void {
  if (!props.canUseAi || !hasPrompt.value) return
  const value = prompt.value
  close()
  emit('usePrompt', value)
}
function useTemplatePrompt(text: string): void {
  if (!props.canUseAi) return
  close()
  emit('usePrompt', text)
}
defineExpose({ open, back })
</script>

<template>
  <Teleport to="body">
    <dialog
      v-if="tutorialOpen"
      ref="dialog"
      class="frontend-workbench__tutorial-dialog mobile-dialog-viewport"
      aria-labelledby="fw-tutorial-title"
      @cancel.prevent="back()"
    >
      <div class="fw-reference-header">
        <FeatureAppHeader
          layout="panel"
          title="效果参考库"
          title-id="fw-tutorial-title"
          back-label="关闭效果参考库"
          @back="close"
        />
      </div>
      <div ref="scrollArea" class="fw-reference-scroll">
        <nav class="fw-reference-tabs" aria-label="参考类型">
          <button type="button" :aria-pressed="tab === 'effects'" @click="setTab('effects')">
            动效演示</button
          ><button type="button" :aria-pressed="tab === 'styles'" @click="setTab('styles')">
            视觉风格
          </button>
          <button type="button" :aria-pressed="tab === 'sites'" @click="setTab('sites')">
            动效网站
          </button>
          <button type="button" :aria-pressed="tab === 'templates'" @click="setTab('templates')">
            模板提示词
          </button>
        </nav>
        <FrontendWorkshopReferenceResources
          v-if="tab === 'sites' || tab === 'templates'"
          :mode="tab"
          :can-use-ai="canUseAi"
          @use-prompt="useTemplatePrompt"
        />
        <div v-else class="fw-reference-layout" :class="{ 'has-detail': detailOpen }">
          <aside class="fw-reference-directory">
            <label class="fw-reference-search"
              ><span>搜索效果</span
              ><input v-model="search" type="search" placeholder="例如：伪3D、翻页、光影"
            /></label>
            <label v-if="tab === 'effects'" class="fw-reference-category"
              ><span>动效类型</span
              ><select v-model="category">
                <option value="">全部类型</option>
                <option v-for="(label, key) in workshopEffectCategories" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
            <nav aria-label="效果目录">
              <button
                v-for="item in filteredItems"
                :key="item.id"
                type="button"
                :aria-pressed="selectedEntry.id === item.id"
                @click="selectItem(item.id)"
              >
                <span>{{ item.name }}</span
                ><small>{{ item.en }}</small>
              </button>
            </nav>
            <p v-if="!filteredItems.length" class="fw-reference-empty">
              没找到这个效果，试试其他描述。
            </p>
          </aside>
          <article class="fw-reference-detail">
            <button type="button" class="fw-reference-back" @click="showDirectory">
              ‹ 返回效果目录
            </button>
            <div class="fw-reference-heading">
              <div>
                <h2>{{ selectedEntry.name }}</h2>
                <small>{{ selectedEntry.en }}</small>
              </div>
              <button type="button" :aria-pressed="inPrompt()" @click="togglePromptItem">
                {{ inPrompt() ? '移出描述' : '加入描述' }}
              </button>
            </div>
            <FrontendWorkshopEffectPreview
              v-if="tab === 'effects'"
              :key="effectId"
              :effect="currentEffect"
            />
            <FrontendWorkshopStylePreview v-else :key="styleId" :style-entry="currentStyle" />
            <p class="fw-reference-description">{{ selectedEntry.desc }}</p>
            <p class="fw-reference-uses">{{ selectedEntry.use }}</p>
            <details class="fw-reference-wording">
              <summary>这种效果怎么描述</summary>
              <p>{{ selectedEntry.prompt }}</p>
            </details>
            <details v-if="reference" class="fw-reference-reading">
              <summary>了解实现原理</summary>
              <a :href="reference.url" target="_blank" rel="noopener noreferrer">{{
                reference.label
              }}</a>
              <p>这里是独立演示；手机操作、减少动态效果及实际酒馆环境仍需在成品中确认。</p>
            </details>
          </article>
        </div>
        <section
          v-if="hasPrompt && (tab === 'effects' || tab === 'styles')"
          class="fw-reference-prompt"
          aria-label="组合描述"
        >
          <h3>给 AI 的组合描述</h3>
          <div class="fw-reference-chosen">
            <button
              v-if="chosenStyle"
              type="button"
              :aria-label="`移除风格${chosenStyle.name}`"
              @click="chosenStyleId = ''"
            >
              {{ chosenStyle.name }} ×</button
            ><button
              v-for="effect in chosenEffects"
              :key="effect.id"
              type="button"
              :aria-label="`移除动效${effect.name}`"
              @click="chosenEffectIds = chosenEffectIds.filter((id) => id !== effect.id)"
            >
              {{ effect.name }} ×
            </button>
          </div>
          <p>演示分别展示效果，组合后由 AI 根据你的作品安排位置。</p>
          <details>
            <summary>查看完整描述</summary>
            <p class="fw-reference-prompt-text">{{ prompt }}</p>
          </details>
          <div class="fw-reference-actions">
            <button type="button" @click="copyPrompt">复制描述</button
            ><button v-if="canUseAi" type="button" class="is-primary" @click="usePrompt">
              带入肘肘更健康</button
            ><small>{{
              canUseAi ? '只预填，不自动发送' : '创建或打开作品后，可将描述交给 AI'
            }}</small>
          </div>
          <p role="status">{{ status }}</p>
          <textarea
            v-if="fallbackCopy"
            ref="copyArea"
            :value="prompt"
            readonly
            aria-label="手动复制组合描述"
          />
        </section>
        <details class="fw-reference-help">
          <summary>少量操作帮助</summary>
          <p>
            选中画布元素后可手动修改或让 AI
            修改；长按拖动用于移动画布视野。图层隐藏、锁定和单独查看只影响编辑，不改变导出。
          </p>
          <p>
            复杂组件可以直接让 AI
            提取并整理样式、脚本，再预览确认保存。用到酒馆接口或配套脚本的功能，需要在真实酒馆中验证。
          </p>
        </details>
      </div>
    </dialog>
  </Teleport>
</template>

<style src="../styles/FrontendWorkshopTutorial.css"></style>
