<script setup lang="ts">
defineProps<{ label: string }>()

function reloadPage(): void {
  window.location.reload()
}
</script>

<template>
  <div class="async-panel-error" role="alert">
    <p class="async-panel-error__title">{{ label }}加载失败</p>
    <p class="async-panel-error__hint">
      通常是资源库刚完成更新，当前页面还在使用旧版本；也可能是网络暂时中断。刷新后即可继续，本地资源不受影响。
    </p>
    <button class="async-panel-error__action" type="button" @click="reloadPage">刷新页面</button>
  </div>
</template>
