<script setup lang="ts">
import { toRef } from 'vue'
import FeatureAppIcon from './FeatureAppIcon.vue'
import ActionSheet from './ActionSheet.vue'
import FeatureShell from './FeatureShell.vue'
import FeatureStateView from './FeatureStateView.vue'
import FolderLibraryView from './FolderLibraryView.vue'
import {
  useFeatureHub,
  type FeatureHubProps,
  type FeatureHubEvents,
} from '../composables/UseFeatureHub'
const props = defineProps<FeatureHubProps>()
const emit = defineEmits<FeatureHubEvents>()
const controller = useFeatureHub(props, emit)
const {
  activePage,
  desktopFilterOpen,
  desktopFilterButtonLabel,
  currentFeatureDesktopEntries,
  handleDesktopPointerDown,
  handleDesktopPointerUp,
  featureDesktopEntryKey,
  featureDesktopEntryClass,
  isFeatureDesktopEntryPinned,
  featureDesktopEntryName,
  handleFeatureDesktopEntryClick,
  openFeatureDesktopEntry,
  handleFeatureDesktopEntryPointerDown,
  handleFeatureDesktopEntryPointerMove,
  handleFeatureDesktopEntryPointerEnd,
  featureDesktopEntryIconClass,
  featureDesktopEntryDescription,
  featureDesktopEntryBadge,
  featureDesktopPageCount,
  desktopPage,
  setFeatureDesktopPage,
  desktopFilterActions,
  selectDesktopFilter,
  DrawApp,
  OfficialAppManager,
  AppearanceStudio,
  TavernBridgeCenter,
  bundleSendIds,
  PresetStitcherApp,
  FrontendWorkshopApp,
  ImageGenerationApp,
  GeneratedImageAlbumApp,
  UserPersonaApp,
  ResourceBundleApp,
  ChatReaderApp,
  sendBundleToTavern,
  ExternalAppManager,
  handleExternalAppsChanged,
  handleExternalAppInstalled,
  activeExternalAppId,
  ExternalAppHost,
  CloudBackupCenter,
} = controller
const desktopPointerStart = toRef(controller, 'desktopPointerStart')
</script>

