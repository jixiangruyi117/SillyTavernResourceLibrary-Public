<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { triggerNativeHaptic } from '../core/NativeHaptics'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  acknowledged: []
}>()

const READING_SECONDS = 5
const SCROLL_END_TOLERANCE_PX = 6
const secondsRemaining = ref(READING_SECONDS)
const reachedEnd = ref(false)
const dialog = ref<HTMLElement>()
const body = ref<HTMLElement>()
let countdownTimer: number | undefined

const canAcknowledge = computed(() => secondsRemaining.value === 0 && reachedEnd.value)
const confirmLabel = computed(() => {
  if (canAcknowledge.value) return '我已阅读，进入资源库'
  if (!reachedEnd.value && secondsRemaining.value > 0)
    return `请阅读并滑至底部 · ${secondsRemaining.value} 秒`
  if (!reachedEnd.value) return '请滑至底部继续'
  return `请阅读 ${secondsRemaining.value} 秒`
})
const readingHint = computed(() => {
  if (canAcknowledge.value) return '感谢阅读。本说明仅在这台设备首次启动时显示。'
  if (!reachedEnd.value) return '请完整阅读并滑动到正文底部。'
  return '已阅读到正文底部，请等待倒计时结束。'
})

function clearCountdown(): void {
  if (countdownTimer !== undefined) window.clearInterval(countdownTimer)
  countdownTimer = undefined
}

function startCountdown(): void {
  clearCountdown()
  secondsRemaining.value = READING_SECONDS
  countdownTimer = window.setInterval(() => {
    secondsRemaining.value = Math.max(0, secondsRemaining.value - 1)
    if (secondsRemaining.value === 0) clearCountdown()
  }, 1000)
}

function checkReachedEnd(): void {
  const element = body.value
  if (!element || reachedEnd.value || element.scrollHeight <= 0 || element.clientHeight <= 0) return
  if (element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_END_TOLERANCE_PX)
    reachedEnd.value = true
}

async function resetReadingState(): Promise<void> {
  reachedEnd.value = false
  startCountdown()
  await nextTick()
  if (body.value) body.value.scrollTop = 0
  checkReachedEnd()
  dialog.value?.focus()
}

function preventDismiss(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
}

function acknowledge(): void {
  if (!canAcknowledge.value) return
  triggerNativeHaptic('confirm')
  emit('acknowledged')
}

watch(
  () => props.open,
  (open) => {
    if (open) void resetReadingState()
    else clearCountdown()
  },
)

onMounted(() => {
  window.addEventListener('keydown', preventDismiss, true)
  window.addEventListener('resize', checkReachedEnd)
  if (props.open) void resetReadingState()
})

onUnmounted(() => {
  clearCountdown()
  window.removeEventListener('keydown', preventDismiss, true)
  window.removeEventListener('resize', checkReachedEnd)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="project-notice__overlay" role="presentation">
      <section
        ref="dialog"
        class="project-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-notice-title"
        aria-describedby="project-notice-description"
        tabindex="-1"
      >
        <header class="project-notice__header">
          <span class="project-notice__seal" aria-hidden="true">SRL</span>
          <div>
            <p>READ BEFORE ENTERING</p>
            <h1 id="project-notice-title">使用前说明</h1>
          </div>
        </header>

        <div
          id="project-notice-description"
          ref="body"
          class="project-notice__body"
          tabindex="0"
          @scroll.passive="checkReachedEnd"
        >
          <p class="project-notice__lead">
            SRL 是一个非商业、面向社区的本地优先项目。使用前请了解数据边界、免费声明与责任说明。
          </p>

          <section>
            <h2>数据与隐私</h2>
            <p>
              本版本不提供账号、登录、作者管理后台、反馈服务、共享图床或作者云服务。角色卡、世界书、预设、外观配置与大多数资源数据默认保存在当前设备，不会因为打开
              SRL 而自动上传。
            </p>
            <p>
              只有在你主动使用自己的 GitHub 备份、自建图床、AI
              API、第三方插件或其他外部服务时，相关数据才可能按照对应服务的规则离开本机。请自行确认这些服务的来源、权限、隐私政策与安全性。
            </p>
          </section>

          <section>
            <h2>完全免费，请勿付费购买</h2>
            <p>
              SRL 官方版本及公开源码本身均不收取购买费、授权费或激活费。若有人以“购买
              SRL”“官方安装包”“激活资格”或“项目源码”等名义向你收费，该收费行为并非由本项目作者授权。建议联系收款方申请退款，并根据实际情况通过支付平台的退款或申诉渠道处理。
            </p>
            <p>
              官方公开源码：
              <a
                href="https://github.com/jixiangruyi117/SillyTavernResourceLibrary-Public"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/jixiangruyi117/SillyTavernResourceLibrary-Public
              </a>
            </p>
            <p>
              第三方自行提供的服务器、部署或技术支持可能产生独立费用；这类第三方服务不代表 SRL
              官方收费或官方授权销售。
            </p>
          </section>

          <section>
            <h2>使用责任</h2>
            <p>
              SRL
              仅提供资源管理、预览、转换、生成、备份与扩展运行等工具能力。用户自行导入、创建、生成、修改、发布、传播或使用的内容，以及自行安装的第三方
              APP、插件、脚本、角色卡、远程资源和外部服务，由相应内容提供者或实际使用者自行负责。
            </p>
            <p>
              SRL
              作者不会主动控制、审核或认可用户通过本工具产生或处理的全部内容，也不代表相关第三方内容的立场。请勿利用
              SRL 从事违反适用法律、侵犯他人权益或恶意攻击服务的行为。
            </p>
          </section>

          <section>
            <h2>公开源码说明</h2>
            <p>
              欢迎在许可证允许范围内学习、修改公开源码并自行部署。公开源码的使用、修改与分发请遵守仓库中的
              LICENSE 与 NOTICE；第三方内容、插件和外部服务仍受其各自条款约束。
            </p>
          </section>
        </div>

        <footer class="project-notice__footer">
          <p aria-live="polite">{{ readingHint }}</p>
          <button type="button" :disabled="!canAcknowledge" @click="acknowledge">
            {{ confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
