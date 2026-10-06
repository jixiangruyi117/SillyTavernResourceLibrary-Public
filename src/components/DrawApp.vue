<script setup lang="ts">
import DrawCarousel from './DrawCarousel.vue'
import FeatureAppHeader from './FeatureAppHeader.vue'
import { useDrawApp } from '../composables/UseDrawApp'
import type { FeatureHubProps, FeatureHubEvents } from '../composables/UseFeatureHub'
const props = defineProps<FeatureHubProps>()
const emit = defineEmits<FeatureHubEvents & { back: [] }>()
const {
  drawPool,
  drawState,
  characters,
  selectedCategoryId,
  drawCategories,
  selectedTag,
  characterTags,
  FRESHNESS_OPTIONS,
  freshness,
  favoritesOnly,
  showNames,
  toggleShowNames,
  isDrawing,
  resultResources,
  isResultOverlayOpen,
  singleResult,
  resultGeneration,
  isRevealing,
  handleResultOverlayClick,
  closeResultOverlay,
  skipReveal,
  openResult,
  previewUrls,
  resultRecord,
  resourceCreator,
  formatDate,
  draw,
  returnToLibrary,
  revealCount,
  drawError,
  recentHistory,
  isClearing,
  clearDrawRecords,
  historyNames,
} = useDrawApp(props, emit)
</script>

