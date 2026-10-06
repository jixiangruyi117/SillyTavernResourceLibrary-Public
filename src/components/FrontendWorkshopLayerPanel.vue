<script setup lang="ts">
import { computed, onUnmounted, ref, toRaw, watch } from 'vue'

import { confirmAction } from '../composables/UseConfirmDialog'
import type {
  FrontendWorkshopLayer,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'
import { findFrontendWorkshopNode } from '../types/FrontendWorkshopProject'
import { applyFrontendWorkshopCommand } from '../utils/FrontendWorkshopCommandSystem'
import {
  cloneFrontendWorkshopProject,
  flattenFrontendWorkshopNodes,
} from '../utils/FrontendWorkshopProjectGeometry'

const props = defineProps<{
  project: FrontendWorkshopProject
  pageId: string
  activeLayerId: string
  selectedNodeId: string
}>()

const emit = defineEmits<{
  close: []
  activeLayerChange: [id: string]
  selectedNodeChange: [id: string]
  commitProject: [
    payload: { previousProject: FrontendWorkshopProject; project: FrontendWorkshopProject },
  ]
  status: [message: string]
}>()

const renamingLayerId = ref('')
const layerNameDraft = ref('')
const draggedLayerId = ref('')
const displayLayers = ref<FrontendWorkshopLayer[]>([])
let layerDragTimer: ReturnType<typeof setTimeout> | undefined
let layerDragSession:
  | {
      pointerId: number
      layerId: string
      startX: number
      startY: number
      active: boolean
      handle: HTMLElement
    }
  | undefined

const currentPage = computed(() => props.project.pages.find((page) => page.id === props.pageId))
const currentLayers = computed(() => currentPage.value?.layers ?? [])
const hiddenCanvasNodes = computed(() =>
  flattenFrontendWorkshopNodes(currentPage.value?.nodes ?? []).filter((node) => node.hidden),
)
const selectedNode = computed(() =>
  currentPage.value
    ? findFrontendWorkshopNode(currentPage.value.nodes, props.selectedNodeId)
    : undefined,
)

watch(
  currentLayers,
  (layers) => {
    if (!layerDragSession?.active) displayLayers.value = layers.map((layer) => ({ ...layer }))
  },
  { immediate: true },
)

function commit(mutator: (project: FrontendWorkshopProject) => void): boolean {
  const previousProject = cloneFrontendWorkshopProject(props.project)
  const result = applyFrontendWorkshopCommand(toRaw(props.project), mutator)
  if (!result.ok) {
    emit('status', result.issues.map((issue) => issue.message).join('；'))
    return false
  }
  emit('commitProject', { previousProject, project: result.project })
  return true
}

function selectLayer(id: string): void {
  const nextId = props.activeLayerId === id ? '' : id
  emit('activeLayerChange', nextId)
  if (selectedNode.value && nextId && selectedNode.value.layerId !== nextId) {
    emit('selectedNodeChange', '')
  }
}

function createLayer(): void {
  const layer: FrontendWorkshopLayer = {
    id: crypto.randomUUID(),
    name: `图层 ${currentLayers.value.length + 1}`,
    visible: true,
    locked: false,
  }
  if (
    commit((project) => {
      project.pages.find((page) => page.id === props.pageId)?.layers.push(layer)
    })
  ) {
    emit('activeLayerChange', layer.id)
  }
}

function updateLayer(id: string, key: 'visible' | 'locked'): void {
  commit((project) => {
    const layer = project.pages
      .find((page) => page.id === props.pageId)
      ?.layers.find((item) => item.id === id)
    if (layer) layer[key] = !layer[key]
  })
  if (selectedNode.value?.layerId === id) emit('selectedNodeChange', '')
}

function moveLayer(id: string, direction: -1 | 1): void {
  commit((project) => {
    const layers = project.pages.find((page) => page.id === props.pageId)?.layers
    if (!layers) return
    const index = layers.findIndex((layer) => layer.id === id)
    const destination = index + direction
    if (index < 0 || destination < 0 || destination >= layers.length) return
    const [layer] = layers.splice(index, 1)
    layers.splice(destination, 0, layer!)
  })
}

function beginLayerRename(layer: FrontendWorkshopLayer): void {
  renamingLayerId.value = layer.id
  layerNameDraft.value = layer.name
}

function confirmLayerRename(id: string): void {
  const name = layerNameDraft.value.trim().slice(0, 40)
  if (!name) return
  commit((project) => {
    const layer = project.pages
      .find((page) => page.id === props.pageId)
      ?.layers.find((item) => item.id === id)
    if (layer) layer.name = name
  })
  renamingLayerId.value = ''
  layerNameDraft.value = ''
}

async function deleteLayer(id: string): Promise<void> {
  const page = currentPage.value
  const layer = page?.layers.find((item) => item.id === id)
  if (!page || !layer || page.layers.length <= 1) {
    emit('status', '项目至少需要保留一个图层。')
    return
  }
  const confirmed = await confirmAction({
    title: '删除图层',
    message: `删除“${layer.name}”？其中的元素会移到相邻图层，不会被删除。`,
    confirmLabel: '删除图层',
    danger: true,
  })
  if (!confirmed) return
  commit((project) => {
    const targetPage = project.pages.find((item) => item.id === props.pageId)
    if (!targetPage) return
    const index = targetPage.layers.findIndex((item) => item.id === id)
    const fallback = targetPage.layers[index - 1] ?? targetPage.layers[index + 1]
    if (!fallback) return
    targetPage.nodes.forEach((node) => {
      if (node.layerId === id) node.layerId = fallback.id
    })
    targetPage.layers.splice(index, 1)
  })
  if (props.activeLayerId === id) emit('activeLayerChange', '')
}

function showNode(id: string): void {
  commit((project) => {
    const page = project.pages.find((item) => item.id === props.pageId)
    const node = page ? findFrontendWorkshopNode(page.nodes, id) : undefined
    if (node) node.hidden = false
  })
  emit('selectedNodeChange', id)
}

function reorderDisplayLayers(id: string, targetId: string): void {
  if (id === targetId) return
  const from = displayLayers.value.findIndex((layer) => layer.id === id)
  const to = displayLayers.value.findIndex((layer) => layer.id === targetId)
  if (from < 0 || to < 0) return
  const [layer] = displayLayers.value.splice(from, 1)
  displayLayers.value.splice(to, 0, layer!)
}

function stopLayerDragListeners(): void {
  window.removeEventListener('pointermove', moveLayerDrag)
  window.removeEventListener('pointerup', endLayerDrag)
  window.removeEventListener('pointercancel', endLayerDrag)
}

function startLayerDrag(event: PointerEvent, layerId: string): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (layerDragTimer) clearTimeout(layerDragTimer)
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  layerDragSession = {
    pointerId: event.pointerId,
    layerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    handle,
  }
  stopLayerDragListeners()
  window.addEventListener('pointermove', moveLayerDrag)
  window.addEventListener('pointerup', endLayerDrag)
  window.addEventListener('pointercancel', endLayerDrag)
  try {
    handle.setPointerCapture(event.pointerId)
  } catch {
    // 旧 WebView 仍可使用上移/下移按钮。
  }
  layerDragTimer = setTimeout(() => {
    if (!layerDragSession || layerDragSession.pointerId !== event.pointerId) return
    layerDragSession.active = true
    draggedLayerId.value = layerId
  }, 320)
}

