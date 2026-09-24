<script setup lang="ts">
import WorkshopProofPanel from './WorkshopProofPanel.vue'
import WorkshopGenerationPanel from './WorkshopGenerationPanel.vue'
import WorkshopAppearancePanel from './WorkshopAppearancePanel.vue'
import WorkshopContentPanel from './WorkshopContentPanel.vue'
import { proxyRefs } from 'vue'
import FeatureAppHeader from './FeatureAppHeader.vue'
import FrontendWorkshopLayoutStudio from './FrontendWorkshopLayoutStudio.vue'
import RichContentPreview from './RichContentPreview.vue'
import {
  useFrontendWorkshopApp,
  type FrontendWorkshopAppEvents,
} from '../composables/UseFrontendWorkshopApp'
const emit = defineEmits<FrontendWorkshopAppEvents>()
const controller = useFrontendWorkshopApp(emit)
const panelModel = proxyRefs(controller)
const {
  activeStep,
  handleBack,
  workshopSteps,
  current,
  designPanels,
  activeDesignPanel,
  parsedFields,
  imageUrls,
  selectedTargetSize,
  layoutReference,
  busy,
  generate,
  generationFailure,
  manualRepair,
  currentIndex,
  currentCompatibility,
  currentDataMode,
  previewMode,
  previewWidth,
  previewShell,
  previewAvatarMode,
  inspectionMode,
  previewFullscreen,
  previewWidthNote,
  handleInspectTarget,
  previewStageStyle,
  renderedSource,
  conversation,
  refinement,
  openConversation,
  conversationOpen,
  previous,
  compare,
  savingBundle,
  blockingSampleIssue,
  saveBundleToLibrary,
  libraryStatus,
  copy,
  copied,
  worldbookJson,
  downloadWorkshopJson,
  regexJson,
  manualRepairOpen,
  openManualRepairGuide,
  manualRepairIssues,
  manualRepairLines,
  applyManualRepair,
  manualRepairGuideOpen,
  layoutStudioOpen,
  applyLayoutReference,
} = controller
</script>

