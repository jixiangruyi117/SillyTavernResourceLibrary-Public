<script setup lang="ts">
defineProps<{ effect: string; run: number; position: number; text: string; active: boolean }>()
const emit = defineEmits<{ progress: [value: number] }>()
function onScroll(event: Event): void {
  const el = event.currentTarget as HTMLElement
  const total = el.scrollHeight - el.clientHeight
  emit('progress', total > 0 ? (el.scrollTop / total) * 100 : 0)
}
</script>

<template>
  <div
    v-if="['sticky', 'horizontal', 'depth'].includes(effect)"
    class="fw-effect-scroll"
    :class="`is-${effect}`"
    aria-label="滚动演示区域"
    tabindex="0"
    @scroll="onScroll"
  >
    <div class="fw-effect-scroll-track" :style="{ '--progress': position / 100 }">
      <div class="fw-effect-sticky-subject">
        <small>人物档案</small><strong>沈砚潮</strong><span>向下滚动查看故事</span>
      </div>
      <div v-if="effect === 'sticky'" class="fw-effect-scroll-chapters">
        <section v-for="(name, index) in ['身份', '能力', '故事']" :key="name">
          <small>0{{ index + 1 }}</small>
          <h3>{{ name }}</h3>
          <p>在潮汐之外，发现他的另一面。</p>
        </section>
      </div>
      <div v-else-if="effect === 'horizontal'" class="fw-effect-horizontal-window">
        <div class="fw-effect-horizontal-strip">
          <section v-for="name in ['相遇', '深潜', '返航']" :key="name">
            <strong>{{ name }}</strong
            ><span>一段尚未公开的记录</span>
          </section>
        </div>
      </div>
      <div v-else class="fw-effect-depth-window">
        <i v-for="i in 3" :key="i" :style="{ '--i': i }" /><strong>穿过潮汐</strong>
      </div>
    </div>
  </div>
  <div
    v-else
    :key="run"
    class="fw-effect-motion"
    :class="[`is-${effect}`, { 'is-playing': active }]"
    :style="{ '--p': position / 100 }"
  >
    <template v-if="effect === 'stroke'"
      ><svg viewBox="0 0 260 120" role="img" aria-label="逐步绘制的山形路线">
        <path d="M15 95 L62 36 L102 72 L143 19 L185 61 L239 28" pathLength="1" /></svg
      ><span>航线记录</span></template
    >
    <template v-else-if="effect === 'ripple'"
      ><div class="fw-effect-ripple-target">确认选择<i /></div
    ></template>
    <template v-else-if="['spotlight', 'hologram', 'shimmer'].includes(effect)"
      ><article class="fw-effect-light-card">
        <small>人物档案 / 07</small>
        <div class="fw-effect-light-art" />
        <strong>沈砚潮</strong><span>潮汐之外的观察者</span><i /></article
    ></template>
    <template v-else
      ><div class="fw-effect-ambient" />
      <div class="fw-effect-word">
        <strong :data-text="text">{{ text }}</strong
        ><span>档案 07 · 潮汐之外</span><small v-if="effect === 'slide'">未知身份 / 观察者</small>
      </div></template
    >
    <div v-if="effect === 'shutter'" class="fw-effect-shutters" aria-hidden="true">
      <i v-for="i in 6" :key="i" :style="{ '--i': i }" />
    </div>
  </div>
</template>

<style scoped src="../styles/FrontendWorkshopMotionEffect.css"></style>
