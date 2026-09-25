const STARTUP_STATE_KEY = 'srl.startup.state.v1'
const SAFE_MODE_SESSION_KEY = 'srl.safeMode.session.v1'
const RESCUE_HOST_ID = 'srl-startup-rescue-layer'

interface StartupState {
  pending: boolean
  consecutiveFailures: number
  startedAt: number
}

function readState(): StartupState {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(STARTUP_STATE_KEY) ?? 'null',
    ) as StartupState | null
    if (
      value &&
      typeof value.pending === 'boolean' &&
      Number.isFinite(value.consecutiveFailures) &&
      value.consecutiveFailures >= 0
    ) {
      return value
    }
  } catch {
    // Invalid state restarts the counter.
  }
  return { pending: false, consecutiveFailures: 0, startedAt: 0 }
}

function writeState(state: StartupState): void {
  try {
    sessionStorage.setItem(STARTUP_STATE_KEY, JSON.stringify(state))
  } catch {
    // Startup diagnostics must not prevent mounting when browser storage is unavailable.
  }
}

function storedCss(): string {
  try {
    return localStorage.getItem('srl.ui.customCss')?.trim() || ''
  } catch {
    return ''
  }
}

function restart(safe: boolean): void {
  try {
    if (safe) sessionStorage.setItem(SAFE_MODE_SESSION_KEY, 'safe')
    else sessionStorage.removeItem(SAFE_MODE_SESSION_KEY)
  } catch {
    const message = document
      .getElementById(RESCUE_HOST_ID)
      ?.shadowRoot?.querySelector('[data-message]')
    if (message) message.textContent = '浏览器无法保存启动选项，未重新加载。请检查站点存储权限。'
    return
  }
  markStartupReady()
  window.location.reload()
}

function protectedHost(): { host: HTMLDivElement; root: ShadowRoot } {
  document.getElementById(RESCUE_HOST_ID)?.remove()
  const host = document.createElement('div')
  host.id = RESCUE_HOST_ID
  for (const [property, value] of Object.entries({
    all: 'initial',
    display: 'block',
    position: 'fixed',
    inset:
      'auto max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
    'z-index': '2147483647',
    'pointer-events': 'none',
    visibility: 'visible',
    opacity: '1',
  })) {
    host.style.setProperty(property, value, 'important')
  }
  document.body.append(host)
  return { host, root: host.attachShadow({ mode: 'open' }) }
}

export function beginStartupAttempt(): { rescueRequired: boolean; failures: number } {
  // The old counter was shared by every tab and interpreted interrupted loads as CSS failures.
  try {
    localStorage.removeItem(STARTUP_STATE_KEY)
  } catch {
    /* Diagnostic metadata only. */
  }
  try {
    if (sessionStorage.getItem(SAFE_MODE_SESSION_KEY) === 'pending')
      sessionStorage.removeItem(SAFE_MODE_SESSION_KEY)
  } catch {
    /* Keep the normal startup path usable. */
  }
  const previous = readState()
  const failures = previous.pending ? previous.consecutiveFailures + 1 : 0
  writeState({ pending: true, consecutiveFailures: failures, startedAt: Date.now() })
  return { rescueRequired: failures >= 2, failures }
}

export function markStartupReady(): void {
  writeState({ pending: false, consecutiveFailures: 0, startedAt: Date.now() })
  const host = document.getElementById(RESCUE_HOST_ID)
  if (host?.dataset.kind === 'rescue') host.remove()
}

export function isSafeModeActive(): boolean {
  try {
    return sessionStorage.getItem(SAFE_MODE_SESSION_KEY) === 'safe'
  } catch {
    return false
  }
}

const RECOVERY_STYLE = `<style>
  *,*::before,*::after{box-sizing:border-box}
  .bar{pointer-events:auto;max-width:560px;max-height:calc(100dvh - 32px);overflow:auto;margin:auto;padding:12px 14px;border:1px solid #7eaaa1;border-radius:14px;background:#f4fffc;color:#173832;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 28px #102d2833}
  strong{display:block}p{margin:6px 0 10px;color:#49645f}summary{cursor:pointer;min-height:32px;font-weight:600}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.actions button{flex:1;min-height:44px;padding:8px 12px;border:1px solid #6b9c93;border-radius:10px;background:#fff;color:#173832;font:600 14px/1.4 system-ui;cursor:pointer;overflow-wrap:anywhere}
  .actions .safe{border-color:#187f73;background:#187f73;color:#fff}[hidden]{display:none!important}
  @media(prefers-color-scheme:dark){.bar{background:#202d28;color:#e4eee8;border-color:#6b8978}p{color:#c2d0c6}.actions button{background:#293d32;color:#e4eee8}}
</style>`

export function installStartupRescuePrompt(): void {
  const { host, root } = protectedHost()
  host.dataset.kind = 'rescue'
  root.innerHTML = `${RECOVERY_STYLE}<section class="bar" role="status"><strong>之前的启动未完成</strong><p data-message>页面仍在继续加载；${storedCss() ? '若仍无法操作，可暂时停用自定义 CSS 和高负载预览后重开。' : '当前没有自定义 CSS。若仍无法操作，可暂时停用高负载预览后重开。'}不会删除资源或设置。</p><div class="actions"><button type="button" data-normal>关闭提示，继续使用</button><button type="button" class="safe" data-safe>安全模式重开</button></div></section>`
  root.querySelector('[data-normal]')?.addEventListener('click', () => host.remove())
  root.querySelector('[data-safe]')?.addEventListener('click', () => restart(true))
}

export function installSafeModeBanner(): void {
  if (!isSafeModeActive()) return
  const { host, root } = protectedHost()
  host.dataset.kind = 'safe'
  root.innerHTML = `${RECOVERY_STYLE}<details class="bar" open><summary>安全模式 · 点此收起</summary><p data-message>${storedCss() ? '自定义 CSS 与高负载预览已临时停用。' : '高负载预览已临时停用；没有自定义 CSS 需要清除。'}已保存设置没有改变。</p><div class="actions">${storedCss() ? '<button type="button" data-clear>清除自定义 CSS…</button>' : ''}<button type="button" data-normal>恢复正常并重开</button></div><div data-clear-confirm hidden><p>仅清除当前应用的自定义 CSS，保留已保存的美化预设和所有资源。确认清除并重开？</p><div class="actions"><button type="button" data-cancel-clear>取消</button><button type="button" data-confirm-clear>确认清除</button></div></div></details>`
  root.querySelector('[data-clear]')?.addEventListener('click', () => {
    root.querySelector<HTMLElement>('[data-clear-confirm]')!.hidden = false
  })
  root.querySelector('[data-cancel-clear]')?.addEventListener('click', () => {
    root.querySelector<HTMLElement>('[data-clear-confirm]')!.hidden = true
  })
  root.querySelector('[data-confirm-clear]')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('srl.ui.customCss')
      localStorage.removeItem('srl.appearance.pending.v1')
      localStorage.removeItem('srl.appearance.lastGood.v1')
    } catch {
      root.querySelector('[data-message]')!.textContent = '未能清除自定义 CSS，请检查站点存储权限。'
      return
    }
    restart(false)
  })
  root.querySelector('[data-normal]')?.addEventListener('click', () => restart(false))
}
