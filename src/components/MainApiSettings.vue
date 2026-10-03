<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { mainApiService } from '../core/AppContainer'
import type { MainApiModelOption, MainApiProfile } from '../services/MainApiService'
import InlineModelPicker from './InlineModelPicker.vue'

const initialState = mainApiService.getProfilesState()
const props = withDefaults(defineProps<{ assistant?: boolean; profileId?: string }>(), {
  assistant: false,
  profileId: '',
})
const emit = defineEmits<{ selected: [id: string] }>()
const profiles = ref<MainApiProfile[]>(initialState.profiles)
const activeProfileId = ref(initialState.activeProfileId)
const selectedProfileId = ref(
  props.assistant
    ? props.profileId === initialState.activeProfileId
      ? ''
      : initialState.profiles.some((profile) => profile.id === props.profileId)
        ? props.profileId
        : ''
    : initialState.activeProfileId,
)
const config = reactive<MainApiProfile>({
  ...(initialState.profiles.find((p) => p.id === selectedProfileId.value) ??
    mainApiService.getActiveProfile()),
})
const status = ref('')
const testing = ref(false)
const loadingModels = ref(false)
const modelOptions = ref<MainApiModelOption[]>([])

const isActive = computed(() => config.id === activeProfileId.value)
const editableProfiles = computed(() =>
  profiles.value.filter((profile) => !props.assistant || profile.id !== activeProfileId.value),
)

function refresh(profileId = selectedProfileId.value): void {
  const state = mainApiService.getProfilesState()
  profiles.value = state.profiles
  activeProfileId.value = state.activeProfileId
  const selected =
    state.profiles.find((profile) => profile.id === profileId) ??
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles[0]!
  selectedProfileId.value = selected.id
  Object.assign(config, selected)
  modelOptions.value = []
}

function selectProfile(): void {
  if (props.assistant && !selectedProfileId.value) {
    emit('selected', '')
    status.value = ''
    return
  }
  refresh(selectedProfileId.value)
  status.value = ''
}

async function save(announce = true): Promise<MainApiProfile> {
  const saved = mainApiService.saveProfile({ ...config })
  await mainApiService.awaitCredentialWrites()
  refresh(saved.id)
  if (props.assistant) emit('selected', saved.id)
  if (announce) status.value = `已保存“${saved.name}”`
  return saved
}

async function activate(): Promise<void> {
  const saved = await save(false)
  mainApiService.setActiveProfile(saved.id)
  refresh(saved.id)
  status.value = `“${saved.name}”已设为主 API`
}

async function addProfile(): Promise<void> {
  const profile = mainApiService.createProfile(`API ${profiles.value.length + 1}`)
  await mainApiService.awaitCredentialWrites()
  refresh(profile.id)
  status.value = '已新建空白 API 配置'
}

async function duplicateProfile(): Promise<void> {
  const profile = mainApiService.createProfile(`${config.name} 副本`)
  const copied = mainApiService.saveProfile({
    ...config,
    id: profile.id,
    name: profile.name,
  })
  await mainApiService.awaitCredentialWrites()
  refresh(copied.id)
  status.value = '已复制当前配置；密钥也只保存在本设备'
}

async function removeProfile(): Promise<void> {
  if (profiles.value.length <= 1) {
    status.value = '至少需要保留一个 API 配置'
    return
  }
  if (
    !(await confirmAction({
      title: '删除 API 配置',
      message: `删除“${config.name}”吗？此操作只影响当前设备。`,
      confirmLabel: '删除',
      danger: true,
    }))
  )
    return
  const next = mainApiService.deleteProfile(config.id)
  await mainApiService.awaitCredentialWrites()
  refresh(next.id)
  if (props.assistant) {
    selectedProfileId.value = ''
    emit('selected', '')
  }
  status.value = 'API 配置已删除'
}

async function test(): Promise<void> {
  testing.value = true
  status.value = '正在发起最小生成请求…'
  try {
    const saved = await save(false)
    status.value = await mainApiService.testConnection(saved)
  } catch (error) {
    status.value = error instanceof Error ? error.message : '连接失败'
  } finally {
    testing.value = false
  }
}

async function loadModels(): Promise<void> {
  loadingModels.value = true
  status.value = '正在从接口拉取可用模型…'
  try {
    modelOptions.value = await mainApiService.listModels({ ...config })
    status.value = modelOptions.value.length
      ? `已拉取 ${modelOptions.value.length} 个模型；可直接选择，也可以继续手动输入`
      : '接口返回了空模型列表；仍可手动填写模型名'
  } catch (error) {
    modelOptions.value = []
    status.value = error instanceof Error ? error.message : '模型列表拉取失败'
  } finally {
    loadingModels.value = false
  }
}
</script>

