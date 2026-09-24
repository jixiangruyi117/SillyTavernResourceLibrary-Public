<script setup lang="ts">
import PresetWorkbenchTools from './PresetWorkbenchTools.vue'
import PresetSourcePane from './PresetSourcePane.vue'
import PresetCandidateSheet from './PresetCandidateSheet.vue'
import PresetStitchEditorPortal from './PresetStitchEditorPortal.vue'
import { proxyRefs } from 'vue'
import FeatureAppHeader from './FeatureAppHeader.vue'
import {
  usePresetStitcherApp,
  type PresetStitcherAppProps,
  type PresetStitcherAppEvents,
} from '../composables/UsePresetStitcherApp'
const props = defineProps<PresetStitcherAppProps>()
const emit = defineEmits<PresetStitcherAppEvents>()
const controller = usePresetStitcherApp(props, emit)
const panelModel = proxyRefs(controller)
const {
  setEditorTextarea,
  fullWorkspaceActive,
  step,
  requestBack,
  readingMode,
  toggleReadingMode,
  mainSide,
  toggleMainSide,
  baseSummary,
  errorMessage,
  notice,
  pendingDraft,
  draftBaseName,
  busy,
  restoreDraft,
  discardDraft,
  presetSearch,
  presetPageItems,
  chooseBase,
  presetSegmentCount,
  formatDate,
  presetPageCount,
  presetPage,
  setPage,
  sourceDrag,
  singleColumn,
  sourceDrawerOpen,
  toggleSingleColumn,
  startSourceDrag,
  guardDragTouch,
  sourcePickerOpen,
  toggleExpanded,
  editor,
  editorOverlayStyle,
  mobileEditorOverlay,
  ROLE_OPTIONS,
  rememberEditorSelection,
  QUICK_VARIABLES,
  insertVariable,
  openVariableWriter,
  unreadWrittenVariables,
  insertUnreadWrittenVariable,
  saveEdit,
  cancelEdit,
  getPromptDisplayTokens,
  copyEntryContent,
  favorites,
  candidateSheetOpen,
  candidates,
  candidateCharacterCount,
  targetFiltersOpen,
  activeTargetFilterCount,
  showEnabledOnly,
  showModifiedOnly,
  showVariableReadsOnly,
  showVariableWritesOnly,
  targetPage,
  targetPageItems,
  insertionIndex,
  selectInsertionIndex,
  getEntryChangeKind,
  expandedTargetKeys,
  beginTargetEdit,
  moveEntry,
  assembly,
  removePickByKey,
  targetPageCount,
  canUndo,
  undoWorkbench,
  canRedo,
  redoWorkbench,
  saveCheckpoint,
  checkpoint,
  restoreCheckpoint,
  blockingPromptIssues,
  reviewItems,
  openReview,
  reviewGroups,
  reviewAddedLines,
  reviewRemovedLines,
  reviewAddedMacros,
  reviewRemovedMacros,
  reviewVariableReads,
  reviewVariableWrites,
  productName,
  baseIsStitched,
  saveAsVersion,
  versionNote,
  generate,
  successName,
  resetAll,
  variableWriterOpen,
  variableName,
  variableValue,
  insertVariableWrite,
  chooseFavoriteSource,
  sourcePresetPageItems,
  chooseSource,
  sourcePresetPageCount,
} = controller
</script>