<template>
  <FeatureAppHeader title="抽了么" @back="emit('back')">
    <template #status>
      <span class="feature-header-status">{{ drawPool.length }} 张可抽</span>
    </template>
  </FeatureAppHeader>

  <section class="draw-app__stats" aria-label="抽卡统计">
    <div>
      <strong>{{ drawState.totalDraws }}</strong>
      <span>累计抽取</span>
    </div>
    <div>
      <strong>{{ drawState.totalSessions }}</strong>
      <span>抽取轮次</span>
    </div>
    <div>
      <strong>{{ Object.keys(drawState.records).length }}</strong>
      <span>遇见角色</span>
    </div>
  </section>

  <details class="draw-filters">
    <summary>
      <span><strong>抽取范围</strong></span>
      <em>{{ drawPool.length }} / {{ characters.length }}</em>
    </summary>
    <div class="draw-filters__body">
      <label>
        <span>文件夹</span>
        <select v-model="selectedCategoryId">
          <option value="">全部文件夹</option>
          <option v-for="category in drawCategories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
      </label>
      <label>
        <span>标签</span>
        <select v-model="selectedTag">
          <option value="">全部标签</option>
          <option v-for="item in characterTags" :key="item.tag" :value="item.tag">
            #{{ item.tag }} · {{ item.count }}
          </option>
        </select>
      </label>
      <fieldset>
        <legend>相遇记录</legend>
        <button
          v-for="option in FRESHNESS_OPTIONS"
          :key="option.value"
          type="button"
          :class="{ 'is-active': freshness === option.value }"
          @click="freshness = option.value"
        >
          {{ option.label }}
        </button>
      </fieldset>
      <label class="draw-filters__favorite">
        <input v-model="favoritesOnly" type="checkbox" />
        <span><strong>仅抽收藏</strong><small>与上面的条件同时生效</small></span>
      </label>
    </div>
  </details>

  <label class="draw-display-option">
    <span><strong>揭晓时显示名字</strong><small>关闭后只展示完整卡面，可在抽取前选择</small></span>
    <input type="checkbox" :checked="showNames" @change="toggleShowNames" />
    <i aria-hidden="true"></i>
  </label>

  <section class="draw-stage" :class="{ 'draw-stage--loading': isDrawing }" aria-live="polite">
    <div v-if="isDrawing" class="draw-stage__shuffle">
      <span></span><span></span><span></span>
      <strong>正在翻阅角色档案</strong>
    </div>
    <Teleport v-else-if="resultResources.length" to="body" :disabled="!isResultOverlayOpen">
      <section
        v-if="isResultOverlayOpen && singleResult"
        :key="`gallery-${resultGeneration}`"
        class="gallery-reveal"
        :class="{
          'gallery-reveal--complete': !isRevealing,
          'gallery-reveal--names-hidden': !showNames,
        }"
        role="dialog"
        aria-modal="true"
        aria-label="单抽角色揭晓"
        @click="handleResultOverlayClick"
      >
        <header class="gallery-reveal__header">
          <div>
            <strong>档案揭晓</strong>
          </div>
          <span>01 / 01</span>
          <button
            ref="resultCloseButton"
            type="button"
            aria-label="关闭单抽揭晓页"
            @click.stop="closeResultOverlay"
          >
            ×
          </button>
        </header>

        <main class="gallery-reveal__stage">
          <i class="gallery-reveal__spotlight" aria-hidden="true"></i>
          <article class="gallery-artwork">
            <button
              type="button"
              class="gallery-artwork__frame"
              :aria-label="isRevealing ? '跳过揭晓动画' : `查看角色 ${singleResult.name} 的详情`"
              @click.stop="isRevealing ? skipReveal() : openResult(singleResult, 0)"
            >
              <img
                v-if="previewUrls.get(singleResult.id)"
                class="gallery-artwork__image"
                :src="previewUrls.get(singleResult.id)"
                :alt="`${singleResult.name}角色卡`"
                decoding="async"
              />
              <span v-else class="gallery-artwork__placeholder" aria-hidden="true">
                <i></i>
                <strong>{{ singleResult.name.trim().slice(0, 2) || 'SR' }}</strong>
              </span>
            </button>
          </article>

          <aside v-if="showNames" class="gallery-plaque">
            <div class="gallery-plaque__index">
              <span>No. 001</span>
              <small v-if="(resultRecord(singleResult.id)?.count ?? 1) === 1">
                NEW ACQUISITION
              </small>
            </div>
            <h1>{{ singleResult.name || '未命名角色' }}</h1>
            <p>CHARACTER FILE</p>
            <dl>
              <div v-if="resourceCreator(singleResult)">
                <dt>作者</dt>
                <dd>{{ resourceCreator(singleResult) }}</dd>
              </div>
              <div v-if="singleResult.tags.length">
                <dt>标签</dt>
                <dd>{{ singleResult.tags.slice(0, 3).join(' · ') }}</dd>
              </div>
              <div>
                <dt>遇见</dt>
                <dd>
                  {{
                    (resultRecord(singleResult.id)?.count ?? 1) === 1
                      ? '首次遇见'
                      : `第 ${resultRecord(singleResult.id)?.count ?? 1} 次`
                  }}
                </dd>
              </div>
              <div>
                <dt>最近</dt>
                <dd>
                  {{ formatDate(resultRecord(singleResult.id)?.lastDrawnAt ?? Date.now()) }}
                </dd>
              </div>
            </dl>
          </aside>
        </main>

        <footer class="gallery-reveal__actions">
          <button type="button" class="gallery-reveal__primary" @click.stop="draw(1)">
            继续抽取
          </button>
          <button type="button" @click.stop="openResult(singleResult, 0)">查看详情</button>
          <button type="button" class="gallery-reveal__tertiary" @click.stop="returnToLibrary">
            返回资源库
          </button>
        </footer>
        <p v-if="isRevealing" class="gallery-reveal__hint">轻触空白处跳过揭晓</p>
      </section>
      <DrawCarousel
        v-else-if="isResultOverlayOpen"
        :key="`carousel-${resultGeneration}`"
        :resources="resultResources"
        :preview-urls="previewUrls"
        :records="drawState.records"
        :reveal-count="revealCount"
        :show-names="showNames"
        @close="closeResultOverlay"
        @open="openResult"
        @skip="skipReveal"
      />
      <div v-else :key="resultGeneration" class="draw-results" aria-label="本次抽卡结果">
        <header>
          <div>
            <small>NEW ENCOUNTER</small>
            <strong>本次遇见</strong>
          </div>
          <div class="draw-results__tools">
            <span>点击卡面打开档案</span>
            <button
              v-if="resultResources.length > 1"
              type="button"
              @click="isResultOverlayOpen = true"
            >
              重新查看十连
            </button>
          </div>
        </header>
        <div
          class="draw-results__grid"
          :class="{
            'draw-results__grid--single': resultResources.length === 1,
            'draw-results__grid--names-hidden': !showNames,
          }"
        >
          <button
            v-for="(resource, index) in resultResources"
            :key="`${resource.id}-${index}`"
            type="button"
            class="draw-result-card"
            :class="{ 'draw-result-card--revealed': index < revealCount }"
            :style="{ '--draw-index': index }"
            :aria-label="
              index < revealCount ? `打开角色 ${resource.name}` : `第 ${index + 1} 张卡牌尚未翻开`
            "
            @click="openResult(resource, index)"
          >
            <span class="draw-result-card__inner">
              <span class="draw-result-card__back" aria-hidden="true">
                <i></i>
                <strong>SRL</strong>
              </span>
              <span class="draw-result-card__front">
                <span class="draw-result-card__cover">
                  <img
                    v-if="previewUrls.get(resource.id)"
                    :src="previewUrls.get(resource.id)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <strong v-else>{{ resource.name.slice(0, 2) }}</strong>
                  <i v-if="showNames">{{ String(index + 1).padStart(2, '0') }}</i>
                </span>
                <span v-if="showNames" class="draw-result-card__copy">
                  <strong>{{ resource.name }}</strong>
                  <span class="draw-result-card__meta">
                    <small>
                      <i>遇见次数</i>
                      第 {{ resultRecord(resource.id)?.count ?? 1 }} 次
                    </small>
                    <small>
                      <i>最近遇见</i>
                      {{ formatDate(resultRecord(resource.id)?.lastDrawnAt ?? Date.now()) }}
                    </small>
                  </span>
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </Teleport>
    <div v-else class="draw-stage__empty">
      <span aria-hidden="true"><i></i><i></i><i></i></span>
      <small>READY / {{ String(drawPool.length).padStart(3, '0') }}</small>
      <h2>{{ drawPool.length ? '下一位，会是谁？' : '这个范围里没有角色' }}</h2>
      <p>
        {{ drawPool.length ? '十连会优先避免同一轮重复。' : '调整文件夹、标签或相遇记录后再试。' }}
      </p>
    </div>
    <p v-if="drawError" class="draw-stage__error" role="alert">{{ drawError }}</p>
  </section>

  <section v-if="recentHistory.length" class="draw-history">
    <header>
      <span><strong>最近抽取</strong></span>
      <button type="button" :disabled="isClearing" @click="clearDrawRecords">
        {{ isClearing ? '清除中' : '清除记录' }}
      </button>
    </header>
    <ol>
      <li v-for="item in recentHistory" :key="item.id">
        <span>{{ item.resourceIds.length === 1 ? '单抽' : '十连' }}</span>
        <div>
          <strong>{{ historyNames(item.resourceIds) }}</strong>
          <small>{{ item.filterLabel }}</small>
        </div>
        <time>{{ formatDate(item.drawnAt) }}</time>
      </li>
    </ol>
  </section>

  <footer class="draw-actions">
    <span>
      <strong>{{ drawPool.length }}</strong>
      <small>张符合条件</small>
    </span>
    <button type="button" :disabled="isDrawing || isRevealing || !drawPool.length" @click="draw(1)">
      单抽
    </button>
    <button
      class="draw-actions__primary"
      type="button"
      :disabled="isDrawing || isRevealing || !drawPool.length"
      @click="draw(10)"
    >
      十连抽
    </button>
  </footer>
</template>
