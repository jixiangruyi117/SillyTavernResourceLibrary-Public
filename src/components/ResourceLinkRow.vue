<script setup lang="ts">
import { computed, ref } from 'vue'
import { createAsyncPanel } from '../core/AsyncPanel'
const GitHubResourceOverview = createAsyncPanel(
  '仓库说明',
  () => import('./GitHubResourceOverview.vue'),
)

import {
  analyzeResourceLink,
  getResourceLinkRiskBadges,
  inferResourceLinkType,
  normalizeResourceLinkUrl,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_INSTALL_TARGET_LABELS,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_PURPOSE_LABELS,
  RESOURCE_LINK_TRUST_MODE,
  RESOURCE_LINK_TYPE,
  RESOURCE_LINK_TYPE_LABELS,
  type ResourceInstallTarget,
  type ResourceLink,
  type ResourceLinkPurpose,
  type ResourceLinkType,
} from '../types/Resource'

const props = defineProps<{ link: ResourceLink }>()
const emit = defineEmits<{
  update: [link: ResourceLink]
  remove: [id: string]
}>()

const editing = ref(false)
const copyStatus = ref('')

const typeOptions = Object.values(RESOURCE_LINK_TYPE).map((value) => ({
  value,
  label: RESOURCE_LINK_TYPE_LABELS[value],
}))
const purposeOptions = Object.values(RESOURCE_LINK_PURPOSE).map((value) => ({
  value,
  label: RESOURCE_LINK_PURPOSE_LABELS[value],
}))
const installTargetOptions = Object.values(RESOURCE_INSTALL_TARGET).map((value) => ({
  value,
  label: RESOURCE_INSTALL_TARGET_LABELS[value],
}))

const normalizedUrl = computed(() => normalizeResourceLinkUrl(props.link.url))
const riskBadges = computed(() => {
  if (!normalizedUrl.value) return []
  return getResourceLinkRiskBadges({
    ...props.link,
    url: normalizedUrl.value,
    type: props.link.type || inferResourceLinkType(normalizedUrl.value),
    purpose: props.link.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST,
    installTarget: props.link.installTarget ?? RESOURCE_INSTALL_TARGET.NONE,
    trustMode: props.link.trustMode ?? RESOURCE_LINK_TRUST_MODE.LINK_ONLY,
  })
})
const displayLabel = computed(() => {
  if (props.link.label.trim()) return props.link.label.trim()
  if (props.link.type === RESOURCE_LINK_TYPE.DISCORD) return 'Discord · 手动链接'
  if (props.link.type === RESOURCE_LINK_TYPE.GITHUB) {
    return `GitHub · ${RESOURCE_LINK_PURPOSE_LABELS[props.link.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST]}`
  }
  return `${RESOURCE_LINK_TYPE_LABELS[props.link.type]} · ${RESOURCE_LINK_PURPOSE_LABELS[props.link.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST]}`
})
const versionLabel = computed(() => {
  const version = props.link.versionRef
  if (!version) return ''
  const label =
    version.kind === 'commit'
      ? 'commit'
      : version.kind === 'release'
        ? 'release'
        : version.kind === 'tag'
          ? 'tag'
          : 'branch'
  return `${label}: ${version.value}`
})

function update(patch: Partial<ResourceLink>): void {
  emit('update', { ...props.link, ...patch })
}

function normalizeDraft(): void {
  const url = normalizeResourceLinkUrl(props.link.url)
  if (!url) return
  const analysis = analyzeResourceLink(url)
  emit('update', {
    ...props.link,
    url,
    type: analysis.type ?? inferResourceLinkType(url),
    purpose: (analysis.purpose ?? props.link.purpose) as ResourceLinkPurpose,
    installTarget: (analysis.installTarget ?? props.link.installTarget) as ResourceInstallTarget,
    trustMode: analysis.trustMode ?? props.link.trustMode ?? RESOURCE_LINK_TRUST_MODE.LINK_ONLY,
    versionRef: analysis.versionRef,
    github: analysis.github,
  })
}

async function copyLink(): Promise<void> {
  if (!normalizedUrl.value) return
  try {
    await navigator.clipboard.writeText(normalizedUrl.value)
  } catch {
    const input = document.createElement('textarea')
    input.value = normalizedUrl.value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.append(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  copyStatus.value = '已复制'
  window.setTimeout(() => {
    copyStatus.value = ''
  }, 1200)
}
</script>

<template>
  <article class="source-link-row" :class="{ 'source-link-row--editing': editing }">
    <div class="source-link-row__summary">
      <div class="source-link-row__identity">
        <a v-if="normalizedUrl" :href="normalizedUrl" target="_blank" rel="noopener noreferrer">
          {{ displayLabel }}
        </a>
        <strong v-else>{{ displayLabel }}</strong>
        <small>{{ normalizedUrl || link.url || '还没有填写链接' }}</small>
      </div>
      <span class="source-link-row__purpose">
        {{ RESOURCE_LINK_PURPOSE_LABELS[link.purpose ?? RESOURCE_LINK_PURPOSE.SOURCE_POST] }}
      </span>
      <button v-if="normalizedUrl" type="button" @click="copyLink">
        {{ copyStatus || '复制' }}
      </button>
      <button type="button" @click="editing = !editing">{{ editing ? '收起' : '编辑' }}</button>
    </div>

    <GitHubResourceOverview
      v-if="link.type === RESOURCE_LINK_TYPE.GITHUB && link.github"
      :link="link"
    />
    <div v-if="editing" class="source-link-row__editor">
      <div class="source-link-row__grid">
        <label>
          <span>类型</span>
          <select
            :value="link.type"
            @change="
              update({ type: ($event.target as HTMLSelectElement).value as ResourceLinkType })
            "
          >
            <option v-for="option in typeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>用途</span>
          <select
            :value="link.purpose"
            @change="
              update({ purpose: ($event.target as HTMLSelectElement).value as ResourceLinkPurpose })
            "
          >
            <option v-for="option in purposeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>安装目标</span>
          <select
            :value="link.installTarget"
            @change="
              update({
                installTarget: ($event.target as HTMLSelectElement).value as ResourceInstallTarget,
              })
            "
          >
            <option
              v-for="option in installTargetOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          <span>名称</span>
          <input
            :value="link.label"
            maxlength="80"
            placeholder="例：作者 DC 原帖"
            @input="update({ label: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="source-link-row__url">
          <span>链接</span>
          <input
            :value="link.url"
            inputmode="url"
            maxlength="2000"
            placeholder="https://discord.com/channels/..."
            @input="update({ url: ($event.target as HTMLInputElement).value })"
            @blur="normalizeDraft"
          />
        </label>
        <label class="source-link-row__note">
          <span>备注</span>
          <textarea
            :value="link.note"
            rows="2"
            maxlength="240"
            placeholder="可选：发布社区、版本、作者说明"
            @input="update({ note: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
        </label>
      </div>

      <div v-if="riskBadges.length" class="source-link-row__badges">
        <span v-for="badge in riskBadges" :key="badge">{{ badge }}</span>
      </div>
      <p v-if="link.github || versionLabel" class="source-link-row__meta">
        <template v-if="link.github">
          GitHub：{{ link.github.owner }}/{{ link.github.repo
          }}<template v-if="link.github.path"> / {{ link.github.path }}</template>
        </template>
        <template v-if="versionLabel">{{ link.github ? ' · ' : '' }}{{ versionLabel }}</template>
      </p>
      <div class="source-link-row__footer">
        <button class="source-link-row__delete" type="button" @click="emit('remove', link.id)">
          删除这个链接
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped src="../styles/ResourceLinkRow.css"></style>
