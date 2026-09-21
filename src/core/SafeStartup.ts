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
      localStorage.getItem(STARTUP_STATE_KEY) ?? 'null',
    ) as StartupState | null
    if (value && typeof value.pending === 'boolean' && Number.isFinite(value.consecutiveFailures)) {
      return value
    }
  } catch {
    // Invalid state restarts the counter.
  }
  return { pending: false, consecutiveFailures: 0, startedAt: 0 }
}

function writeState(state: StartupState): void {
  localStorage.setItem(STARTUP_STATE_KEY, JSON.stringify(state))
}

function protectedHost(): { host: HTMLDivElement; root: ShadowRoot } {
  document.getElementById(RESCUE_HOST_ID)?.remove()
  const host = document.createElement('div')
  host.id = RESCUE_HOST_ID
  for (const [property, value] of Object.entries({
    all: 'initial',
    display: 'grid',
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    placeItems: 'center',
    padding: '20px',
    background: '#0c1c19cc',
    visibility: 'visible',
    opacity: '1',
  })) {
    host.style.setProperty(property, value, 'important')
  }
  document.body.append(host)
  return { host, root: host.attachShadow({ mode: 'open' }) }
}

export function beginStartupAttempt(): { rescueRequired: boolean; failures: number } {
  const previous = readState()
  const failures = previous.pending ? previous.consecutiveFailures + 1 : 0
  writeState({ pending: true, consecutiveFailures: failures, startedAt: Date.now() })
  if (failures >= 2) sessionStorage.setItem(SAFE_MODE_SESSION_KEY, 'pending')
  return { rescueRequired: failures >= 2, failures }
}

export function markStartupReady(): void {
  writeState({ pending: false, consecutiveFailures: 0, startedAt: Date.now() })
}

export function isSafeModeActive(): boolean {
  const value = sessionStorage.getItem(SAFE_MODE_SESSION_KEY)
  return value === 'safe' || value === 'pending'
}

export function installStartupRescuePrompt(): void {
  const { host, root } = protectedHost()
  root.innerHTML = `<style>
    :host{font:15px/1.55 system-ui,sans-serif;color:#173832}.card{width:min(100%,440px);padding:24px;border:1px solid #7eaaa1;border-radius:20px;background:#f4fffc;box-shadow:0 24px 80px #0008}.card small{letter-spacing:.12em;color:#47736b}.card h1{margin:6px 0 8px;font:700 22px/1.25 system-ui}.card p{margin:0 0 18px;color:#49645f}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.actions button{min-height:48px;border:1px solid #6b9c93;border-radius:12px;background:#fff;color:#173832;font:600 14px system-ui;cursor:pointer}.actions .safe{border-color:#187f73;background:#187f73;color:#fff}@media(max-width:420px){.actions{grid-template-columns:1fr}}
  </style><section class="card" role="alertdialog" aria-modal="true"><small>SAFE STARTUP</small><h1>SRL 上次可能未正常启动</h1><p>安全模式会临时停用自定义界面 CSS、脚本预览和复杂预览预加载；资源、设置和导出功能仍保留。</p><div class="actions"><button type="button" data-normal>正常启动</button><button type="button" class="safe" data-safe>安全模式</button></div></section>`
  root.querySelector('[data-normal]')?.addEventListener('click', () => {
    sessionStorage.removeItem(SAFE_MODE_SESSION_KEY)
    host.remove()
  })
  root.querySelector('[data-safe]')?.addEventListener('click', () => {
    sessionStorage.setItem(SAFE_MODE_SESSION_KEY, 'safe')
    host.remove()
    installSafeModeBanner()
  })
}

export function installSafeModeBanner(): void {
  if (!isSafeModeActive()) return
  const { host, root } = protectedHost()
  host.style.setProperty('inset', 'auto 12px 12px 12px', 'important')
  host.style.setProperty('display', 'block', 'important')
  host.style.setProperty('padding', '0', 'important')
  host.style.setProperty('background', 'transparent', 'important')
  root.innerHTML = `<style>:host{font:13px/1.4 system-ui,sans-serif;color:#173832}.bar{display:flex;align-items:center;gap:10px;max-width:620px;margin:auto;padding:10px 12px;border:1px solid #7eaaa1;border-radius:14px;background:#f4fffc;box-shadow:0 12px 36px #0005}.bar strong{flex:1}.bar button{min-height:44px;border:1px solid #6b9c93;border-radius:10px;background:#fff;color:#173832;font:600 12px system-ui}@media(max-width:520px){.bar{flex-wrap:wrap}.bar strong{flex-basis:100%}.bar button{flex:1}}</style><div class="bar" role="status"><strong>安全模式：已停用自定义 CSS 与高负载预览</strong><button type="button" data-clear>清除自定义 CSS</button><button type="button" data-normal>恢复正常启动</button></div>`
  root.querySelector('[data-clear]')?.addEventListener('click', () => {
    localStorage.removeItem('srl.ui.customCss')
    localStorage.removeItem('srl.appearance.pending.v1')
    sessionStorage.removeItem(SAFE_MODE_SESSION_KEY)
    window.location.reload()
  })
  root.querySelector('[data-normal]')?.addEventListener('click', () => {
    sessionStorage.removeItem(SAFE_MODE_SESSION_KEY)
    window.location.reload()
  })
}