function moveLayerDrag(event: PointerEvent): void {
  const session = layerDragSession
  if (!session || session.pointerId !== event.pointerId) return
  if (!session.active) {
    if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 9) {
      if (layerDragTimer) clearTimeout(layerDragTimer)
      layerDragTimer = undefined
      layerDragSession = undefined
    }
    return
  }
  event.preventDefault()
  const row = Array.from(
    document.querySelectorAll<HTMLElement>('.frontend-workbench__layer-popover [data-layer-id]'),
  ).find((candidate) => {
    const rect = candidate.getBoundingClientRect()
    return event.clientY >= rect.top && event.clientY <= rect.bottom
  })
  const targetId = row?.dataset.layerId
  if (targetId) reorderDisplayLayers(session.layerId, targetId)
}

function endLayerDrag(event: PointerEvent): void {
  const session = layerDragSession
  if (!session || session.pointerId !== event.pointerId) return
  stopLayerDragListeners()
  if (layerDragTimer) clearTimeout(layerDragTimer)
  layerDragTimer = undefined
  layerDragSession = undefined
  draggedLayerId.value = ''
  try {
    session.handle.releasePointerCapture(event.pointerId)
  } catch {
    // 指针已由系统释放。
  }
  if (!session.active) return
  const order = displayLayers.value.map((layer) => layer.id)
  commit((project) => {
    const layers = project.pages.find((page) => page.id === props.pageId)?.layers
    if (!layers) return
    layers.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
  })
}

