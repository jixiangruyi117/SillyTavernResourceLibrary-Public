<script setup lang="ts">
import BeautificationPreview from './BeautificationPreview.vue'
import WorldBookBrowser from './WorldBookBrowser.vue'
import GreetingResourceDetails from './GreetingResourceDetails.vue'
import GreetingPreviewDialog from './GreetingPreviewDialog.vue'
import RichContentPreview from './RichContentPreview.vue'
import UserPersonaResourceDetails from './UserPersonaResourceDetails.vue'
import StructuredResourceContentWorkbench from './StructuredResourceContentWorkbench.vue'
import { computed, ref } from 'vue'
import type { Resource } from '../types/Resource'
import {
  useStructuredResourceDetails,
  type StructuredResourceDetailsProps,
} from '../composables/UseStructuredResourceDetails'
const props = defineProps<StructuredResourceDetailsProps>()
const emit = defineEmits<{
  saved: [resource: Resource]
  'draft-change': [dirty: boolean]
  'workbench-open': [open: boolean]
  busy: [busy: boolean]
}>()
const contentWorkbench = ref<{ prepareSave?: () => Promise<boolean> }>()
const controller = useStructuredResourceDetails(props)
const {
  rawContent,
  RESOURCE_TYPE,
  presetPage,
  recordCountLabel,
  rawError,
  worldEntries,
  selectedRegexScript,
  closeRegexScript,
  selectedRegexStatus,
  regexEffectLabel,
  previewPolicy,
  hasBlockedRegexPreviewContent,
  regexQuery,
  REGEX_FILTERS,
  regexFilter,
  pagedRegexScripts,
  selectRegexScript,
  regexPage,
  REGEX_PAGE_SIZE,
  regexScripts,
  filteredRegexScripts,
  changeRegexPage,
  regexPageLabel,
  regexPageCount,
  presetPrompts,
  samplerValues,
  openPresetPage,
  presetTemplates,
  helperScripts,
  helperScriptLocation,
  helperScriptExport,
  hasPresetContent,
  selectedPresetPrompt,
  closePresetPage,
  presetPromptQuery,
  pagedPresetPrompts,
  selectPresetPrompt,
  presetPromptPage,
  PRESET_PROMPT_PAGE_SIZE,
  filteredPresetPrompts,
  changePresetPromptPage,
  presetPromptPageCount,
  standaloneGreetings,
  openGreetingPreview,
  quickReplies,
  scriptText,
  genericValues,
  greetingPreviewIndex,
  greetingPreviewItems,
  handleGreetingPreviewClose,
} = controller
const editable = computed(
  () =>
    props.resource.type === RESOURCE_TYPE.WORLD_BOOK || props.resource.type === RESOURCE_TYPE.REGEX,
)
defineExpose({ prepareSave: async () => (await contentWorkbench.value?.prepareSave?.()) ?? true })
</script>

