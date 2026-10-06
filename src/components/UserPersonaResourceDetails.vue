<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { userPersonaService } from '../core/AppContainer'
import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'
import type { Resource, ResourceSummary } from '../types/Resource'
import type { UserPersonaBackupView, UserPersonaEntry } from '../types/UserPersona'
import { resolveUserPersonaProfile } from '../utils/UserPersonaProfile'

const props = defineProps<{ resource: Resource; relatedResources?: ResourceSummary[] }>()
const page = ref<'home' | 'characters' | 'versions' | 'global' | 'variant'>('home')
const view = ref<UserPersonaBackupView>()
const selectedAvatarId = ref('')
const characterId = ref('')
const versionId = ref('')
const error = ref('')
const entries = computed(() => view.value?.entries ?? [])
const entry = computed(() => entries.value.find((item) => item.avatarId === selectedAvatarId.value))
const version = computed(
  () => entry.value?.profile.variants[characterId.value]?.versions[versionId.value],
)
const characters = computed(() => {
  const current = entry.value
  if (!current) return []
  return resolveCharacterRows(Object.keys(current.profile.variants)).map((character) => ({
    ...character,
    count: Object.keys(current.profile.variants[character.id]?.versions ?? {}).length,
  }))
})
function resolveCharacterRows(ids: string[]) {
  const current = entry.value
  if (!current) return []
  return ids.map((id) => {
    const snapshot = current.characterBindings[id]
    const related = props.relatedResources?.find((resource) =>
      snapshot
        ? resource.contentHash === snapshot.hash
        : resource.fileName === id || `${resource.name}.png` === id,
    )
    return {
      id,
      name: related?.name ?? snapshot?.name ?? id.replace(/\.png$/i, ''),
      status: related
        ? '已关联资源库角色卡'
        : snapshot
          ? '保留酒馆角色卡信息，可随人设传回'
          : '保留酒馆角色卡标识，尚未匹配资源库',
    }
  })
}
const profileCharacterRows = computed(() =>
  resolveCharacterRows(Object.keys(entry.value?.profile.variants ?? {})),
)

async function load(): Promise<void> {
  error.value = ''
  try {
    const result = await userPersonaService.load(props.resource.id)
    view.value = parseSillyTavernPersonaBackup(result.view.raw)
    const selected =
      view.value.entries.find((item) => item.avatarId === selectedAvatarId.value) ??
      view.value.entries.find((item) => item.avatarId === view.value?.defaultPersona) ??
      view.value.entries[0]
    if (!selected) throw new Error('这份用户人设文件没有可展示的内容。')
    selectEntry(selected)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '读取用户人设失败'
  }
}

function selectEntry(item: UserPersonaEntry): void {
  selectedAvatarId.value = item.avatarId
}

function changeEntry(event: Event): void {
  const selected = entries.value.find(
    (item) => item.avatarId === (event.target as HTMLSelectElement).value,
  )
  if (selected) selectEntry(selected)
}

function openCharacter(id: string): void {
  characterId.value = id
  const variants = entry.value?.profile.variants[id]
  if (!variants) return
  if (Object.keys(variants.versions).length > 1) page.value = 'versions'
  else {
    versionId.value = variants.defaultVersionId
    page.value = 'variant'
  }
}

function openVersion(id: string): void {
  if (!entry.value?.profile.variants[characterId.value]?.versions[id]) return
  versionId.value = id
  page.value = 'variant'
}

function back(): void {
  page.value =
    page.value === 'global' || page.value === 'characters'
      ? 'home'
      : page.value === 'versions'
        ? 'characters'
        : page.value === 'variant'
          ? Object.keys(entry.value?.profile.variants[characterId.value]?.versions ?? {}).length > 1
            ? 'versions'
            : 'characters'
          : 'home'
}

watch(
  () => props.resource.id,
  () => {
    page.value = 'home'
    void load()
  },
)
onMounted(load)
</script>