<template>
  <section class="frontend-workshop" :data-active-step="activeStep">
    <FeatureAppHeader title="前端了么" @back="handleBack">
      <template #status><span>ST AI_OUTPUT / 2</span></template>
    </FeatureAppHeader>

    <nav class="frontend-workshop__steps" aria-label="制作步骤">
      <button
        v-for="step in workshopSteps"
        :key="step.id"
        type="button"
        :class="{ 'is-active': activeStep === step.id }"
        :disabled="step.id !== 'design' && !current"
        @click="activeStep = step.id"
      >
        {{ step.label }}
      </button>
    </nav>

    <div class="frontend-workshop__layout">
      <section class="frontend-workshop__brief" data-workshop-step="design">
        <header><small>01 / CONTRACT</small><strong>定义状态内容</strong></header>
        <nav class="frontend-workshop__design-tabs" aria-label="设计阶段">
          <button
            v-for="panel in designPanels"
            :key="panel.id"
            type="button"
            :class="{ 'is-active': activeDesignPanel === panel.id }"
            @click="activeDesignPanel = panel.id"
          >
            <small>{{ panel.eyebrow }}</small>
            <strong>{{ panel.label }}</strong>
          </button>
        </nav>
        <WorkshopContentPanel :model="panelModel" />

        <WorkshopAppearancePanel :model="panelModel" />

        <WorkshopGenerationPanel :model="panelModel" />
      </section>

      <WorkshopProofPanel :model="panelModel" />
    </div>

    <button
      v-if="current"
      class="frontend-workshop__conversation-launcher"
      type="button"
      @click="openConversation"
    >
      <span>AI 对话</span>
      <small>{{ conversation.length ? `${conversation.length} 条记录` : '继续调整' }}</small>
    </button>

    <Teleport to="body">
      <div
        v-if="conversationOpen && current"
        class="frontend-workshop__conversation-dialog mobile-dialog-viewport"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-dialog-title"
        @click.self="conversationOpen = false"
      >
        <section>
          <header>
            <span>
              <small>AI REVISION THREAD</small>
              <strong id="conversation-dialog-title">和 AI 继续调整</strong>
              <p>每次发送都会生成一个可回看的版本；历史约束会自动保留且去重。</p>
            </span>
            <button type="button" aria-label="关闭 AI 对话" @click="conversationOpen = false">
              关闭
            </button>
          </header>
          <div v-if="conversation.length" class="frontend-workshop__conversation-dialog-history">
            <p v-for="message in conversation" :key="message.id" :class="`is-${message.role}`">
              <small>{{ message.role === 'user' ? '你' : 'AI' }}</small>
              <span>{{ message.content }}</span>
            </p>
          </div>
          <p v-else class="frontend-workshop__conversation-dialog-empty">
            还没有调整记录。直接告诉 AI 想改什么即可。
          </p>
          <label class="frontend-workshop__refine frontend-workshop__conversation-dialog-refine">
            <span>告诉 AI 下一步怎么改</span>
            <textarea
              v-model="refinement"
              rows="4"
              placeholder="例如：只缩小标题，保留当前配色和卡片结构"
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
          </section>
        </section>
      </div>
    </Teleport>

    <section v-if="current" class="frontend-workshop__delivery" data-workshop-step="delivery">
      <header>
        <span><small>03 / DELIVERY</small><strong>交付文件</strong></span>
        <div class="frontend-workshop__delivery-actions">
          <button type="button" :disabled="!previous" @click="compare = !compare">
            {{ compare ? '关闭对比' : '与上一版对比' }}
          </button>
          <button
            type="button"
            :disabled="savingBundle || Boolean(blockingSampleIssue)"
            @click="saveBundleToLibrary"
          >
            {{ savingBundle ? '正在保存…' : '保存为配套资源' }}
          </button>
        </div>
      </header>
      <p v-if="libraryStatus" class="frontend-workshop__library-status">{{ libraryStatus }}</p>
      <p v-if="blockingSampleIssue" class="frontend-workshop__error" role="alert">
        当前版本不能交付：{{
          blockingSampleIssue.message
        }}。请重新生成或继续修改，直到本地校验通过。
      </p>
      <p class="frontend-workshop__delivery-hint">
        可保存为配套资源，也可分别下载酒馆原生正则 JSON 与世界书
        JSON；不会创建酒馆无法导入的自定义合并格式。
      </p>
      <p v-if="currentDataMode === 'mvu'" class="frontend-workshop__delivery-hint">
        MVU 交付前必须确认：酒馆助手、MVU、ST-Prompt-Template 均已启用，并在 ST-Prompt-Template
        开启“处理消息内容”。酒馆内置正则本身不会执行 EJS。
      </p>
      <div :class="{ 'is-comparing': compare && previous }">
        <article v-if="compare && previous">
          <small>上一版 · V{{ currentIndex }}</small>
          <h3>{{ previous.artifact.title }}</h3>
          <pre>{{ previous.artifact.prompt }}</pre>
          <pre>{{ JSON.stringify(previous.artifact.regex, null, 2) }}</pre>
        </article>
        <article>
          <small>当前版 · V{{ currentIndex + 1 }}</small>
          <h3>{{ current.artifact.title }}</h3>
          <p class="frontend-workshop__delivery-note">
            {{ currentCompatibility.dataLabel }} ·
            {{ currentCompatibility.dependencies.join(' + ') }}
          </p>
          <div class="frontend-workshop__copybar">
            <strong>稳定输出提示词</strong>
            <button
              type="button"
              :disabled="Boolean(blockingSampleIssue)"
              @click="copy(current.artifact.prompt, 'prompt')"
            >
              {{ copied === 'prompt' ? '已复制' : '复制' }}
            </button>
          </div>
          <pre>{{ current.artifact.prompt }}</pre>
          <div class="frontend-workshop__copybar">
            <strong>酒馆世界书 JSON</strong>
            <button
              type="button"
              :disabled="Boolean(blockingSampleIssue)"
              @click="copy(worldbookJson, 'worldbook')"
            >
              {{ copied === 'worldbook' ? '已复制' : '复制' }}
            </button>
            <button
              type="button"
              :disabled="Boolean(blockingSampleIssue)"
              @click="downloadWorkshopJson('worldbook')"
            >
              下载 JSON
            </button>
          </div>
          <pre>{{ worldbookJson }}</pre>
          <div class="frontend-workshop__copybar">
            <strong>酒馆正则 JSON</strong>
            <button
              type="button"
              :disabled="Boolean(blockingSampleIssue)"
              @click="copy(regexJson, 'regex')"
            >
              {{ copied === 'regex' ? '已复制' : '复制' }}
            </button>
            <button
              type="button"
              :disabled="Boolean(blockingSampleIssue)"
              @click="downloadWorkshopJson('regex')"
            >
              下载 JSON
            </button>
          </div>
          <pre>{{ regexJson }}</pre>
        </article>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="manualRepairOpen && manualRepair"
        class="frontend-workshop__manual-repair-dialog mobile-dialog-viewport"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-repair-title"
        @click.self="manualRepairOpen = false"
      >
        <section>
          <header>
            <span>
              <small>MANUAL RECOVERY</small>
              <strong id="manual-repair-title">AI 连续两次未通过校验</strong>
              <p>可直接修改第二次实际输出；保存前仍会执行同一套酒馆模板、安全与结构校验。</p>
            </span>
            <span class="frontend-workshop__manual-repair-header-actions">
              <button type="button" class="is-guide" @click="openManualRepairGuide">
                查看常见错误修复
              </button>
              <button type="button" aria-label="关闭手动修复" @click="manualRepairOpen = false">
                关闭
              </button>
            </span>
          </header>
          <div class="frontend-workshop__manual-repair-issues" role="alert">
            <strong>待修复位置</strong>
            <ul>
              <li v-for="issue in manualRepairIssues" :key="issue">{{ issue }}</li>
            </ul>
          </div>
          <div class="frontend-workshop__manual-repair-code" aria-label="错误位置预览">
            <small>命中的代码行已标红；无法精确定位的结构问题保留在上方清单。</small>
            <pre><code><span v-for="line in manualRepairLines" :key="line.index" :class="{ 'is-error': line.hasError }"><b>{{ line.index }}</b>{{ line.text }}
