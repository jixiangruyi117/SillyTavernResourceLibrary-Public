<script setup lang="ts">
import '../styles/AiTagging.css'
import { toRef } from 'vue'

import {
  useAiTaggingPanel,
  type AiTaggingPanelProps,
  type AiTaggingPanelEvents,
} from '../composables/UseAiTaggingPanel'
const props = defineProps<AiTaggingPanelProps>()
const emit = defineEmits<AiTaggingPanelEvents>()
const controller = useAiTaggingPanel(props, emit)
const {
  requestClose,
  stage,
  restoredAt,
  undoRecord,
  draftTime,
  discardDraft,
  undoTagCount,
  undoing,
  undoLastApplication,
  filteredResources,
  candidatePage,
  candidatePageCount,
  pageCandidates,
  searchQuery,
  typeFilter,
  resourceTypes,
  categoryFilter,
  tagState,
  tagQuery,
  toggleFilteredSelection,
  allFilteredSelected,
  clearSelection,
  selectedIds,
  customPrompt,
  batchSize,
  concurrency,
  AI_TAGGING_MAX_CONCURRENCY,
  batchSizeError,
  AI_TAGGING_RESOURCE_CHAR_BUDGET,
  openReviewResource,
  ruleTemplates,
  ruleTemplateName,
  selectedRuleTemplateId,
  applyRuleTemplate,
  saveRuleTemplate,
  deleteRuleTemplate,
  taxonomyTemplateId,
  AI_TAGGING_TAXONOMY_TEMPLATES,
  activeTaxonomyTemplate,
  mergeAliases,
  apiSource,
  activeProfile,
  apiDetailsOpen,
  temporaryProtocol,
  temporaryModel,
  temporaryUrl,
  temporaryApiKey,
  toggleResource,
  RESOURCE_TYPE_LABELS,
  progressPercent,
  progressBatchCount,
  message,
  progressCompleted,
  progressTotal,
  stopRequested,
  requestStop,
  setAllAccepted,
  reviewItems,
  reviewPage,
  reviewPageSize,
  reviewPageCount,
  pageReviewItems,
  removeTag,
  addDraftTag,
  failures,
  retryableResourceIds,
  retryFailures,
  resourceName,
  usageText,
  startRecognition,
  applying,
  backToSelection,
  acceptedItems,
  applyReviewedTags,
  acceptedTagCount,
  systemPromptText,
  isSystemPromptCustom,
  systemPromptError,
  resetSystemPrompt,
  AI_TAGGING_MAX_SYSTEM_PROMPT,
  progressResourceNames,
  selectedApiSummary,
  activeFilterCount,
} = controller
const profiles = toRef(controller, 'profiles')

function selectRuleTemplate(event: Event): void {
  const target = event.target
  if (target instanceof HTMLSelectElement) applyRuleTemplate(target.value)
}
</script>

