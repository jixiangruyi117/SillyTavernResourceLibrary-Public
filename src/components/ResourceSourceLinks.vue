<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useTransientStatus } from '../composables/UseTransientStatus'
import { communitySourceService } from '../core/CommunitySourceRuntime'
import {
  parseDiscordMessageUrl,
  readDiscordSourceFromUrl,
} from '../services/DiscordSourceRefreshService'
import { COMMUNITY_SOURCE_MESSAGE_KIND } from '../types/CommunitySource'
import {
  analyzeResourceLink,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TRUST_MODE,
  RESOURCE_LINK_TYPE,
  type ResourceLink,
  type ResourceLinkType,
} from '../types/Resource'
import DiscordCommunitySources from './DiscordCommunitySources.vue'
import ResourceLinkAdvancedSettings from './ResourceLinkAdvancedSettings.vue'
import ResourceLinkRow from './ResourceLinkRow.vue'

type PlatformGroupId = 'discord' | 'github' | 'other'
type AddSourceMode = 'link' | 'post'

const props = defineProps<{ resourceId: string }>()
const links = defineModel<ResourceLink[]>('links', { required: true })

const advancedOpen = ref(false)
const openPlatforms = ref(new Set<PlatformGroupId>())
const discordManualOpen = ref(false)
const discordCommunityCount = ref(0)
const communityRevision = ref(0)
const addSourceOpen = ref(false)
const addSourceUrl = ref('')
const addSourceMode = ref<AddSourceMode>('post')
const addSourceBusy = ref(false)
const addSourceError = ref('')
const { statusMessage, showTransientStatus } = useTransientStatus()
let addSourceController: AbortController | undefined

const discordLinks = computed(() =>
  links.value.filter((link) => link.type === RESOURCE_LINK_TYPE.DISCORD),
)
const githubLinks = computed(() =>
  links.value.filter((link) => link.type === RESOURCE_LINK_TYPE.GITHUB),
)
const otherLinks = computed(() =>
  links.value.filter(
    (link) => link.type !== RESOURCE_LINK_TYPE.DISCORD && link.type !== RESOURCE_LINK_TYPE.GITHUB,
  ),
)
const groups = computed(() =>
  [
    discordLinks.value.length || discordCommunityCount.value
      ? {
          id: 'discord' as const,
          label: 'Discord',
          description: '已保存的社区发布来源与手动链接',
          count: discordLinks.value.length + discordCommunityCount.value,
          links: discordLinks.value,
        }
      : undefined,
    githubLinks.value.length
      ? {
          id: 'github' as const,
          label: 'GitHub',
          description: '仓库、Release、Raw 文件与文档',
          count: githubLinks.value.length,
          links: githubLinks.value,
        }
      : undefined,
    otherLinks.value.length
      ? {
          id: 'other' as const,
          label: '其他链接',
          description: '官网、Patreon、Ko-fi 与其他网页',
          count: otherLinks.value.length,
          links: otherLinks.value,
        }
      : undefined,
  ].flatMap((group) => (group ? [group] : [])),
)

function classifyLink(value: string): ResourceLinkType {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase()
    if (
      hostname === 'discord.com' ||
      hostname === 'www.discord.com' ||
      hostname === 'ptb.discord.com' ||
      hostname === 'canary.discord.com'
    ) {
      return RESOURCE_LINK_TYPE.DISCORD
    }
    if (hostname === 'github.com' || hostname.endsWith('.github.com'))
      return RESOURCE_LINK_TYPE.GITHUB
    if (hostname === 'patreon.com' || hostname.endsWith('.patreon.com'))
      return RESOURCE_LINK_TYPE.PATREON
    if (hostname === 'ko-fi.com' || hostname.endsWith('.ko-fi.com')) return RESOURCE_LINK_TYPE.KOFI
    return RESOURCE_LINK_TYPE.WEBSITE
  } catch {
    return RESOURCE_LINK_TYPE.OTHER
  }
}

