<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import FeatureAppHeader from './FeatureAppHeader.vue'
import ActionSheet from './ActionSheet.vue'
import UserPersonaListItem from './UserPersonaListItem.vue'
import {
  useUserPersonaApp,
  type UserPersonaAppProps,
  type UserPersonaAppEvents,
} from '../composables/UseUserPersonaApp'
const TavernBridgeCenter = defineAsyncComponent(() => import('./TavernBridgeCenter.vue'))
const props = defineProps<UserPersonaAppProps>()
const emit = defineEmits<UserPersonaAppEvents>()
const {
  page,
  transferOpen,
  busy,
  loading,
  saving,
  goBack,
  openTransfer,
  importTransferredFiles,
  headerMoreOpen,
  headerMoreActions,
  selectHeaderMore,
  importPersonaFiles,
  startNewPack,
  statusMessage,
  errorMessage,
  searchQuery,
  listLimit,
  filteredResources,
  visibleResources,
  openResource,
  draft,
  entries,
  selectedAvatarId,
  changeEntry,
  currentWarnings,
  creatingPack,
  isDirty,
  saveDraft,
  avatarPreviewUrl,
  avatarPreviewFailed,
  avatarSourceUrl,
  cachedAvatarResource,
  pendingAvatarFile,
  chooseAvatarImage,
  onAvatarFileChange,
  onAvatarUrlInput,
  removeAvatarBinding,
  showTemplates,
  selectedTemplateId,
  applyTemplate,
  USER_PERSONA_TEMPLATES,
  customTemplates,
  selectedCustomTemplate,
  deleteSelectedCustomTemplate,
  creatingTemplate,
  customTemplateName,
  saveCustomTemplate,
  insertPlaceholder,
  showAdvanced,
  USER_PERSONA_POSITIONS,
  USER_PERSONA_ROLES,
  selectedWorldBookId,
  onWorldBookChange,
  worldBooks,
  characterSearchQuery,
  characterCategoryFilter,
  filteredCharacters,
  selectedCharacterIds,
  toggleCharacter,
  unresolvedConnections,
} = useUserPersonaApp(props, emit)
</script>

