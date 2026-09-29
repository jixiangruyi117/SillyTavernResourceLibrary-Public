<script setup lang="ts">
import { ref } from 'vue'

import { DISCORD_BRIDGE_DEPLOY_URL } from '../services/DiscordBridgeDeployService'

const props = withDefaults(defineProps<{
  open: boolean
  deploymentMode?: 'one-click' | 'github'
  applicationId: string
  publicKey: string
  botToken: string
  interactionsUrl?: string
  installationUrl: string
  developerAppUrl: string
  developerBotUrl: string
}>(), { deploymentMode: 'one-click' })

const emit = defineEmits<{ close: [] }>()
const copyStatus = ref('')

async function copyText(value: string, message: string): Promise<void> {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const input = document.createElement('textarea')
    input.value = value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.append(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  copyStatus.value = message
  window.setTimeout(() => {
    if (copyStatus.value === message) copyStatus.value = ''
  }, 1800)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="discord-guide-fade">
      <button
        v-if="open"
        class="discord-guide-backdrop"
        type="button"
        :aria-label="`关闭${props.deploymentMode === 'github' ? 'GitHub 部署' : '一键部署'}教程`"
        @click="emit('close')"
      ></button>
    </Transition>
    <Transition name="discord-guide-slide">
      <aside v-if="open" class="discord-guide-drawer" :aria-label="`Discord ${props.deploymentMode === 'github' ? 'GitHub 部署' : '一键部署'}教程`">
        <header class="discord-guide-drawer__header">
          <div>
            <small>GITHUB + CLOUDFLARE</small>
            <h3>{{ props.deploymentMode === 'github' ? 'GitHub 部署教程' : '一键部署教程' }}</h3>
          </div>
          <button type="button" :aria-label="`关闭${props.deploymentMode === 'github' ? 'GitHub 部署' : '一键部署'}教程`" @click="emit('close')">×</button>
        </header>

        <div class="discord-guide-drawer__body">
          <p class="discord-guide-intro">
            {{ props.deploymentMode === 'github'
              ? '先把项目 Fork 到自己的 GitHub，再让 Cloudflare 从这个仓库部署。以后推送到 main 会自动部署。'
              : '按顺序完成下面步骤。每个人都要部署到自己的 Cloudflare，并使用自己的 Discord App。' }}
          </p>

          <section class="discord-guide-step">
            <span>01</span>
            <div>
              <h4>先准备 Discord App 的三个值</h4>
              <p>
                打开自己的 Discord App。在 General Information 找到 Application ID 和 Public Key；在 Bot
                页面生成 Bot Token。把三个值填入 SRL 配置框，再回来点复制。
              </p>
              <p class="discord-guide-note discord-guide-note--soft">
                如果侧栏挡住了配置框，先关闭教程，填完三个值，再重新打开本教程。
              </p>
              <a :href="developerAppUrl" target="_blank" rel="noopener noreferrer">
                打开 Discord General Information
              </a>
              <a :href="developerBotUrl" target="_blank" rel="noopener noreferrer">
                打开 Discord Bot 设置
              </a>
              <code>Application ID：General Information → APPLICATION ID</code>
              <figure class="discord-guide-screenshot">
                <img
                  src="/tutorials/discord-application-id-redacted.png"
                  alt="Discord General Information 页面，绿色圈出已遮挡的 Application ID 和 Public Key"
                  loading="lazy"
                >
                <figcaption>绿色圈出 Application ID 和 Public Key；两个值都已遮挡。中文界面把公钥一项显示为“客户端”。</figcaption>
              </figure>
              <code>Public Key：General Information → PUBLIC KEY（中文界面显示为“客户端”）</code>
              <code>Bot Token：Bot → Reset Token</code>
              <figure class="discord-guide-screenshot">
                <img
                  src="/tutorials/discord-bot-token-redacted.png"
                  alt="Discord Bot 页面，绿色圈出 Reset Token 按钮"
                  loading="lazy"
                >
                <figcaption>绿色圈线标出生成 Bot Token 的按钮；截图没有显示令牌。</figcaption>
              </figure>
              <div class="discord-guide-copy-list">
                <button
                  type="button"
                  :disabled="!applicationId"
                  @click="copyText(applicationId, 'Application ID 已复制')"
                >
                  复制 Application ID
                </button>
                <button
                  type="button"
                  :disabled="!publicKey"
                  @click="copyText(publicKey, 'Public Key 已复制')"
                >
                  复制 Public Key
                </button>
                <button
                  type="button"
                  :disabled="!botToken"
                  @click="copyText(botToken, 'Bot Token 已复制')"
                >
                  复制 Bot Token
                </button>
              </div>
              <p class="discord-guide-note">
                不要把 Application Secret 当作 Public Key。Bot Token 是密码，只粘贴到自己的 Cloudflare Secret。
              </p>
            </div>
          </section>

          <section v-if="props.deploymentMode === 'one-click'" class="discord-guide-step">
            <span>02</span>
            <div>
              <h4>点下面按钮开始部署</h4>
              <p>
                不用先手动 Fork。点下面按钮后，Cloudflare 会让你登录并连接 GitHub 或 GitLab，再自动把模板复制到你的账号并部署 Worker。按页面提示完成即可。
              </p>
              <a
                class="discord-guide-action"
                :href="DISCORD_BRIDGE_DEPLOY_URL"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开 Cloudflare 一键部署
              </a>
              <p class="discord-guide-note discord-guide-note--soft">
                这一步也会为你创建并绑定 D1 数据库。部署完成后，先不要关闭此教程。
              </p>
              <p class="discord-guide-note discord-guide-note--soft">
                这会创建连接自动部署的代码副本，不是可直接点 GitHub“Sync fork”更新的 Fork。原仓库有新版时，需要手动同步或合并后再推送。
              </p>
            </div>
          </section>

          <section v-else class="discord-guide-step">
            <span>02</span>
            <div>
              <h4>把项目 Fork 到自己的 GitHub</h4>
              <p>点击下面链接，在 GitHub 页面右上方点 Fork，再选择自己的账号并点 Create fork。已经 Fork 过就跳过这步。</p>
              <a href="https://github.com/jixiangruyi117/SRL-Discord-Bridge/fork" target="_blank" rel="noopener noreferrer">
                Fork SRL Discord Bridge
              </a>
              <p class="discord-guide-note discord-guide-note--soft">
                Fork 是把代码副本放进你的 GitHub 账号。这里不需要复制或手写 Worker 代码。
              </p>
            </div>
          </section>

          <section v-if="props.deploymentMode === 'github'" class="discord-guide-step">
            <span>03</span>
            <div>
              <h4>让 Cloudflare 导入你的 Fork</h4>
              <p>打开 Cloudflare → Workers &amp; Pages → Create application → Import a repository。授权 GitHub 后选中你的 SRL-Discord-Bridge 仓库和 <strong>main</strong> 分支。</p>
              <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">打开 Cloudflare Dashboard</a>
              <a href="https://developers.cloudflare.com/workers/ci-cd/builds/" target="_blank" rel="noopener noreferrer">
                查看 Cloudflare 导入 Git 仓库的官方步骤
              </a>
              <p>项目设置中确认 Worker 名称为 <strong>srl-discord-source-bridge</strong>，Build command 填 <strong>npm run typecheck</strong>，Deploy command 填 <strong>npm run deploy</strong>，然后点 Save and Deploy。</p>
              <p class="discord-guide-note discord-guide-note--soft">
                Cloudflare 会根据项目配置自动创建并绑定 D1。数据库 ID 留在 Cloudflare，不用复制到公开的 GitHub Fork，也不用改 wrangler.jsonc。
              </p>
              <p class="discord-guide-note discord-guide-note--soft">
                以后要更新时，在你的 GitHub Fork 页面点 <strong>Sync fork → Update branch</strong>。同步到 main 后，Cloudflare 会自动重新部署；如果显示冲突，先按 GitHub 提示解决冲突。
              </p>
              <a href="https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork" target="_blank" rel="noopener noreferrer">
                查看 GitHub 同步 Fork 的说明
              </a>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>{{ props.deploymentMode === 'github' ? '04' : '03' }}</span>
            <div>
              <h4>把 Discord 值加到 Cloudflare</h4>
              <p>
                如果部署页面先询问配置值，就在那里填；如果没有询问，部署后打开 Cloudflare Dashboard →
                Workers &amp; Pages → 你的 Worker → Settings → Variables and Secrets → Add。
              </p>
              <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">
                打开 Cloudflare Dashboard
              </a>
              <code>DISCORD_APPLICATION_ID　类型选 Text　值取自 Discord 的 Application ID</code>
              <code>DISCORD_PUBLIC_KEY　类型选 Text　值取自 Discord 的 Public Key</code>
              <code>DISCORD_BOT_TOKEN　类型选 Secret　值取自 Discord 的 Bot Token</code>
              <a
                href="https://developers.cloudflare.com/workers/configuration/secrets/"
                target="_blank"
                rel="noopener noreferrer"
              >
                查看 Cloudflare 添加 Secret 的官方步骤
              </a>
              <p class="discord-guide-note">
                添加三项后保存并 Deploy。Bot Token 必须选 Secret；不要发给别人，也不要放到 GitHub 代码里。
              </p>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>{{ props.deploymentMode === 'github' ? '05' : '04' }}</span>
            <div>
              <h4>把 Worker 根链接填回 SRL</h4>
              <p>从 Cloudflare 复制部署完成后显示的链接，例如：</p>
              <code>https://你的-worker.workers.dev</code>
              <p>
                回到本页后面的“Cloudflare 部署链接”框，只粘贴这条根链接，再点“保存并测试连接”。不要自己加路径。
              </p>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>{{ props.deploymentMode === 'github' ? '06' : '05' }}</span>
            <div>
              <h4>把 Discord 接收地址粘到 App</h4>
              <p>SRL 测试成功后，会自动生成下面这条地址。复制它：</p>
              <code v-if="interactionsUrl">{{ interactionsUrl }}</code>
              <code v-else>先填入 Worker 根链接，SRL 才能生成地址</code>
              <div class="discord-guide-copy-list">
                <button
                  type="button"
                  :disabled="!interactionsUrl"
                  @click="copyText(interactionsUrl || '', 'Discord 交互地址已复制')"
                >
                  复制 Discord 交互地址
                </button>
              </div>
              <p>
                回到 Discord Developer Portal → General Information → Interactions Endpoint URL，粘贴并保存。
              </p>
              <a :href="developerAppUrl" target="_blank" rel="noopener noreferrer">
                打开 Discord General Information
              </a>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>{{ props.deploymentMode === 'github' ? '07' : '06' }}</span>
            <div>
              <h4>开启安装并添加消息命令</h4>
              <p>
                在 Discord App 的 Installation 页面开启 User Install，并启用 applications.commands。然后选择
                Add to my apps。
              </p>
              <a :href="installationUrl" target="_blank" rel="noopener noreferrer">
                打开 Discord Installation 页面
              </a>
              <p>回到 SRL，点“注册消息命令”。之后在 Discord 里右键一条消息 → Apps → 保存到资源库。</p>
              <p class="discord-guide-note discord-guide-note--soft">
                只有还要自动检查社区帖子更新时，才需要把 Bot 加入对应服务器，并允许它查看来源频道。
              </p>
            </div>
          </section>

          <p v-if="copyStatus" class="discord-guide-status" role="status">{{ copyStatus }}</p>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped src="../styles/DiscordSetupGuideDrawer.css"></style>
