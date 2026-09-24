<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useFrontendWorkshopApp } from '../composables/UseFrontendWorkshopApp'
type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useFrontendWorkshopApp>>,
  | 'activeDesignPanel'
  | 'drafts'
  | 'draftName'
  | 'saveDraft'
  | 'hasUnsavedDraft'
  | 'recoveryStatus'
  | 'loadDraft'
  | 'deleteDraft'
  | 'workshopPresets'
  | 'applyPreset'
  | 'dataModeOptions'
  | 'dataMode'
  | 'fieldInputMode'
  | 'switchFieldInputMode'
  | 'source'
  | 'parsedFields'
  | 'moveVisualField'
  | 'removeVisualField'
  | 'updateVisualField'
  | 'fieldKindOptions'
  | 'addVisualField'
>
const input = defineProps<{ model: PanelModel }>()
const activeDesignPanel = toRef(input.model, 'activeDesignPanel')
const drafts = toRef(input.model, 'drafts')
const draftName = toRef(input.model, 'draftName')
const saveDraft = toRef(input.model, 'saveDraft')
const hasUnsavedDraft = toRef(input.model, 'hasUnsavedDraft')
const recoveryStatus = toRef(input.model, 'recoveryStatus')
const loadDraft = toRef(input.model, 'loadDraft')
const deleteDraft = toRef(input.model, 'deleteDraft')
const workshopPresets = toRef(input.model, 'workshopPresets')
const applyPreset = toRef(input.model, 'applyPreset')
const dataModeOptions = toRef(input.model, 'dataModeOptions')
const dataMode = toRef(input.model, 'dataMode')
const fieldInputMode = toRef(input.model, 'fieldInputMode')
const switchFieldInputMode = toRef(input.model, 'switchFieldInputMode')
const source = toRef(input.model, 'source')
const parsedFields = toRef(input.model, 'parsedFields')
const moveVisualField = toRef(input.model, 'moveVisualField')
const removeVisualField = toRef(input.model, 'removeVisualField')
const updateVisualField = toRef(input.model, 'updateVisualField')
const fieldKindOptions = toRef(input.model, 'fieldKindOptions')
const addVisualField = toRef(input.model, 'addVisualField')
</script>
<template>
  <div
    class="frontend-workshop__design-panel"
    data-design-panel="content"
    :class="{ 'is-active': activeDesignPanel === 'content' }"
  >
    <details class="frontend-workshop__drafts">
      <summary>
        <span><strong>草稿</strong><small>最多保留 8 个命名方案</small></span>
        <em>{{ drafts.length }}</em>
      </summary>
      <div>
        <label>
          <span>草稿名称</span>
          <input v-model="draftName" maxlength="40" placeholder="例如：墨绿多角色版" />
        </label>
        <button type="button" @click="saveDraft">保存当前草稿</button>
      </div>
      <p class="frontend-workshop__draft-protection" role="status">
        <strong>{{ hasUnsavedDraft ? '有未保存修改' : '当前内容已保存' }}</strong>
        <span>{{
          recoveryStatus ||
          (hasUnsavedDraft
            ? '修改会自动保留在当前设备，退出时仍可保存为命名草稿'
            : '继续编辑后会自动开启本机恢复保护')
        }}</span>
      </p>
      <ul v-if="drafts.length">
        <li v-for="draft in drafts" :key="draft.id">
          <button type="button" @click="loadDraft(draft)">
            <strong>{{ draft.name }}</strong>
            <small>{{ new Date(draft.updatedAt).toLocaleString('zh-CN') }}</small>
          </button>
          <button type="button" aria-label="删除草稿" @click="deleteDraft(draft.id)">×</button>
        </li>
      </ul>
    </details>
    <div class="frontend-workshop__presets" aria-label="状态栏起稿模板">
      <span>快速起稿</span>
      <button
        v-for="preset in workshopPresets"
        :key="preset.label"
        type="button"
        @click="applyPreset(preset)"
      >
        {{ preset.label }}
      </button>
    </div>
    <section class="frontend-workshop__axis" aria-labelledby="workshop-data-mode">
      <header>
        <span>
          <small>DATA ENGINE</small>
          <strong id="workshop-data-mode">数据怎么变化</strong>
        </span>
        <em>与外观分开选择</em>
      </header>
      <div class="frontend-workshop__mode-grid">
        <button
          v-for="option in dataModeOptions"
          :key="option.value"
          type="button"
          :class="{ 'is-active': dataMode === option.value }"
          :aria-pressed="dataMode === option.value"
          @click="dataMode = option.value"
        >
          <small>{{ option.eyebrow }}</small>
          <strong>{{ option.title }}</strong>
          <span>{{ option.description }}</span>
          <em>{{ option.meta }}</em>
        </button>
      </div>
      <p v-if="dataMode === 'mvu'">
        这里生成的是 MVU 显示适配层，需要酒馆助手、MVU 和
        ST-Prompt-Template，并在后者开启“处理消息内容”；不会替你伪造初始化和更新规则。分组名会作为变量路径，例如
        <code>[角色.林言] + 好感度</code> 对应 <code>角色.林言.好感度</code>。
      </p>
    </section>
    <section class="frontend-workshop__field-editor" :data-field-input-mode="fieldInputMode">
      <header>
        <span>
          <small>FIELD CONTRACT</small>
          <strong>准备做的状态栏内容</strong>
        </span>
        <div role="group" aria-label="字段输入方式">
          <button
            type="button"
            :class="{ 'is-active': fieldInputMode === 'text' }"
            :aria-pressed="fieldInputMode === 'text'"
            @click="switchFieldInputMode('text')"
          >
            文本
          </button>
          <button
            type="button"
            :class="{ 'is-active': fieldInputMode === 'visual' }"
            :aria-pressed="fieldInputMode === 'visual'"
            @click="switchFieldInputMode('visual')"
          >
            表格
          </button>
        </div>
      </header>
      <label v-if="fieldInputMode === 'text'">
        <textarea v-model="source" rows="7" placeholder="姓名：&#10;性别：&#10;状态："></textarea>
        <small>
          一行一个字段；用 [分组名] 分区，用 字段[百分比/数字/标签/列表/长文本] 指定表现。最多 24
          项。
          <template v-if="dataMode === 'mvu'">
            多角色可写成 [角色.角色名]，工具会据此生成变量路径。
          </template>
        </small>
      </label>
      <div v-else class="frontend-workshop__field-table">
        <p>
          表格与文本编辑的是同一份字段契约；修改后会整理为标准的
          <code>[分组] + 字段[类型]：示例</code> 语法。
        </p>
        <article v-for="(field, index) in parsedFields" :key="field.path">
          <header>
            <strong>{{ index + 1 }} · {{ field.label }}</strong>
            <div>
              <button
                type="button"
                :disabled="index === 0"
                :aria-label="`上移字段${field.label}`"
                @click="moveVisualField(index, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                :disabled="index === parsedFields.length - 1"
                :aria-label="`下移字段${field.label}`"
                @click="moveVisualField(index, 1)"
              >
                ↓
              </button>
              <button
                type="button"
                :aria-label="`删除字段${field.label}`"
                @click="removeVisualField(index)"
              >
                删除
              </button>
            </div>
          </header>
          <div>
            <label>
              <span>分组</span>
              <input
                :value="field.group"
                @change="
                  updateVisualField(index, 'group', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
            <label>
              <span>字段名</span>
              <input
                :value="field.label"
                @change="
                  updateVisualField(index, 'label', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
            <label>
              <span>类型</span>
              <select
                :value="field.kind"
                @change="
                  updateVisualField(index, 'kind', ($event.target as HTMLSelectElement).value)
                "
              >
                <option
                  v-for="option in fieldKindOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span>示例值</span>
              <input
                :value="field.example"
                @change="
                  updateVisualField(index, 'example', ($event.target as HTMLInputElement).value)
                "
              />
            </label>
          </div>
          <code v-if="dataMode === 'mvu'">{{ field.path }}</code>
        </article>
        <button
          class="frontend-workshop__field-add"
          type="button"
          :disabled="parsedFields.length >= 24"
          @click="addVisualField"
        >
          添加字段
        </button>
      </div>
    </section>
    <div v-if="parsedFields.length" class="frontend-workshop__contract">
      <span v-for="field in parsedFields" :key="field.label">
        <small>{{ field.group }}</small>
        <strong>{{ field.label }}</strong>
        <em>{{ field.kind }}</em>
        <code v-if="dataMode === 'mvu'">{{ field.path }}</code>
      </span>
    </div>
    <button
      class="frontend-workshop__panel-next"
      type="button"
      @click="activeDesignPanel = 'appearance'"
    >
      下一步：设置外观
    </button>
  </div>
</template>
<style scoped src="../styles/FrontendWorkshopBase.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignReferences.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignBlocks.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignAppearance.css"></style>
<style scoped src="../styles/FrontendWorkshopDesignInputs.css"></style>
<style scoped src="../styles/FrontendWorkshopProof.css"></style>
<style scoped src="../styles/FrontendWorkshopDelivery.css"></style>
<style scoped src="../styles/FrontendWorkshopResponsive.css"></style>
