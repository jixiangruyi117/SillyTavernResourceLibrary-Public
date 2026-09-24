<script setup lang="ts">
defineProps<{
  open: boolean
  interactionsUrl?: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="discord-guide-fade">
      <button
        v-if="open"
        class="discord-guide-backdrop"
        type="button"
        aria-label="关闭配置教程"
        @click="emit('close')"
      ></button>
    </Transition>
    <Transition name="discord-guide-slide">
      <aside v-if="open" class="discord-guide-drawer" aria-label="Discord 来源配置教程">
        <header class="discord-guide-drawer__header">
          <div>
            <small>DISCORD SOURCE</small>
            <h3>配置教程</h3>
          </div>
          <button type="button" aria-label="关闭配置教程" @click="emit('close')">×</button>
        </header>

        <div class="discord-guide-drawer__body">
          <section class="discord-guide-step">
            <span>01</span>
            <div>
              <h4>创建 Discord App</h4>
              <p>
                打开 Discord Developer Portal，点击
                <strong>New Application</strong>，创建属于你自己的来源助手。
              </p>
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开 Developer Portal
              </a>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>02</span>
            <div>
              <h4>复制三个配置值</h4>
              <p>
                在 General Information 复制 <strong>Application ID</strong> 和
                <strong>Public Key</strong>，再到 Bot 页面生成 <strong>Bot Token</strong>。
              </p>
              <code>General Information → PUBLIC KEY</code>
              <code>Bot → Reset Token</code>
              <p class="discord-guide-note">
                不要把 Application Secret 当成 Public Key；Bot Token 也不要发给别人。
              </p>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>03</span>
            <div>
              <h4>开启 User Install</h4>
              <p>
                在 Installation 中启用 <strong>User Install</strong>，scope 使用
                <strong>applications.commands</strong>。
              </p>
              <code>Installation → User Install → applications.commands</code>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>04</span>
            <div>
              <h4>部署自己的 Cloudflare Worker</h4>
              <p>
                使用 SRL Discord Bridge 模板部署到你自己的 Cloudflare。部署完成后，只需要复制
                <strong>workers.dev 根链接</strong>。
              </p>
              <code>https://你的-worker.workers.dev</code>
              <p class="discord-guide-note discord-guide-note--soft">
                不需要自己添加 /interactions、/health 或其他后缀，SRL 会自动处理。
              </p>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>05</span>
            <div>
              <h4>复制 Discord 最终地址</h4>
              <p>
                把 Worker 根链接粘进 SRL 后，SRL 会自动生成 Discord 需要的
                <strong>Interactions Endpoint URL</strong>。
              </p>
              <code v-if="interactionsUrl">{{ interactionsUrl }}</code>
              <code v-else>https://你的-worker.workers.dev/interactions</code>
              <p class="discord-guide-note discord-guide-note--soft">
                这里只复制 SRL 生成的最终地址，不需要自己拼接路径。
              </p>
            </div>
          </section>

          <section class="discord-guide-step">
            <span>06</span>
            <div>
              <h4>安装并测试</h4>
              <p>
                在 Discord App 的 Installation 页面完成 Add to my apps。之后长按或右键一条消息，选择
                <strong>Apps → 保存到资源库</strong>。
              </p>
            </div>
          </section>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped src="../styles/DiscordSetupGuideDrawer.css"></style>