<template>
  <GreetingResourceDetails v-if="resource.type === RESOURCE_TYPE.GREETING" :resource="resource" />
  <BeautificationPreview
    v-else-if="resource.type === RESOURCE_TYPE.BEAUTIFICATION"
    :resource="resource"
  />
  <UserPersonaResourceDetails
    v-else-if="resource.type === RESOURCE_TYPE.USER_PERSONA"
    :resource="resource"
    :related-resources="relatedResources"
    @saved="emit('saved', $event)"
  />

  <component
    :is="editable ? StructuredResourceContentWorkbench : 'div'"
    v-else-if="resource.type !== RESOURCE_TYPE.CHARACTER_CARD"
    :key="`${resource.id}:${resource.contentHash}`"
    ref="contentWorkbench"
    :resource="editable ? resource : undefined"
    :content="editable ? rawContent : undefined"
    :disabled="editable ? disabled : undefined"
    @saved="emit('saved', $event)"
    @draft-change="emit('draft-change', $event)"
    @workbench-open="emit('workbench-open', $event)"
    @busy="emit('busy', $event)"
  >
    <section
      ref="structuredRoot"
      :class="
        resource.type === RESOURCE_TYPE.WORLD_BOOK ? 'structured-world-book' : 'structured-record'
      "
      :aria-labelledby="
        resource.type === RESOURCE_TYPE.WORLD_BOOK ? undefined : 'structured-record-title'
      "
      :aria-label="resource.type === RESOURCE_TYPE.WORLD_BOOK ? '世界书内容' : undefined"
    >
      <header v-if="resource.type !== RESOURCE_TYPE.WORLD_BOOK" class="structured-record__header">
        <div>
          <p>{{ resource.type === RESOURCE_TYPE.PRESET ? 'PRESET DOSSIER' : 'PARSED CONTENT' }}</p>
          <h3 id="structured-record-title">
            {{
              resource.type === RESOURCE_TYPE.PRESET && presetPage === 'regex'
                ? '配套预设正则'
                : resource.type === RESOURCE_TYPE.PRESET && presetPage === 'prompts'
                  ? '提示词目录'
                  : resource.type === RESOURCE_TYPE.PRESET
                    ? '预设档案'
                    : '内容解析'
            }}
          </h3>
        </div>
        <span v-if="recordCountLabel">{{ recordCountLabel }}</span>
      </header>

      <p v-if="rawError" class="structured-record__empty">{{ rawError }}</p>

      <WorldBookBrowser
        v-else-if="resource.type === RESOURCE_TYPE.WORLD_BOOK"
        :key="resource.id"
        :entries="worldEntries"
      />

      <div v-else-if="resource.type === RESOURCE_TYPE.REGEX" class="regex-browser">
        <article v-if="selectedRegexScript" class="regex-browser__detail regex-flow">
          <header class="regex-browser__detail-header">
            <button type="button" class="world-browser__back" @click="closeRegexScript">
              <span aria-hidden="true">←</span>
              返回正则目录
            </button>
            <small>{{ selectedRegexStatus }}</small>
          </header>
          <div class="regex-browser__title">
            <small>REGEX RULE · {{ regexEffectLabel(selectedRegexScript.effect) }}</small>
            <h4>{{ selectedRegexScript.name }}</h4>
            <div>
              <span v-for="placement in selectedRegexScript.placements" :key="placement">
                {{ placement }}
              </span>
            </div>
          </div>
          <div class="regex-effect" :class="`regex-effect--${selectedRegexScript.effect.kind}`">
            <section>
              <small>匹配示例</small>
              <code>{{ selectedRegexScript.effect.before }}</code>
            </section>
            <i aria-hidden="true">→</i>
            <section>
              <small>最终效果</small>
              <code>{{ selectedRegexScript.effect.after }}</code>
            </section>
          </div>
          <p class="regex-effect__explanation">{{ selectedRegexScript.effect.explanation }}</p>

          <section v-if="selectedRegexScript.previewDocument" class="regex-rendered-preview">
            <header>
              <div>
                <small>{{
                  previewPolicy.allowScripts ? 'ISOLATED RUNTIME' : 'STATIC RENDER'
                }}</small>
                <strong>{{
                  previewPolicy.allowScripts ? 'HTML / CSS 隔离运行效果' : 'HTML / CSS 静态效果'
                }}</strong>
              </div>
              <span>{{
                previewPolicy.allowScripts
                  ? '隔离脚本已允许'
                  : previewPolicy.allowRemoteResources
                    ? '联网内容已允许'
                    : '脚本与联网内容已阻止'
              }}</span>
            </header>
            <iframe
              :key="`${selectedRegexScript.id}-${selectedRegexScript.replace.length}-${previewPolicy.allowRemoteResources}-${previewPolicy.allowScripts}`"
              :srcdoc="selectedRegexScript.previewDocument"
              :sandbox="previewPolicy.allowScripts ? 'allow-scripts' : ''"
              loading="lazy"
              :title="`${selectedRegexScript.name} 的隔离替换效果`"
            ></iframe>
            <p v-if="hasBlockedRegexPreviewContent(selectedRegexScript.effect)">
              {{
                previewPolicy.allowScripts
                  ? '脚本与远程资源已在无同源权限的隔离预览中启用；原文件不受影响。'
                  : previewPolicy.allowRemoteResources
                    ? '远程图片与字体已允许，脚本仍被阻止；原文件不受影响。'
                    : '脚本与远程资源已阻止；可在设置中统一调整预览权限，原文件不受影响。'
              }}
            </p>
          </section>

          <div
            v-else-if="selectedRegexScript.effect.kind === 'dynamic'"
            class="regex-dynamic-notice"
          >
            <strong>此替换依赖动态脚本</strong>
            <p>为避免执行未知代码或联网请求，资源库不会生成运行预览；可在下方检查原始代码。</p>
          </div>

          <details v-if="selectedRegexScript.find" class="regex-raw-rule">
            <summary>查看原始正则与替换代码</summary>
            <div class="regex-flow__pipeline">
              <section>
                <small>查找 FIND</small>
                <code>{{ selectedRegexScript.find }}</code>
              </section>
              <i aria-hidden="true">→</i>
              <section>
                <small>替换 REPLACE</small>
                <code>{{ selectedRegexScript.replace || '空内容（删除匹配项）' }}</code>
              </section>
            </div>
          </details>
        </article>

        <template v-else>
          <div class="world-browser__tools">
            <label>
              <span>搜索正则</span>
              <input v-model="regexQuery" type="search" placeholder="名称、作用位置或规则内容" />
            </label>
            <div class="world-browser__filters" aria-label="筛选正则规则">
              <button
                v-for="filter in REGEX_FILTERS"
                :key="filter.id"
                type="button"
                :class="{ 'is-active': regexFilter === filter.id }"
                :aria-pressed="regexFilter === filter.id"
                @click="regexFilter = filter.id"
              >
                {{ filter.label }}
              </button>
            </div>
          </div>

          <ol v-if="pagedRegexScripts.length" class="world-browser__list regex-browser__list">
            <li v-for="(script, index) in pagedRegexScripts" :key="script.id">
              <button type="button" @click="selectRegexScript(script)">
                <i>{{ String((regexPage - 1) * REGEX_PAGE_SIZE + index + 1).padStart(2, '0') }}</i>
                <span>
                  <strong>{{ script.name }}</strong>
                  <small>
                    {{ script.scope }} ·
                    {{ script.placements.slice(0, 2).join('、') || '未指定位置' }}
                  </small>
                </span>
                <em :class="{ 'is-disabled': script.disabled }">
                  {{ script.disabled ? '停用' : regexEffectLabel(script.effect) }}
                </em>
                <b aria-hidden="true">›</b>
              </button>
            </li>
          </ol>
          <p v-else class="structured-record__empty">
            {{
              regexScripts.length ? '没有符合搜索或筛选条件的正则。' : '没有读取到正则替换逻辑。'
            }}
          </p>

          <nav
            v-if="filteredRegexScripts.length > REGEX_PAGE_SIZE"
            class="world-browser__pagination"
          >
            <button type="button" :disabled="regexPage <= 1" @click="changeRegexPage(-1)">
              上一页
            </button>
            <span>{{ regexPageLabel }}</span>
            <button
              type="button"
              :disabled="regexPage >= regexPageCount"
              @click="changeRegexPage(1)"
            >
              下一页
            </button>
          </nav>
        </template>
      </div>

      <div v-else-if="resource.type === RESOURCE_TYPE.PRESET" class="preset-dossier">
        <template v-if="presetPage === 'overview'">
          <header class="preset-dossier__identity">
            <div>
              <small>GENERATION PRESET</small>
              <h4>{{ resource.name }}</h4>
            </div>
            <div class="preset-dossier__stats">
              <span v-if="presetPrompts.length">{{ presetPrompts.length }} 段提示词</span>
              <span v-if="regexScripts.length">{{ regexScripts.length }} 条正则</span>
              <span v-if="samplerValues.length">{{ samplerValues.length }} 项参数</span>
            </div>
          </header>

          <nav class="preset-dossier__entries" aria-label="预设内容目录">
            <button v-if="presetPrompts.length" type="button" @click="openPresetPage('prompts')">
              <small>PROMPT LIBRARY</small>
              <strong>提示词目录</strong>
              <span>{{ presetPrompts.length }} 段提示词 · 分页查看内容</span>
              <i aria-hidden="true">→</i>
            </button>
            <button v-if="regexScripts.length" type="button" @click="openPresetPage('regex')">
              <small>REGEX RULES</small>
              <strong>配套预设正则</strong>
              <span>{{ regexScripts.length }} 条规则 · 查看替换逻辑与 CSS 效果</span>
              <i aria-hidden="true">→</i>
            </button>
          </nav>

          <details v-if="samplerValues.length" class="preset-dossier__section">
            <summary>
              <strong>采样参数</strong><small>{{ samplerValues.length }} 项</small>
            </summary>
            <dl class="preset-samplers">
              <div v-for="item in samplerValues" :key="item.label">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </details>
          <details v-if="presetTemplates.length" class="preset-dossier__section">
            <summary>
              <strong>提示词模板</strong><small>{{ presetTemplates.length }} 项</small>
            </summary>
            <div class="preset-templates">
              <details v-for="item in presetTemplates" :key="item.label">
                <summary>{{ item.label }}</summary>
                <pre>{{ item.value }}</pre>
              </details>
            </div>
          </details>
          <details v-if="helperScripts.length" class="preset-dossier__section">
            <summary>
              <strong>酒馆助手脚本</strong><small>{{ helperScripts.length }} 个</small>
            </summary>
            <div class="helper-script-list">
              <p class="helper-script-list__warning">
                资源库只做静态解析，不执行代码；导入前请确认来源可信。
              </p>
              <details v-for="script in helperScripts" :key="script.id">
                <summary>
                  <span
                    ><strong>{{ script.name }}</strong
                    ><small>{{ helperScriptLocation(script) }}</small></span
                  >
                  <i>{{ script.buttons.length }} 个按钮</i>
                </summary>
                <div class="helper-script-list__body">
                  <p v-if="script.info">{{ script.info }}</p>
                  <div class="helper-script-list__facts">
                    <span v-if="script.buttons.length">按钮 · {{ script.buttons.join('、') }}</span>
                    <span v-if="script.dataCount">私有数据 · {{ script.dataCount }} 项</span>
                    <span>{{ helperScriptExport(script, '预设') }}</span>
                  </div>
                  <pre>{{ script.content || '此脚本没有代码内容。' }}</pre>
                </div>
              </details>
            </div>
          </details>
          <p v-if="!hasPresetContent" class="structured-record__empty">
            预设已识别，但没有找到常见采样参数或提示词字段。
          </p>
        </template>

        <section v-else-if="presetPage === 'prompts'" class="preset-subpage">
          <article v-if="selectedPresetPrompt" class="preset-subpage__detail">
            <button type="button" class="world-browser__back" @click="closePresetPage">
              <span aria-hidden="true">←</span>返回提示词目录
            </button>
            <header>
              <small>PROMPT · {{ selectedPresetPrompt.role }}</small>
              <h4>{{ selectedPresetPrompt.name }}</h4>
              <span>{{ selectedPresetPrompt.enabled ? '已启用' : '已停用' }}</span>
            </header>
            <pre>{{ selectedPresetPrompt.content || '此提示词没有正文。' }}</pre>
          </article>
          <template v-else>
            <header class="preset-subpage__header">
              <button type="button" class="world-browser__back" @click="closePresetPage">
                <span aria-hidden="true">←</span>返回预设档案
              </button>
              <span>{{ presetPrompts.length }} 段提示词</span>
            </header>
            <div class="world-browser__tools">
              <label>
                <span>搜索提示词</span>
                <input v-model="presetPromptQuery" type="search" placeholder="名称、角色或正文" />
              </label>
            </div>
            <ol class="world-browser__list preset-prompt-directory">
              <li v-for="(prompt, index) in pagedPresetPrompts" :key="prompt.id">
                <button type="button" @click="selectPresetPrompt(prompt.id)">
                  <i>{{
                    String((presetPromptPage - 1) * PRESET_PROMPT_PAGE_SIZE + index + 1).padStart(
                      2,
                      '0',
                    )
                  }}</i>
                  <span
                    ><strong>{{ prompt.name }}</strong
                    ><small>{{ prompt.role }}</small></span
                  >
                  <em :class="{ 'is-disabled': !prompt.enabled }">{{
                    prompt.enabled ? '启用' : '停用'
                  }}</em>
                  <b aria-hidden="true">›</b>
                </button>
              </li>
            </ol>
            <p v-if="!pagedPresetPrompts.length" class="structured-record__empty">
              没有匹配的提示词。
            </p>
            <nav
              v-if="filteredPresetPrompts.length > PRESET_PROMPT_PAGE_SIZE"
              class="world-browser__pagination"
            >
              <button
                type="button"
                :disabled="presetPromptPage <= 1"
                @click="changePresetPromptPage(-1)"
              >
                上一页
              </button>
              <span>第 {{ presetPromptPage }} / {{ presetPromptPageCount }} 页</span>
              <button
                type="button"
                :disabled="presetPromptPage >= presetPromptPageCount"
                @click="changePresetPromptPage(1)"
              >
                下一页
              </button>
            </nav>
          </template>
        </section>

        <section v-else class="preset-subpage regex-browser">
          <article v-if="selectedRegexScript" class="regex-browser__detail regex-flow">
            <header class="regex-browser__detail-header">
              <button type="button" class="world-browser__back" @click="closePresetPage">
                <span aria-hidden="true">←</span>返回正则目录
              </button>
              <small>{{ selectedRegexStatus }}</small>
            </header>
            <div class="regex-browser__title">
              <small>PRESET REGEX · {{ regexEffectLabel(selectedRegexScript.effect) }}</small>
              <h4>{{ selectedRegexScript.name }}</h4>
              <div>
                <span v-for="placement in selectedRegexScript.placements" :key="placement">{{
                  placement
                }}</span>
              </div>
            </div>
            <div class="regex-effect" :class="`regex-effect--${selectedRegexScript.effect.kind}`">
              <section>
                <small>匹配示例</small><code>{{ selectedRegexScript.effect.before }}</code>
              </section>
              <i aria-hidden="true">→</i>
              <section>
                <small>最终效果</small><code>{{ selectedRegexScript.effect.after }}</code>
              </section>
            </div>
            <p class="regex-effect__explanation">{{ selectedRegexScript.effect.explanation }}</p>
            <section v-if="selectedRegexScript.previewDocument" class="regex-rendered-preview">
              <header>
                <div>
                  <small>{{
                    previewPolicy.allowScripts ? 'ISOLATED RUNTIME' : 'STATIC RENDER'
                  }}</small>
                  <strong>{{
                    previewPolicy.allowScripts ? 'HTML / CSS 隔离运行效果' : 'HTML / CSS 静态效果'
                  }}</strong>
                </div>
                <span>{{
                  previewPolicy.allowScripts
                    ? '隔离脚本已允许'
                    : previewPolicy.allowRemoteResources
                      ? '联网内容已允许'
                      : '脚本与联网内容已阻止'
                }}</span>
              </header>
              <iframe
                :key="`preset-${selectedRegexScript.id}-${previewPolicy.allowRemoteResources}-${previewPolicy.allowScripts}`"
                :srcdoc="selectedRegexScript.previewDocument"
                :sandbox="previewPolicy.allowScripts ? 'allow-scripts' : ''"
                loading="lazy"
                :title="`${selectedRegexScript.name} 的替换效果`"
              ></iframe>
            </section>
            <div
              v-else-if="selectedRegexScript.effect.kind === 'dynamic'"
              class="regex-dynamic-notice"
            >
              <strong>此替换依赖动态脚本</strong>
              <p>资源库不会执行未知脚本；原代码仍完整保留。</p>
            </div>
            <details class="regex-raw-rule">
              <summary>查看原始正则与替换代码</summary>
              <div class="regex-flow__pipeline">
                <section>
                  <small>查找 FIND</small
                  ><code>{{ selectedRegexScript.find || '未提供查找表达式' }}</code>
                </section>
                <i aria-hidden="true">→</i>
                <section>
                  <small>替换 REPLACE</small
                  ><code>{{ selectedRegexScript.replace || '空内容（删除匹配项）' }}</code>
                </section>
              </div>
            </details>
          </article>
          <template v-else>
            <header class="preset-subpage__header">
              <button type="button" class="world-browser__back" @click="closePresetPage">
                <span aria-hidden="true">←</span>返回预设档案
              </button>
              <span>{{ regexScripts.length }} 条规则</span>
            </header>
            <div class="world-browser__tools">
              <label
                ><span>搜索正则</span
                ><input v-model="regexQuery" type="search" placeholder="名称、位置或规则内容"
              /></label>
              <div class="world-browser__filters" aria-label="筛选预设正则">
                <button
                  v-for="filter in REGEX_FILTERS"
                  :key="filter.id"
                  type="button"
                  :class="{ 'is-active': regexFilter === filter.id }"
                  @click="regexFilter = filter.id"
                >
                  {{ filter.label }}
                </button>
              </div>
            </div>
            <ol v-if="pagedRegexScripts.length" class="world-browser__list regex-browser__list">
              <li v-for="(script, index) in pagedRegexScripts" :key="script.id">
                <button type="button" @click="selectRegexScript(script)">
                  <i>{{
                    String((regexPage - 1) * REGEX_PAGE_SIZE + index + 1).padStart(2, '0')
                  }}</i>
                  <span
                    ><strong>{{ script.name }}</strong
                    ><small>{{
                      script.placements.slice(0, 2).join('、') || '未指定位置'
                    }}</small></span
                  >
                  <em :class="{ 'is-disabled': script.disabled }">{{
                    script.disabled ? '停用' : regexEffectLabel(script.effect)
                  }}</em>
                  <b aria-hidden="true">›</b>
                </button>
              </li>
            </ol>
            <p v-else class="structured-record__empty">没有符合搜索或筛选条件的正则。</p>
            <nav
              v-if="filteredRegexScripts.length > REGEX_PAGE_SIZE"
              class="world-browser__pagination"
            >
              <button type="button" :disabled="regexPage <= 1" @click="changeRegexPage(-1)">
                上一页
              </button>
              <span>{{ regexPageLabel }}</span>
              <button
                type="button"
                :disabled="regexPage >= regexPageCount"
                @click="changeRegexPage(1)"
              >
                下一页
              </button>
            </nav>
          </template>
        </section>
      </div>

      <div v-else-if="standaloneGreetings.length" class="standalone-greeting-list">
        <article
          v-for="(item, index) in standaloneGreetings"
          :key="item.id"
          @dblclick="openGreetingPreview(index, $event)"
        >
          <header>
            <span>
              <small>{{
                [item.group, item.theme].filter(Boolean).join(' · ') || 'OPENING MESSAGE'
              }}</small>
              <strong>{{ item.label }}</strong>
            </span>
            <button type="button" @click.stop="openGreetingPreview(index, $event)" @touchend.stop>
              展开阅读
              <span aria-hidden="true">↗</span>
            </button>
          </header>
          <p v-if="item.description" class="standalone-greeting-list__description">
            {{ item.description }}
          </p>
          <RichContentPreview :source="item.message" :title="item.label" />
        </article>
      </div>

      <div v-else-if="resource.type === RESOURCE_TYPE.QUICK_REPLY" class="quick-reply-list">
        <article v-for="item in quickReplies" :key="item.id">
          <header>
            <strong>{{ item.label }}</strong>
            <small>{{ item.enabled ? '启用' : '停用' }}</small>
          </header>
          <RichContentPreview
            :source="item.message"
            :title="item.label"
            empty-text="没有回复内容。"
          />
        </article>
      </div>

      <div
        v-else-if="resource.type === RESOURCE_TYPE.SCRIPT && helperScripts.length"
        class="helper-script-list"
      >
        <p class="helper-script-list__warning">
          酒馆助手脚本可以运行 JavaScript。资源库只做静态解析，不执行代码；导入前请确认来源可信。
        </p>
        <details
          v-for="script in helperScripts"
          :key="script.id"
          :open="helperScripts.length === 1"
        >
          <summary>
            <span>
              <strong>{{ script.name }}</strong>
              <small>{{ helperScriptLocation(script) }}</small>
            </span>
            <i>{{ script.buttons.length }} 个按钮</i>
          </summary>
          <div class="helper-script-list__body">
            <p v-if="script.info">{{ script.info }}</p>
            <div class="helper-script-list__facts">
              <span v-if="script.buttons.length">按钮 · {{ script.buttons.join('、') }}</span>
              <span v-if="script.dataCount">私有数据 · {{ script.dataCount }} 项</span>
              <span>{{ helperScriptExport(script, '资源') }}</span>
            </div>
            <pre>{{ script.content || '此脚本没有代码内容。' }}</pre>
          </div>
        </details>
      </div>

      <div v-else-if="resource.type === RESOURCE_TYPE.SCRIPT && scriptText" class="script-proof">
        <p>仅以文本方式查看，不会在资源库中执行脚本。</p>
        <pre>{{ scriptText }}</pre>
      </div>

      <dl v-else-if="genericValues.length" class="structured-facts">
        <div v-for="item in genericValues" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>

      <p v-else class="structured-record__empty">当前文件没有可结构化展示的字段。</p>
    </section>
  </component>

  <GreetingPreviewDialog
    v-model="greetingPreviewIndex"
    :items="greetingPreviewItems"
    context-title="开场白档案"
    @close="handleGreetingPreviewClose"
  />
</template>
