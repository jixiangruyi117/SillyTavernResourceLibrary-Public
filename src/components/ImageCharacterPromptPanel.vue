<script setup lang="ts">
import { toRef, type ShallowUnwrapRef } from 'vue'
import type { useImageGenerationApp } from '../composables/UseImageGenerationApp'

type PanelModel = Pick<
  ShallowUnwrapRef<ReturnType<typeof useImageGenerationApp>>,
  'internalTab' | 'capabilities' | 'characters' | 'addCharacter'
>
const input = defineProps<{ model: PanelModel }>()
const internalTab = toRef(input.model, 'internalTab')
const capabilities = toRef(input.model, 'capabilities')
const characters = toRef(input.model, 'characters')
const addCharacter = toRef(input.model, 'addCharacter')
</script>
<template>
  <template v-if="internalTab === 'characters'">
    <template v-if="capabilities.multiCharacter === 'supported'">
      <div class="head">
        <div>
          <div class="title">角色 Prompt</div>
          <div class="note">每个角色独立描述、排除内容和位置。</div>
        </div>
        <span class="chip">{{ characters.length }} / {{ capabilities.maxCharacters }}</span>
      </div>
      <section
        v-for="(character, index) in characters"
        :key="index"
        class="card image-generation-entry"
      >
        <div class="card-head">
          <strong>角色 {{ index + 1 }}</strong
          ><button class="btn" type="button" @click="characters.splice(index, 1)">删除</button>
        </div>
        <textarea
          v-model="character.prompt"
          class="textarea character-prompt"
          :aria-label="`角色 ${index + 1} Prompt`"
          placeholder="角色外观与服装"
        ></textarea>
        <div class="row2 field-gap">
          <input
            v-model="character.negativePrompt"
            class="input"
            :aria-label="`角色 ${index + 1} Negative`"
            placeholder="角色排除内容"
          /><label v-if="capabilities.characterPositioning === 'supported'" class="check"
            ><input v-model="character.positioned" type="checkbox" />指定位置</label
          >
        </div>
        <div v-if="character.positioned" class="row2 field-gap">
          <template v-if="capabilities.freeCharacterPositioning"
            ><label
              >横向位置<input
                v-model.number="character.x"
                class="input"
                type="number"
                min="0"
                max="1"
                step="0.05" /></label
            ><label
              >纵向位置<input
                v-model.number="character.y"
                class="input"
                type="number"
                min="0"
                max="1"
                step="0.05" /></label
          ></template>
          <template v-else
            ><label
              >横向位置<select v-model.number="character.x" class="select">
                <option v-for="point in [0.1, 0.3, 0.5, 0.7, 0.9]" :key="point" :value="point">
                  {{ point }}
                </option>
              </select></label
            ><label
              >纵向位置<select v-model.number="character.y" class="select">
                <option v-for="point in [0.1, 0.3, 0.5, 0.7, 0.9]" :key="point" :value="point">
                  {{ point }}
                </option>
              </select></label
            ></template
          >
        </div>
      </section>
      <button
        class="add"
        type="button"
        :disabled="characters.length >= capabilities.maxCharacters"
        @click="addCharacter"
      >
        添加角色
      </button>
    </template>
    <p v-else class="workspace-notice">当前模型不可用：不支持独立角色提示词。</p>
  </template>
</template>
<style scoped src="../styles/ImageGenerationApp.css"></style>
