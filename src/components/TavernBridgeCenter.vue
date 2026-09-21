<script setup lang="ts">
import FeatureAppHeader from './FeatureAppHeader.vue'
import FeatureBackButton from './FeatureBackButton.vue'
import TavernBridgeInstallGuide from './TavernBridgeInstallGuide.vue'
import {
  useTavernBridgeCenter,
  type TavernBridgeCenterProps,
  type TavernBridgeCenterEvents,
} from '../composables/UseTavernBridgeCenter'
const props = withDefaults(defineProps<TavernBridgeCenterProps>(), {
  categories: () => [],
  initialLocalIds: () => [],
})
const emit = defineEmits<TavernBridgeCenterEvents>()
const {
  state,
  busy,
  acceptPairing,
  canUseLocalTavernHost,
  connectLocalTavern,
  installGuideOpen,
  error,
  progress,
  localDirectEnabled,
  setLocalDirectEnabled,
  localDirectAvailable,
  LOCAL_DIRECT_BRIDGE_EXTENSION_VERSION,
  refreshTavernResources,
  disconnectTavern,
  activeDirection,
  bridgeDiffSummary,
  selectSyncEntries,
  showOnlyMissingTavern,
  showOnlyMissingLocal,
  tavernReceiveFilters,
  tavernReceiveFilter,
  tavernSearch,
  visibleTavernItems,
  selectAllTavern,
  selectedTavernIds,
  showOnlySelectedTavern,
  toggleSelection,
  tavernResourceLabel,
  itemExistsLocally,
  pullFromTavern,
  localSendFilters,
  localSendFilter,
  search,
  bridgeFolderFilter,
  bridgeTagFilter,
  bridgeTagOptions,
  bridgeFavoritesOnly,
  selectAllLocal,
  selectedLocalIds,
  filteredLocalResources,
  tavernItems,
  showOnlySelectedLocal,
  resourceLabel,
  resourceExistsInTavern,
  conflictPolicy,
  sendConflictCount,
  sendToTavern,
  reports,
  transferQueue,
  failedTransferKeys,
  retryFailedTransfers,
  openAuthorTools,
  authorToolsDialog,
  closeAuthorTools,
  AUTHOR_TOOLS,
  showAuthorToolDetails,
  selectedAuthorTool,
  copyAuthorToolRepository,
  copiedAuthorToolId,
} = useTavernBridgeCenter(props, emit)
</script>

