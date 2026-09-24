<script setup lang="ts">
import ActionSheet from './ActionSheet.vue'
import DiscordMarkdownText from './DiscordMarkdownText.vue'
import {
  useDiscordCommunitySources,
  type DiscordCommunitySourcesProps,
  type DiscordCommunitySourcesEvents,
} from '../composables/UseDiscordCommunitySources'
const props = defineProps<DiscordCommunitySourcesProps>()
const emit = defineEmits<DiscordCommunitySourcesEvents>()
const {
  loading,
  loadError,
  summaries,
  openSource,
  sourceTitle,
  sourceBadge,
  sourcePreview,
  sourceCommunityLabel,
  sourceMeta,
  statusMessage,
  detailSource,
  closeDetail,
  detailSourceDate,
  formatDate,
  COMMUNITY_SOURCE_REFRESH_MODE,
  detailLoading,
  detailChecking,
  applyingRefresh,
  checkForUpdates,
  openSourceManagement,
  detailLoadError,
  COMMUNITY_SOURCE_REMOTE_STATE,
  refreshError,
  detailMessages,
  messageElementId,
  detailSelectedMessageId,
  handleContextMenu,
  startLongPress,
  moveLongPress,
  finishLongPress,
  kindLabel,
  COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE,
  embedPresentations,
  imageAttachments,
  attachmentDisplayUrl,
  attachmentIsLocal,
  attachmentLocalLabel,
  savingAttachmentKey,
  saveAttachmentToLocal,
  attachmentSaveKey,
  fileAttachments,
  formatBytes,
  copyText,
  openActions,
  detailRevisions,
  historyOpen,
  revisionLabel,
  openRevision,
  requestRevisionRestore,
  navigationOpen,
  navigationGroups,
  navigateToMessage,
  navPreview,
  navigateToHistory,
  refreshCandidate,
  cancelRefreshDecision,
  refreshDiffRows,
  selectedRefreshMessageIds,
  refreshChangeLabel,
  refreshChangeDetails,
  refreshMode,
  refreshCanApply,
  applyRefresh,
  revisionSheetOpen,
  selectedRevision,
  revisionViewMode,
  selectedRevisionMessages,
  revisionComparison,
  actionSheetOpen,
  actionSheetActions,
  handleAction,
  deleteStarterModeOpen,
  actionSource,
  deleteMessage,
  sourceManagementOpen,
  sourceUsageCount,
  sourceManagementActions,
  handleSourceManagementAction,
  sourceDeleteConfirmOpen,
  confirmPermanentSourceDelete,
  revisionRestoreConfirmOpen,
  restoringRevision,
  confirmRevisionRestore,
} = useDiscordCommunitySources(props, emit)
</script>