</span></code></pre>
          </div>
          <label>
            <span>可编辑的完整 AI 输出</span>
            <textarea v-model="manualRepair.response" spellcheck="false" />
          </label>
          <p v-if="manualRepair.error" class="frontend-workshop__manual-repair-error" role="alert">
            {{ manualRepair.error }}
          </p>
          <footer>
            <button type="button" @click="manualRepairOpen = false">稍后再修</button>
            <button type="button" class="is-primary" @click="applyManualRepair">
              重新验证并保存
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="manualRepairGuideOpen && manualRepair"
        class="frontend-workshop__manual-repair-dialog frontend-workshop__manual-repair-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-repair-guide-title"
        @click.self="manualRepairGuideOpen = false"
      >
        <section>
          <header>
            <span>
              <small>REPAIR REFERENCE</small>
              <strong id="manual-repair-guide-title">常见错误修复</strong>
              <p>以下是酒馆可命中的结构范例。请按你的模板语义改，不要整段机械替换。</p>
            </span>
            <button
              type="button"
              aria-label="关闭常见错误修复"
              @click="manualRepairGuideOpen = false"
            >
              关闭
            </button>
          </header>
          <div class="frontend-workshop__manual-repair-guide-list">
            <article>
              <strong>字段占位符：只出现一次，且必须是可见文字</strong>
              <p>
                不要把字段放进 <code>style</code>、<code>id</code>、<code>for</code> 或
                <code>name</code>。
              </p>
              <pre
                v-pre
              ><code>&lt;span class="status-value"&gt;{{field_1}}&lt;/span&gt;</code></pre>
            </article>
            <article>
              <strong>输入控件：使用固定 ID，字段值单独展示</strong>
              <pre v-pre><code>&lt;input id="theme-id" type="checkbox"&gt;
&lt;label for="theme-id"&gt;切换主题&lt;/label&gt;
&lt;span&gt;{{field_1}}&lt;/span&gt;</code></pre>
            </article>
            <article>
              <strong>主题开关：checkbox 与对应 label 必须紧邻</strong>
              <p><code>input:checked + label</code> 依赖这个顺序；两者之间不能夹其他节点。</p>
              <pre v-pre><code>&lt;input id="theme-id" type="checkbox"&gt;
&lt;label for="theme-id" class="theme-button"&gt;夜间&lt;/label&gt;
&lt;div class="theme-panel"&gt;...&lt;/div&gt;

#theme-id:checked + .theme-button { color: white; }</code></pre>
            </article>
            <article>
              <strong>资源协议：使用 HTTPS，不使用 data: URI</strong>
              <p>
                <code>data:image/svg+xml,...</code> 不是外链，但当前成品协议策略仍不接受它。请换成
                HTTPS 图片/SVG 地址；页内滤镜引用可写为 <code>url(&quot;#filter-id&quot;)</code>。
              </p>
              <pre v-pre><code>&lt;img src="https://cdn.example.com/icon.svg" alt="图标"&gt;
.grain { filter: url("#filter-id"); }</code></pre>
            </article>
            <article>
              <strong>重复字段：不要用同一个占位符做标题、ID 与正文</strong>
              <p>
                每个 <code v-pre>{{ field_n }}</code> 只能保留一个真正展示数据的位置；标题、控件 ID
                和 CSS 类请改为固定文字。
              </p>
            </article>
          </div>
          <footer>
            <button type="button" class="is-primary" @click="manualRepairGuideOpen = false">
              我知道了，继续修改代码
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="previewFullscreen && current"
        class="frontend-workshop__fullscreen"
        role="dialog"
        aria-modal="true"
        aria-label="状态栏全屏校样"
      >
        <header>
          <span>
            <strong>{{ current.artifact.title }}</strong>
            <em
              >{{ previewShell === 'message' ? '酒馆消息位' : '只看状态栏' }} · V{{
                currentIndex + 1
              }}
              · {{ current.artifact.regex.id.slice(0, 8) }} · {{ previewWidthNote }}</em
            >
          </span>
          <button type="button" @click="previewFullscreen = false">退出全屏</button>
        </header>
        <main>
          <div class="frontend-workshop__fullscreen-stage-viewport">
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
                  :title="`${current.artifact.title}状态栏全屏校样`"
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
        </main>
      </div>
      <FrontendWorkshopLayoutStudio
        v-if="layoutStudioOpen"
        :fields="parsedFields"
        :image-urls="imageUrls"
        :model-value="layoutReference"
        :target-size="selectedTargetSize"
        @apply="applyLayoutReference"
        @close="layoutStudioOpen = false"
      />
    </Teleport>
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
