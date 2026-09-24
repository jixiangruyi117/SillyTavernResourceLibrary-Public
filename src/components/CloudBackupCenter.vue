<script setup lang="ts">
import FeatureAppHeader from './FeatureAppHeader.vue'
import BackupScopeTree from './BackupScopeTree.vue'
import {
  useCloudBackupCenter,
  type CloudBackupCenterProps,
  type CloudBackupCenterEvents,
} from '../composables/UseCloudBackupCenter'
const props = defineProps<CloudBackupCenterProps>()
const emit = defineEmits<CloudBackupCenterEvents>()
const controller = useCloudBackupCenter(emit, props.resources)
const {
  status,
  formatTime,
  snapshot,
  activeProvider,
  selectProvider,
  busyAction,
  createBackup,
  nativeTransport,
  nativeBackupActive,
  cancelNativeBackup,
  loadBackups,
  message,
  lastMetrics,
  metricSpeed,
  formatMetricDuration,
  formatMetricBytes,
  excessBackupCount,
  excessBackupBytes,
  cleanupRetention,
  activeConfig,
  backups,
  restorePicker,
  selectedRestoreKeys,
  toggleRestoreResource,
  selectAllRestoreResources,
  clearRestoreResources,
  restoreResourceType,
  formatBytes,
  download,
  restore,
  saveConfig,
  github,
  openTutorialPreview,
  editingCredential,
  refillCredential,
  githubToken,
  cancelCredentialRefill,
  webdav,
  KOOFR_URL,
  webdavPassword,
  setScheduleMode,
  updateScheduleValue,
  updateScheduleUnit,
  updateScheduleTime,
  activeProtection,
  cloudScopeModel,
  setCloudScopeModel,
  communitySourcesEnabled,
  communitySourcesDisabledReason,
  backupScopeResources,
  backupContentSummary,
  testConnection,
  tutorialPreview,
  closeTutorialPreview,
} = controller
</script>

