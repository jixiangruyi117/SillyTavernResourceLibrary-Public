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
  <section class="cloud-center">
    <FeatureAppHeader title="GitHub 直连备份" @back="emit('back')" />

    <div class="cloud-workspace">
      <form class="cloud-config" @submit.prevent="connect">
        <header>
          <div>
            <small>GITHUB DIRECT BACKUP</small>
            <h2>连接私有仓库</h2>
          </div>
          <span>步骤 1 / 配置</span>
        </header>

        <details class="cloud-beginner-guide" :open="!owner || !repository">
          <summary>
            <span
              ><strong>第一次用？照着 3 步填</strong
              ><small>备份直接写入你的 GitHub 私有仓库</small></span
            ><i>约 3 分钟</i>
          </summary>
          <ol class="cloud-tutorial-list">
            <li>在 GitHub 新建一个 <b>Private</b> 仓库。</li>
            <li>创建只允许访问该仓库、Contents 为 <b>Read and write</b> 的细粒度 Token。</li>
            <li>把用户名、仓库名和 Token 填到下面，点击“测试并保存”。</li>
          </ol>
          <p class="cloud-device-note">
            <b>手机和电脑步骤相同：</b>GitHub Token
            只会在本机受保护存储中使用，不会经过资源库作者的服务器。
          </p>
          <a href="https://github.com/new" target="_blank" rel="noreferrer"
            >打开 GitHub 新建仓库页面 →</a
          >
        </details>

        <label
          ><span>你的 GitHub 名字</span
          ><input v-model.trim="owner" autocomplete="username" placeholder="例如 octocat"
        /></label>
        <label
          ><span>备份仓库名字</span><input v-model.trim="repository" placeholder="例如 srl-backups"
        /></label>
        <label
          ><span>GitHub Token</span
          ><input
            v-model="token"
            type="password"
            autocomplete="new-password"
            placeholder="github_pat_…"
          /><small>只用于当前设备直连 GitHub；验证成功后不会再次显示完整 Token。</small></label
        >

        <div class="cloud-config__row">
          <label
            ><span>保留份数</span
            ><input v-model.number="retention" type="number" inputmode="numeric" min="1" max="100"
          /></label>
        </div>
        <div class="cloud-config__actions">
          <button class="button--primary" type="submit" :disabled="busy">
            {{ busy ? '连接中…' : '测试并保存' }}
          </button>
        </div>
      </form>

      <section class="cloud-operations">
        <header>
          <div>
            <small>BACKUP &amp; RESTORE</small>
            <h2>云端档案</h2>
          </div>
          <span>步骤 2 / 使用</span>
        </header>
        <div class="cloud-primary-actions">
          <button class="button--primary" type="button" :disabled="busy" @click="createBackup">
            {{ busy ? '生成并上传中…' : '立即备份（只传变化）' }}
          </button>
          <button type="button" :disabled="busy" @click="refreshBackups">刷新列表</button>
        </div>
        <p class="cloud-operations__note">
          备份请求从浏览器直接发送到你的 GitHub
          私有仓库，不经过资源库作者的服务器。资源按内容变化上传，恢复时会合并回本机资源库。
        </p>
        <details class="cloud-guide">
          <summary>上传方式与安全说明</summary>
          <p>
            SRL
            使用对象级差分备份；没有变化的内容不会重复上传。备份完成并通过远端校验后才会出现在列表中，保留份数之外的旧备份会按配置清理。
          </p>
          <p>
            请使用私有仓库和仅本仓库权限的 Token。资源库不会托管你的
            Token，也不会把备份内容发送到作者服务器。
          </p>
        </details>
        <div v-if="message" class="cloud-message" role="status">{{ message }}</div>
        <div v-if="error" class="cloud-backup-error" role="alert">{{ error }}</div>
        <div v-if="backups.length" class="cloud-backup-list">
          <article v-for="item in backups" :key="item.id">
            <div>
              <strong>{{ item.archiveName ?? item.objectKey }}</strong>
              <small>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</small>
            </div>
            <span>
              <button type="button" :disabled="busy" @click="download(item)">下载</button>
              <button type="button" :disabled="busy" @click="restore(item)">导入本机</button>
            </span>
          </article>
        </div>
        <div v-else class="cloud-empty">
          <strong>还没有读取云端备份</strong>
          <p>保存配置后先刷新列表，再创建或恢复备份。</p>
        </div>
      </section>
    </div>
  </section>
</template>
