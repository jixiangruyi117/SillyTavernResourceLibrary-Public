const PENDING_APPEARANCE_KEY = 'srl.appearance.pending.v1'
const LAST_GOOD_APPEARANCE_KEY = 'srl.appearance.lastGood.v1'
const GUARD_HOST_ID = 'srl-appearance-safe-layer'

interface PendingAppearance {
  previousCss: string
  nextCss: string
  expiresAt: number
}

interface AppearanceTransactionOptions {
  previousCss: string
  nextCss: string
  apply(css: string): void
  persist(css: string): void
  onKeep?(): void
  onRollback?(): void
  durationMs?: number
}

function parsePendingAppearance(): PendingAppearance | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_APPEARANCE_KEY) ?? 'null') as unknown
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as PendingAppearance).previousCss === 'string' &&
      typeof (value as PendingAppearance).nextCss === 'string' &&
      Number.isFinite((value as PendingAppearance).expiresAt)
    ) {
      return value as PendingAppearance
    }
  } catch {
    // Corrupt safety metadata is discarded below.
  }
  try {
    localStorage.removeItem(PENDING_APPEARANCE_KEY)
  } catch {
    /* No metadata is needed for normal appearance. */
  }
  return null
}

function createProtectedHost(id: string): { host: HTMLDivElement; root: ShadowRoot } {
  document.getElementById(id)?.remove()
  const host = document.createElement('div')
  host.id = id
  const importantStyles: Record<string, string> = {
    all: 'initial',
    display: 'block',
    position: 'fixed',
    inset: 'auto 12px 12px 12px',
    'z-index': '2147483647',
    'pointer-events': 'none',
    visibility: 'visible',
    opacity: '1',
  }
  for (const [property, value] of Object.entries(importantStyles)) {
    host.style.setProperty(property, value, 'important')
  }
  document.body.append(host)
  return { host, root: host.attachShadow({ mode: 'open' }) }
}

export function recoverInterruptedAppearance(): string | undefined {
  const pending = parsePendingAppearance()
  if (!pending) return undefined
  try {
    localStorage.removeItem(PENDING_APPEARANCE_KEY)
    localStorage.setItem(LAST_GOOD_APPEARANCE_KEY, pending.previousCss)
  } catch {
    /* Still render the previous CSS if diagnostic storage is unavailable. */
  }
  return pending.previousCss
}

export function readLastGoodAppearance(): string {
  try {
    return localStorage.getItem(LAST_GOOD_APPEARANCE_KEY) ?? ''
  } catch {
    return ''
  }
}

class AppearanceTransactionManager {
  private rollbackActive?: () => void

  rollback(): void {
    this.rollbackActive?.()
  }

  begin(options: AppearanceTransactionOptions): void {
    this.rollbackActive?.()
    const durationMs = Math.max(1000, options.durationMs ?? 15_000)
    const pending: PendingAppearance = {
      previousCss: options.previousCss,
      nextCss: options.nextCss,
      expiresAt: Date.now() + durationMs,
    }
    localStorage.setItem(PENDING_APPEARANCE_KEY, JSON.stringify(pending))
    options.persist(options.nextCss)
    options.apply(options.nextCss)

    const { host, root } = createProtectedHost(GUARD_HOST_ID)
    root.innerHTML = `<style>
      :host{font:14px/1.45 system-ui,sans-serif;color:#15342f}
      *,*::before,*::after{box-sizing:border-box}.guard{pointer-events:auto;font:14px/1.45 system-ui,sans-serif;color:#15342f;display:flex;align-items:center;gap:12px;max-width:680px;margin:auto;padding:12px 14px;border:1px solid #6fa79d;border-radius:14px;background:#f4fffc;box-shadow:0 12px 36px #102d2850}
      .copy{min-width:0;flex:1}.copy strong,.copy span{display:block}.copy span{color:#496660;font-size:12px}
      .actions{display:flex;gap:8px}.actions button{min-height:44px;padding:8px 12px;border:1px solid #6b9c93;border-radius:10px;background:#fff;color:#15342f;font:600 13px system-ui;cursor:pointer}
      .actions .keep{border-color:#187f73;background:#187f73;color:#fff}
      @media(max-width:520px){.guard{align-items:stretch;flex-direction:column}.actions button{flex:1}}
    </style><div class="guard" role="alert"><div class="copy"><strong>自定义 CSS 已临时应用</strong><span data-countdown></span></div><div class="actions"><button type="button" data-rollback>立即恢复</button><button type="button" class="keep" data-keep>保留更改</button></div></div>`
    const countdown = root.querySelector<HTMLElement>('[data-countdown]')
    const updateCountdown = () => {
      if (countdown)
        countdown.textContent = `${Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000))} 秒内未确认将自动恢复上一版`
    }
    updateCountdown()
    const interval = window.setInterval(updateCountdown, 250)
    let settled = false
    const finish = (keep: boolean) => {
      if (settled) return
      settled = true
      window.clearInterval(interval)
      window.clearTimeout(timeout)
      host.remove()
      localStorage.removeItem(PENDING_APPEARANCE_KEY)
      this.rollbackActive = undefined
      if (keep) {
        localStorage.setItem(LAST_GOOD_APPEARANCE_KEY, options.nextCss)
        options.onKeep?.()
      } else {
        options.persist(options.previousCss)
        options.apply(options.previousCss)
        localStorage.setItem(LAST_GOOD_APPEARANCE_KEY, options.previousCss)
        options.onRollback?.()
      }
    }
    const timeout = window.setTimeout(() => finish(false), durationMs)
    root.querySelector('[data-keep]')?.addEventListener('click', () => finish(true))
    root.querySelector('[data-rollback]')?.addEventListener('click', () => finish(false))
    this.rollbackActive = () => finish(false)
  }

  clear(css: string, apply: (value: string) => void, persist: (value: string) => void): void {
    this.rollbackActive?.()
    localStorage.removeItem(PENDING_APPEARANCE_KEY)
    localStorage.setItem(LAST_GOOD_APPEARANCE_KEY, css)
    persist(css)
    apply(css)
  }
}

export const appearanceTransaction = new AppearanceTransactionManager()
