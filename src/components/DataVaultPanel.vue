<script setup lang="ts">
import { ref } from 'vue'

import type { BackupRecord } from '../types/Resource'
import type { VaultStatus } from '../types/Vault'
import FeatureBackButton from './FeatureBackButton.vue'

defineProps<{
  status: VaultStatus
  snapshots: BackupRecord[]
  busy: boolean
  required?: boolean
}>()
const emit = defineEmits<{
  close: []
  unlock: [password: string]
  enable: [password: string]
  disable: []
  lock: []
  snapshot: []
  restore: [id: string]
  delete: [id: string]
}>()

const password = ref('')
const confirmation = ref('')
const localError = ref('')
const showPassword = ref(false)

function finishKeyboardInput(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}

function submitUnlock(): void {
  localError.value = ''
  if (!password.value) {
    localError.value = '请输入加密密码'
    return
  }
  finishKeyboardInput()
  emit('unlock', password.value)
}

function submitEnable(): void {
  localError.value = ''
  if (password.value.length < 8) {
    localError.value = '密码至少需要 8 个字符'
    return
  }
  if (password.value !== confirmation.value) {
    localError.value = '两次输入的密码不一致'
    return
  }
  finishKeyboardInput()
  emit('enable', password.value)
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatBytes(value = 0): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <Teleport to="body">
    <div
      class="editor-overlay vault-overlay"
      role="presentation"
      @click.self="!required && emit('close')"
    >
      <section
        class="editor-sheet vault-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-panel-title"
      >
        <header class="editor-sheet__header vault-sheet__header">
          <FeatureBackButton
            v-if="!required"
            class="vault-sheet__back"
            label="返回资源库"
            @click="emit('close')"
          />
          <div>
            <h2 id="vault-panel-title">
              {{ status.locked ? '解锁本地保险库' : '加密与历史版本' }}
            </h2>
          </div>
          <button
            v-if="!required"
            class="editor-sheet__close"
            type="button"
            aria-label="关闭"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <section v-if="status.locked" class="vault-unlock">
          <div class="vault-unlock__seal" aria-hidden="true">
            <span></span>
          </div>
          <h3>资源库已加密</h3>
          <p>密码只用于当前会话解锁，不会保存在浏览器中。</p>
          <form class="vault-password-form" @submit.prevent="submitUnlock">
            <label>
              <span>加密密码</span>
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                enterkeyhint="done"
                autofocus
              />
            </label>
            <label class="vault-password-form__show">
              <input v-model="showPassword" type="checkbox" />
              <span>显示密码</span>
            </label>
            <p v-if="localError" class="vault-password-form__error">{{ localError }}</p>
            <button class="button button--primary" type="submit" :disabled="busy">
              {{ busy ? '正在解密…' : '解锁资源库' }}
            </button>
          </form>
          <p class="vault-warning">忘记密码无法恢复。请另行保存密码和完整 ZIP 备份。</p>
        </section>

        <div v-else class="vault-sheet__content">
          <section class="vault-section" aria-labelledby="encryption-title">
            <div class="vault-section__heading">
              <div>
                <h3 id="encryption-title">本地数据加密</h3>
              </div>
              <span class="vault-state" :class="{ 'vault-state--active': status.enabled }">
                {{ status.enabled ? '已开启' : '未开启' }}
              </span>
            </div>

            <template v-if="status.enabled">
              <p class="vault-section__description">
                资源名称、标签、解析内容、原文件、缩略图和历史快照均已加密。内容指纹仅用于本机去重。
              </p>
              <div class="vault-section__actions">
                <button
                  class="button button--quiet"
                  type="button"
                  :disabled="busy"
                  @click="emit('lock')"
                >
                  立即锁定
                </button>
                <button
                  class="text-button text-button--danger"
                  type="button"
                  :disabled="busy"
                  @click="emit('disable')"
                >
                  关闭并解密本地数据
                </button>
              </div>
            </template>

            <form
              v-else
              class="vault-password-form vault-password-form--enable"
              @submit.prevent="submitEnable"
            >
              <p class="vault-section__description">
                开启后使用 PBKDF2 从密码派生密钥，再以 AES-256-GCM
                加密数据。迁移在单个本地事务中完成。
              </p>
              <div class="vault-password-form__pair">
                <label>
                  <span>设置密码</span>
                  <input
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    minlength="8"
                    autocomplete="new-password"
                    enterkeyhint="next"
                  />
                </label>
                <label>
                  <span>再次输入</span>
                  <input
                    v-model="confirmation"
                    :type="showPassword ? 'text' : 'password'"
                    minlength="8"
                    autocomplete="new-password"
                    enterkeyhint="done"
                  />
                </label>
              </div>
              <label class="vault-password-form__show">
                <input v-model="showPassword" type="checkbox" />
                <span>显示密码</span>
              </label>
              <p v-if="localError" class="vault-password-form__error">{{ localError }}</p>
              <button class="button button--primary" type="submit" :disabled="busy">
                {{ busy ? '正在加密…' : '开启本地加密' }}
              </button>
              <p class="vault-warning">密码不会上传或保存。忘记密码后，加密数据无法找回。</p>
            </form>
          </section>

          <section class="vault-section vault-history" aria-labelledby="history-title">
            <div class="vault-section__heading">
              <div>
                <h3 id="history-title">历史版本</h3>
              </div>
              <button
                class="button button--quiet"
                type="button"
                :disabled="busy"
                @click="emit('snapshot')"
              >
                创建快照
              </button>
            </div>
            <p class="vault-section__description">
              最多保留 8 个完整快照。整库恢复和保险库转换前会自动留存版本；日常删除可在回收站恢复。
            </p>

            <div v-if="snapshots.length" class="vault-history__list">
              <article v-for="snapshot in snapshots" :key="snapshot.id" class="vault-history__item">
                <div class="vault-history__copy">
                  <strong>{{ snapshot.reason || '本地快照' }}</strong>
                  <span>{{ formatDate(snapshot.createdAt) }}</span>
                  <small>
                    {{ snapshot.resourceCount }} 项资源 · {{ snapshot.categoryCount || 0 }} 个文件夹
                    ·
                    {{ formatBytes(snapshot.size) }}
                    <template v-if="snapshot.encrypted"> · 已加密</template>
                  </small>
                </div>
                <div class="vault-history__actions">
                  <button type="button" :disabled="busy" @click="emit('restore', snapshot.id)">
                    恢复
                  </button>
                  <button
                    class="vault-history__delete"
                    type="button"
                    :disabled="busy"
                    @click="emit('delete', snapshot.id)"
                  >
                    删除
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="vault-history__empty">
              <strong>还没有历史版本</strong>
              <span>创建第一个快照，以后可以将整个资源库回退到此时。</span>
            </div>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
