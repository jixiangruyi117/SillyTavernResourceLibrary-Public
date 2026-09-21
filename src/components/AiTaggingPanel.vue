<script setup lang="ts">
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
  AI_TAGGING_MAX_SELECTION,
  customPrompt,
  batchSize,
  AI_TAGGING_MAX_BATCH_SIZE,
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
  progressBatch,
  progressBatchCount,
  message,
  progressCompleted,
  progressTotal,
  stopRequested,
  requestStop,
  setAllAccepted,
  reviewItems,
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
} = controller
const profiles = toRef(controller, 'profiles')
</script>

<template>
  <section
    class="ai-tagging mobile-dialog-viewport"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ai-tagging-title"
  >
    <header class="ai-tagging__header">
      <div>
        <h2 id="ai-tagging-title">AI 标签实验台</h2>
        <p>小批识别，逐项审核，确认后才写入本地资源。</p>
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
      <span :class="{ 'is-active': stage === 'select' }"><b>01</b> 选择与规则</span>
      <span :class="{ 'is-active': stage === 'running' }"><b>02</b> 分批识别</span>
      <span :class="{ 'is-active': stage === 'review' }"><b>03</b> 人工审核</span>
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

    <main class="ai-tagging__body">
      <template v-if="stage === 'select'">
        <aside class="ai-tagging__control-panel">
          <section class="ai-tagging__block">
            <div class="ai-tagging__block-heading">
              <div>
                <small>SCOPE</small>
                <h3>筛选范围</h3>
              </div>
              <strong>{{ filteredResources.length }} 项</strong>
            </div>
            <label class="ai-tagging__field ai-tagging__field--wide">
              <span>搜索</span>
              <input v-model="searchQuery" type="search" placeholder="名称、文件名、描述或标签" />
            </label>
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
                <select v-model="tagState">
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
            <div class="ai-tagging__scope-actions">
              <button type="button" @click="toggleFilteredSelection">
                {{
                  allFilteredSelected ? '取消当前筛选' : `选择当前筛选 ${filteredResources.length}`
                }}
              </button>
              <button type="button" @click="clearSelection">清空选择</button>
              <span>已选 {{ selectedIds.size }} / {{ AI_TAGGING_MAX_SELECTION }}</span>
            </div>
          </section>

          <section class="ai-tagging__block">
            <div class="ai-tagging__block-heading">
              <div>
                <small>INSTRUCTION</small>
                <h3>识别规则</h3>
              </div>
            </div>
            <label class="ai-tagging__field ai-tagging__field--wide">
              <span>自定义提示词</span>
              <textarea v-model="customPrompt" maxlength="4000" rows="5"></textarea>
              <small>{{ customPrompt.length }} / 4000</small>
            </label>
            <label class="ai-tagging__field ai-tagging__field--batch">
              <span>每批资源数</span>
              <input
                v-model.number="batchSize"
                type="number"
                min="1"
                :max="AI_TAGGING_MAX_BATCH_SIZE"
              />
              <small
                >允许 1–{{ AI_TAGGING_MAX_BATCH_SIZE }}；建议 3–5，系统还会限制单批上下文。</small
              >
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
                  ><small>只规范本次 AI 建议，不改写已有标签；自由标签仍会保留。</small></span
                >
              </label>
            </div>
          </section>

          <section class="ai-tagging__block">
            <div class="ai-tagging__block-heading">
              <div>
                <small>MODEL ROUTE</small>
                <h3>API 来源</h3>
              </div>
            </div>
            <label class="ai-tagging__field ai-tagging__field--wide">
              <span>调用配置</span>
              <select v-model="apiSource">
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
              <small>QUEUE</small>
              <h3>待识别资源</h3>
            </div>
            <span>{{ selectedIds.size }} 已选</span>
          </header>
          <div class="ai-tagging__candidate-list">
            <label
              v-for="resource in filteredResources"
              :key="resource.id"
              class="ai-tagging__candidate"
              :class="{ 'is-selected': selectedIds.has(resource.id) }"
            >
              <input
                type="checkbox"
                :checked="selectedIds.has(resource.id)"
                :disabled="
                  !selectedIds.has(resource.id) && selectedIds.size >= AI_TAGGING_MAX_SELECTION
                "
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
        </section>
      </template>

      <section v-else-if="stage === 'running'" class="ai-tagging__running" aria-live="polite">
        <div class="ai-tagging__radar" aria-hidden="true">
          <span>{{ progressPercent }}%</span>
        </div>
        <small>BATCH {{ progressBatch || 1 }} / {{ progressBatchCount }}</small>
        <h3>正在分批辨认内容线索</h3>
        <p>{{ message }}</p>
        <div class="ai-tagging__progress"><i :style="{ width: `${progressPercent}%` }"></i></div>
        <strong>{{ progressCompleted }} / {{ progressTotal }} 项完成</strong>
        <button type="button" :disabled="stopRequested" @click="requestStop">
          {{ stopRequested ? '正在取消当前请求' : '停止识别' }}
        </button>
      </section>

      <section v-else class="ai-tagging__review">
        <header class="ai-tagging__review-header">
          <div>
            <small>HUMAN CHECKPOINT</small>
            <h3>审核 AI 建议</h3>
            <p>删除不准确标签，也可以手动补充；只有勾选项会写入。</p>
          </div>
          <div class="ai-tagging__review-actions">
            <button type="button" @click="setAllAccepted(true)">全选</button
            ><button type="button" @click="setAllAccepted(false)">全不选</button>
          </div>
        </header>
        <div class="ai-tagging__review-list">
          <article
            v-for="item in reviewItems"
            :key="item.resourceId"
            class="ai-tagging__review-card"
            :class="{ 'is-rejected': !item.accepted }"
          >
            <header>
              <label><input v-model="item.accepted" type="checkbox" /><span>接受此项</span></label>
              <div>
                <strong>{{ item.resource.name }}</strong
                ><small>{{ RESOURCE_TYPE_LABELS[item.resource.type] }}</small>
              </div>
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
      </section>
    </main>

    <aside v-if="failures.length" class="ai-tagging__errors" aria-label="识别错误">
      <header>
        <div>
          <strong>部分批次需要处理</strong>
          <small>成功结果和审核修改均已保留</small>
        </div>
        <button
          v-if="retryableResourceIds.length && stage === 'review'"
          type="button"
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

    <footer class="ai-tagging__footer">
      <p>
        <strong>{{ message || '资源内容只会发送到你选择的 API。' }}</strong
        ><small v-if="usageText">{{ usageText }}</small>
      </p>
      <div v-if="stage === 'select'">
        <button type="button" @click="requestClose">取消</button
        ><button
          class="is-primary"
          type="button"
          :disabled="!selectedIds.size"
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
