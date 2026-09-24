<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useFrontendWorkshopApp } from '../composables/UseFrontendWorkshopApp'
import InlineModelPicker from './InlineModelPicker.vue'
type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useFrontendWorkshopApp>>,
  | 'activeDesignPanel'
  | 'activeApiLabel'
  | 'apiMode'
  | 'savedProfileId'
  | 'apiProfiles'
  | 'customApi'
  | 'customModelOptions'
  | 'loadingModels'
  | 'loadCustomModels'
  | 'customApiCredentialPersistence'
  | 'saveApiPreference'
  | 'testingApi'
  | 'testWorkshopApi'
  | 'apiStatus'
  | 'estimatedGenerationUsage'
  | 'current'
  | 'initialPromptPreview'
  | 'referenceImages'
  | 'busy'
  | 'generate'
  | 'generationNotice'
  | 'error'
  | 'generationFailure'
  | 'manualRepair'
  | 'openManualRepair'
>
const input = defineProps<{ model: PanelModel }>()
const activeDesignPanel = toRef(input.model, 'activeDesignPanel')
const activeApiLabel = toRef(input.model, 'activeApiLabel')
const apiMode = toRef(input.model, 'apiMode')
const savedProfileId = toRef(input.model, 'savedProfileId')
const apiProfiles = toRef(input.model, 'apiProfiles')
const customApi = toRef(input.model, 'customApi')
const customModelOptions = toRef(input.model, 'customModelOptions')
const loadingModels = toRef(input.model, 'loadingModels')
const loadCustomModels = toRef(input.model, 'loadCustomModels')
const customApiCredentialPersistence = toRef(input.model, 'customApiCredentialPersistence')
const saveApiPreference = toRef(input.model, 'saveApiPreference')
const testingApi = toRef(input.model, 'testingApi')
const testWorkshopApi = toRef(input.model, 'testWorkshopApi')
const apiStatus = toRef(input.model, 'apiStatus')
const estimatedGenerationUsage = toRef(input.model, 'estimatedGenerationUsage')
const current = toRef(input.model, 'current')
const initialPromptPreview = toRef(input.model, 'initialPromptPreview')
const referenceImages = toRef(input.model, 'referenceImages')
const busy = toRef(input.model, 'busy')
const generate = toRef(input.model, 'generate')
const generationNotice = toRef(input.model, 'generationNotice')
const error = toRef(input.model, 'error')
const generationFailure = toRef(input.model, 'generationFailure')
const manualRepair = toRef(input.model, 'manualRepair')
const openManualRepair = toRef(input.model, 'openManualRepair')
</script>
<template>
  <div
    class="frontend-workshop__design-panel"
    data-design-panel="generate"
    :class="{ 'is-active': activeDesignPanel === 'generate' }"
  >
    <details class="frontend-workshop__api">
      <summary>
        <span
          ><strong>生成接口</strong><small>{{ activeApiLabel }}</small></span
        >
        <em>高级</em>
      </summary>
      <div class="frontend-workshop__api-body">
        <label>
          <span>调用方式</span>
          <select v-model="apiMode">
            <option value="main">跟随设置中的主 API</option>
            <option value="saved">选择已保存的 API</option>
            <option value="custom">本工具专用自定义 API</option>
          </select>
        </label>
        <label v-if="apiMode === 'saved'">
          <span>已保存配置</span>
          <select v-model="savedProfileId">
            <option v-for="profile in apiProfiles" :key="profile.id" :value="profile.id">
              {{ profile.name }}
            </option>
          </select>
        </label>
        <template v-if="apiMode === 'custom'">
          <div class="frontend-workshop__api-pair">
            <label>
              <span>协议</span>
              <select v-model="customApi.protocol">
                <option value="openai-compatible">OpenAI 兼容</option>
                <option value="anthropic-compatible">Anthropic 兼容</option>
              </select>
            </label>
            <label>
              <span>模型</span>
              <InlineModelPicker
                v-model="customApi.model"
                :options="customModelOptions"
                :loading="loadingModels"
                button-label="拉取"
                @load="loadCustomModels"
              />
            </label>
          </div>
          <label>
            <span>API URL</span>
            <input v-model.trim="customApi.url" inputmode="url" autocomplete="url" />
          </label>
          <label>
            <span>API 密钥</span>
            <input
              v-model="customApi.apiKey"
              type="password"
              autocomplete="new-password"
              placeholder="允许无密钥接口留空"
            />
          </label>
          <label>
            <span>密钥保存方式</span>
            <select v-model="customApiCredentialPersistence">
              <option value="local">保存在本机（推荐）</option>
              <option value="session">仅本次使用</option>
            </select>
          </label>
          <div class="frontend-workshop__api-pair">
            <label>
              <span>温度 {{ customApi.temperature }}</span>
              <input
                v-model.number="customApi.temperature"
                type="range"
                min="0"
                max="2"
                step="0.05"
              />
            </label>
            <label>
              <span>Top P {{ customApi.topP }}</span>
              <input v-model.number="customApi.topP" type="range" min="0" max="1" step="0.05" />
            </label>
            <label>
              <span>传输方式</span>
              <select v-model="customApi.stream">
                <option :value="false">非流式</option>
                <option :value="true">流式接收</option>
              </select>
            </label>
            <label v-if="customApi.protocol === 'openai-compatible'">
              <span>推理深度</span>
              <select v-model="customApi.reasoningEffort">
                <option value="auto">自动</option>
                <option value="none">无推理 none</option>
                <option value="minimal">最少 minimal</option>
                <option value="low">低 low</option>
                <option value="medium">中 medium</option>
                <option value="high">高 high</option>
                <option value="xhigh">很高 xhigh</option>
                <option value="max">最高 max</option>
              </select>
            </label>
            <label>
              <span>最大输出 Token（0 = 自动）</span>
              <input v-model.number="customApi.maxTokens" type="number" min="0" max="128000" />
              <small> 0 不发送上限，但模型仍受自身限制；Anthropic 协议必须填写大于 0 的值。 </small>
            </label>
            <label v-if="customApi.protocol === 'openai-compatible'">
              <span>频率惩罚</span>
              <input
                v-model.number="customApi.frequencyPenalty"
                type="number"
                min="-2"
                max="2"
                step="0.1"
              />
            </label>
            <label v-if="customApi.protocol === 'openai-compatible'">
              <span>存在惩罚</span>
              <input
                v-model.number="customApi.presencePenalty"
                type="number"
                min="-2"
                max="2"
                step="0.1"
              />
            </label>
          </div>
        </template>
        <div class="frontend-workshop__api-actions">
          <button type="button" @click="saveApiPreference">保存选择</button>
          <button type="button" :disabled="testingApi" @click="testWorkshopApi">
            {{ testingApi ? '测试中…' : '测试连接' }}
          </button>
        </div>
        <p role="status">{{ apiStatus }}</p>
      </div>
    </details>
    <section
      v-if="estimatedGenerationUsage"
      class="frontend-workshop__token-meter"
      aria-live="polite"
    >
      <span>
        <small>BEFORE GENERATION</small>
        <strong>本次 Token 粗估</strong>
      </span>
      <dl>
        <div>
          <dt>输入</dt>
          <dd>约 {{ estimatedGenerationUsage.inputTokens.toLocaleString() }}</dd>
        </div>
        <div>
          <dt>输出</dt>
          <dd>
            约 {{ estimatedGenerationUsage.outputLow.toLocaleString() }}～{{
              estimatedGenerationUsage.outputHigh.toLocaleString()
            }}
          </dd>
        </div>
        <div>
          <dt>合计</dt>
          <dd>
            约 {{ estimatedGenerationUsage.totalLow.toLocaleString() }}～{{
              estimatedGenerationUsage.totalHigh.toLocaleString()
            }}
          </dd>
        </div>
      </dl>
      <p>不同模型分词方式不同，生成前只能估算；参考图按常见视觉请求粗略计入。</p>
      <p v-if="current?.tokenUsage">
        当前版本实际记录：输入 {{ current.tokenUsage.inputTokens.toLocaleString() }}，输出
        {{ current.tokenUsage.outputTokens.toLocaleString() }}，合计
        {{ current.tokenUsage.totalTokens.toLocaleString() }} ·
        {{ current.tokenUsage.source === 'provider' ? '接口实报' : '接口未返回用量，按文本估算' }}
        <template v-if="current.tokenUsage.requests > 1">
          · 含 {{ current.tokenUsage.requests }} 次自动修复请求
        </template>
      </p>
    </section>
    <details class="frontend-workshop__prompt-policy">
      <summary>
        <span>
          <small>AI DESIGN POLICY</small>
          <strong>这次 AI 会按什么逻辑做</strong>
        </span>
        <em>可查看</em>
      </summary>
      <ol>
        <li>先逐句拆解你的原话，列出必须改变、必须保留和禁止出现的内容。</li>
        <li>本轮明确指令优先于 AI 自己的审美发挥，不允许只做容易的一半。</li>
        <li>先完成 320px 酒馆消息位，再扩展到 390px 和桌面宽度。</li>
        <li>只选一个主视觉概念，避免默认紫蓝渐变、满屏圆角卡片、毛玻璃和发光堆叠。</li>
        <li>最后同时复核字段、积木、交互、安全限制和本轮每一条修改要求。</li>
      </ol>
      <p>
        具体字段、构图、色卡、字体和酒馆协议仍会按当前页面选择动态加入提示词；AI
        只负责视觉模板，正则与 MVU 读取逻辑继续由本地编译器生成。
      </p>
    </details>
    <details class="frontend-workshop__full-prompt">
      <summary>
        <span><strong>查看本轮完整提示词</strong><small>System + 用户消息</small></span>
        <em>生成前可核对</em>
      </summary>
      <template v-if="initialPromptPreview.request">
        <section>
          <h4>System 完整提示词</h4>
          <pre>{{ initialPromptPreview.request.systemPrompt }}</pre>
        </section>
        <section>
          <h4>本轮用户提示词</h4>
          <pre>{{ initialPromptPreview.request.userPrompt }}</pre>
        </section>
        <p v-if="referenceImages.length">
          本轮还会附带 {{ referenceImages.length }} 张参考图；图片本体不写入提示词历史。
        </p>
      </template>
      <p v-else role="alert">{{ initialPromptPreview.error }}</p>
    </details>
    <button
      class="frontend-workshop__generate"
      type="button"
      :disabled="busy"
      @click="generate(false)"
    >
      {{ busy ? '正在生成并验证…' : '生成酒馆状态栏' }}
    </button>
    <p v-if="generationNotice" class="frontend-workshop__generation-notice" role="status">
      {{ generationNotice }}
    </p>
    <p v-if="error" class="frontend-workshop__error" role="alert">{{ error }}</p>
    <section
      v-if="generationFailure && manualRepair"
      class="frontend-workshop__generation-failure"
      role="alert"
    >
      <strong>{{ generationFailure.title }}</strong>
      <p>{{ generationFailure.detail }}</p>
      <small>{{ generationFailure.hint }}</small>
      <button class="frontend-workshop__manual-repair-open" type="button" @click="openManualRepair">
        手动修复代码
      </button>
    </section>
    <aside>
      <strong>程序会替 AI 把关</strong>
      <p>
        字段正则与 MVU 读取代码由本地编译器生成；AI
        只负责视觉层。第一次漏字段、积木或交互时会自动带着精确错误修复一次；第二次仍不完整才停止，残缺结果不会保存。
      </p>
    </aside>
  </div>
</template>
<style scoped src="../styles/FrontendWorkshopBase.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignReferences.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignBlocks.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignAppearance.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignInputs.css"></style>
<style scoped src="../styles/FrontendWorkshopProof.css"></style>
<style scoped src="../styles/FrontendWorkshopDelivery.css"></style>
<style scoped src="../styles/FrontendWorkshopResponsive.css"></style>