<template>
  <section
    class="settings-section main-api-settings"
    :class="{ 'main-api-settings--assistant': assistant }"
  >
    <header v-if="!assistant">
      <div>
        <h3>主 API 配置</h3>
      </div>
      <span>{{ profiles.length }} 个 · 本机配置</span>
    </header>

    <div class="main-api-settings__profilebar">
      <label>
        <span>正在编辑</span>
        <select v-model="selectedProfileId" aria-label="API 配置" @change="selectProfile">
          <option v-if="assistant" value="">使用主 API</option>
          <option v-for="profile in editableProfiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}{{ profile.id === activeProfileId ? '（主 API）' : '' }}
          </option>
        </select>
      </label>
      <button type="button" @click="addProfile">新增</button>
      <details class="main-api-settings__profiletools">
        <summary aria-label="管理 API 配置">更多</summary>
        <div class="main-api-settings__profilemenu">
          <button
            type="button"
            :disabled="assistant && !selectedProfileId"
            @click="duplicateProfile"
          >
            复制
          </button>
          <button
            type="button"
            class="is-danger"
            :disabled="assistant && !selectedProfileId"
            @click="removeProfile"
          >
            删除
          </button>
        </div>
      </details>
    </div>

    <div
      v-if="!assistant || selectedProfileId"
      class="main-api-settings__grid main-api-settings__basic"
    >
      <label>
        <span>配置名称</span>
        <input v-model.trim="config.name" autocomplete="off" placeholder="例如：日常生成" />
      </label>
      <label>
        <span>接口协议</span>
        <select v-model="config.protocol" aria-label="接口协议">
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="anthropic-compatible">Anthropic 兼容</option>
        </select>
      </label>
      <label class="main-api-settings__wide">
        <span>模型</span>
        <InlineModelPicker
          v-model="config.model"
          :options="modelOptions"
          :loading="loadingModels"
          @load="loadModels"
        />
      </label>
      <label class="main-api-settings__wide">
        <span>API URL</span>
        <input
          v-model.trim="config.url"
          inputmode="url"
          autocomplete="url"
          :placeholder="
            config.protocol === 'openai-compatible'
              ? 'https://example.com/v1（也可填完整 /chat/completions）'
              : 'https://api.anthropic.com/v1（也可填完整 /messages）'
          "
        />
      </label>
      <label class="main-api-settings__wide">
        <span>API 密钥</span>
        <input
          v-model="config.apiKey"
          type="password"
          autocomplete="new-password"
          placeholder="无密钥接口可留空"
        />
      </label>
    </div>
    <details v-if="!assistant || selectedProfileId" class="main-api-settings__advanced">
      <summary>
        更多设置<span>{{
          config.credentialPersistence === 'local' ? '密钥保存在本机' : '密钥仅本次使用'
        }}</span>
      </summary>
      <p v-if="!assistant" class="main-api-settings__intro">
        可以保存多套接口；标记为“当前主 API”的配置会供“前端了么”和后续 AI
        功能默认调用。网页端接口需允许浏览器 CORS，APK 使用原生 HTTP。
      </p>
      <div class="main-api-settings__grid">
        <label class="main-api-settings__wide main-api-settings__credential-mode">
          <span>密钥保存方式</span>
          <select v-model="config.credentialPersistence" aria-label="密钥保存方式">
            <option value="local">保存在本机（推荐）</option>
            <option value="session">仅本次使用，关闭应用后清除</option>
          </select>
          <small v-if="!assistant" class="main-api-settings__hint">
            网页端由不可导出的设备密钥加密；APK 由 Android Keystore
            保护。导出与云备份默认不携带密钥。
          </small>
        </label>
        <label>
          <span>温度 {{ config.temperature }}</span>
          <input v-model.number="config.temperature" type="range" min="0" max="2" step="0.05" />
        </label>
        <label>
          <span>Top P {{ config.topP }}</span>
          <input v-model.number="config.topP" type="range" min="0" max="1" step="0.05" />
        </label>
        <label>
          <span>传输方式</span>
          <select v-model="config.stream">
            <option :value="false">非流式（等待完整结果）</option>
            <option :value="true">流式（逐段接收）</option>
          </select>
        </label>
        <label v-if="config.protocol === 'openai-compatible'">
          <span>推理深度</span>
          <select v-model="config.reasoningEffort">
            <option value="auto">自动（不发送参数）</option>
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
          <input v-model.number="config.maxTokens" type="number" min="0" step="1" />
          <small v-if="!assistant" class="main-api-settings__hint">
            0
            使用服务商默认输出额度，可能低于模型最大容量；这里不另设上限。需要长输出时请填写模型支持的最大值。Anthropic
            要求大于 0。
          </small>
        </label>
        <label v-if="config.protocol === 'openai-compatible'">
          <span>频率惩罚</span>
          <input
            v-model.number="config.frequencyPenalty"
            type="number"
            min="-2"
            max="2"
            step="0.1"
          />
        </label>
        <label v-if="config.protocol === 'openai-compatible'">
          <span>存在惩罚</span>
          <input
            v-model.number="config.presencePenalty"
            type="number"
            min="-2"
            max="2"
            step="0.1"
          />
        </label>
      </div>
    </details>
    <div v-if="!assistant || selectedProfileId" class="main-api-settings__actions">
      <button
        type="button"
        class="is-primary"
        :aria-label="assistant ? '保存并用于助手' : undefined"
        @click="save()"
      >
        {{ assistant ? '保存并使用' : '保存配置' }}
      </button>
      <button type="button" :disabled="testing" aria-label="保存并测试连接" @click="test">
        {{ testing ? '测试中…' : '保存并测试' }}
      </button>
      <button
        v-if="!assistant && !isActive"
        class="main-api-settings__activate"
        type="button"
        @click="activate"
      >
        设为主 API
      </button>
      <p v-if="status" role="status">{{ status }}</p>
    </div>
  </section>