<template>
  <section
    class="stitch"
    :class="{ 'is-reading': fullWorkspaceActive, 'is-workbench': step === 'workbench' }"
    aria-label="缝了么预设工作台"
  >
    <FeatureAppHeader title="缝了么" back-label="返回功能桌面" @back="requestBack">
      <template #actions>
        <button
          v-if="step === 'workbench'"
          type="button"
          class="feature-header-action feature-header-action--icon stitch__header-action"
          :aria-label="readingMode ? '退出全屏工作区' : '进入全屏工作区'"
          :aria-pressed="readingMode"
          :title="readingMode ? '退出全屏工作区' : '全屏工作区：保留全部操作'"
          @click="toggleReadingMode"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />
          </svg>
        </button>
        <button
          v-if="step === 'workbench'"
          type="button"
          class="feature-header-action feature-header-action--icon stitch__header-action"
          :aria-label="`将主预设调到${mainSide === 'right' ? '左侧' : '右侧'}`"
          :title="`主预设调到${mainSide === 'right' ? '左侧' : '右侧'}`"
          @click="toggleMainSide"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h12l-3-3m3 3-3 3M20 17H8l3 3m-3-3 3-3" />
          </svg>
        </button>
      </template>
    </FeatureAppHeader>

    <div v-if="baseSummary && step !== 'done' && !fullWorkspaceActive" class="stitch__contextbar">
      <span>当前主预设</span>
      <strong :title="baseSummary.name">{{ baseSummary.name }}</strong>
    </div>

    <div v-if="fullWorkspaceActive" class="stitch__focus-toolbar">
      <button
        v-if="readingMode"
        type="button"
        class="button button--quiet stitch__focus-exit"
        aria-label="退出全屏工作区"
        @click="toggleReadingMode"
      >
        退出
      </button>
      <button
        type="button"
        class="button button--quiet stitch__focus-swap"
        :aria-label="`将主预设调到${mainSide === 'right' ? '左侧' : '右侧'}`"
        @click="toggleMainSide"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h12l-3-3m3 3-3 3M20 17H8l3 3m-3-3 3-3" />
        </svg>
      </button>
    </div>

    <p v-if="errorMessage" class="stitch__error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="notice" class="stitch__notice" role="status">{{ notice }}</p>

    <template v-if="step === 'base'">
      <div class="stitch-entry-layout">
        <div class="stitch-entry-layout__controls">
          <div v-if="pendingDraft" class="stitch__draft">
            <span>
              <strong>发现自动草稿</strong>
              <small>{{ draftBaseName ? `主预设「${draftBaseName}」` : '上次未完成的工作' }}</small>
            </span>
            <div>
              <button
                type="button"
                class="button button--primary"
                :disabled="busy"
                @click="restoreDraft()"
              >
                继续缝
              </button>
              <button
                class="button button--quiet"
                type="button"
                :disabled="busy"
                @click="discardDraft"
              >
                放弃
              </button>
            </div>
          </div>
          <div class="stitch__intro">
            <span>01</span>
            <div>
              <strong>选择主预设</strong>
              <p>采样参数、未知字段和整体结构以它为准；编辑只发生在工作副本。</p>
            </div>
          </div>
          <label class="stitch__search">
            <span aria-hidden="true">⌕</span>
            <input v-model="presetSearch" type="search" placeholder="搜索主预设" />
          </label>
        </div>
        <section class="stitch-entry-layout__presets" aria-labelledby="stitch-entry-presets-title">
          <header>
            <strong id="stitch-entry-presets-title">已有预设</strong>
            <small>选择后进入双预设工作台</small>
          </header>
          <ul v-if="presetPageItems.length" class="stitch__preset-list">
            <li v-for="resource in presetPageItems" :key="resource.id">
              <button type="button" :disabled="busy" @click="chooseBase(resource)">
                <span>
                  <strong>{{ resource.name }}</strong>
                  <em v-if="Array.isArray(resource.metadata.stitchedFrom)">我的自缝版</em>
                  <em v-else>原始预设</em>
                </span>
                <small
                  >{{ presetSegmentCount(resource) }} 条 ·
                  {{ formatDate(resource.updatedAt) }}</small
                >
              </button>
            </li>
          </ul>
          <p v-else class="stitch__empty">
            {{ presetSearch ? '没有匹配的预设' : '资源库里还没有预设。' }}
          </p>
          <nav v-if="presetPageCount > 1" class="stitch-pagination" aria-label="主预设列表分页">
            <button
              class="button button--quiet"
              type="button"
              aria-label="上一页"
              :disabled="presetPage === 1"
              @click="setPage('preset', presetPage - 1)"
            >
              ←
            </button>
            <span>{{ presetPage }} / {{ presetPageCount }}</span>
            <button
              class="button button--quiet"
              type="button"
              aria-label="下一页"
              :disabled="presetPage === presetPageCount"
              @click="setPage('preset', presetPage + 1)"
            >
              →
            </button>
          </nav>
        </section>
      </div>
    </template>

    <template v-else-if="step === 'workbench'">
      <div
        class="stitch-workbench"
        :class="{
          'is-main-left': mainSide === 'left',
          'is-dragging': sourceDrag?.picked,
          'is-single-column': singleColumn,
        }"
      >
        <button
          v-if="singleColumn"
          type="button"
          class="button button--quiet stitch-source-toggle"
          :aria-label="sourceDrawerOpen ? '收起填充预设' : '展开填充预设'"
          :aria-expanded="sourceDrawerOpen"
          aria-controls="stitch-source-drawer"
          @click="sourceDrawerOpen = !sourceDrawerOpen"
        >
          {{ sourceDrawerOpen ? '›' : '‹' }}
        </button>
        <PresetSourcePane
          v-show="!singleColumn || sourceDrawerOpen"
          id="stitch-source-drawer"
          :model="panelModel"
          :class="{ 'is-source-drawer': singleColumn }"
        />

        <section
          class="stitch-pane stitch-pane--target"
          aria-label="主预设"
          @touchmove="guardDragTouch"
        >
          <header class="stitch-pane__header">
            <span class="stitch-pane__preset-name" :title="baseSummary?.name">
              <strong>{{ baseSummary?.name }}</strong
              ><small class="stitch-pane__kind">（主）</small>
            </span>
          </header>
          <section class="stitch-pane__filter-disclosure">
            <button
              type="button"
              class="button button--quiet stitch-pane__filter-toggle"
              aria-label="条目筛选"
              :aria-expanded="targetFiltersOpen"
              aria-controls="stitch-target-filters"
              @click="targetFiltersOpen = !targetFiltersOpen"
            >
              <span>筛选</span>
              <small v-if="activeTargetFilterCount">已启用 {{ activeTargetFilterCount }} 项</small>
              <span class="stitch-pane__filter-chevron" aria-hidden="true">{{
                targetFiltersOpen ? '⌃' : '⌄'
              }}</span>
            </button>
            <button
              type="button"
              class="button button--quiet stitch-pane__candidates"
              :aria-label="`将入 ${candidates.length} · +${candidateCharacterCount}`"
              @click="candidateSheetOpen = true"
            >
              候选 {{ candidates.length }}
            </button>
            <div
              v-show="targetFiltersOpen"
              id="stitch-target-filters"
              class="stitch-pane__filters"
              role="group"
              aria-label="主预设显示筛选"
            >
              <label><input v-model="showEnabledOnly" type="checkbox" />只显示启用条目</label>
              <label><input v-model="showModifiedOnly" type="checkbox" />只显示本次修改条目</label>
              <label><input v-model="showVariableReadsOnly" type="checkbox" />只显示读取变量</label>
              <label
                ><input v-model="showVariableWritesOnly" type="checkbox" />只显示写入变量</label
              >
            </div>
          </section>
          <ol class="stitch-target-list">
            <li
              v-if="targetPageItems.length"
              class="stitch-insertion"
              :class="{
                'is-active': insertionIndex === targetPageItems[0].index,
                'is-drag-over':
                  sourceDrag?.picked &&
                  sourceDrag.overDropSlot &&
                  sourceDrag.targetIndex === targetPageItems[0].index,
              }"
              :data-insertion-index="targetPageItems[0].index"
            >
              <button type="button" @click="selectInsertionIndex(targetPageItems[0].index)">
                {{ insertionIndex === targetPageItems[0].index ? '插入位置' : '插到此页之前' }}
              </button>
            </li>
            <template v-for="{ entry, index: actualIndex } in targetPageItems" :key="entry.key">
              <li
                class="stitch-entry stitch-entry--target"
                :data-entry-index="actualIndex"
                :class="{
                  'is-marker': entry.marker,
                  'is-disabled': !entry.enabled,
                  'is-editing': editor?.scope === 'target' && editor.key === entry.key,
                  'is-inserted': getEntryChangeKind(entry) === 'inserted',
                  'is-modified': getEntryChangeKind(entry) === 'modified',
                }"
              >
                <div class="stitch-entry__summary">
                  <button
                    type="button"
                    class="stitch-entry__reorder"
                    aria-label="长按拖动条目排序"
                    title="长按拖动；也可展开条目使用上移、下移"
                    @pointerdown="startSourceDrag('target', entry.key, $event)"
                    @contextmenu.prevent
                  >
                    ⠿
                  </button>
                  <button
                    type="button"
                    class="stitch-entry__copy"
                    :aria-expanded="expandedTargetKeys.has(entry.key)"
                    @click="toggleExpanded('target', entry.key)"
                  >
                    <strong :title="entry.name">{{ entry.name }}</strong>
                    <small>
                      <span
                        v-if="getEntryChangeKind(entry)"
                        class="stitch-entry__change-badge"
                        :class="`is-${getEntryChangeKind(entry)}`"
                        >{{ getEntryChangeKind(entry) === 'inserted' ? '新增' : '修改' }}</span
                      >
                      {{ entry.origin === 'base' ? '' : `${entry.sourceName} · ` }}
                      {{ entry.marker ? '结构项' : `${entry.charCount} 字` }}
                    </small>
                  </button>
                  <label class="stitch-entry__toggle"
                    ><input
                      v-model="entry.enabled"
                      type="checkbox"
                      :aria-label="`${entry.name}：启用`"
                    /><span>{{ entry.enabled ? '启用' : '停用' }}</span></label
                  >
                </div>
                <div v-if="expandedTargetKeys.has(entry.key)" class="stitch-entry__detail">
                  <template v-if="editor?.scope === 'target' && editor.key === entry.key">
                    <PresetStitchEditorPortal :active="mobileEditorOverlay">
                      <div class="stitch-editor" :style="editorOverlayStyle">
                        <label
                          >名称<input v-model="editor.name" type="text" maxlength="160"
                        /></label>
                        <label
                          >角色<select v-model="editor.role">
                            <option
                              v-for="role in ROLE_OPTIONS"
                              :key="role.value"
                              :value="role.value"
                            >
                              {{ role.label }}
                            </option>
                          </select></label
                        >
                        <label
                          >正文<textarea
                            :ref="setEditorTextarea"
                            v-model="editor.content"
                            rows="8"
                            @click="rememberEditorSelection"
                            @focus="rememberEditorSelection"
                            @input="rememberEditorSelection"
                            @keyup="rememberEditorSelection"
                            @select="rememberEditorSelection"
                          ></textarea>
                        </label>
                        <div class="stitch-editor__macros">
                          <button
                            v-for="item in QUICK_VARIABLES"
                            :key="item.value"
                            class="button button--quiet"
                            type="button"
                            @click="insertVariable(item.value, item.placeholder, $event)"
                          >
                            {{ item.label }}
                          </button>
                          <button
                            class="button button--quiet"
                            type="button"
                            @click="openVariableWriter"
                          >
                            写入聊天变量
                          </button>
                          <select
                            v-if="unreadWrittenVariables.length"
                            aria-label="读取尚未使用的已写变量"
                            @change="insertUnreadWrittenVariable"
                          >
                            <option value="">读取未使用的已写变量</option>
                            <option
                              v-for="variable in unreadWrittenVariables"
                              :key="`${variable.scope}:${variable.name}`"
                              :value="`${variable.scope}:${variable.name}`"
                            >
                              {{ variable.label }}
                            </option>
                          </select>
                        </div>
                        <div class="stitch-editor__actions">
                          <button type="button" class="button button--primary" @click="saveEdit">
                            保存修改</button
                          ><button class="button button--quiet" type="button" @click="cancelEdit">
                            取消
                          </button>
                        </div>
                      </div>
                    </PresetStitchEditorPortal>
                  </template>
                  <template v-else>
                    <!-- eslint-disable-next-line vue/no-v-html -- 高亮函数先转义正文，仅插入固定 span。 -->
                    <pre v-if="entry.content" class="stitch-entry__content"><span
                      v-for="(token, tokenIndex) in getPromptDisplayTokens(entry.content)"
                      :key="`${tokenIndex}:${token.text}`"
                      :class="token.kind === 'plain' ? undefined : ['stitch-macro', `stitch-macro--${token.kind}`]"
                    >{{ token.text }}</span></pre>
                    <pre v-else>（结构项没有正文）</pre>
                    <div class="stitch-entry__actions">
                      <button
                        v-if="!entry.marker"
                        class="button button--quiet"
                        type="button"
                        @click="beginTargetEdit(entry)"
                      >
                        编辑
                      </button>
                      <button
                        class="button button--quiet"
                        type="button"
                        :disabled="!entry.content"
                        @click="copyEntryContent(entry.content)"
                      >
                        复制
                      </button>
                      <button
                        class="button button--quiet"
                        type="button"
                        :disabled="actualIndex === 0"
                        @click="moveEntry(actualIndex, -1)"
                      >
                        上移
                      </button>
                      <button
                        class="button button--quiet"
                        type="button"
                        :disabled="actualIndex === assembly.length - 1"
                        @click="moveEntry(actualIndex, 1)"
                      >
                        下移
                      </button>
                      <button
                        v-if="entry.origin === 'pick'"
                        type="button"
                        class="button button--quiet is-danger"
                        @click="removePickByKey(entry.key)"
                      >
                        移除
                      </button>
                    </div>
                  </template>
                </div>
              </li>
              <li
                class="stitch-insertion"
                :class="{
                  'is-active': insertionIndex === actualIndex + 1,
                  'is-drag-over':
                    sourceDrag?.picked &&
                    sourceDrag.overDropSlot &&
                    sourceDrag.targetIndex === actualIndex + 1,
                }"
                :data-insertion-index="actualIndex + 1"
              >
                <button type="button" @click="selectInsertionIndex(actualIndex + 1)">
                  {{ insertionIndex === actualIndex + 1 ? '插入位置' : '插到这里' }}
                </button>
              </li>
            </template>
            <li v-if="!targetPageItems.length" class="stitch__empty">当前筛选下没有主预设条目。</li>
          </ol>
          <nav v-if="targetPageCount > 1" class="stitch-pagination" aria-label="主预设条目分页">
            <button
              class="button button--quiet"
              type="button"
              :disabled="targetPage === 1"
              @click="setPage('target', targetPage - 1)"
            >
              ←</button
            ><span>{{ targetPage }} / {{ targetPageCount }}</span
            ><button
              class="button button--quiet"
              type="button"
              :disabled="targetPage === targetPageCount"
              @click="setPage('target', targetPage + 1)"
            >
              →
            </button>
          </nav>
        </section>
      </div>

      <div id="stitch-entry-editor-portal"></div>
      <PresetStitchEditorPortal :active="mobileEditorOverlay">
        <div v-if="editor" class="stitch-editor-backdrop" aria-hidden="true"></div>
      </PresetStitchEditorPortal>

      <PresetWorkbenchTools
        :hidden="Boolean(editor || sourcePickerOpen || candidateSheetOpen || variableWriterOpen)"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :has-checkpoint="Boolean(checkpoint)"
        :single-column="singleColumn"
        @undo="undoWorkbench"
        @redo="redoWorkbench"
        @save="saveCheckpoint"
        @restore="restoreCheckpoint"
        @single="toggleSingleColumn"
      />

      <details v-if="blockingPromptIssues.length" class="stitch-audit" open>
        <summary>生成前检查 · {{ blockingPromptIssues.length }} 个错误</summary>
        <ul>
          <li
            v-for="issue in blockingPromptIssues"
            :key="`${issue.kind}:${issue.entryKeys.join(':')}:${issue.title}`"
            :class="`is-${issue.severity}`"
          >
            <strong>{{ issue.title }}</strong
            ><small>{{ issue.detail }}</small>
          </li>
        </ul>
      </details>

      <footer v-if="!fullWorkspaceActive" class="stitch__footer">
        <span
          ><strong>{{ reviewItems.length }}</strong> 项变更 · 草稿自动保存</span
        >
        <button type="button" class="button button--primary" @click="openReview">
          查看变更并导出
        </button>
      </footer>
    </template>

    <template v-else-if="step === 'review'">
      <div class="stitch-review__hero">
        <span>03</span>
        <div>
          <strong>导出前确认</strong>
          <p>这里只列出相对主预设的变化；原文件不会被覆盖。</p>
        </div>
      </div>
      <div class="stitch-review">
        <section v-if="reviewGroups.added.length">
          <header>
            <strong>新增条目与正则</strong><em>{{ reviewGroups.added.length }}</em>
          </header>
          <ul>
            <li v-for="item in reviewGroups.added" :key="item.key">
              <b>{{ item.kind === 'regex' ? '正则' : '新增' }}</b
              ><span
                ><strong>{{ item.title }}</strong
                ><small
                  >{{ item.detail
                  }}<template v-if="item.sourceName">
                    · 来源：{{ item.sourceName }}</template
                  ></small
                ></span
              >
            </li>
          </ul>
        </section>
        <section v-if="reviewGroups.changed.length">
          <header>
            <strong>修改内容</strong><em>{{ reviewGroups.changed.length }}</em>
          </header>
          <ul>
            <li v-for="item in reviewGroups.changed" :key="item.key">
              <b>修改</b
              ><span
                ><strong>{{ item.title }}</strong
                ><small>{{ item.detail }}</small></span
              >
            </li>
          </ul>
        </section>
        <section v-if="reviewGroups.moved.length">
          <header>
            <strong>顺序变化</strong><em>{{ reviewGroups.moved.length }}</em>
          </header>
          <ul>
            <li v-for="item in reviewGroups.moved" :key="item.key">
              <b>顺序</b
              ><span
                ><strong>{{ item.title }}</strong
                ><small>{{ item.detail }}</small></span
              >
            </li>
          </ul>
        </section>
        <section v-if="reviewAddedLines.length">
          <header>
            <strong>具体增加的行</strong><em>{{ reviewAddedLines.length }}</em>
          </header>
          <ul class="stitch-review__code-list">
            <li v-for="(line, index) in reviewAddedLines" :key="`line-add:${index}:${line}`">
              <b>增加</b>
              <pre>{{ line }}</pre>
            </li>
          </ul>
        </section>
        <section v-if="reviewRemovedLines.length">
          <header>
            <strong>具体删除的行</strong><em>{{ reviewRemovedLines.length }}</em>
          </header>
          <ul class="stitch-review__code-list">
            <li v-for="(line, index) in reviewRemovedLines" :key="`line-remove:${index}:${line}`">
              <b>删除</b>
              <pre>{{ line }}</pre>
            </li>
          </ul>
        </section>
        <section v-if="reviewAddedMacros.length || reviewRemovedMacros.length">
          <header>
            <strong>宏变化</strong
            ><em>{{ reviewAddedMacros.length + reviewRemovedMacros.length }}</em>
          </header>
          <ul class="stitch-review__code-list">
            <li v-for="macro in reviewAddedMacros" :key="`macro-add:${macro}`">
              <b>增加</b>
              <pre>{{ macro }}</pre>
            </li>
            <li v-for="macro in reviewRemovedMacros" :key="`macro-remove:${macro}`">
              <b>删除</b>
              <pre>{{ macro }}</pre>
            </li>
          </ul>
        </section>
        <section v-if="reviewVariableReads.length">
          <header>
            <strong>新增变量读取</strong><em>{{ reviewVariableReads.length }}</em>
          </header>
          <ul>
            <li v-for="variable in reviewVariableReads" :key="`read:${variable}`">
              <b>读取</b
              ><span
                ><strong>{{ variable }}</strong></span
              >
            </li>
          </ul>
        </section>
        <section v-if="reviewVariableWrites.length">
          <header>
            <strong>新增变量写入</strong><em>{{ reviewVariableWrites.length }}</em>
          </header>
          <ul>
            <li v-for="variable in reviewVariableWrites" :key="`write:${variable}`">
              <b>写入</b
              ><span
                ><strong>{{ variable }}</strong></span
              >
            </li>
          </ul>
        </section>
      </div>
      <div class="stitch__generate">
        <label
          ><span>自缝版预设名称</span><input v-model="productName" type="text" maxlength="160"
        /></label>
        <label v-if="baseIsStitched" class="stitch__version-toggle"
          ><input v-model="saveAsVersion" type="checkbox" /><span
            ><strong>存为现有自缝版的新版本</strong
            ><small>关闭后会作为独立“我的自缝版”预设入库</small></span
          ></label
        >
        <label v-if="baseIsStitched && saveAsVersion"
          ><span>版本备注（可选）</span
          ><input v-model="versionNote" type="text" maxlength="240" placeholder="这次改了什么"
        /></label>
        <p>
          格式仍是 SillyTavern generation preset
          JSON；“我的自缝版”只是资源库元数据分类，不改变导入和酒馆互传。
        </p>
        <div>
          <button class="button button--quiet" type="button" @click="step = 'workbench'">
            返回修改</button
          ><button type="button" class="button button--primary" :disabled="busy" @click="generate">
            {{ busy ? '正在生成并入库' : '确认生成并放入资源库' }}
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="stitch__done" role="status">
        <span>✓</span><strong>「{{ successName }}」已作为自缝版预设入库</strong>
        <p>文件仍是标准预设 JSON，可直接下载、导入 SillyTavern 或通过酒馆互传发送。</p>
        <div>
          <button type="button" class="button button--primary" @click="resetAll">再缝一个</button
          ><button class="button button--quiet" type="button" @click="emit('back')">
            返回功能桌面
          </button>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="variableWriterOpen"
        class="stitch-sheet mobile-dialog-viewport"
        role="dialog"
        aria-modal="true"
        aria-label="写入聊天变量"
        @click.self="variableWriterOpen = false"
      >
        <section class="stitch-sheet__panel stitch-variable-writer">
          <header>
            <span><strong>写入聊天变量</strong></span>
            <button
              class="button button--quiet"
              type="button"
              aria-label="关闭"
              @click="variableWriterOpen = false"
            >
              ×
            </button>
          </header>
          <label><span>变量名</span><input v-model="variableName" type="text" autofocus /></label>
          <label><span>变量值</span><textarea v-model="variableValue" rows="4"></textarea></label>
          <div class="stitch-variable-writer__actions">
            <button class="button button--quiet" type="button" @click="variableWriterOpen = false">
              取消
            </button>
            <button
              type="button"
              class="button button--primary"
              @click="insertVariableWrite($event)"
            >
              插入宏
            </button>
          </div>
        </section>
      </div>

      <div
        v-if="sourcePickerOpen"
        class="stitch-sheet mobile-dialog-viewport"
        role="dialog"
        aria-modal="true"
        aria-label="选择填充内容"
        @click.self="sourcePickerOpen = false"
      >
        <section class="stitch-sheet__panel">
          <header>
            <span><strong>更换填充内容</strong></span
            ><button
              class="button button--quiet"
              type="button"
              aria-label="关闭"
              @click="sourcePickerOpen = false"
            >
              ×
            </button>
          </header>
          <div class="stitch-sheet__favorites">
            <button type="button" @click="chooseFavoriteSource">
              <strong>已收藏预设条目</strong
              ><small>{{ favorites.length }} 条 · 跨预设直接复用</small>
            </button>
          </div>
          <label class="stitch__search"
            ><span aria-hidden="true">⌕</span
            ><input v-model="presetSearch" type="search" placeholder="搜索填充预设"
          /></label>
          <ul class="stitch__preset-list">
            <li v-for="resource in sourcePresetPageItems" :key="resource.id">
              <button type="button" :disabled="busy" @click="chooseSource(resource)">
                <span
                  ><strong>{{ resource.name }}</strong
                  ><em v-if="Array.isArray(resource.metadata.stitchedFrom)">我的自缝版</em
                  ><em v-else>原始预设</em></span
                ><small
                  >{{ presetSegmentCount(resource) }} 条 ·
                  {{ formatDate(resource.updatedAt) }}</small
                >
              </button>
            </li>
            <li v-if="!sourcePresetPageItems.length" class="stitch__empty">没有其他可用预设。</li>
          </ul>
          <nav v-if="sourcePresetPageCount > 1" class="stitch-pagination">
            <button
              class="button button--quiet"
              type="button"
              :disabled="presetPage === 1"
              @click="setPage('preset', presetPage - 1)"
            >
              ←</button
            ><span>{{ presetPage }} / {{ sourcePresetPageCount }}</span
            ><button
              class="button button--quiet"
              type="button"
              :disabled="presetPage === sourcePresetPageCount"
              @click="setPage('preset', presetPage + 1)"
            >
              →
            </button>
          </nav>
        </section>
      </div>

      <PresetCandidateSheet :model="panelModel" />

      <div
        v-if="sourceDrag?.picked"
        class="stitch-drag-ghost"
        :style="{ left: `${sourceDrag.x}px`, top: `${sourceDrag.y}px` }"
        role="status"
      >
        {{
          sourceDrag.overDropSlot
            ? `松手插入第 ${sourceDrag.targetIndex + 1} 位`
            : '移到主预设条目之间后松手'
        }}
      </div>
    </Teleport>
  </section>
</template>

<style scoped src="../styles/PresetStitcherApp.css"></style>
