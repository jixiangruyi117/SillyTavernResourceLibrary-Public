<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import { mainApiService } from '../core/AppContainer'
import type { MainApiModelOption, MainApiProfile } from '../services/MainApiService'
import InlineModelPicker from './InlineModelPicker.vue'

const initialState = mainApiService.getProfilesState()
const profiles = ref<MainApiProfile[]>(initialState.profiles)
const activeProfileId = ref(initialState.activeProfileId)
const selectedProfileId = ref(initialState.activeProfileId)
const config = reactive<MainApiProfile>({ ...mainApiService.getActiveProfile() })
const status = ref('')
const testing = ref(false)
const loadingModels = ref(false)
const modelOptions = ref<MainApiModelOption[]>([])

const isActive = computed(() => config.id === activeProfileId.value)

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
  refresh(selectedProfileId.value)
  status.value = ''
}

async function save(announce = true): Promise<MainApiProfile> {
  const saved = mainApiService.saveProfile({ ...config })
  await mainApiService.awaitCredentialWrites()
  refresh(saved.id)
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
  <section class="settings-section main-api-settings">
    <header>
      <div>
        <h3>主 API 配置</h3>
      </div>
      <span>{{ profiles.length }} 个 · 仅保存在当前设备</span>
    </header>
    <p class="main-api-settings__intro">
      可以保存多套接口；标记为“当前主 API”的配置会供“前端了么”和后续 AI
      功能默认调用。网页端接口需允许浏览器 CORS，APK 使用原生 HTTP。
    </p>

    <div class="main-api-settings__profilebar">
      <label>
        <span>正在编辑</span>
        <select v-model="selectedProfileId" @change="selectProfile">
          <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }}{{ profile.id === activeProfileId ? '（主 API）' : '' }}
          </option>
        </select>
      </label>
      <button type="button" @click="addProfile">新增</button>
      <button type="button" @click="duplicateProfile">复制</button>
      <button type="button" class="is-danger" @click="removeProfile">删除</button>
    </div>

    <div class="main-api-settings__grid">
      <label class="main-api-settings__wide">
        <span>配置名称</span>
        <input v-model.trim="config.name" autocomplete="off" placeholder="例如：日常生成" />
      </label>
      <label class="main-api-settings__wide main-api-settings__credential-mode">
        <span>密钥保存方式</span>
        <select v-model="config.credentialPersistence">
          <option value="local">保存在本机（推荐）</option>
          <option value="session">仅本次使用，关闭应用后清除</option>
        </select>
        <small class="main-api-settings__hint">
          网页端由不可导出的设备密钥加密；APK 由 Android Keystore 保护。导出与云备份默认不携带密钥。
        </small>
      </label>
      <label>
        <span>接口协议</span>
        <select v-model="config.protocol">
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="anthropic-compatible">Anthropic 兼容</option>
        </select>
      </label>
      <label>
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
        <span>API 密钥（允许本地无密钥接口留空）</span>
        <input
          v-model="config.apiKey"
          type="password"
          autocomplete="new-password"
          placeholder="sk-…"
        />
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
        <small class="main-api-settings__hint">
          0
          使用服务商默认输出额度，可能低于模型最大容量；这里不另设上限。需要长输出时请填写模型支持的最大值。Anthropic
          要求大于 0。
        </small>
      </label>
      <label v-if="config.protocol === 'openai-compatible'">
        <span>频率惩罚</span>
        <input v-model.number="config.frequencyPenalty" type="number" min="-2" max="2" step="0.1" />
      </label>
      <label v-if="config.protocol === 'openai-compatible'">
        <span>存在惩罚</span>
        <input v-model.number="config.presencePenalty" type="number" min="-2" max="2" step="0.1" />
      </label>
    </div>
    <div class="main-api-settings__actions">
      <button type="button" @click="save()">保存配置</button>
      <button v-if="!isActive" type="button" @click="activate">设为主 API</button>
      <span v-else class="main-api-settings__active">当前主 API</span>
      <button type="button" class="is-primary" :disabled="testing" @click="test">
        {{ testing ? '测试中…' : '保存并测试连接' }}
      </button>
      <p role="status">{{ status }}</p>
    </div>
  </section>
</template>

<style scoped>
.main-api-settings__intro {
  margin: 0 0 0.875rem;
  color: var(--color-ink-soft);
  font-size: 0.625rem;
  line-height: 1.6;
}
.main-api-settings__profilebar {
  display: grid;
  grid-template-columns: minmax(12rem, 1fr) auto auto auto;
  align-items: end;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
  padding: 0.625rem;
  border: 1px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-line));
  background: color-mix(in srgb, var(--color-accent) 5%, var(--color-surface-raised));
}
.main-api-settings__profilebar label,
.main-api-settings label,
.main-api-settings label > span {
  display: grid;
  gap: 0.3rem;
}
.main-api-settings label > span {
  color: var(--color-ink-soft);
  font-size: 0.6rem;
}
.main-api-settings__profilebar button,
.main-api-settings__actions button {
  min-height: var(--size-touch);
  padding: 0 0.75rem;
  border: 1px solid var(--color-accent);
  border-radius: 3px;
  color: var(--color-accent);
  background: var(--color-surface-raised);
  cursor: pointer;
}
.main-api-settings__profilebar .is-danger {
  border-color: var(--color-danger, #a64038);
  color: var(--color-danger, #a64038);
}
.main-api-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
}
.main-api-settings input:not([type='range']),
.main-api-settings select {
  width: 100%;
  min-height: var(--size-touch);
  padding: 0 0.625rem;
  border: 1px solid var(--color-line);
  border-radius: 3px;
  color: var(--color-ink);
  background: var(--color-surface-raised);
  font: inherit;
  font-size: 0.72rem;
}
.main-api-settings input[type='range'] {
  width: 100%;
  accent-color: var(--color-accent);
}
.main-api-settings__hint {
  color: var(--color-ink-soft);
  font-size: 0.55rem;
  line-height: 1.45;
}
.main-api-settings__wide {
  grid-column: 1 / -1;
}
.main-api-settings__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.875rem;
}
.main-api-settings__actions .is-primary {
  color: white;
  background: var(--color-accent);
}
.main-api-settings__actions button:disabled {
  opacity: 0.5;
}
.main-api-settings__active {
  padding: 0.35rem 0.55rem;
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  font-size: 0.625rem;
}
.main-api-settings__actions p {
  flex: 1 1 100%;
  margin: 0.25rem 0 0;
  color: var(--color-ink-soft);
  font-size: 0.625rem;
  white-space: pre-wrap;
}
@media (max-width: 40rem) {
  .main-api-settings__profilebar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .main-api-settings__profilebar label {
    grid-column: 1 / -1;
  }
  .main-api-settings__profilebar button {
    padding-inline: 0.35rem;
  }
}
@media (max-width: 34rem) {
  .main-api-settings__grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .main-api-settings__wide {
    grid-column: 1;
  }
}
</style>