<template>
  <section class="structured-record persona-resource" aria-labelledby="persona-resource-title">
    <header class="structured-record__header">
      <div>
        <p>USER PERSONA DOSSIER</p>
        <h3 id="persona-resource-title">
          {{
            page === 'home'
              ? '人设内容'
              : page === 'characters'
                ? '角色卡人设'
                : page === 'versions'
                  ? `${characters.find((item) => item.id === characterId)?.name ?? '角色卡'} · 版本`
                  : page === 'global'
                    ? `${entry?.name ?? '全局人设'} · 全局`
                    : `${characters.find((item) => item.id === characterId)?.name ?? '角色卡'} · ${version?.name ?? '版本'}`
          }}
        </h3>
      </div>
      <button v-if="page !== 'home'" class="world-browser__back" type="button" @click="back">
        <span aria-hidden="true">←</span>返回上一级
      </button>
      <span v-else>{{ entries.length }} 个人设</span>
    </header>
    <p v-if="error" class="structured-record__empty" role="alert">{{ error }}</p>
    <template v-if="entry">
      <label v-if="entries.length > 1" class="persona-resource__persona-select">
        <span>人设档案</span>
        <select :value="selectedAvatarId" @change="changeEntry">
          <option v-for="item in entries" :key="item.avatarId" :value="item.avatarId">
            {{ item.name }}
          </option>
        </select>
      </label>
      <div class="world-browser">
        <template v-if="page === 'home'">
          <ol class="world-browser__list persona-resource__navigation">
            <li>
              <button type="button" @click="page = 'global'">
                <i>01</i>
                <span
                  ><strong>全局人设</strong
                  ><small>{{ entry.description || '尚未填写全局描述' }}</small></span
                >
                <em>查看</em><b aria-hidden="true">›</b>
              </button>
            </li>
            <li>
              <button type="button" @click="page = 'characters'">
                <i>02</i>
                <span
                  ><strong>角色人设</strong
                  ><small
                    >{{ characters.length }} 张角色卡 ·
                    {{ characters.reduce((sum, item) => sum + item.count, 0) }} 个版本</small
                  ></span
                >
                <em>查看</em><b aria-hidden="true">›</b>
              </button>
            </li>
          </ol>
        </template>
        <article v-else-if="page === 'global'" class="world-browser__detail">
          <div class="world-browser__detail-title">
            <small>GLOBAL PERSONA</small>
            <h4>全局用户设定描述</h4>
          </div>
          <pre>{{ entry.description || '尚未填写全局描述。' }}</pre>
        </article>
        <template v-else-if="page === 'characters'">
          <ol v-if="characters.length" class="world-browser__list persona-resource__navigation">
            <li v-for="(item, index) in characters" :key="item.id">
              <button type="button" @click="openCharacter(item.id)">
                <i>{{ String(index + 1).padStart(2, '0') }}</i>
                <span
                  ><strong>{{ item.name }}</strong
                  ><small>{{
                    profileCharacterRows.find((character) => character.id === item.id)?.status ??
                    '角色卡专属人设'
                  }}</small></span
                >
                <em>{{ item.count }} 版本</em><b aria-hidden="true">›</b>
              </button>
            </li>
          </ol>
          <p v-else class="structured-record__empty">没有角色卡专属人设。</p>
        </template>
        <ol v-else-if="page === 'versions'" class="world-browser__list persona-resource__versions">
          <li v-for="(item, id) in entry.profile.variants[characterId]?.versions" :key="id">
            <button type="button" @click="openVersion(id)">
              <i>{{ id === entry.profile.variants[characterId]?.defaultVersionId ? '★' : '·' }}</i>
              <span
                ><strong>{{ item.name }}</strong
                ><small>{{
                  id === entry.profile.variants[characterId]?.defaultVersionId
                    ? '默认版本'
                    : '专属版本'
                }}</small></span
              >
              <em>查看</em><b aria-hidden="true">›</b>
            </button>
            <details>
              <summary>展开查看内容</summary>
              <pre>{{
                resolveUserPersonaProfile(entry.profile, characterId, id) || '此版本尚无额外内容。'
              }}</pre>
            </details>
          </li>
        </ol>
        <article v-else-if="page === 'variant' && version" class="world-browser__detail">
          <div class="world-browser__detail-title">
            <small>PERSONA VERSION · {{ version.name }}</small>
            <h4>最终注入提示词</h4>
          </div>
          <div class="persona-resource__version-status">
            {{
              versionId === entry.profile.variants[characterId]?.defaultVersionId
                ? '默认版本'
                : '专属版本'
            }}
          </div>
          <pre>{{
            resolveUserPersonaProfile(entry.profile, characterId, versionId) ||
            '此版本尚无额外内容。'
          }}</pre>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.persona-resource {
  min-width: 0;
  color: var(--color-ink);
}
.persona-resource__bindings {
  display: grid;
  gap: 0.25rem;
  padding: 0 0 0.75rem;
  border-bottom: 1px solid var(--color-line);
}
.persona-resource__bindings > strong {
  color: var(--color-accent);
  font-family: var(--font-label);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
}
.persona-resource__bindings > p {
  margin: 0;
  color: var(--color-ink-soft);
  font-size: 0.75rem;
}
.persona-resource__persona-select {
  display: grid;
  gap: 0.4rem;
  padding: 0.75rem 1rem 0;
}
.persona-resource__persona-select span {
  color: var(--color-ink-soft);
  font-size: 0.6875rem;
}
.persona-resource__persona-select select {
  width: 100%;
  min-width: 0;
}
.persona-resource__binding-list li > div {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.625rem;
  min-height: 3.5rem;
  padding: 0.5rem 0.25rem;
}
.persona-resource__binding-list li > div > i {
  color: var(--color-accent);
  font-family: var(--font-display);
  font-size: 1rem;
  font-style: normal;
  text-align: center;
}
.persona-resource__binding-list li > div > span {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}
.persona-resource__binding-list li > div strong {
  font-size: 0.8125rem;
}
.persona-resource__binding-list li > div small {
  color: var(--color-ink-soft);
  font-size: 0.625rem;
}
.persona-resource__binding-list li > div em {
  max-width: 10rem;
  overflow: hidden;
  color: var(--color-ink-soft);
  font-size: 0.625rem;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.persona-resource__version-status {
  margin: 0 0 0.75rem;
  color: var(--color-ink-soft);
  font-size: 0.6875rem;
}
.persona-resource__versions details {
  padding: 0 0.25rem 0.65rem 2.9rem;
  color: var(--color-ink-soft);
  font-size: 0.75rem;
}
.persona-resource__versions summary {
  cursor: pointer;
}
.persona-resource__versions pre,
.persona-resource :deep(.world-browser__detail pre) {
  max-height: min(34rem, 58dvh);
  margin: 0.6rem 0 0;
  padding: 1rem;
  color: var(--color-ink-soft);
  background: color-mix(in srgb, var(--color-canvas) 70%, transparent);
  white-space: pre-wrap;
  overflow: auto;
  overflow-wrap: anywhere;
  line-height: 1.75;
}
@media (max-width: 560px) {
  .persona-resource__binding-list li > div {
    grid-template-columns: 1.5rem minmax(0, 1fr);
  }
  .persona-resource__binding-list li > div > em {
    grid-column: 2;
  }
  .persona-resource__versions details {
    padding-left: 2.25rem;
  }
}
</style>