<template>
  <section
    class="ai-tagging mobile-dialog-viewport"
    :class="{ 'is-suspended': suspended }"
    :inert="suspended"
    :aria-hidden="suspended || undefined"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ai-tagging-title"
  >
    <header class="ai-tagging__header">
      <div>
        <h2 id="ai-tagging-title">AI 标签实验台</h2>
        <p>选好范围与规则，审核后写入 · 支持撤销</p>
      </div>
      <button
        class="ai-tagging__close"
        type="button"
        aria-label="关闭 AI 标签实验台"
        @click="requestClose"
      >
        ×
      </button>
    </header>

    <nav class="ai-tagging__steps" aria-label="AI 标签处理步骤">
      <span
        :class="{ 'is-active': stage === 'select' }"
        :aria-current="stage === 'select' ? 'step' : undefined"
        ><b>1</b> 选择与规则</span
      >
      <span
        :class="{ 'is-active': stage === 'running' }"
        :aria-current="stage === 'running' ? 'step' : undefined"
        ><b>2</b> 分批识别</span
      >
      <span
        :class="{ 'is-active': stage === 'review' }"
        :aria-current="stage === 'review' ? 'step' : undefined"
        ><b>3</b> 人工审核</span
      >
    </nav>

    <div
      class="ai-tagging__notices"
      :class="{ 'ai-tagging__notices--empty': !restoredAt && !undoRecord }"
      aria-live="polite"
    >
      <aside v-if="restoredAt" class="ai-tagging__notice">
        <p>
          <strong>已恢复本机草稿</strong><small>{{ draftTime(restoredAt) }} · 不含 API Key</small>
        </p>
        <button type="button" @click="discardDraft">放弃草稿</button>
      </aside>
      <aside v-if="undoRecord" class="ai-tagging__notice ai-tagging__notice--undo">
        <p>
          <strong>可撤销上次注入</strong
          ><small>{{ undoRecord.additions.length }} 项资源 · {{ undoTagCount }} 个新增标签</small>
        </p>
        <button type="button" :disabled="undoing" @click="undoLastApplication">
          {{ undoing ? '正在撤销' : '撤销上次 AI 注入' }}
        </button>
      </aside>
    </div>

    <main class="ai-tagging__body" :class="`ai-tagging__body--${stage}`">
      <template v-if="stage === 'select'">
        <aside class="ai-tagging__control-panel">
          <section class="ai-tagging__block">
            <div class="ai-tagging__block-heading">
              <div>
                <h3>识别规则</h3>
              </div>
            </div>
            <label class="ai-tagging__field ai-tagging__field--wide">
              <span>自定义提示词</span>
              <textarea
                v-model="customPrompt"
                aria-label="自定义提示词"
                maxlength="4000"
                rows="3"
              ></textarea>
              <small>{{ customPrompt.length }} / 4000</small>
            </label>
            <details class="ai-tagging__disclosure">
              <summary>
                本机规则模板 <span>{{ ruleTemplates.length }} 个已保存</span>
              </summary>
              <div class="ai-tagging__rule-templates">
                <label class="ai-tagging__field">
                  <span>已保存标签规范</span>
                  <select v-model="selectedRuleTemplateId" @change="selectRuleTemplate">
                    <option value="">选择本机模板</option>
                    <option
                      v-for="template in ruleTemplates"
                      :key="template.id"
                      :value="template.id"
                    >
                      {{ template.name }}
                    </option>
                  </select>
                </label>
                <label class="ai-tagging__field">
                  <span>规范名称</span>
                  <input
                    v-model="ruleTemplateName"
                    type="text"
                    maxlength="80"
                    placeholder="如：古风剧情卡"
                  />
                </label>
                <div class="ai-tagging__template-actions">
                  <button type="button" @click="saveRuleTemplate">保存当前规范</button>
                  <button v-if="selectedRuleTemplateId" type="button" @click="deleteRuleTemplate">
                    删除模板
                  </button>
                </div>
                <small
                  >保存补充要求、系统提示词与标签规范选项；只在本机保存，不包含 API 或密钥。</small
                >
              </div>
            </details>
            <details class="ai-tagging__disclosure ai-tagging__advanced">
              <summary>
                高级：系统提示词 <span>{{ isSystemPromptCustom ? '已自定义' : '内置默认' }}</span>
              </summary>
              <div class="ai-tagging__advanced-content">
                <p>
                  这是实际发送给 AI
                  的完整系统消息。修改会替换内置提示词；上方自定义提示词仍作为用户补充要求发送。
                </p>
                <label class="ai-tagging__field">
                  <span>系统提示词</span>
                  <textarea
                    v-model="systemPromptText"
                    aria-label="系统提示词"
                    :maxlength="AI_TAGGING_MAX_SYSTEM_PROMPT"
                    :aria-invalid="Boolean(systemPromptError)"
                    aria-describedby="ai-tagging-system-hint"
                    rows="12"
                    spellcheck="false"
                  ></textarea>
                </label>
                <div class="ai-tagging__prompt-actions">
                  <small
                    >{{ systemPromptText.length.toLocaleString() }} /
                    {{ AI_TAGGING_MAX_SYSTEM_PROMPT.toLocaleString() }}</small
                  >
                  <button
                    type="button"
                    :disabled="!isSystemPromptCustom"
                    @click="resetSystemPrompt"
                  >
                    恢复默认
                  </button>
                </div>
                <p id="ai-tagging-system-hint">
                  {{
                    isSystemPromptCustom
                      ? '自定义后切换标签规范不会改写这段文本；恢复默认会按当前规范重新生成。'
                      : '默认提示词随下方标签规范更新。修改会随本机草稿保存，也可存入规则模板。'
                  }}
                </p>
                <p v-if="systemPromptError" class="ai-tagging__validation" role="alert">
                  {{ systemPromptError }}
                </p>
                <details class="ai-tagging__output-format">
                  <summary>查看 AI 返回格式</summary>
                  <p>
                    每个资源返回原 resourceId；没有可靠建议时 tags 为 []。保留以下 JSON
                    结构，才能进入审核：
                  </p>
                  <pre>
{
  "resources": [{
    "resourceId": "原资源ID",
    "tags": [{
      "name": "古风",
      "evidence": "故事发生在古代",
      "level": "明确证据"
    }]
  }]
}</pre>
                  <p>
                    证据等级使用“明确证据”或“合理推断”。本地最多保留每项 12 个 AI 建议，标签限 40
                    字符；修改提示词不会改变这些限制。返回格式不符会提示失败，不会直接写入资源。
                  </p>
                </details>
              </div>
            </details>
            <details class="ai-tagging__disclosure ai-tagging__rule-options">
              <summary>
                标签规范与批次
                <span>{{ activeTaxonomyTemplate.name }} · {{ batchSize }} 项/批</span>
              </summary>
              <label class="ai-tagging__field ai-tagging__field--batch">
                <span>每批资源数</span>
                <input
                  v-model.number="batchSize"
                  type="number"
                  min="1"
                  step="1"
                  aria-label="每批资源数"
                  :aria-invalid="Boolean(batchSizeError)"
                />
                <small>建议 3–5 项，不设数量上限；按次计费可调大，实际最多取本次选中数量。</small>
                <small
                  >每项发送内容摘录，最多
                  {{ AI_TAGGING_RESOURCE_CHAR_BUDGET.toLocaleString() }}
                  字符，不是完整文件；增大批次不会缩减每项摘录。上下文与输出容量取决于所选模型，过大时可调小后重试。</small
                >
                <small v-if="batchSizeError" role="alert">{{ batchSizeError }}</small>
              </label>
              <label class="ai-tagging__field ai-tagging__field--batch">
                <span>同时请求数</span>
                <select v-model.number="concurrency" aria-label="同时请求数">
                  <option v-for="count in AI_TAGGING_MAX_CONCURRENCY" :key="count" :value="count">
                    {{ count }}
                  </option>
                </select>
                <small>默认同时处理两批；服务商限制并发时可调为 1。每批内容和请求总数不变。</small>
              </label>
              <div class="ai-tagging__taxonomy">
                <label class="ai-tagging__field ai-tagging__field--wide">
                  <span>标签规范模板</span>
                  <select v-model="taxonomyTemplateId">
                    <option
                      v-for="template in AI_TAGGING_TAXONOMY_TEMPLATES"
                      :key="template.id"
                      :value="template.id"
                    >
                      {{ template.name }}
                    </option>
                  </select>
                  <small>{{ activeTaxonomyTemplate.description }}</small>
                </label>
                <label class="ai-tagging__alias-toggle">
                  <input
                    v-model="mergeAliases"
                    type="checkbox"
                    :disabled="!Object.keys(activeTaxonomyTemplate.aliases).length"
                  />
                  <span
                    ><strong>合并模板别名</strong
                    ><small
                      >把本次建议里的同义词统一成模板写法，例如“百合”→“GL”；不会改写已有标签。</small
                    ></span
                  >
                </label>
              </div>
            </details>
          </section>

          <section class="ai-tagging__block ai-tagging__api-config">
            <label class="ai-tagging__field ai-tagging__field--wide">
              <span>API 配置</span>
              <select v-model="apiSource" aria-label="API 配置">
                <option value="active">主 API · {{ activeProfile?.name || '当前启用配置' }}</option>
                <option
                  v-for="profile in profiles"
                  :key="profile.id"
                  :value="`profile:${profile.id}`"
                >
                  已保存 · {{ profile.name }}
                </option>
                <option value="temporary">临时独立 API（仅本次）</option>
              </select>
            </label>
            <p class="ai-tagging__api-summary">{{ selectedApiSummary }}</p>
            <template v-if="apiSource === 'temporary'">
              <button
                class="ai-tagging__details-toggle"
                type="button"
                :aria-expanded="apiDetailsOpen"
                @click="apiDetailsOpen = !apiDetailsOpen"
              >
                {{ apiDetailsOpen ? '收起临时 API 参数' : '填写临时 API 参数' }}
              </button>
              <div v-if="apiDetailsOpen" class="ai-tagging__filter-grid">
                <label class="ai-tagging__field"
                  ><span>协议</span
                  ><select v-model="temporaryProtocol">
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="anthropic-compatible">Anthropic 兼容</option>
                  </select></label
                >
                <label class="ai-tagging__field"
                  ><span>模型</span
                  ><input v-model="temporaryModel" type="text" placeholder="留空继承主 API 模型"
                /></label>
                <label class="ai-tagging__field ai-tagging__field--wide"
                  ><span>API 地址</span
                  ><input v-model="temporaryUrl" type="url" placeholder="留空继承主 API 地址"
                /></label>
                <label class="ai-tagging__field ai-tagging__field--wide"
                  ><span>API Key</span
                  ><input
                    v-model="temporaryApiKey"
                    type="password"
                    autocomplete="off"
                    placeholder="更换地址时不会继承主 API Key"
                /></label>
              </div>
              <p class="ai-tagging__privacy-note">
                临时参数只存在于当前面板；若填写新地址但 Key 留空，系统不会把主 API Key
                发送到新地址。
              </p>
            </template>
          </section>
        </aside>

        <section class="ai-tagging__candidate-panel" aria-label="候选资源">
          <header>
            <div>
              <h3>待识别资源</h3>
            </div>
            <span>{{ selectedIds.size }} 已选</span>
          </header>
          <section class="ai-tagging__filters">
            <div class="ai-tagging__block-heading">
              <div>
                <h3>筛选范围</h3>
              </div>
              <strong>{{ filteredResources.length }} 项</strong>
            </div>
            <label class="ai-tagging__field ai-tagging__field--wide">
              <span>搜索</span>
              <input v-model="searchQuery" type="search" placeholder="名称、文件名、描述或标签" />
            </label>
            <details class="ai-tagging__disclosure ai-tagging__filter-options">
              <summary>
                分类、文件夹与标签筛选
                <span v-if="activeFilterCount">已设 {{ activeFilterCount }} 项</span>
              </summary>
              <div class="ai-tagging__filter-grid">
                <label class="ai-tagging__field">
                  <span>资源分类</span>
                  <select v-model="typeFilter">
                    <option value="all">全部分类</option>
                    <option v-for="item in resourceTypes" :key="item.type" :value="item.type">
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <label class="ai-tagging__field">
                  <span>文件夹</span>
                  <select v-model="categoryFilter">
                    <option value="all">全部文件夹</option>
                    <option value="uncategorized">未放入文件夹</option>
                    <option v-for="category in categories" :key="category.id" :value="category.id">
                      {{ category.name }}
                    </option>
                  </select>
                </label>
                <label class="ai-tagging__field">
                  <span>标签状态</span>
                  <select v-model="tagState" aria-label="标签状态">
                    <option value="all">不限</option>
                    <option value="untagged">尚无标签</option>
                    <option value="tagged">已有标签</option>
                  </select>
                </label>
                <label class="ai-tagging__field">
                  <span>已有标签包含</span>
                  <input v-model="tagQuery" type="text" maxlength="40" placeholder="例如 古风" />
                </label>
              </div>
            </details>
            <div class="ai-tagging__scope-actions">
              <button type="button" @click="toggleFilteredSelection">
                {{
                  allFilteredSelected ? '取消当前筛选' : `选择当前筛选 ${filteredResources.length}`
                }}
              </button>
              <button type="button" @click="clearSelection">清空选择</button>
              <span>已选 {{ selectedIds.size }} 项</span>
            </div>
          </section>
          <div class="ai-tagging__candidate-list">
            <label
              v-for="resource in pageCandidates"
              :key="resource.id"
              class="ai-tagging__candidate"
              :class="{ 'is-selected': selectedIds.has(resource.id) }"
            >
              <input
                type="checkbox"
                :checked="selectedIds.has(resource.id)"
                @change="toggleResource(resource.id)"
              />
              <span class="ai-tagging__candidate-index">{{
                RESOURCE_TYPE_LABELS[resource.type].slice(0, 1)
              }}</span>
              <span class="ai-tagging__candidate-copy"
                ><strong>{{ resource.name }}</strong
                ><small
                  >{{ RESOURCE_TYPE_LABELS[resource.type] }} ·
                  {{ resource.tags.length ? `${resource.tags.length} 个标签` : '尚无标签' }}</small
                ></span
              >
              <span v-if="resource.tags.length" class="ai-tagging__candidate-tags">{{
                resource.tags.slice(0, 3).join(' · ')
              }}</span>
            </label>
            <p v-if="!filteredResources.length" class="ai-tagging__empty">
              当前筛选条件下没有资源。
            </p>
          </div>
          <nav
            v-if="candidatePageCount > 1"
            class="ai-tagging__pagination"
            aria-label="待识别资源分页"
          >
            <button type="button" :disabled="candidatePage <= 1" @click="candidatePage--">
              上一页
            </button>
            <span>{{ candidatePage }} / {{ candidatePageCount }} 页</span>
            <button
              type="button"
              :disabled="candidatePage >= candidatePageCount"
              @click="candidatePage++"
            >
              下一页
            </button>
          </nav>
        </section>
      </template>

      <section v-else-if="stage === 'running'" class="ai-tagging__running" aria-live="polite">
        <div class="ai-tagging__run-card">
          <header>
            <div>
              <span class="ai-tagging__status">{{ stopRequested ? '正在停止' : '识别中' }}</span>
              <h3>{{ stopRequested ? '正在取消当前请求' : '正在读取内容线索' }}</h3>
            </div>
            <strong class="ai-tagging__percentage">{{ progressPercent }}<small>%</small></strong>
          </header>
          <p>{{ message }}</p>
          <progress
            class="ai-tagging__progress"
            :value="progressCompleted"
            :max="progressTotal || 1"
            aria-label="资源识别进度"
          ></progress>
          <div class="ai-tagging__run-counts">
            <span>共 {{ progressBatchCount }} 批 · 同时请求 {{ concurrency }} 批</span
            ><strong>{{ progressCompleted }} / {{ progressTotal }} 项已处理</strong>
          </div>
          <div class="ai-tagging__run-resources">
            <h4>当前批次</h4>
            <ul v-if="progressResourceNames.length">
              <li v-for="(name, index) in progressResourceNames.slice(0, 8)" :key="index">
                <span>{{ index + 1 }}</span
                >{{ name }}
              </li>
            </ul>
            <p v-if="progressResourceNames.length > 8">
              另有 {{ progressResourceNames.length - 8 }} 项正在识别。
            </p>
            <p v-if="!progressResourceNames.length">正在准备资源内容…</p>
          </div>
          <div v-if="reviewItems.length" class="ai-tagging__run-resources">
            <h4>已得到 {{ reviewItems.length }} 项建议，最近完成：</h4>
            <ul>
              <li v-for="item in reviewItems.slice(-4)" :key="item.resourceId">
                <span>{{ item.resource.name }}</span
                >{{ item.tags.map((tag) => tag.name).join('、') || '暂无新标签' }}
              </li>
            </ul>
          </div>
          <p class="ai-tagging__api-summary">{{ selectedApiSummary }}</p>
          <div class="ai-tagging__run-bottom">
            <small>停止后可审核已完成结果，标签尚未写入。</small
            ><button type="button" :disabled="stopRequested" @click="requestStop">
              {{ stopRequested ? '正在停止…' : '停止识别' }}
            </button>
          </div>
        </div>
      </section>

      <section v-else class="ai-tagging__review">
        <header class="ai-tagging__review-header">
          <div>
            <h3>审核 AI 建议</h3>
            <p>{{ reviewItems.length }} 项结果 · 删除不准确标签或手动补充，只有勾选项会写入。</p>
          </div>
          <div class="ai-tagging__review-actions">
            <button type="button" @click="setAllAccepted(true)">全选</button
            ><button type="button" @click="setAllAccepted(false)">全不选</button>
          </div>
        </header>
        <div class="ai-tagging__review-list">
          <article
            v-for="(item, index) in pageReviewItems"
            :key="item.resourceId"
            class="ai-tagging__review-card"
            :class="{ 'is-rejected': !item.accepted }"
          >
            <header>
              <label
                ><input
                  v-model="item.accepted"
                  type="checkbox"
                  :aria-label="`接受 ${item.resource.name} 的标签`"
                /><span>{{
                  String((reviewPage - 1) * reviewPageSize + index + 1).padStart(2, '0')
                }}</span></label
              >
              <div>
                <strong>{{ item.resource.name }}</strong
                ><small>{{ RESOURCE_TYPE_LABELS[item.resource.type] }}</small>
                <button
                  class="ai-tagging__detail-link"
                  type="button"
                  :aria-label="`查看资源详情：${item.resource.name}`"
                  @click="openReviewResource(item, $event)"
                >
                  查看资源详情 <span aria-hidden="true">↗</span>
                </button>
              </div>
              <span class="ai-tagging__review-state">{{
                !item.accepted
                  ? '已跳过'
                  : item.tags.length
                    ? `${item.tags.length} 个待写入`
                    : '无建议'
              }}</span>
            </header>
            <div v-if="item.resource.tags.length" class="ai-tagging__existing-tags">
              <small>已有</small><span v-for="tag in item.resource.tags" :key="tag">{{ tag }}</span>
            </div>
            <div class="ai-tagging__suggested-tags">
              <small>AI 建议</small>
              <article
                v-for="tag in item.tags"
                :key="tag.name"
                class="ai-tagging__tag-evidence"
                :class="`is-${tag.level}`"
              >
                <header>
                  <strong>{{ tag.name }}</strong>
                  <span>{{ tag.level === 'explicit' ? '明确证据' : '合理推断' }}</span>
                  <button
                    type="button"
                    :aria-label="`删除建议标签 ${tag.name}`"
                    @click="removeTag(item, tag)"
                  >
                    ×
                  </button>
                </header>
                <p>{{ tag.evidence || 'AI 未提供具体依据，建议谨慎审核。' }}</p>
              </article>
              <span v-if="!item.tags.length">暂无可靠建议</span>
            </div>
            <form class="ai-tagging__add-tag" @submit.prevent="addDraftTag(item)">
              <input
                v-model="item.draftTag"
                type="text"
                maxlength="40"
                placeholder="手动补充标签"
              /><button type="submit" :disabled="!item.draftTag.trim()">添加</button>
            </form>
          </article>
          <p v-if="!reviewItems.length" class="ai-tagging__empty">没有可审核的结果。</p>
        </div>
        <nav v-if="reviewPageCount > 1" class="ai-tagging__pagination" aria-label="标签建议分页">
          <button type="button" :disabled="reviewPage <= 1" @click="reviewPage--">上一页</button>
          <span>第 {{ reviewPage }} / {{ reviewPageCount }} 页</span>
          <button type="button" :disabled="reviewPage >= reviewPageCount" @click="reviewPage++">
            下一页
          </button>
        </nav>
      </section>
    </main>

    <aside v-if="failures.length" class="ai-tagging__errors" aria-label="识别错误">
      <header>
        <div>
          <strong>部分批次需要处理</strong>
          <small>成功结果和审核修改均已保留</small>
        </div>
        <button
          v-if="retryableResourceIds.length && stage !== 'running'"
          type="button"
          :disabled="Boolean(batchSizeError || systemPromptError)"
          @click="retryFailures"
        >
          仅重试失败项 {{ retryableResourceIds.length }}
        </button>
      </header>
      <article v-for="failure in failures" :key="`${failure.batch}-${failure.message}`">
        <p>{{ failure.message }}</p>
        <ul>
          <li v-for="resourceId in failure.resourceIds" :key="resourceId">
            {{ resourceName(resourceId) }}
          </li>
        </ul>
        <small v-if="!failure.retryable">资源已不存在，不能重试。</small>
      </article>
    </aside>

    <footer v-if="stage !== 'running'" class="ai-tagging__footer">
      <p>
        <strong>{{
          systemPromptError || batchSizeError || message || '资源内容只会发送到你选择的 API。'
        }}</strong
        ><small v-if="usageText">{{ usageText }}</small>
      </p>
      <div v-if="stage === 'select'">
        <button type="button" @click="requestClose">取消</button
        ><button
          class="is-primary"
          type="button"
          :disabled="!selectedIds.size || Boolean(systemPromptError || batchSizeError)"
          @click="startRecognition"
        >
          开始识别 {{ selectedIds.size || '' }}
        </button>
      </div>
      <div v-else-if="stage === 'review'">
        <button type="button" :disabled="applying" @click="backToSelection">返回调整</button
        ><button
          class="is-primary"
          type="button"
          :disabled="applying || !acceptedItems.length"
          @click="applyReviewedTags"
        >
          {{
            applying ? '正在写入' : `注入 ${acceptedItems.length} 项 / ${acceptedTagCount} 个标签`
          }}
        </button>
      </div>
    </footer>
  </section>
</template>
