<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useFrontendWorkshopApp } from '../composables/UseFrontendWorkshopApp'
import RichContentPreview from './RichContentPreview.vue'
type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useFrontendWorkshopApp>>,
  | 'versions'
  | 'currentIndex'
  | 'move'
  | 'versionManageMode'
  | 'toggleVersionManagement'
  | 'selectAllVersions'
  | 'selectedVersionIds'
  | 'toggleVersionSelection'
  | 'deleteSelectedVersions'
  | 'current'
  | 'currentCompatibility'
  | 'currentDataMode'
  | 'sample'
  | 'stressCases'
  | 'applyStressCase'
  | 'mvuTurns'
  | 'activeMvuTurn'
  | 'applyMvuTurn'
  | 'sampleIssues'
  | 'previewResult'
  | 'previewMode'
  | 'previewWidth'
  | 'previewShell'
  | 'previewAvatarMode'
  | 'inspectionMode'
  | 'previewFullscreen'
  | 'previewWidthNote'
  | 'inspectedTargets'
  | 'handleInspectTarget'
  | 'clearInspectedTargets'
  | 'previewStageStyle'
  | 'renderedSource'
  | 'reviewingPreview'
  | 'busy'
  | 'reviewCurrentPreview'
  | 'reviewSuggestions'
  | 'reviewStatus'
  | 'reviewCategoryLabels'
  | 'selectedReviewRequirementApplied'
  | 'selectedReviewSuggestions'
  | 'applySelectedReviewSuggestions'
  | 'reviewApplyLabel'
  | 'clearRepeatedReviewRequirements'
  | 'refinementPromptPreview'
  | 'conversation'
  | 'conversationSelectionMode'
  | 'selectedConversationTurnIds'
  | 'selectedConversationMessageCount'
  | 'selectAllConversationTurns'
  | 'cancelConversationSelection'
  | 'deleteSelectedConversationTurns'
  | 'conversationTurnId'
  | 'startConversationPress'
  | 'moveConversationPress'
  | 'cancelConversationPress'
  | 'handleConversationClick'
  | 'enterConversationSelection'
  | 'toggleConversationTurn'
  | 'refinement'
  | 'generate'
  | 'generationFailure'
  | 'manualRepair'
  | 'openManualRepair'