<template>
  <div class="discord-community-sources">
    <p v-if="loading" class="discord-community-sources__state">正在读取已保存的 Discord 来源…</p>
    <p
      v-else-if="loadError"
      class="discord-community-sources__state discord-community-sources__state--error"
      role="alert"
    >
      {{ loadError }}
    </p>

    <div v-if="summaries.length" class="discord-source-directory">
      <article v-for="view in summaries" :key="view.source.id" class="discord-source-row">
        <button class="discord-source-open" type="button" @click="openSource(view)">
          <span class="discord-source-title">
            <strong>{{ sourceTitle(view) }}</strong>
            <span
              class="discord-source-badge"
              :class="`discord-source-badge--${sourceBadge(view).tone}`"
            >
              {{ sourceBadge(view).label }}
            </span>
          </span>
          <p>{{ sourcePreview(view) }}</p>
          <small>{{ sourceCommunityLabel(view) }} · {{ sourceMeta(view) }}</small>
        </button>
        <button
          class="discord-source-row__arrow"
          type="button"
          :aria-label="`打开 ${sourceTitle(view)}`"
          @click="openSource(view)"
        >
          ›
        </button>
      </article>
    </div>

    <p v-if="statusMessage" class="discord-community-sources__status" role="status">
      {{ statusMessage }}
    </p>
  </div>

  <Teleport to="body">
    <div
      v-if="detailSource"
      class="discord-source-detail-overlay"
      role="presentation"
      @click.self="closeDetail"
    >
      <article
        class="discord-source-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Discord 来源详情"
      >
        <header class="discord-thread-header">
          <div class="discord-thread-header__copy">
            <h3>{{ sourceTitle(detailSource) }}</h3>
            <p>
              {{ sourceCommunityLabel(detailSource) }}
              <template v-if="detailSourceDate"> · {{ detailSourceDate }}</template>
              <template v-if="detailSource.source.lastCheckedAt">
                · 上次检查 {{ formatDate(detailSource.source.lastCheckedAt) }}
              </template>
            </p>
          </div>
          <button type="button" aria-label="关闭 Discord 来源详情" @click="closeDetail">×</button>
        </header>

        <div class="discord-thread-toolbar">
          <a
            v-if="detailSource.source.discordRefreshMode === COMMUNITY_SOURCE_REFRESH_MODE.MANUAL"
            class="discord-thread-toolbar__primary"
            :href="detailSource.source.canonicalUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            前往 Discord 更新
          </a>
          <button
            v-else
            class="discord-thread-toolbar__primary"
            type="button"
            :disabled="detailLoading || detailChecking || applyingRefresh"
            @click="checkForUpdates(detailSource)"
          >
            {{ detailChecking ? '正在检查…' : '检查更新' }}
          </button>
          <button
            v-if="detailSource.source.discordRefreshMode === COMMUNITY_SOURCE_REFRESH_MODE.MANUAL"
            type="button"
            :disabled="detailLoading || detailChecking || applyingRefresh"
            @click="checkForUpdates(detailSource)"
          >
            {{ detailChecking ? '正在检查…' : '重试自动检查' }}
          </button>
          <a
            v-else
            :href="detailSource.source.canonicalUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            打开 Discord 原帖
          </a>
          <button type="button" @click="openSourceManagement(detailSource)">来源管理</button>
        </div>

        <p v-if="detailLoading" class="discord-thread-status" role="status">
          正在读取本机保存的帖子内容…
        </p>
        <p v-else-if="detailLoadError" class="discord-thread-error" role="alert">
          {{ detailLoadError }}
        </p>
        <p
          v-if="detailSource.source.remoteState === COMMUNITY_SOURCE_REMOTE_STATE.UNAVAILABLE"
          class="discord-source-unavailable"
        >
          原帖当前不可访问。本地仍保留最后一次成功保存的内容；远端删除不会反向删除本地存档。
        </p>
        <p v-if="refreshError" class="discord-thread-error" role="alert">{{ refreshError }}</p>
        <p
          v-if="detailSource.source.discordRefreshMode === COMMUNITY_SOURCE_REFRESH_MODE.MANUAL"
          class="discord-thread-status"
          role="status"
        >
          这个来源所在的社区没有安装 Discord
          Bot，因此使用手动更新。前往原帖，对需要更新的消息再次执行“保存到资源库”；SRL
          会更新已有来源，不会重复创建。
        </p>
        <p v-if="statusMessage" class="discord-thread-status" role="status">{{ statusMessage }}</p>

        <div v-if="detailSource.source.forumTags.length" class="discord-source-detail__tags">
          <span v-for="tag in detailSource.source.forumTags" :key="tag">#{{ tag }}</span>
        </div>

        <section class="discord-thread" aria-label="已保存 Discord 帖子内容">
          <article
            v-for="message in detailMessages"
            :id="messageElementId(message)"
            :key="message.id"
            class="discord-thread-message"
            :class="{ 'is-selected': detailSelectedMessageId === message.id }"
            @contextmenu="handleContextMenu($event, detailSource, message)"
            @pointerdown="startLongPress($event, detailSource, message)"
            @pointermove="moveLongPress"
            @pointerup="finishLongPress"
            @pointercancel="finishLongPress"
          >
            <header class="discord-thread-message__header">
              <span class="discord-thread-message__avatar" aria-hidden="true">
                {{ message.authorName.slice(0, 1).toUpperCase() }}
              </span>
              <span class="discord-thread-message__identity">
                <strong>
                  {{ message.authorName }}
                  <i v-if="message.authorBot">BOT</i>
                </strong>
                <small>{{ formatDate(message.timestamp) }}</small>
              </span>
              <em>{{ kindLabel(message) }}</em>
            </header>

            <p
              v-if="message.remoteState === COMMUNITY_SOURCE_MESSAGE_REMOTE_STATE.MISSING"
              class="discord-thread-message__remote-state"
            >
              Discord 原消息已删除或不可访问 · 本地副本仍保留
            </p>

            <DiscordMarkdownText
              v-if="message.content"
              class="discord-thread-message__body"
              :content="message.content"
            />

            <div v-if="message.embeds.length" class="discord-thread-embeds">
              <section
                v-for="(embed, embedIndex) in embedPresentations(message)"
                :key="`${message.id}-embed-${embedIndex}`"
                class="discord-thread-embed"
              >
                <small v-if="embed.authorName">{{ embed.authorName }}</small>
                <a
                  v-if="embed.title && embed.url"
                  class="discord-thread-embed__title"
                  :href="embed.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ embed.title }}
                </a>
                <strong v-else-if="embed.title" class="discord-thread-embed__title">
                  {{ embed.title }}
                </strong>
                <DiscordMarkdownText
                  v-if="embed.description"
                  class="discord-thread-embed__description"
                  :content="embed.description"
                />
                <div v-if="embed.fields.length" class="discord-thread-embed__fields">
                  <div v-for="(field, fieldIndex) in embed.fields" :key="fieldIndex">
                    <strong>{{ field.name }}</strong>
                    <DiscordMarkdownText :content="field.value" />
                  </div>
                </div>
                <a
                  v-if="embed.imageUrl || embed.thumbnailUrl"
                  class="discord-thread-embed__image"
                  :href="embed.imageUrl || embed.thumbnailUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    :src="embed.imageUrl || embed.thumbnailUrl"
                    alt="Discord Embed 图片"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
                <small v-if="embed.footerText" class="discord-thread-embed__footer">
                  {{ embed.footerText }}
                </small>
              </section>
            </div>

            <div v-if="imageAttachments(message).length" class="discord-thread-images">
              <div
                v-for="attachment in imageAttachments(message)"
                :key="attachment.id"
                class="discord-thread-image-item"
              >
                <a
                  v-if="attachmentDisplayUrl(attachment)"
                  :href="attachmentDisplayUrl(attachment)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :download="attachmentIsLocal(attachment) ? attachment.name : undefined"
                >
                  <img
                    :src="attachmentDisplayUrl(attachment)"
                    :alt="attachment.name"
                    loading="lazy"
                    decoding="async"
                  />
                  <span>{{ attachment.name }}</span>
                </a>
                <div class="discord-attachment-local-state">
                  <small>{{ attachmentLocalLabel(attachment) }}</small>
                  <button
                    v-if="!attachmentIsLocal(attachment)"
                    type="button"
                    :disabled="Boolean(savingAttachmentKey)"
                    @click.stop="saveAttachmentToLocal(message, attachment)"
                  >
                    {{
                      savingAttachmentKey === attachmentSaveKey(message, attachment)
                        ? '正在保存…'
                        : '保存到本机'
                    }}
                  </button>
                </div>
              </div>
            </div>

            <div v-if="fileAttachments(message).length" class="discord-thread-files">
              <div
                v-for="attachment in fileAttachments(message)"
                :key="attachment.id"
                class="discord-thread-file"
              >
                <a
                  v-if="attachmentDisplayUrl(attachment)"
                  :href="attachmentDisplayUrl(attachment)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :download="attachmentIsLocal(attachment) ? attachment.name : undefined"
                >
                  <span>
                    <strong>{{ attachment.name }}</strong>
                    <small>{{ formatBytes(attachment.size) }}</small>
                  </span>
                  <b>{{ attachmentIsLocal(attachment) ? '打开本机副本' : '打开附件 ↗' }}</b>
                </a>
                <div class="discord-attachment-local-state">
                  <small>{{ attachmentLocalLabel(attachment) }}</small>
                  <button
                    v-if="!attachmentIsLocal(attachment)"
                    type="button"
                    :disabled="Boolean(savingAttachmentKey)"
                    @click="saveAttachmentToLocal(message, attachment)"
                  >
                    {{
                      savingAttachmentKey === attachmentSaveKey(message, attachment)
                        ? '正在保存…'
                        : '保存到本机'
                    }}
                  </button>
                </div>
              </div>
            </div>

            <footer class="discord-thread-message__actions">
              <a :href="message.canonicalUrl" target="_blank" rel="noopener noreferrer">
                查看 Discord 原消息 ↗
              </a>
              <button type="button" @click="copyText(message.canonicalUrl)">复制链接</button>
              <button type="button" @click="openActions(detailSource, message)">更多操作</button>
            </footer>
          </article>

          <section
            v-if="detailRevisions.length"
            id="discord-source-history"
            class="discord-source-history"
          >
            <button
              class="discord-source-history__toggle"
              type="button"
              :aria-expanded="historyOpen"
              @click="historyOpen = !historyOpen"
            >
              <span>历史版本 · {{ detailRevisions.length }}</span>
              <span :class="{ 'is-open': historyOpen }">›</span>
            </button>
            <div v-if="historyOpen" class="discord-source-history__body">
              <article v-for="(revision, index) in detailRevisions" :key="revision.id">
                <div>
                  <strong>{{ revisionLabel(revision, index) }}</strong>
                  <small>
                    {{ revision.messages.length }} 条保存内容
                    <template v-if="revision.source.title"> · {{ revision.source.title }}</template>
                  </small>
                </div>
                <div class="discord-source-history__actions">
                  <button type="button" @click="openRevision(revision, 'view')">查看</button>
                  <button type="button" @click="openRevision(revision, 'compare')">比较</button>
                  <button type="button" @click="requestRevisionRestore(revision)">恢复</button>
                </div>
              </article>
            </div>
          </section>
        </section>
      </article>

      <button
        v-if="!detailLoading && detailMessages.length"
        class="discord-thread-nav-handle"
        :class="{ 'is-open': navigationOpen }"
        type="button"
        :aria-label="navigationOpen ? '收起帖子导航' : '展开帖子导航'"
        @click="navigationOpen = !navigationOpen"
      >
        {{ navigationOpen ? '›' : '‹' }}
      </button>

      <button
        v-if="navigationOpen"
        class="discord-thread-nav-backdrop"
        type="button"
        aria-label="关闭帖子导航"
        @click="navigationOpen = false"
      ></button>

      <aside
        class="discord-thread-nav"
        :class="{ 'is-open': navigationOpen }"
        :aria-hidden="!navigationOpen"
        aria-label="帖子导航"
      >
        <header>
          <span>
            <strong>帖子导航</strong>
            <small>{{ detailMessages.length }} 条已保存消息</small>
          </span>
          <button type="button" aria-label="关闭帖子导航" @click="navigationOpen = false">×</button>
        </header>
        <section v-for="group in navigationGroups" :key="group.id">
          <h4>{{ group.label }}</h4>
          <button
            v-for="message in group.items"
            :key="message.id"
            type="button"
            @click="navigateToMessage(message)"
          >
            <strong>
              {{ message.authorName }}
              <i v-if="message.authorBot">BOT</i>
              · {{ formatDate(message.timestamp) }}
            </strong>
            <span>{{ navPreview(message) }}</span>
          </button>
        </section>
        <section v-if="detailRevisions.length">
          <h4>存档</h4>
          <button type="button" @click="navigateToHistory">
            <strong>历史版本</strong>
            <span>{{ detailRevisions.length }} 个本地版本</span>
          </button>
        </section>
      </aside>
    </div>

    <div
      v-if="refreshCandidate"
      class="discord-refresh-sheet-wrap mobile-dialog-viewport"
      role="presentation"
      @click.self="cancelRefreshDecision"
    >
      <section
        class="discord-refresh-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-refresh-title"
      >
        <h3 id="discord-refresh-title">发现帖子更新</h3>
        <p>
          先看具体变化。新的作者 / Bot 消息可以选择是否收入本机；已有消息的修改只会在你确认后更新。
        </p>

        <div class="discord-refresh-diff">
          <div v-for="row in refreshDiffRows" :key="row.label">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>

        <div v-if="refreshCandidate.diff.changes.length" class="discord-refresh-change-list">
          <label
            v-for="change in refreshCandidate.diff.changes"
            :key="`${change.type}:${change.messageId}`"
            class="discord-refresh-change"
          >
            <input
              v-if="change.type === 'new'"
              v-model="selectedRefreshMessageIds"
              type="checkbox"
              :value="change.messageId"
            />
            <span v-else class="discord-refresh-change__marker"></span>
            <span>
              <strong>{{ refreshChangeLabel(change) }} · {{ change.authorName }}</strong>
              <small>{{ refreshChangeDetails(change) }}</small>
              <em>{{ change.summary }}</em>
            </span>
          </label>
        </div>

        <label class="discord-refresh-choice">
          <input v-model="refreshMode" type="radio" value="keep" />
          <span>
            <strong>更新并保留上一版本</strong>
            <small>先生成一个本地历史版本，再应用你确认的变化。</small>
          </span>
        </label>
        <label class="discord-refresh-choice">
          <input v-model="refreshMode" type="radio" value="replace" />
          <span>
            <strong>更新并替换上一版本</strong>
            <small>清除旧历史，只保留更新后的最新版。</small>
          </span>
        </label>

        <div class="discord-refresh-actions">
          <button type="button" :disabled="applyingRefresh" @click="cancelRefreshDecision">
            取消
          </button>
          <button
            class="discord-refresh-actions__primary"
            type="button"
            :disabled="applyingRefresh || !refreshCanApply"
            @click="applyRefresh"
          >
            {{ applyingRefresh ? '正在更新…' : '确认更新' }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="revisionSheetOpen && selectedRevision"
      class="discord-refresh-sheet-wrap mobile-dialog-viewport"
      role="presentation"
      @click.self="revisionSheetOpen = false"
    >
      <section class="discord-revision-sheet" role="dialog" aria-modal="true">
        <header class="discord-revision-sheet__header">
          <span>
            <strong>历史版本</strong>
            <small>{{ formatDate(selectedRevision.createdAt) }}</small>
          </span>
          <button type="button" aria-label="关闭历史版本" @click="revisionSheetOpen = false">
            ×
          </button>
        </header>

        <div class="discord-revision-tabs">
          <button
            type="button"
            :class="{ 'is-active': revisionViewMode === 'view' }"
            @click="revisionViewMode = 'view'"
          >
            查看版本
          </button>
          <button
            type="button"
            :class="{ 'is-active': revisionViewMode === 'compare' }"
            @click="revisionViewMode = 'compare'"
          >
            与当前比较
          </button>
        </div>

        <div v-if="revisionViewMode === 'view'" class="discord-revision-messages">
          <article v-for="message in selectedRevisionMessages" :key="message.id">
            <header>
              <strong>{{ message.authorName }}</strong>
              <span>{{ kindLabel(message) }} · {{ formatDate(message.timestamp) }}</span>
            </header>
            <p v-if="message.content">{{ message.content }}</p>
            <small v-if="message.attachments.length">
              附件：{{ message.attachments.map((attachment) => attachment.name).join('、') }}
            </small>
          </article>
        </div>

        <div v-else class="discord-revision-compare">
          <div class="discord-revision-compare__summary">
            <span
              >当前新增 <strong>{{ revisionComparison.currentOnly }}</strong></span
            >
            <span
              >历史独有 <strong>{{ revisionComparison.revisionOnly }}</strong></span
            >
            <span
              >内容不同 <strong>{{ revisionComparison.changed }}</strong></span
            >
            <span
              >相同 <strong>{{ revisionComparison.same }}</strong></span
            >
          </div>
          <div v-if="revisionComparison.items.length" class="discord-revision-compare__items">
            <article v-for="item in revisionComparison.items" :key="item.key">
              <strong>{{ item.label }} · {{ item.authorName }}</strong>
              <small>{{ item.summary }}</small>
            </article>
          </div>
          <p v-else>这个历史版本与当前保存内容一致。</p>
        </div>

        <div class="discord-refresh-actions">
          <button type="button" @click="revisionSheetOpen = false">关闭</button>
          <button
            class="discord-refresh-actions__primary"
            type="button"
            @click="requestRevisionRestore(selectedRevision)"
          >
            恢复此版本
          </button>
        </div>
      </section>
    </div>
  </Teleport>

  <ActionSheet
    v-model:open="actionSheetOpen"
    title="Discord 保存内容"
    description="这些操作只管理 SRL 本机副本。"
    :actions="actionSheetActions"
    @select="handleAction"
  />

  <ActionSheet
    v-model:open="deleteStarterModeOpen"
    title="删除首楼"
    description="这个来源还有其他已保存消息。可以只删除首楼，或转到来源管理。"
    :actions="[
      {
        id: 'starter-only',
        label: '只删除首楼快照',
        description: '保留作者补充和精选评论',
        danger: true,
      },
      {
        id: 'manage-source',
        label: '管理整个 Discord 来源',
        description: '解除关联或永久删除来源需要单独确认',
      },
    ]"
    @select="
      $event.id === 'manage-source'
        ? ((deleteStarterModeOpen = false), openSourceManagement(actionSource))
        : deleteMessage()
    "
  />

  <ActionSheet
    v-model:open="sourceManagementOpen"
    title="Discord 来源管理"
    :description="`这个来源当前被 ${sourceUsageCount} 个资源使用。`"
    :actions="sourceManagementActions"
    @select="handleSourceManagementAction"
  />

  <ActionSheet
    v-model:open="sourceDeleteConfirmOpen"
    title="永久删除本机来源"
    :description="
      sourceUsageCount > 1
        ? `这个来源仍被 ${sourceUsageCount} 个资源使用。继续后会删除全部关联、消息和历史版本；Discord 原帖不受影响。`
        : '继续后会删除这个来源的本机消息、历史版本和资源关联；Discord 原帖不受影响。'
    "
    :actions="[
      {
        id: 'confirm-delete-source',
        label: '确认永久删除',
        danger: true,
      },
    ]"
    @select="confirmPermanentSourceDelete"
  />

  <ActionSheet
    v-model:open="revisionRestoreConfirmOpen"
    title="恢复历史版本"
    description="恢复前的当前状态会先自动保存成一个新的历史版本，因此可以再次恢复回来。"
    :actions="[
      {
        id: 'confirm-restore-revision',
        label: restoringRevision ? '正在恢复…' : '确认恢复',
        disabled: restoringRevision,
      },
    ]"
    @select="confirmRevisionRestore"
  />
</template>

<style scoped src="../styles/DiscordCommunitySources.css"></style>
