import {
  EXTERNAL_APP_RUNTIME_MODE,
  type ExternalAppManifest,
  type ExternalAppRuntimeMode,
  type ExternalAppCompatibilityNotice,
} from '../types/ExternalApp'
import { requireSafePath, readText } from './ExternalAppPackage'

export function resolveAssetPath(
  reference: string,
  currentPath: string,
  allowExternal = false,
): string | undefined {
  const trimmed = reference.trim()
  if (!trimmed || trimmed.startsWith('#')) return undefined
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) {
    if (allowExternal && /^https:\/\//i.test(trimmed)) return undefined
    throw new Error('第一阶段 APP 不支持外部资源')
  }
  const path = trimmed.split(/[?#]/, 1)[0]
  const base = currentPath.split('/').slice(0, -1)
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!base.length) throw new Error('APP 资源路径超出安装包范围')
      base.pop()
      continue
    }
    base.push(segment)
  }
  return requireSafePath(base.join('/'), 'APP 资源')
}

export function mediaType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'woff2':
      return 'font/woff2'
    case 'woff':
      return 'font/woff'
    default:
      return 'application/octet-stream'
  }
}

export function dataUrl(path: string, contents: Uint8Array): string {
  const chunks: string[] = []
  // Multiples of three preserve Base64 boundaries without a giant binary string.
  for (let offset = 0; offset < contents.length; offset += 24 * 1024)
    chunks.push(btoa(String.fromCharCode(...contents.subarray(offset, offset + 24 * 1024))))
  return `data:${mediaType(path)};base64,${chunks.join('')}`
}

export function iconDataUrl(
  files: Record<string, Uint8Array>,
  manifest: ExternalAppManifest,
): string | undefined {
  const path = manifest.icon
  const contents = path ? files[path] : undefined
  return path && contents ? dataUrl(path, contents) : undefined
}

export function inlineCssAssets(
  css: string,
  cssPath: string,
  files: Record<string, Uint8Array>,
  allowExternal = false,
): string {
  const normalizedCss = allowExternal ? css : css.replace(/@import\s+[^;]+;/gi, '')
  return normalizedCss.replace(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi, (whole, _quote, reference) => {
    let assetPath: string | undefined
    try {
      assetPath = resolveAssetPath(reference, cssPath, allowExternal)
    } catch {
      return 'url("")'
    }
    if (!assetPath) return whole
    const asset = files[assetPath]
    if (!asset) throw new Error(`找不到 CSS 资源 ${assetPath}`)
    return `url("${dataUrl(assetPath, asset)}")`
  })
}

export const RUNTIME_BRIDGE_MARKER = 'SRL_RUNTIME_BRIDGE_V3'