<template>
  <section class="cloud-center">
    <FeatureAppHeader title="云备份" @back="emit('back')" />

    <section class="cloud-status" :class="{ 'cloud-status--error': status.lastError }">
      <i aria-hidden="true"></i>
      <div>
        <small>AUTO BACKUP</small
        ><strong>{{ status.lastError ? '上次备份失败' : formatTime(status.lastSuccessAt) }}</strong>
        <p>
          {{
            status.lastError ||
            status.lastWarning ||
            (snapshot.credentials[activeProvider] === 'valid'
              ? '凭证已保存 · 正在使用'
              : snapshot.credentials[activeProvider] === 'invalid'
                ? '服务端已确认凭据失效，请重新填写'
                : '还没有保存云端凭证')
          }}
        </p>
      </div>
      <time v-if="status.lastSuccessAt">{{
        new Date(status.lastSuccessAt).toLocaleString('zh-CN')
      }}</time>
    </section>

    <nav class="cloud-provider-tabs" aria-label="选择云端备份方式">
      <button
        type="button"
        :class="{ 'is-active': activeProvider === 'github' }"
        :disabled="Boolean(busyAction)"
        @click="selectProvider('github')"
      >
        <span>GH</span><strong>GitHub</strong><small>适合已有 GitHub 账号</small>
      </button>
      <button
        type="button"
        :class="{ 'is-active': activeProvider === 'webdav' }"
        :disabled="Boolean(busyAction)"
        @click="selectProvider('webdav')"
      >
        <span>KF</span><strong>Koofr</strong><small>10 GB 免费空间 · WebDAV</small>
      </button>
    </nav>

    <div class="cloud-workspace">
      <section class="cloud-operations">
        <header>
          <div>
            <small>BACKUP & RESTORE</small>
            <h2>云端档案</h2>
          </div>
          <span>步骤 2 / 使用</span>
        </header>
        <div class="cloud-primary-actions">
          <button
            class="button--primary"
            type="button"
            :disabled="Boolean(busyAction)"
            @click="createBackup"
          >
            {{ busyAction === 'backup' ? '生成并上传中…' : '立即备份（只传变化）' }}</button
          ><button
            v-if="nativeTransport && (busyAction === 'backup' || nativeBackupActive)"
            type="button"
            @click="cancelNativeBackup"
          >
            {{
              nativeBackupActive && busyAction !== 'backup' ? '取消后台续传' : '取消本次备份'
            }}</button
          ><button type="button" :disabled="Boolean(busyAction)" @click="loadBackups">
            {{ busyAction === 'list' ? '读取中…' : '刷新云端列表' }}
          </button>
        </div>
        <section class="cloud-backup-scope" aria-label="本次云备份范围">
          <strong>本次备份范围</strong>
          <p>资源按下方范围树中的选中项保存；历史版本随所属资源，外观和常用偏好可单独调整。</p>
          <p>{{ backupContentSummary }}</p>
          <small
            >可在右侧“备份安全与流量 → 确认备份范围”调整；保存配置后才会用于自动和手动备份。</small
          >
        </section>
        <p class="cloud-operations__note">
          自动备份只能在应用打开且本机已保存凭证时运行；关闭期间错过的备份会在下次打开后补做。云端导入采用安全合并，不会清空本机现有资源。当前
          <strong>{{
            nativeTransport
              ? 'APK 已走 Android 原生 HTTP 网络栈'
              : activeProvider === 'github'
                ? '网页直接连接 GitHub，PAT 不经过本站服务器'
                : '网页通过本站同源代理流式连接 Koofr'
          }}</strong
          >。所有备份只使用对象级差分结构；请使用私有仓库、可信 Koofr 账号和强应用密码。{{
            nativeTransport
              ? 'APK 的后台传输凭据由 Android Keystore 保护，不写入服务器数据库。'
              : 'GitHub 令牌和 Koofr 应用密码由浏览器本机 non-extractable 设备密钥加密并保存在 IndexedDB，不写入服务器数据库。'
          }}
        </p>
        <details class="cloud-guide">
          <summary>上传方式、大文件与失败保护</summary>
          <p>
            Cloud Backup V3 按资源建立对象快照，不生成整包 ZIP。小资源使用独立 immutable
            对象，大资源按内容边界分块；与历史快照相同的对象按 SHA-256
            直接复用，所以只改一张角色卡时只上传该卡的新对象和一份小清单。全部对象成功并远端校验后才提交清单；没有清单的不完整上传不会显示成可恢复备份。只有新快照完整成功后才会按“保留份数”清理旧备份，仍被保留快照引用的共享分块不会误删。
          </p>
          <p>
            单个内容对象最大约 32 MiB。GitHub 会自动轮换 object container，不再把单个 Release
            的附件数量当作总容量上限；Koofr 使用稳定的 objects / snapshots 目录。中断后已经 verified
            的对象继续复用，只恢复未完成对象。
          </p>
        </details>
        <p v-if="message" class="cloud-message" role="status">{{ message }}</p>
        <details v-if="lastMetrics" class="cloud-metrics">
          <summary>
            <span>上次任务性能</span>
            <strong>{{ metricSpeed(lastMetrics) }}</strong>
          </summary>
          <dl>
            <div>
              <dt>准备</dt>
              <dd>
                {{
                  formatMetricDuration(
                    lastMetrics.prepareMs + lastMetrics.hashMs + lastMetrics.objectBuildMs,
                  )
                }}
              </dd>
            </div>
            <div>
              <dt>Native 暂存</dt>
              <dd>
                {{
                  formatMetricDuration(
                    lastMetrics.nativeDiskMs +
                      lastMetrics.bridgeEncodeMs +
                      lastMetrics.bridgeTransferMs,
                  )
                }}
              </dd>
            </div>
            <div>
              <dt>请求累计耗时</dt>
              <dd>{{ formatMetricDuration(lastMetrics.networkMs) }}</dd>
            </div>
            <div>
              <dt>远端确认</dt>
              <dd>{{ formatMetricDuration(lastMetrics.verifyMs) }}</dd>
            </div>
            <div>
              <dt>清理</dt>
              <dd>{{ formatMetricDuration(lastMetrics.maintenanceMs) }}</dd>
            </div>
          </dl>
          <p>
            本地读取 {{ formatMetricBytes(lastMetrics.localReadBytes) }} · 哈希
            {{ formatMetricBytes(lastMetrics.hashedBytes) }} · Bridge
            {{ formatMetricBytes(lastMetrics.bridgeBytes) }} · 上传
            {{ formatMetricBytes(lastMetrics.uploadedBytes) }} · HTTP
            {{ lastMetrics.httpRequestCount }} 次 · 重试
            {{ lastMetrics.retryCount }}
            次。任务平均值包含准备与校验，不是实时网速；请求耗时可能重叠，上传计数不等于去重后的备份大小。
          </p>
        </details>
        <div v-if="excessBackupCount" class="cloud-retention-alert">
          <span>
            <strong>当前多出 {{ excessBackupCount }} 份旧备份</strong>
            <small>新备份成功后会自动安全清理；此处用于处理此前失败或中断留下的旧快照。</small>
          </span>
          <button type="button" :disabled="Boolean(busyAction)" @click="cleanupRetention">
            {{
              busyAction === 'prune'
                ? '清理中…'
                : `核对并清理（最多 ${formatBytes(excessBackupBytes)}）`
            }}
          </button>
        </div>
        <div v-if="backups.length" class="cloud-backup-list">
          <article v-for="item in backups" :key="item.id">
            <div>
              <strong>{{ item.objectKey }}</strong
              ><small
                >{{ new Date(item.createdAt).toLocaleString('zh-CN') }} · {{ formatBytes(item.size)
                }}<template v-if="item.partCount"> · {{ item.partCount }} 个分卷</template></small
              >
            </div>
            <span
              ><button type="button" :disabled="Boolean(busyAction)" @click="download(item)">
                {{ busyAction === `download:${item.id}` ? '下载中…' : '下载' }}</button
              ><button type="button" :disabled="Boolean(busyAction)" @click="restore(item)">
                {{ busyAction === `restore:${item.id}` ? '处理中…' : '导入本机' }}
              </button></span
            >
          </article>
        </div>
        <div v-else class="cloud-empty">
          <strong>还没有读取云端备份</strong>
          <p>保存配置后先测试连接，再创建备份或刷新列表。</p>
        </div>
        <section
          v-if="restorePicker"
          class="cloud-restore-selection"
          aria-labelledby="cloud-restore-selection-title"
        >
          <header>
            <div>
              <small>SELECTIVE RESTORE</small>
              <strong id="cloud-restore-selection-title">选择要导入的资源</strong>
              <span>{{ restorePicker.item.objectKey }}</span>
            </div>
            <span>{{ selectedRestoreKeys.size }} / {{ restorePicker.resources.length }} 项</span>
          </header>
          <div class="cloud-restore-selection__tools">
            <button type="button" @click="selectAllRestoreResources">全选</button>
            <button type="button" @click="clearRestoreResources">清空</button>
          </div>
          <div class="cloud-restore-resource-list">
            <label
              v-for="resource in restorePicker.resources"
              :key="resource.id"
              class="cloud-restore-resource"
            >
              <input
                type="checkbox"
                :checked="selectedRestoreKeys.has(resource.id)"
                @change="toggleRestoreResource(resource)"
              />
              <span>
                <strong>{{ resource.name }}</strong>
                <small
                  >{{ restoreResourceType(resource) }} · {{ resource.fileName
                  }}<template v-if="resource.versionCount">
                    · 历史 {{ resource.versionCount }} 项</template
                  ></small
                >
              </span>
            </label>
          </div>
          <p>用户人设头像和历史版本会随所属资源自动处理；云端凭据仍按高级迁移设置单独确认。</p>
        </section>
      </section>

      <form class="cloud-config" @submit.prevent="saveConfig()">
        <header>
          <div>
            <small>{{
              activeProvider === 'github' ? 'GITHUB RELEASE ASSETS' : 'KOOFR WEBDAV'
            }}</small>
            <h2>{{ activeProvider === 'github' ? '连接私有仓库' : '连接 Koofr' }}</h2>
          </div>
          <span>步骤 1 / 配置</span>
        </header>

        <template v-if="activeProvider === 'github'">
          <details class="cloud-beginner-guide" :open="!github.owner">
            <summary>
              <span
                ><strong>第一次用？照着 3 张图做</strong
                ><small>不用懂 Git，也不用安装软件</small></span
              >
              <i>约 3 分钟</i>
            </summary>
            <div class="cloud-tutorial-steps cloud-tutorial-steps--real">
              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">1</span>
                <div>
                  <h3>建一个“私人盒子”</h3>
                  <p>点下面按钮，仓库名随便填；只要勾选 <b>Private</b>，再点创建。</p>
                </div>
                <button
                  type="button"
                  class="tutorial-real-shot"
                  aria-label="放大查看已脱敏的 GitHub 新建私有仓库真实截图"
                  @click="
                    openTutorialPreview(
                      '/tutorials/github-create-repository-redacted.webp',
                      'GitHub 新建仓库真实页面，账号已经隐藏',
                      $event,
                    )
                  "
                >
                  <img
                    src="/tutorials/github-create-repository-redacted.webp"
                    alt="GitHub 新建仓库真实页面，账号已经隐藏"
                    loading="lazy"
                    decoding="async"
                  /><span>点图放大</span>
                </button>
                <ol class="tutorial-real-notes">
                  <li><b>Repository name</b> 填一个好认的名字，例如 <code>srl-backups</code>。</li>
                  <li><b>Choose visibility</b> 保持 <b>Private</b>，其他项目保持默认。</li>
                  <li>滑到页面最下方，点绿色 <b>Create repository</b>。</li>
                </ol>
                <a href="https://github.com/new" target="_blank" rel="noreferrer"
                  >打开建仓库页面 →</a
                >
              </article>

              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">2</span>
                <div>
                  <h3>领一把“专用钥匙”</h3>
                  <p>
                    Repository access 只选刚建的仓库；Contents 改成
                    <b>Read and write</b>，然后生成。
                  </p>
                </div>
                <button
                  type="button"
                  class="tutorial-real-shot"
                  aria-label="放大查看已脱敏的 GitHub 细粒度令牌真实截图"
                  @click="
                    openTutorialPreview(
                      '/tutorials/github-token-settings-redacted.webp',
                      'GitHub 新建细粒度令牌真实页面，账号已经隐藏',
                      $event,
                    )
                  "
                >
                  <img
                    src="/tutorials/github-token-settings-redacted.webp"
                    alt="GitHub 新建细粒度令牌真实页面，账号已经隐藏"
                    loading="lazy"
                    decoding="async"
                  /><span>点图放大</span>
                </button>
                <ol class="tutorial-real-notes">
                  <li><b>Token name</b> 填 <code>SRL Backup</code>；到期时间按你需要选择。</li>
                  <li>
                    <b>Repository access</b> 选择 <b>Only select repositories</b>，再选刚建的仓库。
                  </li>
                  <li>
                    继续向下，在 <b>Repository permissions</b> 中把 <b>Contents</b> 改成
                    <b>Read and write</b>。
                  </li>
                  <li>最下方生成令牌后立刻复制；GitHub 只完整显示这一次。</li>
                </ol>
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                  >打开领钥匙页面 →</a
                >
              </article>

              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">3</span>
                <div>
                  <h3>把 3 项粘贴到下面</h3>
                  <p>用户名、仓库名和刚复制的钥匙填好，点“测试连接”。成功后就结束了。</p>
                </div>
                <div
                  class="tutorial-shot tutorial-shot--compact"
                  role="img"
                  aria-label="将 GitHub 资料粘贴到资源库的操作示意图"
                >
                  <div class="tutorial-shot__bar">
                    <i></i><i></i><i></i><span>SRL · 云备份</span>
                  </div>
                  <div class="tutorial-shot__body">
                    <label>你的 GitHub 名字 <span>octocat</span></label
                    ><label>备份仓库名字 <span>我的酒馆备份</span></label
                    ><label>刚复制的钥匙 <span>••••••••••••••••</span></label
                    ><button type="button" tabindex="-1">测试连接</button>
                  </div>
                </div>
              </article>
            </div>
            <p class="cloud-device-note">
              <b>手机和电脑步骤相同：</b>直接点上面的绿色链接即可，不需要在 GitHub
              菜单里层层寻找。手机页面较窄时左右滑动教程卡片。
            </p>
          </details>
          <label
            ><span>你的 GitHub 名字</span
            ><input v-model.trim="github.owner" autocomplete="username" placeholder="例如 octocat"
          /></label>
          <label
            ><span>备份仓库名字</span
            ><input v-model.trim="github.repository" placeholder="例如 srl-backups"
          /></label>
          <div
            v-if="snapshot.credentials.github === 'valid' && !editingCredential.github"
            class="cloud-credential-status"
          >
            <span><strong>GitHub 密钥</strong><small>已保存 · 正在使用</small></span>
            <button type="button" @click="refillCredential('github')">重新填写密钥</button>
          </div>
          <label v-else
            ><span>{{
              snapshot.credentials.github === 'invalid' ? 'GitHub 密钥已失效' : 'GitHub 密钥'
            }}</span
            ><input
              v-model="githubToken"
              type="password"
              autocomplete="new-password"
              placeholder="github_pat_…"
            /><small>{{
              snapshot.credentials.github === 'valid'
                ? '旧密钥会继续有效；只有新密钥测试成功后才会原子替换。'
                : nativeTransport
                  ? '验证成功后由 Android Keystore 持久保护。'
                  : '验证成功后由浏览器本机设备密钥加密并保存到 IndexedDB。'
            }}</small>
            <button
              v-if="snapshot.credentials.github === 'valid'"
              type="button"
              class="cloud-credential-cancel"
              @click="cancelCredentialRefill('github')"
            >
              取消重新填写
            </button></label
          >
        </template>

        <template v-else>
          <details class="cloud-beginner-guide" :open="!webdav.username">
            <summary>
              <span
                ><strong>第一次用？照着 4 步填</strong
                ><small>只讲 Koofr，地址和文件夹已自动配置</small></span
              ><i>约 3 分钟</i>
            </summary>
            <nav class="webdav-official-links" aria-label="Koofr 官方教程">
              <a
                href="https://koofr.eu/help/linking-koofr-with-desktops/how-to-generate-an-application-specific-password-in-koofr/"
                target="_blank"
                rel="noreferrer"
                ><strong>Koofr 官方说明</strong><span>应用密码教程 · 手机和电脑步骤相同</span
                ><i>打开 →</i></a
              >
            </nav>
            <div class="cloud-tutorial-steps cloud-tutorial-steps--real">
              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">1</span>
                <div>
                  <h3>打开 Preferences</h3>
                  <p>登录 Koofr 后点右上角头像，在菜单里点被绿圈标出的 Preferences。</p>
                </div>
                <button
                  type="button"
                  class="tutorial-real-shot"
                  aria-label="放大查看已脱敏的 Koofr 应用密码设置真实截图"
                  @click="
                    openTutorialPreview(
                      '/tutorials/koofr-step-1-preferences-redacted.png',
                      '第 1 步：打开 Koofr Preferences，账号已经隐藏',
                      $event,
                    )
                  "
                >
                  <img
                    src="/tutorials/koofr-step-1-preferences-redacted.png"
                    alt="第 1 步：打开 Koofr Preferences，账号已经隐藏"
                    loading="lazy"
                    decoding="async"
                  /><span>点图放大</span>
                </button>
              </article>
              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">2</span>
                <div>
                  <h3>选择 Password</h3>
                  <p>进入 Preferences 后，在左侧菜单点被绿圈标出的 Password。</p>
                </div>
                <button
                  type="button"
                  class="tutorial-real-shot"
                  aria-label="放大查看已脱敏的 Koofr 应用密码生成结果真实截图"
                  @click="
                    openTutorialPreview(
                      '/tutorials/koofr-step-2-password-redacted.png',
                      '第 2 步：选择 Password，个人资料已经裁掉',
                      $event,
                    )
                  "
                >
                  <img
                    src="/tutorials/koofr-step-2-password-redacted.png"
                    alt="第 2 步：选择 Password，个人资料已经裁掉"
                    loading="lazy"
                    decoding="async"
                  /><span>点图放大</span>
                </button>
              </article>
              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">3</span>
                <div>
                  <h3>生成应用密码</h3>
                  <p>滑到 App passwords，在名称框填“SRL WebDAV Backup”，再点 Generate。</p>
                </div>
                <button
                  type="button"
                  class="tutorial-real-shot"
                  aria-label="放大查看 Koofr 应用密码生成位置"
                  @click="
                    openTutorialPreview(
                      '/tutorials/koofr-step-3-generate-redacted.png',
                      '第 3 步：填写名称并生成应用密码，账号已经隐藏',
                      $event,
                    )
                  "
                >
                  <img
                    src="/tutorials/koofr-step-3-generate-redacted.png"
                    alt="第 3 步：填写名称并生成应用密码，账号已经隐藏"
                    loading="lazy"
                    decoding="async"
                  /><span>点图放大</span>
                </button>
              </article>
              <article class="cloud-tutorial-step">
                <span class="cloud-tutorial-step__number">4</span>
                <div>
                  <h3>复制密码并填入 SRL</h3>
                  <p>
                    立即点 Copy；回到这里，地址用
                    <code>https://app.koofr.net/dav/Koofr</code
                    >，用户名填注册邮箱，应用密码填刚复制的内容。
                  </p>
                </div>
                <button
                  type="button"
                  class="tutorial-real-shot"
                  aria-label="放大查看 Koofr 应用密码复制按钮"
                  @click="
                    openTutorialPreview(
                      '/tutorials/koofr-step-4-copy-redacted.png',
                      '第 4 步：立即复制应用密码，真实密码已经遮挡',
                      $event,
                    )
                  "
                >
                  <img
                    src="/tutorials/koofr-step-4-copy-redacted.png"
                    alt="第 4 步：立即复制应用密码，真实密码已经遮挡"
                    loading="lazy"
                    decoding="async"
                  /><span>点图放大</span>
                </button>
                <p class="cloud-koofr-ready">地址和备份文件夹已由 SRL 自动配置</p>
              </article>
            </div>
            <p class="cloud-device-note">
              <b>Koofr 手机和电脑步骤相同：</b>手机页面较窄时打开浏览器“桌面版网站”更容易找到
              Password。SRL 不再展示其他 WebDAV 服务商，避免用户在不同入口之间迷路。
            </p>
          </details>
          <div class="cloud-fixed-value">
            <span>Koofr 服务器</span><strong>{{ KOOFR_URL }}</strong
            ><small>已自动配置，不需要修改</small>
          </div>
          <label
            ><span>Koofr 注册邮箱</span
            ><input v-model.trim="webdav.username" autocomplete="username"
          /></label>
          <div
            v-if="snapshot.credentials.webdav === 'valid' && !editingCredential.webdav"
            class="cloud-credential-status"
          >
            <span><strong>Koofr 应用密码</strong><small>已保存 · 正在使用</small></span>
            <button type="button" @click="refillCredential('webdav')">重新填写密钥</button>
          </div>
          <label v-else
            ><span>{{
              snapshot.credentials.webdav === 'invalid' ? 'Koofr 应用密码已失效' : 'Koofr 应用密码'
            }}</span
            ><input v-model="webdavPassword" type="password" autocomplete="new-password" /><small>{{
              snapshot.credentials.webdav === 'valid'
                ? '旧应用密码会继续有效；只有新值测试成功后才会原子替换。'
                : nativeTransport
                  ? '验证成功后由 Android Keystore 持久保护。'
                  : '验证成功后由浏览器本机设备密钥加密并保存到 IndexedDB。'
            }}</small>
            <button
              v-if="snapshot.credentials.webdav === 'valid'"
              type="button"
              class="cloud-credential-cancel"
              @click="cancelCredentialRefill('webdav')"
            >
              取消重新填写
            </button></label
          >
          <div class="cloud-fixed-value">
            <span>备份文件夹</span><strong>{{ webdav.folder || 'SRL-Backups' }}</strong
            ><small>上传成功后由 SRL 自动创建</small>
          </div>
          <details class="cloud-guide">
            <summary>
              {{ nativeTransport ? 'APK 会怎样连接 Koofr？' : '网页会怎样连接 Koofr？' }}
            </summary>
            <p v-if="nativeTransport">
              APK 直接使用 Android 原生 HTTP 网络栈访问 Koofr WebDAV，不经过网页
              CORS，也不会把应用密码写入服务器数据库。
            </p>
            <p v-else>
              网页固定通过本站 <code>/api/cloud/proxy/koofr</code> 流式转发二进制对象以解决 WebDAV
              CORS；不会把完整资源库或压缩包交给 Worker。
            </p>
          </details>
        </template>

        <div class="cloud-config__row">
          <label
            ><span>保留份数</span
            ><input
              v-model.number="activeConfig.retention"
              type="number"
              inputmode="numeric"
              min="1"
              max="30"
            /><small
              >新备份完整上传后会自动清理超出此数量的旧快照；异常中断或资源数量骤降时不会自动删除。</small
            ></label
          >
          <label class="cloud-auto"
            ><input v-model="activeConfig.autoBackup" type="checkbox" /><span
              ><strong>自动备份</strong
              ><small>{{
                nativeTransport
                  ? '应用打开时检查；生成完成后可交给 Android 在后台继续上传'
                  : '仅在网页打开时检查；错过后下次打开补做'
              }}</small></span
            ></label
          >
        </div>
        <section v-if="activeConfig.autoBackup" class="cloud-schedule" aria-label="自动备份频率">
          <header><strong>备份频率</strong><small>完整 ZIP 备份不建议设置得过于频繁</small></header>
          <div class="cloud-schedule__modes">
            <button
              type="button"
              :class="{ 'is-active': activeConfig.schedule?.mode === 'interval' }"
              @click="setScheduleMode('interval')"
            >
              按间隔</button
            ><button
              type="button"
              :class="{ 'is-active': activeConfig.schedule?.mode === 'daily' }"
              @click="setScheduleMode('daily')"
            >
              每天定时
            </button>
          </div>
          <div v-if="activeConfig.schedule?.mode === 'interval'" class="cloud-schedule__fields">
            <label
              ><span>每隔</span
              ><input
                type="number"
                inputmode="numeric"
                :min="activeConfig.schedule.unit === 'minutes' ? 15 : 1"
                :max="
                  activeConfig.schedule.unit === 'minutes'
                    ? 1440
                    : activeConfig.schedule.unit === 'hours'
                      ? 168
                      : 30
                "
                :value="activeConfig.schedule.value"
                @input="updateScheduleValue"
            /></label>
            <label
              ><span>单位</span
              ><select :value="activeConfig.schedule.unit" @change="updateScheduleUnit">
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
              </select></label
            >
          </div>
          <label v-else-if="activeConfig.schedule?.mode === 'daily'" class="cloud-schedule__time"
            ><span>每天几点</span
            ><input type="time" :value="activeConfig.schedule.time" @input="updateScheduleTime"
          /></label>
          <p v-if="nativeTransport">
            分钟模式最低 15 分钟；应用打开时生成到期快照，交给 Android 后切后台仍会继续上传。
          </p>
          <p v-else>分钟模式最低 15 分钟；浏览器关闭或手机系统冻结页面时不会后台执行。</p>
        </section>
        <details class="cloud-protection">
          <summary>
            <span><strong>备份安全与流量</strong><small>完整性校验和自动备份条件</small></span>
            <i>高级</i>
          </summary>
          <div class="cloud-protection__body">
            <div v-if="activeConfig.autoBackup" class="cloud-protection__conditions">
              <label class="cloud-protection__toggle">
                <input v-model="activeProtection.wifiOnly" type="checkbox" />
                <span
                  ><strong>自动备份仅 Wi-Fi</strong><small>手动备份不受此条件限制。</small></span
                >
              </label>
              <label class="cloud-protection__toggle">
                <input v-model="activeProtection.chargingOnly" type="checkbox" />
                <span
                  ><strong>自动备份仅充电时</strong
                  ><small>设备不提供电量接口时不会强行拦截。</small></span
                >
              </label>
            </div>
            <details class="cloud-protection__content">
              <summary>确认备份范围（默认资源始终备份）</summary>
              <p>
                资源、手动添加内容和额外数据共用本地导入导出选择逻辑。密钥和凭据默认关闭，选中后保存配置或开始备份时会再次确认；Discord
                社区内容只有在目标确认私有后才会解锁。
              </p>
              <BackupScopeTree
                :model-value="cloudScopeModel"
                :resources="backupScopeResources"
                :categories="props.categories"
                mode="cloud"
                :disabled-scope-ids="communitySourcesEnabled ? [] : ['extra.communitySources']"
                :disabled-scope-reasons="{
                  'extra.communitySources': communitySourcesDisabledReason,
                }"
                @update:model-value="setCloudScopeModel"
              />
            </details>
            <ul class="cloud-protection__facts">
              <li><b>已启用：</b>上传文件名携带 SHA-256 摘要，下载与恢复前自动核对大小和内容。</li>
              <li><b>失败保护：</b>新文件确认上传完整后才清理旧备份。</li>
              <li>
                <b>增量与失败保护：</b>4 MiB 及以下的小资源稳定聚合成最多 16 个包，大资源使用 8–32
                MiB 内容寻址分块；云端已有相同哈希的对象会直接复用。全部对象完成后才提交经过 gzip
                压缩的快照清单，旧 JSON 清单仍可读取。
              </li>
            </ul>
          </div>
        </details>
        <div class="cloud-config__actions">
          <button type="button" :disabled="Boolean(busyAction)" @click="testConnection">
            {{
              busyAction === 'test'
                ? '测试中…'
                : activeProvider === 'webdav' && !nativeTransport
                  ? '测试连接（网页可能受限）'
                  : '测试连接'
            }}</button
          ><button type="submit">保存并设为当前方式</button>
        </div>
      </form>
    </div>

    <Teleport to="body">
      <div
        v-if="tutorialPreview"
        class="tutorial-preview"
        role="dialog"
        aria-modal="true"
        aria-label="教程大图预览"
        @click.self="closeTutorialPreview"
      >
        <section class="tutorial-preview__panel">
          <header>
            <span><small>GUIDE PREVIEW</small><strong>教程大图</strong></span>
            <button
              ref="tutorialCloseButton"
              type="button"
              aria-label="关闭教程大图"
              @click="closeTutorialPreview"
            >
              关闭
            </button>
          </header>
          <div class="tutorial-preview__canvas" @click.self="closeTutorialPreview">
            <img :src="tutorialPreview.source" :alt="tutorialPreview.alt" />
          </div>
          <p>点击图片外的空白处，或按 Esc 返回教程。</p>
        </section>
      </div>
    </Teleport>
  </section>
</template>
