<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue'
const props = defineProps<{ effect: string; position: number; step: number }>()
const selected = ref(0)
const chapters = [
  '潮汐来信',
  '未明身份',
  '深潜记录',
  '风暴边界',
  '最后返航',
  '无声约定',
  '记忆残片',
  '灯塔守望',
  '远海回音',
  '夜航坐标',
  '失落档案',
  '黎明之后',
]
const progress = computed(() => props.position / 100)
const shape = computed(() => ((props.step % 3) + 3) % 3)
function tileStyle(index: number): CSSProperties {
  const p = progress.value
  if (props.effect === 'perspective-gallery')
    return {
      transform: `translate3d(${((index % 3) - 1) * 93}px, ${(Math.floor(index / 3) - 1) * 91}px, ${Math.sin(index * 1.7) * 95 * (1 - p)}px) rotateY(${(1 - p) * (index % 2 ? 18 : -18)}deg)`,
      '--hue': `${180 + index * 12}`,
    }
  const angle = (index / 12) * Math.PI * 2
  const phi = Math.acos(-1 + (2 * (index + 0.5)) / 12)
  const coords =
    shape.value === 0
      ? [((index % 4) - 1.5) * 65, (Math.floor(index / 4) - 1) * 87, 0]
      : shape.value === 1
        ? [Math.sin(angle * 1.6) * 105, (index - 5.5) * 22, Math.cos(angle * 1.6) * 95]
        : [
            Math.sin(phi) * Math.cos(angle * 2) * 122,
            Math.cos(phi) * 122,
            Math.sin(phi) * Math.sin(angle * 2) * 122,
          ]
  return {
    transform: `translate3d(${coords[0]}px, ${coords[1]}px, ${coords[2]}px)`,
    '--hue': `${175 + index * 11}`,
    transitionDelay: `${index * 18}ms`,
  }
}
function stripStyle(index: number): CSSProperties {
  const distance = index * 15
  const flat = progress.value * 240
  const angle = Math.max(0, distance - flat) / 42
  const x = distance <= flat ? distance : flat + Math.sin(angle) * 42
  const z = distance <= flat ? 0 : (1 - Math.cos(angle)) * 42
  return {
    transform: `translate3d(${x - 120}px, -110px, ${z}px) rotateY(${-angle}rad)`,
    backgroundPosition: `${(index / 15) * 100}% 50%`,
    '--shade': Math.min(0.55, (1 - Math.cos(angle)) * 0.28),
  }
}
</script>
<template>
  <div class="fw-complex-effect" :class="`is-${effect}`" :style="{ '--p': progress }">
    <div class="fw-complex-effect__stage">
      <div
        v-if="effect === 'perspective-gallery'"
        class="fw-complex-effect__gallery"
        :style="{
          transform: `rotateX(${(1 - progress) * 40}deg) rotateZ(${(1 - progress) * -24}deg)`,
        }"
      >
        <button
          v-for="(chapter, index) in chapters.slice(0, 9)"
          :key="chapter"
          class="fw-complex-effect__tile"
          :class="{ 'is-selected': selected === index }"
          :style="tileStyle(index)"
          :aria-label="`查看${chapter}`"
          :aria-pressed="selected === index"
          @click="selected = index"
        >
          <span class="fw-complex-effect__landscape" /><small>0{{ index + 1 }}</small
          ><strong>{{ chapter }}</strong>
        </button>
      </div>
      <template v-else-if="effect === 'zoom-journey'">
        <div
          v-for="index in 5"
          :key="index"
          class="fw-complex-effect__gate"
          :style="{
            transform: `translate(-50%, -50%) translateZ(${progress * 680 - index * 170}px) rotateZ(${(1 - progress) * (index % 2 ? 8 : -8)}deg)`,
            opacity: Math.max(0, Math.min(1, (index * 170 - progress * 680 + 190) / 170)),
            '--hue': `${175 + index * 15}`,
          }"
        >
          <span>0{{ index }}</span
          ><strong>{{ chapters[index - 1] }}</strong
          ><i /><i />
        </div>
        <div
          class="fw-complex-effect__destination"
          :style="{ transform: `translate(-50%, -50%) scale(${0.5 + progress * 0.5})` }"
        >
          <small>航行终点</small><strong>黎明返航</strong><span>故事从这里继续</span>
        </div>
      </template>
      <div v-else-if="effect === 'constellation-morph'" class="fw-complex-effect__constellation">
        <button
          v-for="(chapter, index) in chapters"
          :key="chapter"
          class="fw-complex-effect__tile"
          :class="{ 'is-selected': selected === index }"
          :style="tileStyle(index)"
          :aria-label="`查看${chapter}`"
          :aria-pressed="selected === index"
          @click="selected = index"
        >
          <small>{{ String(index + 1).padStart(2, '0') }}</small
          ><span class="fw-complex-effect__landscape" /><strong>{{ chapter }}</strong>
        </button>
      </div>
      <template v-else-if="effect === 'curled-poster'">
        <div class="fw-complex-effect__paper">
          <div
            v-for="index in 16"
            :key="index"
            class="fw-complex-effect__strip"
            :style="stripStyle(index - 1)"
          >
            <i />
          </div>
        </div>
        <span
          class="fw-complex-effect__paper-caption"
          :style="{ opacity: Math.max(0, (progress - 0.65) / 0.35) }"
          >潮汐之外</span
        >
      </template>
    </div>
    <div class="fw-complex-effect__caption" aria-live="polite">
      <template v-if="effect === 'constellation-morph'"
        ><b>{{ ['档案矩阵', '螺旋星轨', '球形星群'][shape] }}</b
        ><span
          >{{ chapters[selected] }} · 点选档案查看，切换形态观察同一组内容重新排列。</span
        ></template
      >
      <template v-else-if="effect === 'perspective-gallery'"
        ><b>{{ chapters[selected] }}</b
        ><span>倾斜散开的空间画廊，逐渐收拢为可阅读的档案墙。</span></template
      >
      <template v-else-if="effect === 'zoom-journey'"
        ><b>{{ chapters[Math.min(4, Math.floor(progress * 5))] }}</b
        ><span>镜头穿过多层门框，前景退场、章节接替、终点逐渐显现。</span></template
      >
      <template v-else
        ><b>卷曲海报展开</b
        ><span>纸面分段弯曲，跟随展开进度逐渐变平，保留统一图案与背面阴影。</span></template
      >
    </div>
  </div>
</template>
<style scoped src="../styles/FrontendWorkshopComplexEffect.css"></style>