export const RUNTIME_BRIDGE = `<script>
(() => {
  // SRL_RUNTIME_BRIDGE_V3
  // sandbox 的不透明来源会让原生 localStorage/sessionStorage 在读取时直接抛错。
  // 为兼容普通静态网页，提供只存活于当前 iframe 的同步内存存储；持久数据仍必须走受控 SDK。
  const createMemoryStorage = () => {
    const values = new Map();
    return Object.freeze({
      get length() { return values.size; },
      key: (index) => Array.from(values.keys())[Number(index)] ?? null,
      getItem: (key) => values.get(String(key)) ?? null,
      setItem: (key, value) => values.set(String(key), String(value)),
      removeItem: (key) => values.delete(String(key)),
      clear: () => values.clear()
    });
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      Object.defineProperty(window, name, { configurable: true, value: createMemoryStorage() });
    } catch (_) {
      // 浏览器若不允许覆盖，后续 window error 会由桥接诊断返回宿主。
    }
  }
  // 不透明 sandbox 的原生 Web Locks 会被拒绝。Supabase 等网页会在恢复会话时调用它，
  // 因而使用仅限此 iframe 的队列锁；不会参与或窥探宿主页面的锁。
  const lockChains = new Map();
  const memoryLocks = Object.freeze({
    request: (name, options, callback) => {
      const handler = typeof options === 'function' ? options : callback;
      if (typeof handler !== 'function') return Promise.reject(new TypeError('Lock callback must be a function'));
      const key = String(name);
      if (options && typeof options === 'object' && options.ifAvailable === true && lockChains.has(key)) {
        return Promise.resolve(handler(null));
      }
      const previous = lockChains.get(key) || Promise.resolve();
      let release;
      const waiting = new Promise((resolve) => { release = resolve; });
      const chain = previous.catch(() => undefined).then(() => waiting);
      lockChains.set(key, chain);
      return previous.catch(() => undefined).then(async () => {
        try {
          return await handler(Object.freeze({ name: key, mode: options?.mode === 'shared' ? 'shared' : 'exclusive' }));
        } finally {
          release();
          if (lockChains.get(key) === chain) lockChains.delete(key);
        }
      });
    }
  });
  try {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: memoryLocks });
  } catch (_) {
    // 浏览器若不允许覆盖，后续 window error 会由桥接诊断返回宿主。
  }
  let port;
  let nonce = '';
  const diagnostics = [];
  let nextId = 0;
  let lastHostSequence = 0;
  const requestTimeoutMs = 15000;
  let isFullscreen = false;
  const pending = new Map();
  const report = (level, value) => {
    const diagnostic = { type: 'srl:diagnostic', level, message: String(value).slice(0, 1000) };
    if (port) port.postMessage(diagnostic);
    else diagnostics.push(diagnostic);
  };
  const request = (method, payload) => new Promise((resolve, reject) => {
    if (!port) return reject(new Error('SRL 扩展接口尚未连接'));
    const id = String(++nextId);
    const timeout = window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('SRL 扩展接口响应超时'));
    }, requestTimeoutMs);
    pending.set(id, {
      resolve: (value) => { window.clearTimeout(timeout); resolve(value); },
      reject: (error) => { window.clearTimeout(timeout); reject(error); }
    });
    port.postMessage({ type: 'srl:request', nonce, id, sequence: nextId, method, payload });
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event.data?.type === 'srl:fullscreen') {
      isFullscreen = event.data.enabled === true;
      return;
    }
    if (event.data?.type !== 'srl:connect' || typeof event.data.nonce !== 'string' || !event.ports?.[0]) return;
    nonce = event.data.nonce;
    port = event.ports[0];
    port.onmessage = (message) => {
      const data = message.data;
      if (data?.type === 'srl:reader-action' && data.nonce === nonce) {
        window.dispatchEvent(new CustomEvent('srlappnavigation', { detail: data.action }));
        return;
      }
      if (data?.type === 'srl:host-back' && data.nonce === nonce && Number.isSafeInteger(data.sequence) && data.sequence > lastHostSequence) {
        lastHostSequence = data.sequence;
        const consume = new CustomEvent('srlappback', { cancelable: true });
        window.dispatchEvent(consume);
        port.postMessage({ type: 'srl:response', nonce, id: data.id, ok: true, value: consume.defaultPrevented });
        return;
      }
      if (data?.type !== 'srl:response' || data.nonce !== nonce || !pending.has(data.id)) return;
      const pendingRequest = pending.get(data.id);
      pending.delete(data.id);
      data.ok ? pendingRequest.resolve(data.value) : pendingRequest.reject(new Error(data.error || 'SRL 扩展请求失败'));
    };
    port.start?.();
    diagnostics.splice(0).forEach((diagnostic) => port.postMessage(diagnostic));
    window.dispatchEvent(new Event('srlappready'));
  });
  const sendHostHoldSignal = (type) => {
    if (!isFullscreen || !port) return;
    port.postMessage({ type, nonce });
  };
  const HOLD_MOVE_TOLERANCE_PX = 18;
  let activeHoldPointerId = null;
  let hostHoldActive = false;
  let holdOriginX = 0;
  let holdOriginY = 0;
  const endHostHoldGesture = () => {
    activeHoldPointerId = null;
    if (!hostHoldActive) return;
    hostHoldActive = false;
    sendHostHoldSignal('srl:host-hold-end');
  };
  // 由宿主在第三方脚本之前注入并注册到 window 的捕获阶段，APP 不能通过 document
  // 监听器阻断长按退出手势。宿主负责计时；桥接只负责识别“仍在按住”还是已经滑动/松手。
  window.addEventListener('pointerdown', (event) => {
    if (!isFullscreen || event.isPrimary === false) return;
    activeHoldPointerId = event.pointerId;
    hostHoldActive = true;
    holdOriginX = event.clientX;
    holdOriginY = event.clientY;
    sendHostHoldSignal('srl:host-hold-start');
  }, { capture: true, passive: true });
  window.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activeHoldPointerId) return;
    if (Math.hypot(event.clientX - holdOriginX, event.clientY - holdOriginY) > HOLD_MOVE_TOLERANCE_PX) {
      endHostHoldGesture();
    }
  }, { capture: true, passive: true });
  window.addEventListener('touchmove', (event) => {
    if (!hostHoldActive) return;
    for (const touch of event.touches) {
      if (Math.hypot(touch.clientX - holdOriginX, touch.clientY - holdOriginY) > HOLD_MOVE_TOLERANCE_PX) {
        endHostHoldGesture();
        break;
      }
    }
  }, { capture: true, passive: true });
  window.addEventListener('pointerup', (event) => {
    if (event.pointerId === activeHoldPointerId) endHostHoldGesture();
  }, { capture: true, passive: true });
  window.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== activeHoldPointerId) return;
    // Android WebView / iOS Safari 在原地长按时也可能发 pointercancel。
    // 已有 pointermove 会负责识别滚动；这里保留宿主计时，并等待 touchend/失焦兜底。
    activeHoldPointerId = null;
  }, { capture: true, passive: true });
  window.addEventListener('touchend', (event) => {
    if (hostHoldActive && event.touches.length === 0) endHostHoldGesture();
  }, { capture: true, passive: true });
  window.addEventListener('blur', endHostHoldGesture, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) endHostHoldGesture();
  }, true);
  document.addEventListener('contextmenu', (event) => {
    if (isFullscreen) event.preventDefault();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isFullscreen || !port) return;
    event.preventDefault();
    const consume = new CustomEvent('srlappback', { cancelable: true });
    window.dispatchEvent(consume);
    if (!consume.defaultPrevented) request('ui.exitFullscreen', {}).catch(() => undefined);
  }, true);
  window.addEventListener('error', (event) => report('error', event.message || event.error));
  window.addEventListener('unhandledrejection', (event) => report('error', event.reason));
  for (const level of ['warn', 'error']) {
    const original = console[level];
    console[level] = (...values) => {
      report(level, values.map((value) => String(value)).join(' '));
      original.apply(console, values);
    };
  }
  window.srlApp = Object.freeze({
    apiVersion: 'srl-app-api@1',
    ready: () => port ? Promise.resolve() : new Promise((resolve) => window.addEventListener('srlappready', resolve, { once: true })),
    storage: Object.freeze({ get: (key) => request('storage.get', { key }), set: (key, value) => request('storage.set', { key, value }), remove: (key) => request('storage.remove', { key }) }),
    capabilities: () => request('sdk.capabilities', {}),
    resources: Object.freeze({
      pick: (options) => request('resources.pick', options || {}),
      list: (options) => request('resources.list', options || {}),
      get: (id) => request('resources.get', { id }),
      update: (change) => request('resources.update', change || {}),
      searchChat: (options) => request('chat.search', options || {}),
      chatVariables: (options) => request('chat.variables', options || {}),
      chatChapters: (options) => request('chat.chapters', options || {}),
      readerStyle: (id, options = {}) => request('chat.style', { ...options, id }),
      readChat: (options) => request('chat.read', options || {}),
      previewChat: (options) => request('chat.preview', options || {}),
      bindChat: (id, characterId) => request('chat.bind', { id, characterId }),
      thumbnail: (id) => request('resources.thumbnail', { id })
    }),
    notify: (message) => request('ui.notify', { message }),
    ui: Object.freeze({
      setReaderNavigation: (state) => request('ui.readerNavigation', state),
      exitFullscreen: () => request('ui.exitFullscreen', {}),
      setTitle: (title) => request('ui.title', { title }),
      setLoading: (label) => request('ui.loading', { label: label || '' })
    }),
    device: Object.freeze({ vibrate: (duration = 30) => request('device.vibrate', { duration }) }),
    files: Object.freeze({
      pick: (options) => request('files.pick', options || {}),
      shareText: (name, text) => request('files.share', { name, text })
    })
  });
})();
</script>`

