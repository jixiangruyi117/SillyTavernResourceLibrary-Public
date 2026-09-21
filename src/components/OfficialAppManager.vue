<script setup lang="ts">
import { onMounted, ref } from 'vue'
import FeatureAppHeader from './FeatureAppHeader.vue'
import { FEATURE_APP_REGISTRY } from '../core/FeatureAppRegistry'
import { officialAppService } from '../core/OfficialAppRuntime'
import {
  isOfficialAppId,
  type InstalledOfficialApp,
  type OfficialAppId,
} from '../types/OfficialApp'
import { OFFICIAL_APP_DATA_DESCRIPTION } from '../types/OfficialApp'
defineEmits<{ back: [] }>()
const apps = FEATURE_APP_REGISTRY.filter((app) => isOfficialAppId(app.id))
const installed = ref<InstalledOfficialApp[]>([])
const busy = ref(false)
const message = ref('')
const selected = ref<OfficialAppId>()
const selectedAction = ref<'uninstall' | 'clearData'>()
const removeDataOnUninstall = ref(false)
const clearStyles = ref(false)
const sizes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
const find = (id: string) => installed.value.find((app) => app.id === id)
async function refresh() {
  installed.value = await officialAppService.list()
}
async function install(id: string) {
  if (!isOfficialAppId(id)) return
  busy.value = true
  message.value = '正在下载并校验 APP…'
  try {
    await officialAppService.install(id)
    await refresh()
    message.value = '安装成功'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '安装失败'
  } finally {
    busy.value = false
  }
}
function choose(id: string, action: 'uninstall' | 'clearData') {
  if (isOfficialAppId(id)) {
    selected.value = id
    selectedAction.value = action
    removeDataOnUninstall.value = false
    clearStyles.value = false
    message.value = ''
  }
}
function cancelSelectedAction() {
  selected.value = undefined
  selectedAction.value = undefined
}
async function applySelectedAction() {
  if (!selected.value || !selectedAction.value) return
  busy.value = true
  try {
    const app = selected.value
    if (selectedAction.value === 'clearData') {
      await officialAppService.clearAppData(app, clearStyles.value)
      message.value =
        '已清理该 APP 的独占数据。程序文件、资源库原件、其他 APP、远端文件和共用配置均已保留；请刷新后再打开该 APP。'
    } else {
      const bytes = await officialAppService.uninstall(
        app,
        removeDataOnUninstall.value,
        removeDataOnUninstall.value && clearStyles.value,
      )
      message.value = `已卸载，删除独占程序文件 ${sizes(bytes)}。共用文件继续保留；已加载的代码会在关闭或刷新页面后退出内存。`
    }
    await refresh()
    selected.value = undefined
    selectedAction.value = undefined
  } catch (error) {
    message.value =
      error instanceof Error
        ? error.message
        : selectedAction.value === 'clearData'
          ? '清理数据失败'
          : '卸载失败'
  } finally {
    busy.value = false
  }
}
onMounted(() =>
  refresh().catch((error) => {
    message.value = String(error)
  }),
)
</script>
<template>
  <FeatureAppHeader title="APP 管理" @back="$emit('back')" />
  <section class="official-app-manager" :aria-busy="busy">
    <p>程序按需下载。升级资源库后可重新下载兼容版本，原有数据保留。</p>
    <p v-if="message" role="status">{{ message }}</p>
    <ul>
      <li v-for="app in apps" :key="app.id">
        <div>
          <strong>{{ app.name }}</strong
          ><small>{{
            find(app.id)
              ? `已安装 · ${sizes(find(app.id)!.files.reduce((sum, file) => sum + file.size, 0))}（含共用文件）`
              : '未安装'
          }}</small>
        </div>
        <button type="button" :disabled="busy" @click="install(app.id)">
          {{ find(app.id) ? '重下' : '下载' }}
        </button>
        <button
          v-if="find(app.id)"
          type="button"
          :disabled="busy"
          @click="choose(app.id, 'uninstall')"
        >
          卸载
        </button>
        <button type="button" :disabled="busy" @click="choose(app.id, 'clearData')">
          清理数据
        </button>
      </li>
    </ul>
    <form
      v-if="selected && selectedAction"
      class="official-app-manager__confirm"
      @submit.prevent="applySelectedAction"
    >
      <strong
        >{{ apps.find((app) => app.id === selected)?.name }} ·
        {{ selectedAction === 'clearData' ? '清理数据' : '卸载选项' }}</strong
      >
      <template v-if="selectedAction === 'clearData'">
        <label><input v-model="clearStyles" type="checkbox" />同时删除该 APP 的自定义样式</label>
        <p>
          将清除：{{ OFFICIAL_APP_DATA_DESCRIPTION[selected] }}。APP
          程序文件继续保留，资源库原件、其他 APP、远端文件和共用 API/图床设置不会受影响。
        </p>
        <p>本机删除后无法撤销；正在使用该 APP 时会拒绝操作，避免旧页面把数据重新写回。</p>
      </template>
      <template v-else>
        <label
          ><input v-model="removeDataOnUninstall" type="radio" :value="false" />仅卸载
          APP，保留数据</label
        >
        <label
          ><input v-model="removeDataOnUninstall" type="radio" :value="true" />同时删除 APP
          数据</label
        >
      </template>
      <label v-if="selectedAction === 'uninstall' && removeDataOnUninstall"
        ><input v-model="clearStyles" type="checkbox" />同时删除该 APP 的自定义样式</label
      >
      <p v-if="selectedAction === 'uninstall'">
        局部样式默认保留，重装后继续生效。勾选删除时会从所有外观预设移除该 APP 的局部 CSS；通用 CSS
        保留。
      </p>
      <p v-if="selectedAction === 'uninstall' && removeDataOnUninstall">
        将清除：{{
          OFFICIAL_APP_DATA_DESCRIPTION[selected]
        }}。本机删除后无法撤销，请先备份需要的内容。
      </p>
      <p v-else-if="selectedAction === 'uninstall'">重新安装后可继续使用原有数据。</p>
      <button type="submit" :disabled="busy">
        {{
          selectedAction === 'clearData'
            ? '确认清理数据'
            : removeDataOnUninstall
              ? '确认卸载并清除数据'
              : '确认仅卸载 APP'
        }}
      </button>
      <button type="button" :disabled="busy" @click="cancelSelectedAction">取消</button>
    </form>
  </section>
</template>
<style scoped>
.official-app-manager {
  padding: 0.75rem;
  overflow-wrap: anywhere;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--color-line);
}
li div {
  flex: 1;
  min-width: 0;
}
small {
  display: block;
  font-size: 0.75rem;
  opacity: 0.75;
}
button {
  min-height: 44px;
  flex-shrink: 0;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-surface-raised);
}
.official-app-manager__confirm {
  margin-top: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--color-line);
  border-radius: 0.75rem;
}
label {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 44px;
}
</style>
