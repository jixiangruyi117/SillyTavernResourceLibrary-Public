<script setup lang="ts">
import { reloadAfterLoadFailure } from '../core/ServiceWorkerReload'

defineProps<{ label: string }>()

function reloadPage(): void {
  void reloadAfterLoadFailure()
}
</script>

<template>
  <div class="async-panel-error" role="alert">
    <p class="async-panel-error__title">{{ label }}加载失败</p>
    <p class="async-panel-error__hint">
      可能是旧版本文件已失效，也可能是网络暂时中断。可以重新获取页面，本机资源与设置会保留。
    </p>
    <button class="async-panel-error__action" type="button" @click="reloadPage">刷新页面</button>
  </div>
</template>