<template>
  <TavernBridgeCenter
    v-if="transferOpen"
    :resources="resources"
    :categories="categories"
    initial-kind="userPersona"
    @back="goBack"
    @import-files="importTransferredFiles"
  />
  <section
    v-show="!transferOpen"
    class="persona-app"
    :data-page="page"
    aria-labelledby="persona-app-title"
    :aria-busy="busy"
  >
    <FeatureAppHeader
      :title="page === 'list' ? 'user才是老大' : creatingPack ? '新建人设' : '编辑人设'"
      title-id="persona-app-title"
      :back-label="page === 'list' ? '返回功能桌面' : '返回人设列表'"
      :back-disabled="busy"
      @back="goBack"
    >
      <template #actions>
        <button
          v-if="headerMoreActions.length"
          class="feature-header-action feature-header-action--icon"
          type="button"
          aria-label="更多人设操作"
          :disabled="busy"
          @click="headerMoreOpen = true"
        >
          …
        </button>
        <button
          v-if="page === 'list'"
          class="feature-header-action feature-header-action--primary"
          type="button"
          :disabled="busy"
          @click="startNewPack"
        >
          新建
        </button>
        <button
          v-else
          class="feature-header-action feature-header-action--primary"
          type="button"
          :disabled="busy"
          @click="saveDraft"
        >
          {{ saving ? '保存中' : '保存' }}
        </button>
      </template>
    </FeatureAppHeader>
    <input
      ref="importInput"
      class="persona-app__import-input"
      type="file"
      accept=".json,application/json"
      multiple
      hidden
      @change="importPersonaFiles"
    />
    <ActionSheet
      v-model:open="headerMoreOpen"
      title="人设操作"
      :actions="headerMoreActions"
      @select="selectHeaderMore"
    />
    <div class="persona-app__body">
      <p v-if="statusMessage" class="persona-app__notice" role="status">{{ statusMessage }}</p>
      <p v-if="errorMessage" class="persona-app__error" role="alert">{{ errorMessage }}</p>
      <template v-if="page === 'list'">
        <div class="persona-app__toolbar">
          <input v-model="searchQuery" type="search" aria-label="搜索人设" placeholder="搜索人设" />
          <button class="button button--quiet" type="button" :disabled="busy" @click="openTransfer">
            酒馆互传
          </button>
        </div>
        <p v-if="loading" role="status">读取中…</p>
        <ul class="persona-app__list" aria-label="已创建的人设">
          <li v-for="resource in visibleResources" :key="resource.id">
            <UserPersonaListItem
              :resource="resource"
              :disabled="busy"
              @open="openResource(resource.id)"
            />
          </li>
        </ul>
        <p v-if="!filteredResources.length && !loading" class="persona-app__empty">
          {{ searchQuery ? '没有匹配的人设' : '暂无人设，点右上角新建' }}
        </p>
        <button
          v-if="visibleResources.length < filteredResources.length"
          class="button button--quiet"
          type="button"
          @click="listLimit += 30"
        >
          加载更多
        </button>
      </template>
      <form v-else class="persona-app__editor" @submit.prevent="saveDraft">
        <p v-if="isDirty" class="persona-app__dirty">未保存</p>
        <label v-if="entries.length > 1" class="persona-app__field"
          ><span>文件内人设</span
          ><select :value="selectedAvatarId" :disabled="busy" @change="changeEntry">
            <option v-for="entry in entries" :key="entry.avatarId" :value="entry.avatarId">
              {{ entry.name }}
            </option>
          </select></label
        >
        <ul v-if="currentWarnings.length" class="persona-app__error">
          <li v-for="warning in currentWarnings" :key="warning">{{ warning }}</li>
        </ul>
        <fieldset :disabled="busy">
          <div class="persona-app__identity">
            <div class="persona-app__avatar-fields">
              <div class="persona-app__avatar-preview">
                <img
                  v-if="avatarPreviewUrl && !avatarPreviewFailed"
                  :src="avatarPreviewUrl"
                  alt="人设封面"
                  referrerpolicy="no-referrer"
                  @error="avatarPreviewFailed = true"
                /><span v-else aria-hidden="true">{{ draft.name.slice(0, 1) || '我' }}</span>
              </div>
              <div class="persona-app__avatar-options">
                <div class="persona-app__actions">
                  <button class="button button--quiet" type="button" @click="chooseAvatarImage">
                    选择图片</button
                  ><button
                    v-if="cachedAvatarResource || pendingAvatarFile || avatarSourceUrl"
                    class="button button--quiet"
                    type="button"
                    @click="removeAvatarBinding"
                  >
                    移除
                  </button>
                </div>
                <label class="persona-app__field"
                  ><span>头像 URL</span
                  ><input
                    v-model="avatarSourceUrl"
                    type="url"
                    placeholder="https://"
                    @input="onAvatarUrlInput"
                /></label>
                <small>仅作资源封面，不随人设传入酒馆。</small>
                <p v-if="avatarPreviewFailed" class="persona-app__error">
                  图片无法预览，请检查地址或选择本地图片。
                </p>
              </div>
              <input
                ref="avatarInput"
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                hidden
                @change="onAvatarFileChange"
              />
            </div>
            <div class="persona-app__name-fields">
              <label class="persona-app__field"
                ><span>人设名</span
                ><input
                  v-model="draft.name"
                  name="personaName"
                  type="text"
                  autocomplete="off"
                  required
              /></label>
              <label class="persona-app__field"
                ><span>备注</span><input v-model="draft.title" name="personaNote" type="text"
              /></label>
            </div>
          </div>
          <div class="persona-app__description-heading">
            <label for="persona-description">人设描述</label>
            <div class="persona-app__actions">
              <button
                class="button button--quiet"
                type="button"
                @click="insertPlaceholder('{{user}}')"
                v-text="'{{user}}'"
              /><button
                class="button button--quiet"
                type="button"
                @click="insertPlaceholder('{{char}}')"
                v-text="'{{char}}'"
              /><button
                class="button button--quiet"
                type="button"
                :aria-expanded="showTemplates"
                aria-controls="persona-templates"
                @click="showTemplates = !showTemplates"
              >
                模板
              </button>
            </div>
          </div>
          <div v-if="showTemplates" id="persona-templates" class="persona-app__templates">
            <div class="persona-app__toolbar">
              <select v-model="selectedTemplateId" aria-label="人物模板">
                <optgroup label="内置模板">
                  <option v-for="t in USER_PERSONA_TEMPLATES" :key="t.id" :value="t.id">
                    {{ t.name }}
                  </option>
                </optgroup>
                <optgroup v-if="customTemplates.length" label="我的模板">
                  <option v-for="t in customTemplates" :key="t.id" :value="t.id">
                    {{ t.name }}
                  </option>
                </optgroup></select
              ><button class="button button--quiet" type="button" @click="applyTemplate">
                应用模板
              </button>
            </div>
            <div class="persona-app__actions">
              <button
                class="button button--quiet"
                type="button"
                @click="creatingTemplate = !creatingTemplate"
              >
                存为模板</button
              ><button
                v-if="selectedCustomTemplate"
                class="button button--quiet"
                type="button"
                @click="deleteSelectedCustomTemplate"
              >
                删除模板
              </button>
            </div>
            <div v-if="creatingTemplate" class="persona-app__toolbar">
              <input
                v-model="customTemplateName"
                aria-label="模板名称"
                placeholder="模板名称"
                maxlength="80"
                @keydown.enter.prevent="saveCustomTemplate"
              /><button class="button button--quiet" type="button" @click="saveCustomTemplate">
                保存模板
              </button>
            </div>
          </div>
          <textarea
            id="persona-description"
            ref="descriptionInput"
            v-model="draft.description"
            name="personaDescription"
            rows="10"
          />
          <details
            class="persona-app__disclosure"
            :open="showAdvanced"
            @toggle="showAdvanced = ($event.target as HTMLDetailsElement).open"
          >
            <summary>高级 · 酒馆注入</summary>
            <div class="persona-app__injection">
              <label class="persona-app__field"
                ><span>注入位置</span
                ><select v-model.number="draft.position">
                  <option :value="USER_PERSONA_POSITIONS.IN_PROMPT">主提示词</option>
                  <option :value="USER_PERSONA_POSITIONS.AFTER_CHARACTER_LEGACY">
                    角色描述之后（旧版）
                  </option>
                  <option :value="USER_PERSONA_POSITIONS.TOP_AUTHORS_NOTE">作者注释之前</option>
                  <option :value="USER_PERSONA_POSITIONS.BOTTOM_AUTHORS_NOTE">作者注释之后</option>
                  <option :value="USER_PERSONA_POSITIONS.AT_DEPTH">聊天指定深度</option>
                  <option :value="USER_PERSONA_POSITIONS.NONE">不注入</option>
                  <option
                    v-if="!Object.values(USER_PERSONA_POSITIONS).some((v) => v === draft.position)"
                    :value="draft.position"
                  >
                    原位置 {{ draft.position }}
                  </option>
                </select></label
              >
              <template v-if="draft.position === USER_PERSONA_POSITIONS.AT_DEPTH"
                ><label class="persona-app__field"
                  ><span>深度</span
                  ><input v-model.number="draft.depth" type="number" min="0" step="1" /></label
                ><label class="persona-app__field"
                  ><span>消息身份</span
                  ><select v-model.number="draft.role">
                    <option :value="USER_PERSONA_ROLES.SYSTEM">系统</option>
                    <option :value="USER_PERSONA_ROLES.USER">用户</option>
                    <option :value="USER_PERSONA_ROLES.ASSISTANT">助手</option>
                  </select></label
                ></template
              >
            </div>
          </details>
          <details class="persona-app__disclosure persona-app__bindings">
            <summary>
              绑定 char 和世界书<span v-if="selectedCharacterIds.size || draft.lorebook"
                >（{{ selectedCharacterIds.size }} 个 char{{
                  draft.lorebook ? ' · ' + draft.lorebook : ''
                }}）</span
              >
            </summary>
            <label class="persona-app__field"
              ><span>世界书</span
              ><select v-model="selectedWorldBookId" @change="onWorldBookChange">
                <option value="">
                  {{
                    draft.lorebook && !selectedWorldBookId ? `原绑定：${draft.lorebook}` : '不绑定'
                  }}
                </option>
                <option v-for="book in worldBooks" :key="book.id" :value="book.id">
                  {{ book.name }}
                </option>
              </select></label
            >
            <button
              v-if="draft.lorebook && !selectedWorldBookId"
              class="button button--quiet"
              type="button"
              @click="draft.lorebook = ''"
            >
              解除原世界书绑定
            </button>
            <div class="persona-app__toolbar">
              <input
                v-model="characterSearchQuery"
                type="search"
                aria-label="搜索 char"
                placeholder="搜索 char"
              /><select v-model="characterCategoryFilter" aria-label="char 分类">
                <option value="all">全部分类</option>
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </div>
            <div class="persona-app__characters">
              <label
                v-for="character in filteredCharacters"
                :key="character.id"
                class="persona-app__character"
                ><input
                  type="checkbox"
                  :checked="selectedCharacterIds.has(character.id)"
                  @change="toggleCharacter(character.id)"
                /><span>{{ character.name }}</span
                ><small>{{ character.fileName }}</small></label
              >
              <p v-if="!filteredCharacters.length">没有可选 char</p>
            </div>
            <p v-if="unresolvedConnections.length">
              保留酒馆原绑定：{{ unresolvedConnections.map((c) => c.id).join('、') }}
            </p>
            <small>绑定按酒馆名称匹配；关联的 char 和世界书需另行传入酒馆。</small>
          </details>
        </fieldset>
      </form>
    </div>
  </section>
</template>

<style src="../styles/UserPersonaApp.css"></style>