<template>
  <main
    class="feature-hub"
    :class="{ 'feature-hub--app': activePage !== 'home' }"
    :data-feature-page="activePage"
  >
    <template v-if="activePage === 'home'">
      <FeatureShell title="功能" back-label="返回资源库" @back="emit('close')">
        <template #actions>
          <button
            class="feature-header-action feature-header-action--ghost"
            type="button"
            @click="activePage = 'officialApps'"
          >
            APP 管理
          </button>
          <button
            class="feature-header-action feature-header-action--ghost"
            type="button"
            aria-label="筛选功能"
            @click="desktopFilterOpen = true"
          >
            {{ desktopFilterButtonLabel }}
          </button>
        </template>
        <section
          v-if="currentFeatureDesktopEntries.length"
          class="feature-desktop"
          aria-label="功能应用"
          @pointerdown="handleDesktopPointerDown"
          @pointerup="handleDesktopPointerUp"
          @pointercancel="desktopPointerStart = undefined"
        >
          <div
            v-for="entry in currentFeatureDesktopEntries"
            :key="featureDesktopEntryKey(entry)"
            :class="featureDesktopEntryClass(entry)"
            class="feature-app"
            role="button"
            tabindex="0"
            :aria-label="
              isFeatureDesktopEntryPinned(entry)
                ? `${featureDesktopEntryName(entry)}，长按取消收藏`
                : `${featureDesktopEntryName(entry)}，长按收藏`
            "
            @click="handleFeatureDesktopEntryClick(entry)"
            @contextmenu.prevent
            @keydown.enter="openFeatureDesktopEntry(entry)"
            @keydown.space.prevent="openFeatureDesktopEntry(entry)"
            @pointerdown="handleFeatureDesktopEntryPointerDown(entry, $event)"
            @pointermove="handleFeatureDesktopEntryPointerMove"
            @pointerup="handleFeatureDesktopEntryPointerEnd"
            @pointercancel="handleFeatureDesktopEntryPointerEnd"
            @pointerleave="handleFeatureDesktopEntryPointerEnd"
          >
            <span
              :class="featureDesktopEntryIconClass(entry)"
              class="feature-app__icon"
              aria-hidden="true"
            >
              <FeatureAppIcon v-if="entry.kind === 'builtIn'" :name="entry.app.icon" />
              <img v-else-if="entry.app.iconDataUrl" :src="entry.app.iconDataUrl" alt="" />
              <template v-else><i></i><i></i><i></i></template>
            </span>
            <strong>{{ featureDesktopEntryName(entry) }}</strong>
            <small>{{ featureDesktopEntryDescription(entry) }}</small>
            <em>{{ featureDesktopEntryBadge(entry) }}</em>
          </div>
        </section>
        <FeatureStateView v-else state="empty" title="还没有可用功能" />
        <nav
          v-if="featureDesktopPageCount > 1"
          class="feature-desktop__pagination"
          aria-label="功能应用分页"
        >
          <button
            type="button"
            aria-label="上一页应用"
            :disabled="desktopPage === 0"
            @click="setFeatureDesktopPage(desktopPage - 1)"
          >
            ‹
          </button>
          <button
            v-for="page in featureDesktopPageCount"
            :key="page"
            class="feature-desktop__page-dot"
            :class="{ 'is-active': desktopPage === page - 1 }"
            type="button"
            :aria-label="`第 ${page} 页应用`"
            :aria-current="desktopPage === page - 1 ? 'page' : undefined"
            @click="setFeatureDesktopPage(page - 1)"
          ></button>
          <button
            type="button"
            aria-label="下一页应用"
            :disabled="desktopPage === featureDesktopPageCount - 1"
            @click="setFeatureDesktopPage(desktopPage + 1)"
          >
            ›
          </button>
        </nav>
      </FeatureShell>
      <ActionSheet
        v-model:open="desktopFilterOpen"
        title="筛选功能"
        :actions="desktopFilterActions"
        @select="selectDesktopFilter"
      />
    </template>

    <OfficialAppManager v-else-if="activePage === 'officialApps'" @back="activePage = 'home'" />
    <DrawApp
      v-else-if="activePage === 'draw'"
      v-bind="props"
      @back="activePage = 'home'"
      @close="emit('close')"
      @open-resource="emit('openResource', $event)"
    />
    <template v-else-if="activePage === 'folders'">
      <FolderLibraryView
        :categories="categories"
        :resources="resources"
        :busy="folderBusy"
        :cabinet-resource-ids="cabinetResourceIds"
        @back="activePage = 'home'"
        @open-resource="emit('openResource', $event)"
        @manage="emit('manageFolders')"
        @add="emit('folderAdd', $event)"
        @cover="emit('folderCover', $event)"
        @rename="emit('folderRename', $event)"
        @reorder="emit('folderReorder', $event)"
        @pin="emit('cabinetPin', $event)"
        @unpin="emit('cabinetUnpin', $event)"
      />
    </template>

    <AppearanceStudio
      v-else-if="activePage === 'appearance'"
      :theme="theme"
      :layout-mode="layoutMode"
      :ui-font-scale="uiFontScale"
      :custom-css="customCss"
      @back="activePage = 'home'"
      @update:theme="emit('update:theme', $event)"
      @update:layout-mode="emit('update:layoutMode', $event)"
      @update:ui-font-scale="emit('update:uiFontScale', $event)"
      @save-css="emit('save-css', $event)"
    />
    <TavernBridgeCenter
      v-else-if="activePage === 'tavernBridge'"
      :resources="resources"
      :categories="categories"
      :initial-local-ids="bundleSendIds"
      @back="activePage = 'home'"
      @import-files="emit('import-files', $event)"
    />
    <PresetStitcherApp
      v-else-if="activePage === 'stitch'"
      :resources="resources"
      :categories="categories"
      @back="activePage = 'home'"
      @library-changed="emit('library-changed')"
    />
    <FrontendWorkshopApp
      v-else-if="activePage === 'frontendWorkshop'"
      @back="activePage = 'home'"
      @library-changed="emit('library-changed')"
    />
    <ImageGenerationApp
      v-else-if="activePage === 'imageGeneration'"
      @back="activePage = 'home'"
      @open-album="activePage = 'imageAlbum'"
    />
    <GeneratedImageAlbumApp v-else-if="activePage === 'imageAlbum'" @back="activePage = 'home'" />
    <UserPersonaApp
      v-else-if="activePage === 'userPersona'"
      :resources="resources"
      :categories="categories"
      @back="activePage = 'home'"
      @library-changed="emit('library-changed')"
      @open-history="emit('openPersonaHistory', $event)"
    />
    <ChatReaderApp v-else-if="activePage === 'chatReader'" @back="activePage = 'home'" />
    <ResourceBundleApp
      v-else-if="activePage === 'resourceBundle'"
      :resources="resources"
      :categories="categories"
      @back="activePage = 'home'"
      @library-changed="emit('library-changed')"
      @send-to-tavern="sendBundleToTavern"
    />
    <ExternalAppManager
      v-else-if="activePage === 'extensions'"
      :shared-files="sharedAppFiles ?? []"
      @back="activePage = 'home'"
      @changed="handleExternalAppsChanged"
      @installed="handleExternalAppInstalled"
      @shared-files-consumed="emit('shared-app-files-consumed')"
    />
    <ExternalAppHost
      v-else-if="activePage === 'externalApp' && activeExternalAppId"
      :app-id="activeExternalAppId"
      @back="activePage = 'home'"
    />
    <CloudBackupCenter
      v-else
      :resource-count="resources.length"
      :resources="resources"
      :categories="categories"
      @back="activePage = 'home'"
      @library-changed="emit('library-changed')"
    />
  </main>
</template>

<style src="../styles/FeatureDesktop.css"></style>
