<script setup lang="ts">
import { computed, ref } from 'vue'

import manualWorkerSource from 'virtual:srl-discord-manual-worker-source'

defineProps<{
  open: boolean
  applicationId: string
  publicKey: string
  botToken: string
}>()
const emit = defineEmits<{ close: [] }>()

const copyStatus = ref('')

const suggestedSrlUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
})

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
    <Transition name="discord-manual-fade">
      <button
        v-if="open"
        class="discord-manual-backdrop"
        type="button"
        aria-label="关闭手动部署教程"
        @click="emit('close')"
      ></button>
    </Transition>

    <Transition name="discord-manual-slide">
      <aside v-if="open" class="discord-manual-drawer" aria-label="只有 Cloudflare 的部署教程">
        <header class="discord-manual-head">
          <div>
            <small>NO GIT REQUIRED</small>
            <h3>只有 Cloudflare？</h3>
            <p>不需要 GitHub / GitLab。照着下面做，最后只复制一个 workers.dev 链接回 SRL。</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="discord-manual-body">
          <section class="discord-manual-step">
            <span class="discord-manual-index">01</span>
            <div>
              <h4>创建一个 Worker</h4>
              <p>进入 Cloudflare Dashboard：</p>
              <code>Workers &amp; Pages → Create → Hello World → Deploy</code>
              <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">
                打开 Cloudflare Dashboard
              </a>
            </div>
          </section>

          <section class="discord-manual-step">
            <span class="discord-manual-index">02</span>
            <div>
              <h4>粘贴 Bridge 代码</h4>
              <p>
                打开刚创建的 Worker → <strong>Edit Code</strong>。删掉示例代码，粘贴 SRL
                生成的浏览器部署版，然后 Deploy。
              </p>
              <button
                class="discord-manual-copy"
                type="button"
                :disabled="!manualWorkerSource"
                @click="copyText(manualWorkerSource, 'Bridge 代码已复制')"
              >
                复制 Bridge 代码
              </button>
              <p class="discord-manual-note">
                这份代码由同一个 Bridge 源码自动生成，只额外加入 D1 自动初始化；不需要手动执行 SQL。
              </p>
            </div>
          </section>

          <section class="discord-manual-step">
            <span class="discord-manual-index">03</span>
            <div>
              <h4>创建 D1 并绑定</h4>
              <p>在 Cloudflare 创建一份 D1，名字随意；推荐：</p>
              <code>srl-discord-source-handoff</code>
              <p>然后回到 Worker：</p>
              <code>Settings / Bindings → Add binding → D1 database</code>
              <p>变量名固定填 <strong>DB</strong>，选择刚创建的数据库。</p>
              <p class="discord-manual-note discord-manual-note--soft">
                不需要建表。第一次请求 Worker 时会自动创建 handoffs 表和索引。
              </p>
            </div>
          </section>

          <section class="discord-manual-step">
            <span class="discord-manual-index">04</span>
            <div>
              <h4>填写 Discord 配置</h4>
              <p>
                进入 Worker 的 <strong>Settings → Variables and Secrets</strong>，添加下面三个值。
              </p>

              <div class="discord-manual-value">
                <span>DISCORD_APPLICATION_ID</span>
                <strong>{{ applicationId || '回到 SRL 上方复制 Application ID' }}</strong>
                <button
                  type="button"
                  :disabled="!applicationId"
                  @click="copyText(applicationId, 'Application ID 已复制')"
                >
                  复制值
                </button>
              </div>

              <div class="discord-manual-value">
                <span>DISCORD_PUBLIC_KEY</span>
                <strong>{{ publicKey || '回到 SRL 上方复制 Public Key' }}</strong>
                <button
                  type="button"
                  :disabled="!publicKey"
                  @click="copyText(publicKey, 'Public Key 已复制')"
                >
                  复制值
                </button>
              </div>

              <div class="discord-manual-value">
                <span>DISCORD_BOT_TOKEN</span>
                <strong>{{
                  botToken ? '已在 SRL 填写，可直接复制' : '先在 SRL 上方填写 Bot Token'
                }}</strong>
                <button
                  type="button"
                  :disabled="!botToken"
                  @click="copyText(botToken, 'Bot Token 已复制')"
                >
                  复制值
                </button>
              </div>

              <p class="discord-manual-note">
                <strong>DISCORD_BOT_TOKEN</strong> 请选择 Secret 类型；Application ID 和 Public Key
                可以使用普通文本变量。
              </p>
            </div>
          </section>

          <section class="discord-manual-step">
            <span class="discord-manual-index">05</span>
            <div>
              <h4>网页 / PWA 用户再填一项</h4>
              <p>
                如果你会从浏览器或 PWA 打开 SRL，再增加普通变量 <strong>SRL_WEB_URL</strong>。
                Android App 用户可以不填。
              </p>
              <div class="discord-manual-value">
                <span>SRL_WEB_URL</span>
                <strong>{{ suggestedSrlUrl || '你的 SRL 网页地址' }}</strong>
                <button
                  type="button"
                  :disabled="!suggestedSrlUrl"
                  @click="copyText(suggestedSrlUrl, 'SRL 网页地址已复制')"
                >
                  复制值
                </button>
              </div>
            </div>
          </section>

          <section class="discord-manual-step">
            <span class="discord-manual-index">06</span>
            <div>
              <h4>复制 Worker 链接回 SRL</h4>
              <p>部署完成后，Cloudflare 会给你类似：</p>
              <code>https://xxxx.workers.dev</code>
              <p>
                只复制这一条，粘到 SRL 的 <strong>Cloudflare 部署链接</strong>。SRL 会自动生成
                Discord 所需的 /interactions 等路径。
              </p>
            </div>
          </section>

          <p v-if="copyStatus" class="discord-manual-status" role="status">{{ copyStatus }}</p>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped src="../styles/DiscordManualDeployDrawer.css"></style>