export function buildRuntimeHtml(
  files: Record<string, Uint8Array>,
  manifest: ExternalAppManifest,
  runtimeMode: ExternalAppRuntimeMode = EXTERNAL_APP_RUNTIME_MODE.ISOLATED,
): string {
  const allowExternal = runtimeMode === EXTERNAL_APP_RUNTIME_MODE.TRUSTED_COMPATIBLE
  const html = readText(files[manifest.entry], manifest.entry)
  const document = new DOMParser().parseFromString(html, 'text/html')
  document
    .querySelectorAll('base, iframe, frame, object, embed, portal, meta[http-equiv="refresh"]')
    .forEach((node) => node.remove())
  for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))) {
    const href = link.getAttribute('href') ?? ''
    let path: string | undefined
    try {
      path = resolveAssetPath(href, manifest.entry, allowExternal)
    } catch {
      link.remove()
      continue
    }
    if (!path) {
      if (allowExternal) continue
      throw new Error('样式表路径无效')
    }
    const contents = files[path]
    if (!contents) throw new Error(`找不到样式文件 ${path}`)
    const style = document.createElement('style')
    style.textContent = inlineCssAssets(readText(contents, path), path, files, allowExternal)
    link.replaceWith(style)
  }
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    const src = script.getAttribute('src') ?? ''
    let path: string | undefined
    try {
      path = resolveAssetPath(src, manifest.entry, allowExternal)
    } catch {
      script.remove()
      continue
    }
    if (!path) {
      if (allowExternal) continue
      throw new Error('脚本路径无效')
    }
    const contents = files[path]
    if (!contents) throw new Error(`找不到脚本文件 ${path}`)
    const replacement = document.createElement('script')
    replacement.type = script.type
    replacement.textContent = readText(contents, path)
    script.replaceWith(replacement)
  }
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[src]'))) {
    if (element.tagName.toLowerCase() === 'script') continue
    const src = element.getAttribute('src') ?? ''
    let path: string | undefined
    try {
      path = resolveAssetPath(src, manifest.entry, allowExternal)
    } catch {
      element.removeAttribute('src')
      continue
    }
    if (!path) continue
    const contents = files[path]
    if (!contents) throw new Error(`找不到资源文件 ${path}`)
    element.setAttribute('src', dataUrl(path, contents))
  }
  if (!allowExternal) {
    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') ?? ''
      if (!href.startsWith('#')) {
        anchor.removeAttribute('href')
        anchor.setAttribute('aria-disabled', 'true')
        anchor.setAttribute('title', '隔离模式不支持外部跳转')
      }
    }
  }
  document.querySelectorAll('form').forEach((form) => {
    form.removeAttribute('action')
    form.removeAttribute('method')
  })
  const head =
    document.head ??
    document.documentElement.insertBefore(document.createElement('head'), document.body)
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = allowExternal
    ? "default-src 'none'; script-src 'unsafe-inline' https: blob:; style-src 'unsafe-inline' https:; img-src data: https: blob:; font-src data: https:; media-src data: https: blob:; connect-src https:; frame-src https: data:; object-src 'none'; base-uri 'none'; form-action https:"
    : "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  head.prepend(policy)
  policy.insertAdjacentHTML('afterend', RUNTIME_BRIDGE)
  return `<!doctype html>${document.documentElement.outerHTML}`
}