>
const input = defineProps<{ model: PanelModel }>()
const versions = toRef(input.model, 'versions')
const currentIndex = toRef(input.model, 'currentIndex')
const move = toRef(input.model, 'move')
const versionManageMode = toRef(input.model, 'versionManageMode')
const toggleVersionManagement = toRef(input.model, 'toggleVersionManagement')
const selectAllVersions = toRef(input.model, 'selectAllVersions')
const selectedVersionIds = toRef(input.model, 'selectedVersionIds')
const toggleVersionSelection = toRef(input.model, 'toggleVersionSelection')
const deleteSelectedVersions = toRef(input.model, 'deleteSelectedVersions')
const current = toRef(input.model, 'current')
const currentCompatibility = toRef(input.model, 'currentCompatibility')
const currentDataMode = toRef(input.model, 'currentDataMode')
const sample = toRef(input.model, 'sample')
const stressCases = toRef(input.model, 'stressCases')
const applyStressCase = toRef(input.model, 'applyStressCase')
const mvuTurns = toRef(input.model, 'mvuTurns')
const activeMvuTurn = toRef(input.model, 'activeMvuTurn')
const applyMvuTurn = toRef(input.model, 'applyMvuTurn')
const sampleIssues = toRef(input.model, 'sampleIssues')
const previewResult = toRef(input.model, 'previewResult')
const previewMode = toRef(input.model, 'previewMode')
const previewWidth = toRef(input.model, 'previewWidth')
const previewShell = toRef(input.model, 'previewShell')
const previewAvatarMode = toRef(input.model, 'previewAvatarMode')
const inspectionMode = toRef(input.model, 'inspectionMode')
const previewFullscreen = toRef(input.model, 'previewFullscreen')
const previewWidthNote = toRef(input.model, 'previewWidthNote')
const inspectedTargets = toRef(input.model, 'inspectedTargets')
const handleInspectTarget = toRef(input.model, 'handleInspectTarget')
const clearInspectedTargets = toRef(input.model, 'clearInspectedTargets')
const previewStageStyle = toRef(input.model, 'previewStageStyle')
const renderedSource = toRef(input.model, 'renderedSource')
const reviewingPreview = toRef(input.model, 'reviewingPreview')
const busy = toRef(input.model, 'busy')
const reviewCurrentPreview = toRef(input.model, 'reviewCurrentPreview')
const reviewSuggestions = toRef(input.model, 'reviewSuggestions')
const reviewStatus = toRef(input.model, 'reviewStatus')
const reviewCategoryLabels = toRef(input.model, 'reviewCategoryLabels')
const selectedReviewRequirementApplied = toRef(input.model, 'selectedReviewRequirementApplied')
const selectedReviewSuggestions = toRef(input.model, 'selectedReviewSuggestions')
const applySelectedReviewSuggestions = toRef(input.model, 'applySelectedReviewSuggestions')
const reviewApplyLabel = toRef(input.model, 'reviewApplyLabel')
const clearRepeatedReviewRequirements = toRef(input.model, 'clearRepeatedReviewRequirements')
const refinementPromptPreview = toRef(input.model, 'refinementPromptPreview')
const conversation = toRef(input.model, 'conversation')
const conversationSelectionMode = toRef(input.model, 'conversationSelectionMode')
const selectedConversationTurnIds = toRef(input.model, 'selectedConversationTurnIds')
const selectedConversationMessageCount = toRef(input.model, 'selectedConversationMessageCount')
const selectAllConversationTurns = toRef(input.model, 'selectAllConversationTurns')
const cancelConversationSelection = toRef(input.model, 'cancelConversationSelection')
const deleteSelectedConversationTurns = toRef(input.model, 'deleteSelectedConversationTurns')
const conversationTurnId = toRef(input.model, 'conversationTurnId')
const startConversationPress = toRef(input.model, 'startConversationPress')
const moveConversationPress = toRef(input.model, 'moveConversationPress')
const cancelConversationPress = toRef(input.model, 'cancelConversationPress')
const handleConversationClick = toRef(input.model, 'handleConversationClick')
const enterConversationSelection = toRef(input.model, 'enterConversationSelection')
const toggleConversationTurn = toRef(input.model, 'toggleConversationTurn')
const refinement = toRef(input.model, 'refinement')
const generate = toRef(input.model, 'generate')
const generationFailure = toRef(input.model, 'generationFailure')
const manualRepair = toRef(input.model, 'manualRepair')
const openManualRepair = toRef(input.model, 'openManualRepair')
</script>
<template>
  <section class="frontend-workshop__proof" data-workshop-step="proof">
    <header>
      <span><small>02 / PROOF</small><strong>状态栏校样</strong></span>
      <div v-if="versions.length" class="frontend-workshop__version-controls">
        <nav aria-label="生成版本">
          <button type="button" :disabled="currentIndex === 0" @click="move(-1)">←</button>
          <em>V{{ currentIndex + 1 }} / {{ versions.length }}</em>
          <button type="button" :disabled="currentIndex === versions.length - 1" @click="move(1)">
            →
          </button>
        </nav>
        <button
          type="button"
          :class="{ 'is-active': versionManageMode }"
          @click="toggleVersionManagement"
        >
          {{ versionManageMode ? '完成整理' : '整理版本' }}
        </button>
      </div>
    </header>
    <section v-if="versionManageMode" class="frontend-workshop__version-manager">
      <header>
        <span>
          <strong>多选删除校样</strong>
          <small>只影响本机生成历史，不会删除已入库资源</small>
        </span>
        <button type="button" @click="selectAllVersions">
          {{ selectedVersionIds.length === versions.length ? '取消全选' : '全选' }}
        </button>
      </header>
      <div>
        <button
          v-for="(version, index) in versions"
          :key="version.id"
          type="button"
          :class="{
            'is-selected': selectedVersionIds.includes(version.id),
            'is-current': index === currentIndex,
          }"
          :aria-pressed="selectedVersionIds.includes(version.id)"
          @click="toggleVersionSelection(version.id)"
        >
          <span>V{{ index + 1 }}</span>
          <small>{{ version.artifact.title }}</small>
        </button>
      </div>
      <button type="button" :disabled="!selectedVersionIds.length" @click="deleteSelectedVersions">
        删除所选（{{ selectedVersionIds.length }}）
      </button>
    </section>
    <template v-if="current">
      <details class="frontend-workshop__proof-settings">
        <summary>
          <span>
            <strong>测试数据与兼容性</strong>
            <small>{{ currentCompatibility.dependencies.join(' + ') }}</small>
          </span>
          <em>按需展开</em>
        </summary>
        <div class="frontend-workshop__compatibility">
          <span>
            <small>兼容等级</small>
            <strong>{{ currentCompatibility.levelLabel }}</strong>
          </span>
          <span>
            <small>数据</small>
            <strong>{{ currentCompatibility.dataLabel }}</strong>
          </span>
          <span>
            <small>连续性</small>
            <strong>{{ currentCompatibility.persistenceLabel }}</strong>
          </span>
          <span>
            <small>依赖</small>
            <strong>{{ currentCompatibility.dependencies.join(' + ') }}</strong>
          </span>
          <p>{{ currentCompatibility.verificationNote }}</p>
        </div>
        <label class="frontend-workshop__sample">
          <span>
            {{
              currentDataMode === 'mvu'
                ? '自定义 MVU 变量样例（可直接改 JSON 测试路径）'
                : '自定义 AI 输出样例（可直接改值测试识别）'
            }}
          </span>
          <textarea v-model="sample" rows="7"></textarea>
        </label>
        <div class="frontend-workshop__stress-tests">
          <span>一键压力校样</span>
          <button
            v-for="stressCase in stressCases"
            :key="stressCase.id"
            type="button"
            @click="applyStressCase(stressCase.id)"
          >
            {{ stressCase.label }}
          </button>
          <button type="button" @click="sample = current.artifact.sampleOutput">恢复默认</button>
        </div>
        <section
          v-if="currentDataMode === 'mvu' && mvuTurns.length"
          class="frontend-workshop__mvu-turns"
        >
          <header>
            <span>
              <strong>连续 10 回合模拟</strong>
              <small>完全本地，不读取或修改真实酒馆变量</small>
            </span>
            <em>
              {{
                mvuTurns[activeMvuTurn]?.changedFields.length
                  ? `变化：${mvuTurns[activeMvuTurn]?.changedFields.join('、')}`
                  : '初始回合'
              }}
            </em>
          </header>
          <div>
            <button
              v-for="(turn, turnIndex) in mvuTurns"
              :key="turn.turn"
              type="button"
              :class="{ 'is-active': activeMvuTurn === turnIndex }"
              @click="applyMvuTurn(turnIndex)"
            >
              {{ turn.turn }}
            </button>
          </div>
        </section>
        <ul v-if="sampleIssues.length" class="frontend-workshop__sample-issues">
          <li v-for="issue in sampleIssues" :key="issue.message" :class="`is-${issue.severity}`">
            {{ issue.message }}
          </li>
        </ul>
        <p v-if="previewResult.error" class="frontend-workshop__error" role="alert">
          {{ previewResult.error }}
        </p>
      </details>
      <div class="frontend-workshop__previewbar">
        <div role="group" aria-label="查看内容">
          <button
            type="button"
            :class="{ 'is-active': previewMode === 'effect' }"
            @click="previewMode = 'effect'"
          >
            效果
          </button>
          <button
            type="button"
            :class="{ 'is-active': previewMode === 'source' }"
            @click="previewMode = 'source'"
          >
            {{ currentDataMode === 'mvu' ? '校样 HTML' : '正则结果' }}
          </button>
        </div>
        <div role="group" aria-label="预览宽度">
          <button
            type="button"
            :class="{ 'is-active': previewWidth === 'phone320' }"
            @click="previewWidth = 'phone320'"
          >
            320
          </button>
          <button
            type="button"
            :class="{ 'is-active': previewWidth === 'phone390' }"
            @click="previewWidth = 'phone390'"
          >
            390
          </button>
          <button
            type="button"
            :class="{ 'is-active': previewWidth === 'desktop' }"
            @click="previewWidth = 'desktop'"
          >
            桌面
          </button>
          <button
            type="button"
            :class="{ 'is-active': previewWidth === 'fit' }"
            @click="previewWidth = 'fit'"
          >
            适应
          </button>
        </div>
        <div v-if="previewShell === 'message'" role="group" aria-label="酒馆头像设置">
          <button
            type="button"
            :class="{ 'is-active': previewAvatarMode === 'visible' }"
            @click="previewAvatarMode = 'visible'"
          >
            显示头像
          </button>
          <button
            type="button"
            :class="{ 'is-active': previewAvatarMode === 'hidden' }"
            @click="previewAvatarMode = 'hidden'"
          >
            隐藏头像
          </button>
        </div>
        <button
          type="button"
          @click="previewShell = previewShell === 'canvas' ? 'message' : 'canvas'"
        >
          {{ previewShell === 'canvas' ? '切到酒馆消息位' : '放大看状态栏' }}
        </button>
        <button
          type="button"
          :class="{ 'is-active': inspectionMode }"
          :disabled="previewMode !== 'effect'"
          @click="inspectionMode = !inspectionMode"
        >
          {{ inspectionMode ? '结束点选' : '点选修改区域' }}
        </button>
        <button type="button" @click="previewFullscreen = true">全屏看当前模式</button>
      </div>
      <p class="frontend-workshop__preview-note">
        <strong>{{ previewShell === 'message' ? '酒馆固定版本校样' : '设计检查模式' }}</strong>
        {{ previewWidthNote }}
      </p>
      <aside v-if="inspectionMode" class="frontend-workshop__inspect-tray">
        <div>
          <strong>直接点击校样里的字段、折叠标题或图片</strong>
          <small>可以连续选择多个区域；下一条修改只作用于这些目标。</small>
        </div>
        <span v-for="target in inspectedTargets" :key="target.id">
          {{ target.label }}
          <button type="button" @click="handleInspectTarget(target)">×</button>
        </span>
        <button v-if="inspectedTargets.length" type="button" @click="clearInspectedTargets">
          清空
        </button>
      </aside>
      <div v-if="!previewResult.error" class="frontend-workshop__stage-viewport">
        <div
          class="frontend-workshop__stage"
          :class="[`is-${previewWidth}`, { 'is-message': previewShell === 'message' }]"
          :data-preview-width="previewWidth"
          :style="previewStageStyle"
        >
          <template v-if="previewShell === 'message'">
            <RichContentPreview
              v-if="previewMode === 'effect'"
              :source="renderedSource"
              :title="current.artifact.title"
              :active="true"
              :inspector="inspectionMode"
              :message-avatar-mode="previewAvatarMode"
              render-shell="message"
              immersive
              bare
              @inspect="handleInspectTarget"
            />
            <pre v-else>{{ renderedSource }}</pre>
          </template>
          <div v-else class="frontend-workshop__canvas">
            <RichContentPreview
              v-if="previewMode === 'effect'"
              :source="renderedSource"
              :title="`${current.artifact.title}状态栏`"
              :active="true"
              :inspector="inspectionMode"
              render-shell="content"
              immersive
              bare
              @inspect="handleInspectTarget"
            />
            <pre v-else>{{ renderedSource }}</pre>
          </div>
        </div>
      </div>
      <details v-if="current.promptSnapshot" class="frontend-workshop__prompt-history">
        <summary>
          <span
            ><strong>查看 V{{ currentIndex + 1 }} 实际注入提示词</strong
            ><small>生成后随版本保留</small></span
          >
          <em>{{ current.promptSnapshot.messages.length }} 段</em>
        </summary>
        <section v-for="message in current.promptSnapshot.messages" :key="message.label">
          <h4>{{ message.label }}</h4>
          <pre>{{ message.content }}</pre>
          <details v-if="message.originalContent">
            <summary>查看本轮原始接口请求记录</summary>
            <pre>{{ message.originalContent }}</pre>
          </details>
        </section>
        <p v-if="current.promptSnapshot.referenceImageNames?.length">
          本轮附带参考图：{{
            current.promptSnapshot.referenceImageNames.join('、')
          }}；图片本体未写入历史。
        </p>
      </details>
      <section class="frontend-workshop__review">
        <header>
          <span>
            <strong>让 AI 审视当前校样</strong>
            <small>读取当前 HTML/CSS 与校样数据，从交互、动效、排版、配色和内容等方面给建议</small>
          </span>
          <button
            class="frontend-workshop__review-start"
            type="button"
            :disabled="reviewingPreview || busy"
            @click="reviewCurrentPreview"
          >
            {{
              reviewingPreview ? '正在审视…' : reviewSuggestions.length ? '重新审视' : '开始审视'
            }}
          </button>
        </header>
        <p v-if="reviewStatus" role="status">{{ reviewStatus }}</p>
        <div v-if="reviewSuggestions.length">
          <article
            v-for="suggestion in reviewSuggestions"
            :key="suggestion.id"
            class="frontend-workshop__review-suggestion"
            :class="{ 'is-selected': suggestion.selected }"
          >
            <label>
              <input v-model="suggestion.selected" type="checkbox" />
              <span>
                <small>{{ reviewCategoryLabels[suggestion.category] }}</small>
                <strong>{{ suggestion.title }}</strong>
                <em class="frontend-workshop__review-selection">
                  {{ suggestion.selected ? '已选' : '点此选择' }}
                </em>
              </span>
            </label>
            <textarea v-model="suggestion.detail" rows="3" maxlength="1200"></textarea>
          </article>
        </div>
        <button
          v-if="reviewSuggestions.length"
          class="frontend-workshop__review-apply"
          :class="{ 'is-applied': selectedReviewRequirementApplied }"
          type="button"
          :disabled="!selectedReviewSuggestions.length"
          @click="applySelectedReviewSuggestions"
        >
          {{ reviewApplyLabel }}
        </button>
        <button
          class="frontend-workshop__review-cleanup"
          type="button"
          @click="clearRepeatedReviewRequirements"
        >
          清理旧版重复建议
        </button>
        <details v-if="current.reviewPromptSnapshot" class="frontend-workshop__review-prompt">
          <summary>查看本次审美诊断完整提示词</summary>
          <section v-for="message in current.reviewPromptSnapshot.messages" :key="message.label">
            <h4>{{ message.label }}</h4>
            <pre>{{ message.content }}</pre>
          </section>
        </details>
      </section>
      <details v-if="refinementPromptPreview.request" class="frontend-workshop__full-prompt">
        <summary>
          <span><strong>查看下一轮完整提示词</strong><small>会随下方要求实时更新</small></span>
          <em>可核对</em>
        </summary>
        <section>
          <h4>System 完整提示词</h4>
          <pre>{{ refinementPromptPreview.request.systemPrompt }}</pre>
        </section>
        <section>
          <h4>本轮用户提示词</h4>
          <pre>{{ refinementPromptPreview.request.userPrompt }}</pre>
        </section>
      </details>
      <section class="frontend-workshop__conversation">
        <header>
          <span
            ><strong>和 AI 继续调整</strong
            ><small>每次发送都会生成一个可回看的版本；长按进入多选</small></span
          >
          <button
            v-if="conversation.length && !conversationSelectionMode"
            class="frontend-workshop__conversation-manage"
            type="button"
            @click="conversationSelectionMode = true"
          >
            管理对话
          </button>
        </header>
        <div
          v-if="conversationSelectionMode"
          class="frontend-workshop__conversation-toolbar"
          role="toolbar"
          aria-label="多选对话"
        >
          <strong>已选 {{ selectedConversationTurnIds.length }} 轮</strong>
          <small>共 {{ selectedConversationMessageCount }} 条消息</small>
          <button type="button" @click="selectAllConversationTurns">全选</button>
          <button type="button" @click="cancelConversationSelection">取消</button>
          <button
            class="frontend-workshop__conversation-delete"
            type="button"
            :disabled="!selectedConversationTurnIds.length"
            @click="deleteSelectedConversationTurns"
          >
            删除选中
          </button>
        </div>
        <div v-if="conversation.length" aria-live="polite">
          <p
            v-for="message in conversation"
            :key="message.id"
            :class="[
              `is-${message.role}`,
              {
                'is-selected': selectedConversationTurnIds.includes(conversationTurnId(message)),
              },
            ]"
            role="button"
            tabindex="0"
            :aria-pressed="selectedConversationTurnIds.includes(conversationTurnId(message))"
            :aria-label="`${message.role === 'user' ? '你的消息' : 'AI 消息'}，长按或按空格选择这轮对话`"
            @pointerdown="startConversationPress(message, $event)"
            @pointermove="moveConversationPress"
            @pointerup="cancelConversationPress"
            @pointercancel="cancelConversationPress"
            @click="handleConversationClick(message)"
            @contextmenu.prevent="enterConversationSelection(message)"
            @keydown.enter.prevent="toggleConversationTurn(message)"
            @keydown.space.prevent="toggleConversationTurn(message)"
          >
            <small>{{ message.role === 'user' ? '你' : 'AI' }}</small>
            <span>{{ message.content }}</span>
          </p>
        </div>
        <label class="frontend-workshop__refine">
          <span>告诉 AI 下一步怎么改</span>
          <small v-if="inspectedTargets.length">
            本轮目标：{{ inspectedTargets.map((target) => target.label).join('、') }}
          </small>
          <textarea
            v-model="refinement"
            rows="3"
            placeholder="例如：这里字号小一点；只改背景颜色和圆角；折叠标题增加箭头动效"
          ></textarea>
          <button type="button" :disabled="busy" :aria-busy="busy" @click="generate(true)">
            {{ busy ? '正在调整…' : '发送并生成下一版' }}
          </button>
        </label>
        <section
          v-if="generationFailure"
          class="frontend-workshop__generation-failure"
          role="alert"
        >
          <strong>{{ generationFailure.title }}</strong>
          <p>{{ generationFailure.detail }}</p>
          <small>{{ generationFailure.hint }}</small>
          <em>本次使用：{{ generationFailure.apiLabel }}</em>
          <button
            v-if="manualRepair"
            class="frontend-workshop__manual-repair-open"
            type="button"
            @click="openManualRepair"
          >
            手动修复代码
          </button>
        </section>
      </section>
    </template>
    <div v-else class="frontend-workshop__empty">
      <span>EMPTY PROOF</span>
      <strong>第一张设计稿会出现在这里</strong>
      <p>请先在左侧填写字段和风格，再生成。</p>
    </div>
  </section>
</template>
<style scoped src="../styles/FrontendWorkshopBase.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignReferences.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignBlocks.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignAppearance.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignInputs.css"></style>
<style scoped src="../styles/FrontendWorkshopProof.css"></style>
<style scoped src="../styles/FrontendWorkshopDelivery.css"></style>
<style scoped src="../styles/FrontendWorkshopResponsive.css"></style>
