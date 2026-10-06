<script setup lang="ts">
import '../FeatureStyles.css'
import { toRef, computed, type ShallowUnwrapRef } from 'vue'
import type { usePersonalResourceNavigation } from '../composables/UsePersonalResourceNavigation'
import type { useApp } from '../composables/UseApp'
import FeatureBackButton from './FeatureBackButton.vue'
import LibraryLinkImportPanel from './LibraryLinkImportPanel.vue'
import { nativeFileSize } from '../core/NativeFileSource'
type PanelModel = ShallowUnwrapRef<ReturnType<typeof useApp>>
const input = defineProps<{
  model: PanelModel
  createPersonal: ReturnType<typeof usePersonalResourceNavigation>['createPersonal']
  step: 'home' | 'resource' | 'backup' | 'other'
}>()
const isImportChooserOpen = toRef(input.model, 'isImportChooserOpen')
const pendingSharedFileBatch = toRef(input.model, 'pendingSharedFileBatch')
const cancelSharedDiscordAttachment = toRef(input.model, 'cancelSharedDiscordAttachment')
const closeImportChooser = toRef(input.model, 'closeImportChooser')
const isLinkImportOpen = toRef(input.model, 'isLinkImportOpen')
const downloadSharedDiscordAttachmentNow = toRef(input.model, 'downloadSharedDiscordAttachmentNow')
const chooseSharedImportRoute = toRef(input.model, 'chooseSharedImportRoute')
const formatBytes = toRef(input.model, 'formatBytes')
const openLinkImportPanel = toRef(input.model, 'openLinkImportPanel')
const isBusy = toRef(input.model, 'isBusy')
const openFileImportPicker = toRef(input.model, 'openFileImportPicker')
const openResourceArchivePicker = toRef(input.model, 'openResourceArchivePicker')
const openTavernBackupPicker = toRef(input.model, 'openTavernBackupPicker')
const openLibraryBackupPicker = toRef(input.model, 'openLibraryBackupPicker')
const createPersonal = toRef(input, 'createPersonal')
const panelModel = input.model
const emit = defineEmits<{ 'update:step': [step: 'home' | 'resource' | 'backup' | 'other'] }>()
const importChooserStep = computed({
  get: () => input.step,
  set: (step) => emit('update:step', step),
})
function returnToImportMenu(): void {
  if (isLinkImportOpen.value) isLinkImportOpen.value = false
  else importChooserStep.value = 'home'
}
</script>
<template>
  <div
    v-if="isImportChooserOpen"
    class="import-choice-overlay"
    role="presentation"
    @click.self="
      pendingSharedFileBatch?.discordAttachment
        ? cancelSharedDiscordAttachment()
        : closeImportChooser()
    "
  >
    <section
      class="import-choice-sheet"
      :class="{ 'import-choice-sheet--link': isLinkImportOpen }"
      role="dialog"
      aria-modal="true"
      :aria-label="isLinkImportOpen ? '链接导入' : '选择导入方式'"
    >
      <header>
        <FeatureBackButton
          v-if="!pendingSharedFileBatch && (isLinkImportOpen || importChooserStep !== 'home')"
          label="返回导入方式"
          @click="returnToImportMenu"
        />
        <span class="import-choice-sheet__header-title">
          <small v-if="isLinkImportOpen">LINK IMPORT</small>
          <strong>
            {{
              isLinkImportOpen
                ? '导入脚本 / 外部扩展链接'
                : pendingSharedFileBatch
                  ? '选择分享文件用途'
                  : importChooserStep === 'home'
                    ? '导入'
                    : importChooserStep === 'resource'
                      ? '导入资源'
                      : importChooserStep === 'backup'
                        ? '导入备份'
                        : '其他资源'
            }}
          </strong>
        </span>
        <button
          class="import-choice-sheet__close"
          type="button"
          aria-label="关闭导入"
          @click="
            pendingSharedFileBatch?.discordAttachment
              ? cancelSharedDiscordAttachment()
              : closeImportChooser()
          "
        >
          ×
        </button>
      </header>

      <section v-if="pendingSharedFileBatch" class="shared-import-routes">
        <template v-if="pendingSharedFileBatch.discordAttachment">
          <p>收到一个 Discord 附件直链，请核对文件后选择是否导入：</p>
          <ul>
            <li>{{ pendingSharedFileBatch.discordAttachment.name }}</li>
            <li>来源：cdn.discordapp.com</li>
            <li>下载时会校验实际响应并按资源文件导入</li>
          </ul>
          <p v-if="pendingSharedFileBatch.discordAttachment.error" role="alert">
            上次下载失败：{{ pendingSharedFileBatch.discordAttachment.error }}。可以重试或取消。
          </p>
          <button type="button" @click="downloadSharedDiscordAttachmentNow">
            <strong>下载并导入</strong>
            <small>下载附件到本机并按角色卡、世界书等资源识别</small>
          </button>
          <button type="button" @click="cancelSharedDiscordAttachment">
            <strong>取消</strong>
            <small>丢弃这条分享链接，不保存为资源链接</small>
          </button>
        </template>
        <template v-else>
          <div
            v-if="pendingSharedFileBatch.interrupted"
            class="shared-import-recovery"
            role="status"
          >
            <strong>检测到上次导入中断</strong>
            <p>继续时会核对已完成内容，并重新尝试尚未完成的项目。</p>
            <button
              v-if="pendingSharedFileBatch.route"
              type="button"
              @click="chooseSharedImportRoute(pendingSharedFileBatch.route)"
            >
              继续上次导入
            </button>
          </div>
          <p>收到 {{ pendingSharedFileBatch.files.length }} 个分享文件，请选择导入用途：</p>
          <ul>
            <li v-for="file in pendingSharedFileBatch.files" :key="`${file.name}-${file.size}`">
              {{ file.name }} · {{ formatBytes(nativeFileSize(file)) }}
            </li>
          </ul>
          <button type="button" @click="chooseSharedImportRoute('libraryBackup')">
            <strong>导入资源库备份</strong>
            <small>SRL 导出的完整或选择性备份 ZIP；进入资源库恢复预检</small>
          </button>
          <button type="button" @click="chooseSharedImportRoute('tavernBackup')">
            <strong>导入酒馆备份</strong>
            <small>SillyTavern 完整备份 ZIP；仅提取支持的资源文件</small>
          </button>
          <button type="button" @click="chooseSharedImportRoute('resource')">
            <strong>导入资源</strong>
            <small>角色卡、世界书、正则、预设等资源文件或酒馆资源 ZIP</small>
          </button>
          <button type="button" @click="chooseSharedImportRoute('thirdPartyApp')">
            <strong>导入第三方 APP</strong>
            <small>HTML、ZIP 或 .srlapp；先预览并检查权限，再由你确认安装</small>
          </button>
        </template>
      </section>

      <template v-else-if="!isLinkImportOpen && importChooserStep === 'home'">
        <button
          class="import-choice-card import-choice-card--link"
          type="button"
          @click="openLinkImportPanel"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1l-.8.8" />
              <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>链接</small>
            <strong>链接导入</strong>
            <em>导入脚本、外部扩展或资源链接</em>
          </span>
        </button>
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="importChooserStep = 'resource'"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>本地文件</small>
            <strong>资源</strong>
            <em>选择单个资源文件，或导入包含多项资源的压缩包</em>
          </span>
        </button>
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="importChooserStep = 'backup'"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7h16v12H4zM7 4h10v3M8 11h8M8 15h5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>备份文件</small>
            <strong>备份</strong>
            <em>选择酒馆备份或资源库备份，进入对应恢复流程</em>
          </span>
        </button>
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="importChooserStep = 'other'"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 5h16v14H4zM8 9h8M8 13h5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>个人资料</small>
            <strong>其他资源</strong>
            <em>新建番外指令、收纳小手机或保存密钥资料</em>
          </span>
        </button>
      </template>

      <template v-else-if="!isLinkImportOpen && importChooserStep === 'resource'">
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="openFileImportPicker"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>可多选</small>
            <strong>单个资源文件</strong>
            <em>选择一个或多个 PNG、JSON、聊天、美化等资源文件</em>
          </span>
        </button>
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="openResourceArchivePicker"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7h16v13H4zM4 10h16M9 4h6M9 13h6M9 16h6" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>ZIP 压缩包</small>
            <strong>资源合集压缩包</strong>
            <em>从一个压缩包中提取多项资源；备份包请从“备份”进入</em>
          </span>
        </button>
      </template>

      <template v-else-if="!isLinkImportOpen && importChooserStep === 'backup'">
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="openTavernBackupPicker"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7h16v12H4zM7 4h10v3M8 11h8M8 15h5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>SillyTavern</small>
            <strong>酒馆备份</strong>
            <em>提取备份中受支持的角色卡、世界书、预设与美化资源</em>
          </span>
        </button>
        <button
          class="import-choice-card"
          type="button"
          :disabled="isBusy"
          @click="openLibraryBackupPicker"
        >
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7h16v13H4zM4 10h16M8 4h8M8 14h8M8 17h5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>SRL</small>
            <strong>资源库备份</strong>
            <em>检查备份内容后，选择覆盖或合并恢复</em>
          </span>
        </button>
      </template>

      <template v-else-if="!isLinkImportOpen && importChooserStep === 'other'">
        <button class="import-choice-card" type="button" @click="createPersonal('extraStory')">
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>个人资料</small>
            <strong>添加番外指令</strong>
            <em>创建一份新的番外指令资料</em>
          </span>
        </button>
        <button class="import-choice-card" type="button" @click="createPersonal('pocketPhone')">
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M7 3h10v18H7zM10 6h4M11 18h2" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>个人资料</small>
            <strong>收纳小手机</strong>
            <em>创建并整理一份小手机内容</em>
          </span>
        </button>
        <button class="import-choice-card" type="button" @click="createPersonal('secret')">
          <span class="import-choice-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3" />
            </svg>
          </span>
          <span class="import-choice-card__copy">
            <small>个人资料</small>
            <strong>保存密钥资料</strong>
            <em>在加密保护下新建密钥资料</em>
          </span>
        </button>
      </template>

      <LibraryLinkImportPanel v-else :model="panelModel" />
    </section>
  </div>
</template>