<template>
  <section class="tavern-bridge" aria-labelledby="tavern-bridge-title">
    <FeatureAppHeader
      title="酒馆互传"
      title-id="tavern-bridge-title"
      :back-label="initialKind === 'userPersona' ? '返回人设列表' : '返回功能桌面'"
      @back="emit('back')"
    />

    <section v-if="state.status !== 'connected'" class="tavern-bridge-pairing">
      <header class="tavern-bridge-pairing__heading">
        <div>
          <strong>{{ state.status === 'pairing' ? '核对配对码' : '连接酒馆' }}</strong>
          <span class="tavern-bridge-pairing__status" :data-status="state.status">
            {{ state.status === 'pairing' ? '待确认' : '未连接' }}
          </span>
        </div>
        <p>{{ state.detail }}</p>
      </header>

      <section v-if="state.status === 'pairing'" class="tavern-bridge-pairing__code">
        <span>配对码</span>
        <code v-if="state.pairCode">{{ state.pairCode }}</code>
        <small v-if="state.tavernOrigin">来源：{{ state.tavernOrigin }}</small>
        <button
          class="tavern-bridge__primary"
          type="button"
          :disabled="busy"
          @click="acceptPairing"
        >
          数字一致，允许本次连接
        </button>
      </section>

      <template v-else>
        <section v-if="canUseLocalTavernHost" class="tavern-local-connect">
          <div>
            <strong>同一台手机上的酒馆</strong>
            <p>不需要额外确认码，在酒馆扩展确认一次即可。</p>
          </div>
          <button type="button" :disabled="busy" @click="connectLocalTavern">
            {{ busy ? '连接中' : '直连' }}
          </button>
        </section>

        <button
          class="tavern-bridge-help-toggle"
          type="button"
          :aria-expanded="installGuideOpen"
          @click="installGuideOpen = !installGuideOpen"
        >
          <span>连接帮助</span>
          <span>{{ installGuideOpen ? '收起' : '查看' }}</span>
        </button>

        <TavernBridgeInstallGuide v-if="installGuideOpen" />
      </template>

      <div v-if="error || progress" class="tavern-bridge-inline-report" aria-live="polite">
        <p v-if="error" role="alert">{{ error }}</p>
        <strong v-else>{{ progress }}</strong>
      </div>
    </section>

    <template v-else>
      <section class="tavern-bridge-connected-summary" aria-label="连接状态">
        <span>
          <i aria-hidden="true"></i>
          <strong>已连接</strong>
        </span>
        <small>{{ state.detail }}</small>
      </section>
      <label v-if="canUseLocalTavernHost" class="tavern-bridge-local-direct">
        <input v-model="localDirectEnabled" type="checkbox" @change="setLocalDirectEnabled" />
        <span>
          <strong>本机酒馆直传</strong>
          <small v-if="localDirectAvailable"
            >文件只在本机 127.0.0.1:8000 与 APK 间传输；失败自动回退当前连接的分块传输。</small
          >
          <small v-else
            >需将酒馆互传扩展更新至
            {{ LOCAL_DIRECT_BRIDGE_EXTENSION_VERSION }}；未满足时仍使用普通分块传输。</small
          >
        </span>
      </label>
      <section class="tavern-bridge-session-actions" aria-label="酒馆连接操作">
        <p>连接保持在当前资源库会话中；退出此页后返回会自动重新读取酒馆目录。</p>
        <div>
          <button type="button" :disabled="busy" @click="refreshTavernResources">
            重新确认并刷新
          </button>
          <button type="button" :disabled="busy" @click="disconnectTavern">断开连接</button>
        </div>
      </section>
      <nav class="tavern-bridge-tabs" aria-label="传输方向">
        <button
          type="button"
          :class="{ 'is-active': activeDirection === 'fromTavern' }"
          @click="activeDirection = 'fromTavern'"
        >
          <strong>从酒馆取回</strong>
        </button>
        <button
          type="button"
          :class="{ 'is-active': activeDirection === 'toTavern' }"
          @click="activeDirection = 'toTavern'"
        >
          <strong>发送到酒馆</strong>
        </button>
      </nav>

      <aside v-if="bridgeDiffSummary" class="tavern-bridge-diff" aria-label="两端差异总览">
        <button
          type="button"
          :disabled="!bridgeDiffSummary.tavernOnly"
          @click="
            () => {
              selectSyncEntries('fromTavern', ['tavern-only'])
              showOnlyMissingTavern = true
            }
          "
        >
          <strong>{{ bridgeDiffSummary.tavernOnly }}</strong>
          <span>项酒馆有而库中缺</span>
        </button>
        <button
          type="button"
          :disabled="!bridgeDiffSummary.localOnly"
          @click="
            () => {
              selectSyncEntries('toTavern', ['local-only'])
              showOnlyMissingLocal = true
            }
          "
        >
          <strong>{{ bridgeDiffSummary.localOnly }}</strong>
          <span>项库中有而酒馆缺</span>
        </button>
        <button
          type="button"
          :disabled="!bridgeDiffSummary.localNewer"
          @click="selectSyncEntries('toTavern', ['local-newer'])"
        >
          <strong>{{ bridgeDiffSummary.localNewer }}</strong>
          <span>项本地较新</span>
        </button>
        <button
          type="button"
          :disabled="!bridgeDiffSummary.tavernNewer"
          @click="selectSyncEntries('fromTavern', ['tavern-newer'])"
        >
          <strong>{{ bridgeDiffSummary.tavernNewer }}</strong>
          <span>项酒馆较新</span>
        </button>
        <small>
          {{ bridgeDiffSummary.consistent }} 项一致 · {{ bridgeDiffSummary.unverified }}
          项旧版 Bridge 无指纹，需复核
        </small>
      </aside>

      <section v-if="activeDirection === 'fromTavern'" class="tavern-bridge-workspace">
        <header>
          <div>
            <h2>酒馆现有资源</h2>
          </div>
          <button type="button" :disabled="busy" @click="refreshTavernResources">刷新目录</button>
        </header>
        <div class="tavern-bridge-explorer">
          <div class="tavern-bridge-type-filter" aria-label="酒馆资源类型筛选">
            <button
              v-for="filter in tavernReceiveFilters"
              :key="filter.key"
              type="button"
              :class="{ 'is-active': tavernReceiveFilter === filter.key }"
              @click="tavernReceiveFilter = filter.key"
            >
              <span>{{ filter.label }}</span>
              <small>{{ filter.count }}</small>
            </button>
          </div>
          <label class="tavern-bridge-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="tavernSearch" type="search" placeholder="搜索酒馆资源" />
          </label>
          <div class="tavern-bridge-selectbar">
            <button type="button" :disabled="!visibleTavernItems.length" @click="selectAllTavern">
              {{
                visibleTavernItems.length &&
                visibleTavernItems.every((item) => selectedTavernIds.has(item.id))
                  ? '取消当前全选'
                  : '全选当前分类'
              }}
            </button>
            <span
              >当前 {{ visibleTavernItems.length }} 项 · 已选 {{ selectedTavernIds.size }} 项</span
            >
            <div class="tavern-bridge-filter-actions">
              <label class="tavern-bridge-missing-toggle">
                <input v-model="showOnlyMissingTavern" type="checkbox" />
                <span>只看库中缺少的</span>
              </label>
              <button
                type="button"
                :class="{ 'is-active': showOnlySelectedTavern }"
                :aria-pressed="showOnlySelectedTavern"
                @click="showOnlySelectedTavern = !showOnlySelectedTavern"
              >
                只看已选 <small>{{ selectedTavernIds.size }}</small>
              </button>
            </div>
          </div>
        </div>
        <div class="tavern-bridge-resource-grid">
          <button
            v-for="item in visibleTavernItems"
            :key="item.id"
            type="button"
            class="tavern-bridge-resource-card"
            :class="{ 'is-selected': selectedTavernIds.has(item.id) }"
            @click="toggleSelection('tavern', item.id)"
          >
            <i aria-hidden="true"></i>
            <span class="tavern-bridge-resource-card__body"
              ><strong>{{ item.name }}</strong
              ><small>{{ item.fileName }}</small></span
            >
            <span class="tavern-bridge-resource-card__meta">
              <em>{{ tavernResourceLabel(item.kind) }}</em>
              <em v-if="itemExistsLocally(item)" class="tavern-bridge-exists">可能已在库中</em>
            </span>
          </button>
          <p v-if="!visibleTavernItems.length" class="tavern-bridge-empty">
            当前分类没有匹配资源，请切换分类或清除搜索。
          </p>
        </div>
        <button
          class="tavern-bridge__primary tavern-bridge__sticky-action"
          type="button"
          :disabled="busy || !selectedTavernIds.size"
          @click="pullFromTavern"
        >
          <span>{{ busy ? '正在接收…' : `取回 ${selectedTavernIds.size} 项并导入 SRL` }}</span>
          <small v-if="!busy">已选内容会直接进入本地资源库</small>
        </button>
      </section>

      <section v-else class="tavern-bridge-workspace">
        <header>
          <div>
            <h2>选择本地资源</h2>
          </div>
        </header>
        <div class="tavern-bridge-type-filter" aria-label="本地资源类型筛选">
          <button
            v-for="filter in localSendFilters"
            :key="filter.key"
            type="button"
            :class="{ 'is-active': localSendFilter === filter.key }"
            @click="localSendFilter = filter.key"
          >
            <span>{{ filter.label }}</span>
            <small>{{ filter.count }}</small>
          </button>
        </div>
        <label class="tavern-bridge-search">
          <span aria-hidden="true">⌕</span>
          <input v-model="search" type="search" placeholder="搜索名称或文件名" />
        </label>
        <div class="tavern-bridge-library-filter" aria-label="按库内整理筛选">
          <select v-model="bridgeFolderFilter" aria-label="按文件夹筛选">
            <option value="">全部文件夹</option>
            <option v-for="category in props.categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
          <select v-model="bridgeTagFilter" aria-label="按标签筛选">
            <option value="">全部标签</option>
            <option v-for="tag in bridgeTagOptions" :key="tag" :value="tag">{{ tag }}</option>
          </select>
          <label class="tavern-bridge-missing-toggle">
            <input v-model="bridgeFavoritesOnly" type="checkbox" />
            <span>只看收藏</span>
          </label>
        </div>
        <div class="tavern-bridge-selectbar">
          <button type="button" @click="selectAllLocal">全选当前结果</button>
          <span>已选 {{ selectedLocalIds.size }} / {{ filteredLocalResources.length }}</span>
          <div class="tavern-bridge-filter-actions">
            <label v-if="tavernItems.length" class="tavern-bridge-missing-toggle">
              <input v-model="showOnlyMissingLocal" type="checkbox" />
              <span>只看酒馆缺少的</span>
            </label>
            <button
              type="button"
              :class="{ 'is-active': showOnlySelectedLocal }"
              :aria-pressed="showOnlySelectedLocal"
              @click="showOnlySelectedLocal = !showOnlySelectedLocal"
            >
              只看已选 <small>{{ selectedLocalIds.size }}</small>
            </button>
          </div>
        </div>
        <div class="tavern-bridge-resource-grid">
          <button
            v-for="resource in filteredLocalResources"
            :key="resource.id"
            type="button"
            class="tavern-bridge-resource-card"
            :class="{ 'is-selected': selectedLocalIds.has(resource.id) }"
            @click="toggleSelection('local', resource.id)"
          >
            <i aria-hidden="true"></i>
            <span class="tavern-bridge-resource-card__body"
              ><strong>{{ resource.name }}</strong
              ><small>{{ resource.fileName }}</small></span
            >
            <span class="tavern-bridge-resource-card__meta">
              <em>{{ resourceLabel(resource) }}</em>
              <em v-if="resourceExistsInTavern(resource)" class="tavern-bridge-exists"
                >酒馆可能已有</em
              >
            </span>
          </button>
          <p v-if="!filteredLocalResources.length" class="tavern-bridge-empty">
            当前筛选没有可发送资源，请切换分类或清除筛选。
          </p>
        </div>
        <fieldset class="tavern-bridge-conflicts">
          <legend>酒馆遇到同名资源时</legend>
          <label
            ><input v-model="conflictPolicy" type="radio" value="copy" /><span
              ><strong>保留副本</strong><small>推荐，不改动酒馆原资源</small></span
            ></label
          >
          <label
            ><input v-model="conflictPolicy" type="radio" value="skip" /><span
              ><strong>跳过同名</strong><small>只发送酒馆里没有的资源</small></span
            ></label
          >
          <label
            ><input v-model="conflictPolicy" type="radio" value="overwrite" /><span
              ><strong>覆盖同名</strong><small>发送前会再次确认</small></span
            ></label
          >
        </fieldset>
        <p v-if="sendConflictCount" class="tavern-bridge-conflict-note" role="status">
          所选中有 {{ sendConflictCount }} 项与酒馆同名：{{
            conflictPolicy === 'copy'
              ? '将以副本名发送，不改动酒馆原资源'
              : conflictPolicy === 'skip'
                ? '这些项将被跳过'
                : '这些项将覆盖酒馆中的同名资源'
          }}。
        </p>
        <button
          class="tavern-bridge__primary tavern-bridge__sticky-action"
          type="button"
          :disabled="busy || !selectedLocalIds.size"
          @click="sendToTavern"
        >
          <span>{{ busy ? '正在发送…' : `发送 ${selectedLocalIds.size} 项到酒馆` }}</span>
          <small v-if="!busy">按上方分类筛选后可批量选择</small>
        </button>
      </section>

      <aside
        v-if="progress || error || reports.length"
        class="tavern-bridge-report"
        aria-live="polite"
      >
        <p v-if="error" role="alert">{{ error }}</p>
        <strong v-else-if="progress">{{ progress }}</strong>
        <ul v-if="transferQueue.length" class="tavern-bridge-queue">
          <li v-for="item in transferQueue" :key="item.key" :data-status="item.status">
            <i aria-hidden="true"></i>
            <span
              ><strong>{{ item.label }} · {{ item.name }}</strong
              ><small v-if="item.detail">{{ item.detail }}</small></span
            >
            <em>{{
              item.status === 'pending'
                ? '等待'
                : item.status === 'active'
                  ? '进行中'
                  : item.status === 'done'
                    ? '完成'
                    : '失败'
            }}</em>
          </li>
        </ul>
        <button
          v-if="failedTransferKeys.length && !busy"
          class="tavern-bridge-retry"
          type="button"
          @click="retryFailedTransfers"
        >
          重试 {{ failedTransferKeys.length }} 个失败项
        </button>
        <ol v-if="reports.length">
          <li v-for="item in reports.slice(0, 5)" :key="item">{{ item }}</li>
        </ol>
        <small v-if="reports.length" class="tavern-bridge-report-hint"
          >最近 {{ reports.length }} 条记录会跨会话保留</small
        >
      </aside>
    </template>
    <section
      v-if="!initialKind"
      class="tavern-bridge-author-tools"
      aria-labelledby="author-tools-title"
    >
      <div>
        <small>MADE BY THE AUTHOR</small>
        <h2 id="author-tools-title">还想试试其他小工具？</h2>
        <p>独立维护的酒馆扩展；查看用途、兼容边界和项目地址。</p>
      </div>
      <button type="button" @click="openAuthorTools">查看其他小工具</button>
    </section>

    <Teleport to="body">
      <div
        v-if="authorToolsDialog"
        class="author-tools-dialog"
        role="presentation"
        tabindex="-1"
        @click.self="closeAuthorTools"
        @keydown.esc="closeAuthorTools"
      >
        <section
          v-if="authorToolsDialog === 'list'"
          class="author-tools-dialog__sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="author-tools-dialog-title"
        >
          <header class="author-tools-dialog__header">
            <div>
              <small>AUTHOR TOOLBOX</small>
              <h2 id="author-tools-dialog-title">作者的其他小工具</h2>
            </div>
            <button type="button" aria-label="关闭" @click="closeAuthorTools">×</button>
          </header>
          <p class="author-tools-dialog__intro">
            每个项目独立维护与发布，点击后查看具体用途和仓库地址。
          </p>
          <ol class="author-tools-dialog__list">
            <li v-for="tool in AUTHOR_TOOLS" :key="tool.id">
              <small>{{ tool.eyebrow }}</small>
              <h3>{{ tool.name }}</h3>
              <p>{{ tool.summary }}</p>
              <button type="button" @click="showAuthorToolDetails(tool.id)">查看详情</button>
            </li>
          </ol>
        </section>

        <section
          v-else-if="selectedAuthorTool"
          class="author-tools-dialog__sheet"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`author-tool-${selectedAuthorTool.id}-title`"
        >
          <header class="author-tools-dialog__header">
            <FeatureBackButton
              class="author-tools-dialog__back"
              label="返回小工具列表"
              @click="authorToolsDialog = 'list'"
            />
            <button type="button" aria-label="关闭" @click="closeAuthorTools">×</button>
          </header>
          <article class="author-tool-detail">
            <small>{{ selectedAuthorTool.eyebrow }}</small>
            <h2 :id="`author-tool-${selectedAuthorTool.id}-title`">
              {{ selectedAuthorTool.name }}
            </h2>
            <p class="author-tool-detail__summary">{{ selectedAuthorTool.summary }}</p>
            <ul>
              <li v-for="detail in selectedAuthorTool.details" :key="detail">{{ detail }}</li>
            </ul>
            <label>GitHub 项目地址</label>
            <code>{{ selectedAuthorTool.repository }}</code>
            <div class="author-tool-detail__actions">
              <a :href="selectedAuthorTool.repository" target="_blank" rel="noreferrer"
                >打开 GitHub</a
              >
              <button type="button" @click="copyAuthorToolRepository(selectedAuthorTool)">
                {{ copiedAuthorToolId === selectedAuthorTool.id ? '已复制地址' : '一键复制地址' }}
              </button>
            </div>
          </article>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped src="../styles/TavernBridgeCenter.css"></style>
