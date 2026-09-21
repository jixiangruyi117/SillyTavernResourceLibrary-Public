<script setup lang="ts">
import FeatureAppHeader from './FeatureAppHeader.vue'
import {
  useCloudBackupCenter,
  type CloudBackupCenterEvents,
  type CloudBackupCenterProps,
} from '../composables/UseCloudBackupCenter'

const props = defineProps<CloudBackupCenterProps>()
const emit = defineEmits<CloudBackupCenterEvents>()
const {
  owner,
  repository,
  token,
  retention,
  backups,
  busy,
  message,
  error,
  connect,
  createBackup,
  refreshBackups,
  download,
  restore,
} = useCloudBackupCenter(emit, props.resources)
</script>

<template>
  <section class="cloud-backup">
    <FeatureAppHeader title="GitHub 直连备份" @back="$emit('back')" />
    <p class="cloud-backup__hint">
      备份请求从浏览器直接发送到你配置的 GitHub 仓库，不经过资源库作者的服务器。
      请使用私有仓库和仅本仓库权限的令牌。
    </p>
    <form class="cloud-backup__form" @submit.prevent="connect">
      <label><span>仓库所有者</span><input v-model.trim="owner" required /></label>
      <label><span>仓库名</span><input v-model.trim="repository" required /></label>
      <label
        ><span>GitHub Token</span><input v-model="token" type="password" autocomplete="off"
      /></label>
      <label
        ><span>保留份数</span><input v-model.number="retention" type="number" min="1" max="100"
      /></label>
      <button type="submit" :disabled="busy">{{ busy ? '连接中…' : '连接并保存' }}</button>
    </form>
    <p v-if="message" class="cloud-backup__message" role="status">{{ message }}</p>
    <p v-if="error" class="cloud-backup__error" role="alert">{{ error }}</p>
    <div class="cloud-backup__actions">
      <button type="button" :disabled="busy" @click="createBackup">立即备份</button>
      <button type="button" :disabled="busy" @click="refreshBackups">刷新列表</button>
    </div>
    <ul class="cloud-backup__list">
      <li v-for="item in backups" :key="item.id">
        <span>{{ item.archiveName ?? item.objectKey }}</span>
        <small>{{ new Date(item.createdAt).toLocaleString() }}</small>
        <button type="button" @click="download(item)">下载</button>
        <button type="button" :disabled="busy" @click="restore(item)">恢复</button>
      </li>
      <li v-if="!backups.length">还没有读取到 GitHub 备份。</li>
    </ul>
  </section>
</template>
