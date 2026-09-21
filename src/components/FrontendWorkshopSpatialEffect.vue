<script setup lang="ts">
import type { CSSProperties } from 'vue'

const props = defineProps<{ effect: string; step: number; position: number }>()
const names = ['暴雨码头', '深潜档案', '黎明返航']
const emit = defineEmits<{ select: [index: number] }>()
function orbitStyle(index: number): CSSProperties {
  const angle = ((props.position / 100) * 2 + index / 3) * Math.PI
  return {
    transform: `translate(${Math.cos(angle) * 92}px, ${Math.sin(angle) * 42}px) scale(${1 + Math.sin(angle) * 0.16})`,
    zIndex: Math.sin(angle) > 0 ? 3 : 1,
  }
}
</script>

<template>
  <div
    class="fw-effect-spatial"
    :class="`is-${effect}`"
    :style="{ '--p': position / 100, '--angle': `${(position - 50) * 0.45}deg` }"
  >
    <template v-if="['carousel', 'stack', 'fan'].includes(effect)">
      <article
        v-for="(name, index) in names"
        :key="name"
        class="fw-effect-card"
        :data-position="(index - (step % 3) + 3) % 3"
        :style="{ '--i': index - 1 }"
      >
        <small>档案 / 0{{ index + 1 }}</small>
        <div class="fw-effect-portrait" />
        <strong>{{ name.slice(0, 2) }}</strong
        ><span>{{ name }}</span>
      </article>
    </template>
    <div v-else-if="effect === 'flip'" class="fw-effect-book">
      <article class="fw-effect-page is-left">
        <small>人物档案</small>
        <h3>沈砚潮</h3>
        <div class="fw-effect-portrait" />
        <p>潮汐之外的观察者。</p>
      </article>
      <article class="fw-effect-page is-right">
        <small>第三章</small>
        <h3>返航</h3>
        <p>第一缕光越过舷窗。</p>
      </article>
      <div class="fw-effect-turn" :class="{ 'is-open': step % 2 !== 0 }">
        <article class="fw-effect-page">
          <small>第一章</small>
          <h3>暴雨</h3>
          <div class="fw-effect-portrait" />
          <p>一封未寄出的信。</p>
        </article>
        <article class="fw-effect-page is-back">
          <small>第二章</small>
          <h3>深潜</h3>
          <p>海面之下的秘密。</p>
        </article>
      </div>
    </div>
    <div
      v-else-if="effect === 'flip-card'"
      class="fw-effect-flipper"
      :class="{ 'is-open': step % 2 !== 0 }"
    >
      <article class="fw-effect-face">
        <small>公开身份</small><strong>观察者</strong><span>沈砚潮 · 档案 07</span>
      </article>
      <article class="fw-effect-face is-back">
        <small>隐藏身份</small><strong>引航人</strong><span>他知道回去的路。</span>
      </article>
    </div>
    <div
      v-else-if="effect === 'cube'"
      class="fw-effect-cube"
      :style="{ transform: `rotateX(-12deg) rotateY(${-step * 90}deg)` }"
    >
      <article
        v-for="(name, index) in ['身份', '能力', '故事', '回忆']"
        :key="name"
        :style="{ transform: `rotateY(${index * 90}deg) translateZ(65px)` }"
      >
        <small>档案 / 0{{ index + 1 }}</small
        ><strong>{{ name }}</strong>
      </article>
    </div>
    <div v-else-if="effect === 'accordion'" class="fw-effect-accordion">
      <button
        v-for="(name, index) in ['人物', '故事', '能力', '回忆']"
        :key="name"
        type="button"
        :aria-pressed="((step % 4) + 4) % 4 === index"
        @click="emit('select', index)"
      >
        <i /><strong>{{ name }}</strong
        ><small>0{{ index + 1 }}</small>
      </button>
    </div>
    <div v-else-if="['isometric', 'explode'].includes(effect)" class="fw-effect-planes">
      <article
        v-for="(name, index) in ['背景', '角色', '信息']"
        :key="name"
        :style="{ '--layer': index }"
      >
        <small>0{{ index + 1 }}</small
        ><strong>{{ name }}</strong>
      </article>
    </div>
    <template v-else-if="effect === 'orbit'">
      <div class="fw-effect-orbit-track" />
      <article class="fw-effect-orbit-core">观察者</article>
      <span
        v-for="(name, index) in ['线索', '记忆', '能力']"
        :key="name"
        class="fw-effect-satellite"
        :style="orbitStyle(index)"
        >{{ name }}</span
      >
    </template>
    <template v-else>
      <div class="fw-effect-background-word">深海</div>
      <article class="fw-effect-card">
        <small>人物 / 07</small>
        <div class="fw-effect-portrait" />
        <strong>沈砚潮</strong><span>潮汐之外的观察者</span>
      </article>
      <div v-if="effect === 'parallax'" class="fw-effect-foreground">
        <span>深海档案</span><span>未知</span>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/FrontendWorkshopSpatialEffect.css"></style>