onUnmounted(() => {
  if (layerDragTimer) clearTimeout(layerDragTimer)
  stopLayerDragListeners()
})
</script>

<template>
  <Teleport to="body">
    <section
      class="frontend-workbench__rail-popover frontend-workbench__layer-popover is-left"
      role="dialog"
      aria-modal="true"
      aria-label="图层管理"
      @click.self="emit('close')"
    >
      <header>
        <strong>图层</strong>
        <span>
          <button
            type="button"
            class="button button--primary frontend-workbench__layer-create"
            @click="createLayer"
          >
            ＋ 新建
          </button>
          <button type="button" aria-label="关闭图层" @click="emit('close')">×</button>
        </span>
      </header>
      <button
        type="button"
        class="frontend-workbench__all-layers"
        :class="{ 'is-active': !activeLayerId }"
        @click="emit('activeLayerChange', '')"
      >
        <span><b>全部图层</b><small>所有可见、未锁定内容都能选</small></span>
      </button>
      <section v-if="hiddenCanvasNodes.length" class="frontend-workbench__hidden-nodes">
        <small>已隐藏元素</small>
        <button
          v-for="node in hiddenCanvasNodes"
          :key="node.id"
          type="button"
          :aria-label="`显示${node.label}`"
          @click="showNode(node.id)"
        >
          <span>{{ node.label }}</span
          ><b>显示</b>
        </button>
      </section>
      <article
        v-for="(layer, layerIndex) in displayLayers"
        :key="layer.id"
        :data-layer-id="layer.id"
        :class="{
          'is-active': activeLayerId === layer.id,
          'is-dragging': draggedLayerId === layer.id,
        }"
      >
        <button
          type="button"
          class="frontend-workbench__layer-visibility"
          :aria-label="layer.visible ? '隐藏图层' : '显示图层'"
          @click="updateLayer(layer.id, 'visible')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        </button>
        <button
          v-if="renamingLayerId !== layer.id"
          type="button"
          class="frontend-workbench__layer-name"
          @click="selectLayer(layer.id)"
        >
          <span>
            <b>{{ layer.name }}</b>
            <small
              >{{
                currentPage?.nodes.filter((node) => node.layerId === layer.id).length ?? 0
              }}
              个元素</small
            >
          </span>
        </button>
        <form
          v-else
          class="frontend-workbench__layer-rename"
          @submit.prevent="confirmLayerRename(layer.id)"
        >
          <input
            v-model="layerNameDraft"
            maxlength="40"
            aria-label="图层名称"
            @keydown.esc.prevent="renamingLayerId = ''"
            @blur="confirmLayerRename(layer.id)"
          />
        </form>
        <button
          type="button"
          class="frontend-workbench__layer-lock"
          :aria-label="layer.locked ? '解锁图层' : '锁定图层'"
          @click="updateLayer(layer.id, 'locked')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </button>
        <details class="frontend-workbench__layer-order">
          <summary
            aria-label="长按拖动图层，点击打开图层操作"
            title="长按拖动排序"
            @pointerdown="startLayerDrag($event, layer.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9h10M7 15h10" /></svg>
          </summary>
          <span>
            <button type="button" @click="beginLayerRename(layer)">重命名</button>
            <button
              type="button"
              :disabled="layerIndex === displayLayers.length - 1"
              @click="moveLayer(layer.id, 1)"
            >
              上移
            </button>
            <button type="button" :disabled="layerIndex === 0" @click="moveLayer(layer.id, -1)">
              下移
            </button>
            <button
              type="button"
              :disabled="displayLayers.length <= 1"
              class="is-danger"
              @click="deleteLayer(layer.id)"
            >
              删除图层
            </button>
          </span>
        </details>
      </article>
      <footer>
        <button type="button" @click="emit('activeLayerChange', '')">取消限定</button>
        <button type="button" class="button button--primary" @click="emit('close')">完成</button>
      </footer>
    </section>
  </Teleport>
</template>

<style src="../styles/FrontendWorkshopLayerPanel.css"></style>
