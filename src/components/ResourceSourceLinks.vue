<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTransientStatus } from '../composables/UseTransientStatus'
import {
  analyzeResourceLink,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TRUST_MODE,
  RESOURCE_LINK_TYPE,
  type ResourceLink,
  type ResourceLinkType,
} from '../types/Resource'
import ResourceLinkRow from './ResourceLinkRow.vue'

const links = defineModel<ResourceLink[]>('links', { required: true })
const addSourceOpen = ref(false)
const addSourceUrl = ref('')
const addSourceError = ref('')
const openPlatforms = ref(new Set<'github' | 'other'>())
const { statusMessage, showTransientStatus } = useTransientStatus()

const githubLinks = computed(() =>
  links.value.filter((link) => link.type === RESOURCE_LINK_TYPE.GITHUB),
)
const otherLinks = computed(() =>
  links.value.filter((link) => link.type !== RESOURCE_LINK_TYPE.GITHUB),
)
const groups = computed(() =>
  [
    githubLinks.value.length
      ? {
          id: 'github' as const,
          label: 'GitHub',
          description: '仓库、Release、Raw 文件与文档',
          links: githubLinks.value,
        }
      : undefined,
    otherLinks.value.length
      ? {
          id: 'other' as const,
          label: '其他链接',
          description: 'Discord、官网与其他网页，仅保存 URL',
          links: otherLinks.value,
        }
      : undefined,
  ].filter((group): group is NonNullable<typeof group> => Boolean(group)),
)

function classifyLink(value: string): ResourceLinkType {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    if (hostname === 'github.com' || hostname.endsWith('.github.com'))
      return RESOURCE_LINK_TYPE.GITHUB
    if (hostname === 'discord.com' || hostname.endsWith('.discord.com'))
      return RESOURCE_LINK_TYPE.DISCORD
    if (hostname === 'patreon.com' || hostname.endsWith('.patreon.com'))
      return RESOURCE_LINK_TYPE.PATREON
    if (hostname === 'ko-fi.com' || hostname.endsWith('.ko-fi.com')) return RESOURCE_LINK_TYPE.KOFI
    return RESOURCE_LINK_TYPE.WEBSITE
  } catch {
    return RESOURCE_LINK_TYPE.OTHER
  }
}

function createLink(value: string): ResourceLink {
  const analysis = analyzeResourceLink(value)
  const type = analysis.type ?? classifyLink(value)
  return {
    id: crypto.randomUUID(),
    label: new URL(value).hostname,
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
  addSourceUrl.value = ''
  addSourceError.value = ''
  addSourceOpen.value = true
}

function submitAddSource(): void {
  const value = addSourceUrl.value.trim()
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    links.value = [...links.value, createLink(url.toString())]
    addSourceOpen.value = false
    showTransientStatus('来源链接已添加')
  } catch {
    addSourceError.value = '请输入有效的 http / https 来源链接。'
  }
}

function togglePlatform(id: 'github' | 'other'): void {
  const next = new Set(openPlatforms.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openPlatforms.value = next
}
</script>

<template>
  <section class="resource-sources" aria-labelledby="resource-sources-title">
    <header class="resource-sources__header">
      <div>
        <span id="resource-sources-title" class="field__label">来源与链接</span>
        <p>只在本机保存来源 URL；不会通过资源库作者的服务器读取或同步帖子。</p>
      </div>
    </header>
    <button class="resource-sources__add" type="button" @click="openAddSource">添加来源</button>
    <p v-if="statusMessage" class="resource-sources__status" role="status">{{ statusMessage }}</p>
    <div v-if="groups.length" class="resource-sources__directory">
      <article v-for="group in groups" :key="group.id" class="resource-source-platform">
        <button
          class="resource-source-platform__row"
          type="button"
          @click="togglePlatform(group.id)"
        >
          <span class="resource-source-platform__copy"
            ><strong>{{ group.label }}</strong
            ><small>{{ group.description }}</small></span
          >
          <span class="resource-source-platform__count">{{ group.links.length }}</span
          ><span>›</span>
        </button>
        <div v-if="openPlatforms.has(group.id)" class="resource-source-platform__body">
          <ResourceLinkRow
            v-for="link in group.links"
            :key="link.id"
            :link="link"
            @update="
              (value) => (links = links.map((item) => (item.id === value.id ? value : item)))
            "
            @remove="(id) => (links = links.filter((item) => item.id !== id))"
          />
        </div>
      </article>
    </div>
    <p v-else class="resource-sources__empty">还没有保存来源，可以添加任意普通链接。</p>
    <Teleport to="body">
      <div
        v-if="addSourceOpen"
        class="resource-source-add-wrap mobile-dialog-viewport"
        role="presentation"
        @click.self="addSourceOpen = false"
      >
        <section
          class="resource-source-add-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resource-source-add-title"
        >
          <h3 id="resource-source-add-title">添加来源</h3>
          <label class="resource-source-add-field"
            ><span>链接</span><input v-model="addSourceUrl" type="url" autofocus
          /></label>
          <p v-if="addSourceError" class="resource-source-add-error" role="alert">
            {{ addSourceError }}
          </p>
          <div class="resource-source-add-actions">
            <button type="button" @click="addSourceOpen = false">取消</button
            ><button
              class="resource-source-add-actions__primary"
              type="button"
              @click="submitAddSource"
            >
              添加
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped src="../styles/ResourceSourceLinks.css"></style>