</template>

<style scoped>
.main-api-settings.main-api-settings {
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--color-line);
  border-radius: 0.75rem;
  background: var(--color-surface-raised);
}
.main-api-settings > header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  margin-bottom: 0.625rem;
}
.main-api-settings > header h3 {
  margin: 0;
  font-size: 1rem;
}
.main-api-settings > header > span {
  margin-left: auto;
  font-size: 0.75rem;
}
.main-api-settings__profilebar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 0.375rem;
  padding-bottom: 0.625rem;
  margin-bottom: 0.625rem;
  border-bottom: 1px solid var(--color-line);
}
.main-api-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 0.625rem;
}
.main-api-settings label {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
}
.main-api-settings label > span {
  color: var(--color-ink-soft);
  font-size: 0.8125rem;
}
.main-api-settings__wide {
  grid-column: 1 / -1;
}
.main-api-settings__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.625rem;
}
.main-api-settings__actions p,
.main-api-settings__activate {
  grid-column: 1 / -1;
}
.main-api-settings__actions p {
  margin: 0.25rem 0 0;
  color: var(--color-ink-soft);
  font-size: 0.8125rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.main-api-settings__profiletools {
  position: relative;
}
.main-api-settings__profiletools summary {
  display: grid;
  place-items: center;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--color-line);
  border-radius: 0.625rem;
  color: var(--color-ink);
  cursor: pointer;
  list-style: none;
  font-size: 0.8125rem;
}
.main-api-settings__profiletools summary::-webkit-details-marker {
  display: none;
}
.main-api-settings__profilemenu {
  position: absolute;
  z-index: 1;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  width: 112px;
  padding: 4px;
  border: 1px solid var(--color-line);
  border-radius: 0.625rem;
  background: var(--color-surface-raised);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-ink) 12%, transparent);
}
.main-api-settings__profilemenu button {
  width: 100%;
}
.main-api-settings__advanced {
  margin-top: 0.625rem;
  border-top: 1px solid var(--color-line);
}
.main-api-settings__advanced > summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
  color: var(--color-ink);
  cursor: pointer;
  font-size: 0.875rem;
}
.main-api-settings__advanced > summary span {
  margin-left: auto;
  color: var(--color-ink-soft);
  font-size: 0.75rem;
}
.main-api-settings__advanced .main-api-settings__grid {
  padding-bottom: 0.375rem;
}
.main-api-settings input:not([type='range']),
.main-api-settings select {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 0.625rem;
  border: 1px solid var(--color-line);
  border-radius: 0.625rem;
  background: var(--color-surface);
  color: var(--color-ink);
  font: inherit;
  font-size: 1rem;
}
.main-api-settings input[type='range'] {
  width: 100%;
  min-height: 44px;
  accent-color: var(--color-accent);
}
.main-api-settings button {
  min-height: 44px;
  padding: 0 0.625rem;
  border: 1px solid var(--color-accent);
  border-radius: 0.625rem;
  font-size: 0.8125rem;
  color: var(--color-accent);
  background: var(--color-surface-raised);
  cursor: pointer;
}
.main-api-settings .is-danger {
  border-color: var(--color-danger);
  color: var(--color-danger);
}
.main-api-settings .is-primary {
  color: white;
  background: var(--color-accent);
}
.main-api-settings button:disabled {
  opacity: 0.5;
}
.main-api-settings__intro,
.main-api-settings__hint {
  color: var(--color-ink-soft);
  font-size: 0.75rem;
  line-height: 1.45;
}
.main-api-settings__intro {
  margin: 0 0 0.5rem;
}
.main-api-settings :deep(.inline-model-picker input) {
  border-radius: 0.625rem;
  font-size: 1rem;
  background: var(--color-surface);
}
.main-api-settings :deep(.inline-model-picker button) {
  border-radius: 0.625rem;
  font-size: 0.8125rem;
}
</style>