function createLink(value: string): ResourceLink {
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `resource-link-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const analysis = analyzeResourceLink(value)
  const type = analysis.type ?? classifyLink(value)
  let label: string
  try {
    label = new URL(value).hostname
  } catch {
    label = '来源链接'
  }
  return {
    id,
    label,
    url: value,
    type,
    note: '',
    purpose: analysis.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST,
    installTarget: analysis.installTarget ?? RESOURCE_INSTALL_TARGET.NONE,
    trustMode: analysis.trustMode ?? RESOURCE_LINK_TRUST_MODE.LINK_ONLY,
    createdAt: Date.now(),
    ...(analysis.github ? { github: analysis.github } : {}),
    ...(analysis.versionRef ? { versionRef: analysis.versionRef } : {}),
  }
}

function openAddSource(): void {
  addSourceController?.abort()
  addSourceUrl.value = ''
  addSourceMode.value = 'post'
  addSourceError.value = ''
  addSourceBusy.value = false
  addSourceOpen.value = true
}

function closeAddSource(): void {
  if (addSourceBusy.value) return
  addSourceController?.abort()
  addSourceController = undefined
  addSourceOpen.value = false
  addSourceError.value = ''
}

function openPlatform(id: PlatformGroupId): void {
  const next = new Set(openPlatforms.value)
  next.add(id)
  openPlatforms.value = next
}

function finishCommunitySourceAdd(message: string): void {
  addSourceOpen.value = false
  openPlatform('discord')
  communityRevision.value += 1
  window.dispatchEvent(new Event('srl:community-sources-changed'))
  showTransientStatus(message)
}

function localizeAttachmentsInBackground(sourceId: string, messageIds: readonly string[]): void {
  if (!sourceId || !messageIds.length) return
  void communitySourceService
    .localizeSavedMessagesAttachments(sourceId, messageIds)
    .catch(() => undefined)
    .finally(() => {
      window.dispatchEvent(
        new CustomEvent('srl:community-source-attachments-updated', { detail: { sourceId } }),
      )
    })
}

async function submitAddSource(): Promise<void> {
  if (addSourceBusy.value) return
  const value = addSourceUrl.value.trim()
  if (!value) {
    addSourceError.value = '请先粘贴来源链接。'
    return
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    addSourceError.value = '链接格式不正确。'
    return
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    addSourceError.value = '来源链接只支持 http / https。'
    return
  }

  addSourceError.value = ''
  if (addSourceMode.value === 'link') {
    const link = createLink(parsed.toString())
    links.value = [...links.value, link]
    if (link.type === RESOURCE_LINK_TYPE.DISCORD) {
      openPlatform('discord')
      discordManualOpen.value = true
    } else if (link.type === RESOURCE_LINK_TYPE.GITHUB) {
      openPlatform('github')
    } else {
      openPlatform('other')
    }
    addSourceOpen.value = false
    showTransientStatus('来源链接已添加')
    return
  }

  const discordUrl = parseDiscordMessageUrl(parsed.toString())
  if (!discordUrl) {
    addSourceError.value = '读取完整帖子目前只支持 Discord 消息链接；其他链接请选择“仅保存链接”。'
    return
  }

  addSourceBusy.value = true
  addSourceController?.abort()
  addSourceController = new AbortController()
  const controller = addSourceController
  const timer = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const remote = await readDiscordSourceFromUrl(parsed.toString(), controller.signal)
    if (remote.state === 'uncheckable') {
      addSourceError.value =
        'Discord Bot 无法直接读取这个社区。请在 Discord 中对目标消息执行“保存到资源库”，由消息命令传回可保存的快照。'
      return
    }
    if (remote.state === 'unavailable') {
      addSourceError.value = 'Discord 原帖当前不可访问，无法完成首次读取。'
      return
    }
    const starter = remote.captures.find((capture) => capture.isStarter) ?? remote.captures[0]
    if (!starter) throw new Error('Discord Bridge 没有返回可保存的帖子内容。')

    const existing = await communitySourceService.findDiscordSourceForCapture(starter)
    if (existing) {
      const alreadyBound = existing.bindings.some(
        (binding) => binding.resourceId === props.resourceId,
      )
      if (!alreadyBound)
        await communitySourceService.bindSource(props.resourceId, existing.source.id)

      const requested = remote.captures.find(
        (capture) => capture.messageId === discordUrl.messageId,
      )
      const requestedAlreadySaved = Boolean(
        requested && existing.messages.some((message) => message.messageId === requested.messageId),
      )
      let addedRequestedMessage = false
      if (
        requested &&
        !requestedAlreadySaved &&
        requested.messageId !== existing.source.starterMessageId
      ) {
        const saved = await communitySourceService.saveDiscordCapture(requested, {
          kind:
            existing.source.starterAuthorId &&
            requested.authorId === existing.source.starterAuthorId
              ? COMMUNITY_SOURCE_MESSAGE_KIND.AUTHOR_UPDATE
              : COMMUNITY_SOURCE_MESSAGE_KIND.SELECTED_COMMENT,
          deferAttachmentLocalization: true,
        })
        localizeAttachmentsInBackground(saved.source.id, [requested.messageId])
        addedRequestedMessage = true
      }

      finishCommunitySourceAdd(
        addedRequestedMessage
          ? alreadyBound
            ? '已添加到现有 Discord 来源'
            : '已关联已有来源，并保存这条补充消息'
          : alreadyBound
            ? '这个 Discord 来源已经在当前资源中'
            : '已关联已有 Discord 来源',
      )
      return
    }

    const ordered = [starter, ...remote.captures.filter((capture) => capture !== starter)]
    let sourceId = ''
    const messageIds: string[] = []
    for (let index = 0; index < ordered.length; index += 1) {
      const capture = ordered[index]
      const saved = await communitySourceService.saveDiscordCapture(capture, {
        ...(index === 0 ? { resourceId: props.resourceId } : {}),
        deferAttachmentLocalization: true,
      })
      sourceId = saved.source.id
      messageIds.push(capture.messageId)
    }
    finishCommunitySourceAdd('Discord 帖子正文已保存；附件会继续在后台保存到本机')
    localizeAttachmentsInBackground(sourceId, messageIds)
  } catch (error) {
    addSourceError.value =
      error instanceof DOMException && error.name === 'AbortError'
        ? '读取 Discord 帖子超时，请确认 Bridge 和网络可以正常访问。'
        : error instanceof Error
          ? error.message
          : '读取 Discord 帖子失败'
  } finally {
    window.clearTimeout(timer)
    if (addSourceController === controller) addSourceController = undefined
    addSourceBusy.value = false
  }
}

function updateLink(updated: ResourceLink): void {
  links.value = links.value.map((link) => (link.id === updated.id ? updated : link))
}

function removeLink(id: string): void {
  links.value = links.value.filter((link) => link.id !== id)
}

function togglePlatform(id: PlatformGroupId): void {
  const next = new Set(openPlatforms.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openPlatforms.value = next
}

function handleCommunitySourcesChanged(): void {
  communityRevision.value += 1
}

onMounted(() => {
  window.addEventListener('srl:community-sources-changed', handleCommunitySourcesChanged)
})

onBeforeUnmount(() => {
  addSourceController?.abort()
  window.removeEventListener('srl:community-sources-changed', handleCommunitySourcesChanged)
})
</script>

<template>
  <section class="resource-sources" aria-labelledby="resource-sources-title">
    <header class="resource-sources__header">
      <div>
        <span id="resource-sources-title" class="field__label">来源与链接</span>
        <p>发布来源保持独立。完整帖子保存在本机；远端变化不会自动删除本地内容。</p>
      </div>
      <button class="resource-sources__advanced" type="button" @click="advancedOpen = true">
        高级设置 ›
      </button>
    </header>

    <button class="resource-sources__add" type="button" @click="openAddSource">添加来源</button>
    <p v-if="statusMessage" class="resource-sources__status" role="status">
      {{ statusMessage }}
    </p>

    <div v-if="groups.length" class="resource-sources__directory">
      <article
        v-for="group in groups"
        :key="group.id"
        class="resource-source-platform"
        :class="{ 'resource-source-platform--open': openPlatforms.has(group.id) }"
      >
        <button
          class="resource-source-platform__row"
          type="button"
          @click="togglePlatform(group.id)"
        >
          <i :class="`resource-source-platform__mark--${group.id}`"></i>
          <span class="resource-source-platform__copy">
            <strong>{{ group.label }}</strong>
            <small>{{ group.description }}</small>
          </span>
          <span class="resource-source-platform__count">{{ group.count }}</span>
          <span class="resource-source-platform__chevron">›</span>
        </button>

        <div v-if="openPlatforms.has(group.id)" class="resource-source-platform__body">
          <template v-if="group.id === 'discord'">
            <DiscordCommunitySources
              :key="`${props.resourceId}:${communityRevision}`"
              :resource-id="props.resourceId"
              @count="discordCommunityCount = $event"
            />

            <template v-if="group.links.length">
              <button
                class="resource-source-subgroup"
                type="button"
                :aria-expanded="discordManualOpen"
                @click="discordManualOpen = !discordManualOpen"
              >
                <span>
                  <strong>手动链接</strong>
                  <small>仅保存 URL 的来源，可编辑或删除</small>
                </span>
                <em>{{ group.links.length }}</em>
                <b :class="{ 'is-open': discordManualOpen }">›</b>
              </button>
              <div v-if="discordManualOpen" class="resource-source-link-list">
                <ResourceLinkRow
                  v-for="link in group.links"
                  :key="link.id"
                  :link="link"
                  @update="updateLink"
                  @remove="removeLink"
                />
              </div>
            </template>
          </template>

          <div v-else class="resource-source-link-list">
            <ResourceLinkRow
              v-for="link in group.links"
              :key="link.id"
              :link="link"
              @update="updateLink"
              @remove="removeLink"
            />
          </div>
        </div>
      </article>
    </div>

    <div v-else class="resource-sources__discord-probe">
      <DiscordCommunitySources
        :key="`${props.resourceId}:${communityRevision}:probe`"
        :resource-id="props.resourceId"
        @count="discordCommunityCount = $event"
      />
    </div>

    <p v-if="!groups.length && discordCommunityCount === 0" class="resource-sources__empty">
      还没有保存来源。可以添加普通链接，或读取并保存 Discord 帖子。
    </p>

    <p class="resource-sources__hint">
      这里只显示实际存在的平台。Discord 完整正文使用独立本地来源存储，不会塞进资源列表摘要。
    </p>
  </section>

  <ResourceLinkAdvancedSettings
    v-if="advancedOpen"
    :context-resource-id="props.resourceId"
    @close="advancedOpen = false"
  />

  <Teleport to="body">
    <div
      v-if="addSourceOpen"
      class="resource-source-add-wrap mobile-dialog-viewport"
      role="presentation"
      @click.self="closeAddSource"
    >
      <section
        class="resource-source-add-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-source-add-title"
      >
        <h3 id="resource-source-add-title">添加来源</h3>
        <p>直接粘贴链接。Discord 消息可以仅保存 URL，也可以读取并保存完整帖子。</p>

        <label class="resource-source-add-field">
          <span>链接</span>
          <input
            v-model="addSourceUrl"
            type="url"
            inputmode="url"
            autocomplete="off"
            maxlength="2000"
            placeholder="https://discord.com/channels/..."
            :disabled="addSourceBusy"
          />
        </label>

        <label class="resource-source-add-choice">
          <input v-model="addSourceMode" type="radio" value="link" :disabled="addSourceBusy" />
          <span>
            <strong>仅保存链接</strong>
            <small>保存为普通来源链接，之后可编辑或删除。</small>
          </span>
        </label>
        <label class="resource-source-add-choice">
          <input v-model="addSourceMode" type="radio" value="post" :disabled="addSourceBusy" />
          <span>
            <strong>读取并保存帖子</strong>
            <small>Discord 专用；读取正文、Embed、附件信息，并支持后续手动检查更新。</small>
          </span>
        </label>

        <p v-if="addSourceError" class="resource-source-add-error" role="alert">
          {{ addSourceError }}
        </p>

        <div class="resource-source-add-actions">
          <button type="button" :disabled="addSourceBusy" @click="closeAddSource">取消</button>
          <button
            class="resource-source-add-actions__primary"
            type="button"
            :disabled="addSourceBusy"
            @click="submitAddSource"
          >
            {{ addSourceBusy ? '正在读取…' : '添加' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="../styles/ResourceSourceLinks.css"></style>