export function inspectCompatibility(runtimeHtml: string): ExternalAppCompatibilityNotice[] {
  const notices: ExternalAppCompatibilityNotice[] = []
  if (/\b(?:indexedDB|caches\.)/i.test(runtimeHtml)) {
    notices.push({
      level: 'warning',
      code: 'isolated-persistence',
      message:
        '检测到浏览器持久化 API；隔离运行时请改用 window.srlApp.storage，否则数据不会持久保存。',
    })
  }
  if (/\b(?:localStorage|sessionStorage)\b/.test(runtimeHtml)) {
    notices.push({
      level: 'info',
      code: 'session-storage',
      message:
        '检测到 Web Storage；SRL 会提供仅当前运行期的兼容存储，长期数据请改用 window.srlApp.storage。',
    })
  }
  if (/\b(?:navigator\.locks|\.locks\.request)\b/.test(runtimeHtml)) {
    notices.push({
      level: 'info',
      code: 'locks',
      message: '检测到 Locks API；SRL 会提供当前 APP 内的兼容锁，不与宿主锁共享。',
    })
  }
  if (/\b(?:serviceWorker|SharedWorker|Worker\s*\()/i.test(runtimeHtml)) {
    notices.push({
      level: 'warning',
      code: 'worker',
      message:
        '检测到 Worker 或 Service Worker；隔离 iframe 可能无法注册，请为该能力准备降级路径。',
    })
  }
  if (/(?:\bfile:|\bhttps?:\/\/|\/)[^'"\s<>]+/i.test(runtimeHtml)) {
    notices.push({
      level: 'warning',
      code: 'external-or-absolute-path',
      message: '检测到外链或绝对路径；标准隔离会移除它们，信任兼容仅保留 HTTPS 外链。',
    })
  }
  if (!/meta\s+name=["']viewport["']/i.test(runtimeHtml)) {
    notices.push({
      level: 'info',
      code: 'viewport',
      message: '未检测到移动端 viewport；手机上可能按桌面宽度缩放。',
    })
  }
  return notices
}
