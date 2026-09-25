/* global window, document, FileReader, ResizeObserver, IntersectionObserver, requestAnimationFrame, setTimeout, clearTimeout, NodeFilter */
'use strict'
;(() => {
  // This APP has no database or chat-file store. All originals and bindings are owned by SRL.
  const $ = (s) => document.querySelector(s)
  const $$ = (s) => [...document.querySelectorAll(s)]
  const esc = (t) =>
    String(t ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  const paths = {
    back: 'M14 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    book: 'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z M12 6v15',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    sliders: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
    close: 'M6 6l12 12 M18 6L6 18',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2',
    progress: 'M4 6h16 M4 12h16 M4 18h10 M17 16l3 3-3 3',
    full: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
    menu: 'M5 7h14 M5 12h14 M5 17h14',
    image: 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M15 8h.01',
  }
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.more}"/></svg>`
  // ExternalAppHost permits 60 requests / 10 seconds. Keep headroom for host UI requests.
  const requestTimes = []
  let requestQueue = Promise.resolve()
  function scheduleRequest(call) {
    const task = requestQueue
      .catch(() => {})
      .then(async () => {
        while (requestTimes.length && Date.now() - requestTimes[0] > 10000) requestTimes.shift()
        if (requestTimes.length >= 50) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(1, 10001 - (Date.now() - requestTimes[0]))),
          )
          while (requestTimes.length && Date.now() - requestTimes[0] > 10000) requestTimes.shift()
        }
        requestTimes.push(Date.now())
        return call()
      })
    requestQueue = task
    return task
  }
  const wrapSdk = (obj) =>
    Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? (...args) => scheduleRequest(() => value(...args))
          : value && typeof value === 'object'
            ? wrapSdk(value)
            : value,
      ]),
    )
  const api = window.srlApp ? wrapSdk(window.srlApp) : undefined
  const shadow = $('#readingFlow').attachShadow({ mode: 'open' })
  let prefs = {
    renderMode: 'simple',
    mode: 'scroll',
    progressMode: 'jump',
    blendPanels: true,
    panelAppearance: 'author',
    layout: 'novel',
    theme: 'paper',
    font: 18,
    leading: 1.85,
    width: 700,
    regex: true,
    remote: false,
    mask: false,
    words: '',
    replacement: '某某',
    hideUser: false,
    css: '',
    styleId: '',
    characterCover: false,
  }
  const appearanceKeys = [
    'theme',
    'font',
    'leading',
    'width',
    'layout',
    'css',
    'styleId',
    'panelAppearance',
    'blendPanels',
    'regex',
  ]
  let defaultPrefs = { ...prefs },
    roleAppearance = null
  let catalog = [],
    characters = [],
    charactersById = new Map(),
    chats = [],
    role = null,
    chat = null,
    state = {},
    pageData = null,
    page = 0,
    pages = 1,
    prior = null,
    readVersion = 0,
    version = 0,
    searchVersion = 0,
    listLimit = 30
  let runtime = {},
    chrome = false,
    saveTimer,
    toastTimer,
    holdTimer,
    suppress = false,
    bodyStyles = '',
    indexState = {},
    background = ''
  const avatarCache = new Map(),
    stateCache = new Map()
  let storageQueue = Promise.resolve()
  const run = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((error) => notify(error instanceof Error ? error.message : String(error), true))
  function notify(text, error = false) {
    $('#toast').textContent = text
    $('#toast').hidden = false
    $('#toast').classList.toggle('error', error)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => ($('#toast').hidden = true), 4000)
  }
  function store(key, value) {
    const snapshot = JSON.parse(JSON.stringify(value))
    const task = storageQueue.catch(() => {}).then(() => api.storage.set(key, snapshot))
    storageQueue = task
    return task
  }
  async function savePrefs() {
    const own = roleAppearance?.enabled === true
    for (const [key, value] of Object.entries(prefs)) {
      if (own && appearanceKeys.includes(key)) roleAppearance.values[key] = value
      else defaultPrefs[key] = value
    }
    if (own) await store('appearance:' + role, roleAppearance)
    await store('preferences-v1', defaultPrefs)
  }
  function resolveAppearance() {
    prefs = { ...defaultPrefs, ...(roleAppearance?.enabled ? roleAppearance.values : {}) }
    applyPrefs()
  }
  async function changeAppearanceMode(enabled, reset = false) {
    const pos = currentPosition()
    const next = reset
      ? { enabled: false }
      : {
          ...roleAppearance,
          enabled,
          values:
            roleAppearance?.values ||
            Object.fromEntries(appearanceKeys.map((key) => [key, prefs[key]])),
          rules:
            roleAppearance?.rules ||
            Object.fromEntries(
              (pageData?.regexRules || [])
                .filter((r) => r.signature)
                .map((r) => [r.signature, r.enabled]),
            ),
        }
    await store('appearance:' + role, next)
    roleAppearance = next
    background = ''
    $('#reader').style.backgroundImage = ''
    $('#reader').style.setProperty('--veil', 0)
    resolveAppearance()
    await read(pageData.messages[0]?.index || 0, pos)
    await panel('appearance')
  }
  async function getState(id) {
    if (!stateCache.has(id)) {
      const s = await api.storage.get('chat:' + id)
      stateCache.set(id, { note: '', title: '', pinned: false, marks: [], ...s })
    }
    return stateCache.get(id)
  }
  async function saveState() {
    if (!chat) return
    stateCache.set(chat.id, state)
    await store('chat:' + chat.id, state)
    indexState.lastChat = chat.id
    await store('reader-index-v1', indexState)
  }
  function sheet(title, html) {
    $('#sheetTitle').textContent = title
    $('#sheetBody').innerHTML = html
    if (!$('#sheet').open) $('#sheet').showModal()
  }
  function loading(text) {
    $('#libraryContent').innerHTML = `<p class="loading">${esc(text)}</p>`
  }
  async function allResources() {
    const results = []
    let offset = 0
    do {
      const response = await api.resources.list({
        types: ['chat', 'characterCard'],
        offset,
        limit: 50,
      })
      results.push(...response.items)
      offset = response.nextOffset
    } while (offset !== null)
    return results
  }
  function boundRole(c) {
    const matches = c.relatedResourceIds
      .map((id) => charactersById.get(id))
      .filter((r) => r && !r.companion)
    return matches.length === 1
      ? matches[0]
      : matches.length === 0 && c.chatCharacter
        ? charactersById.get(c.chatCharacter.id)
        : null
  }
  function avatar(r) {
    const src = avatarCache.get(r.id)
    return src
      ? `<img class="avatar" src="${src}" alt="${esc(r.name)}">`
      : `<span class="avatar serif" data-avatar="${esc(r.id)}">${esc(r.name.slice(0, 1))}</span>`
  }
  function applyCharacterCover() {
    const button = $('#characterCover')
    const label = prefs.characterCover ? '关闭角色沉浸背景' : '开启角色沉浸背景'
    button.setAttribute('aria-pressed', String(prefs.characterCover))
    button.setAttribute('aria-label', label)
    button.title = label
    const image = role && prefs.characterCover ? avatarCache.get(role) : null
    $('#library').classList.toggle('character-cover', Boolean(image))
    if (image) $('#library').style.setProperty('--character-cover', `url("${image}")`)
    else $('#library').style.removeProperty('--character-cover')
  }
  const avatarObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      avatarObserver.unobserve(entry.target)
      const id = entry.target.dataset.avatar
      if (avatarCache.has(id)) continue
      avatarCache.set(id, null)
      run(async () => {
        const blob = await api.resources.thumbnail(
          characters.find((r) => r.id === id)?.thumbnailId || id,
        )
        if (!blob) return
        const src = await dataUrl(blob)
        avatarCache.set(id, src)
        applyCharacterCover()
        const current = $(`[data-avatar="${window.CSS.escape(id)}"]`)
        if (current) {
          const img = document.createElement('img')
          img.className = 'avatar'
          img.src = src
          img.alt = '角色头像'
          current.replaceWith(img)
        }
      })
    }
  })
  function observeAvatars() {
    avatarObserver.disconnect()
    $$('[data-avatar]')
      .slice(0, 30)
      .forEach((el) => avatarObserver.observe(el))
  }
  async function refresh() {
    loading('正在读取资源库…')
    catalog = await allResources()
    characters = catalog.filter((r) => r.type === 'characterCard')
    chats = catalog.filter((r) => r.type === 'chat')
    for (const c of chats) {
      if (c.chatCharacter && !characters.some((r) => r.id === c.chatCharacter.id))
        characters.push({ ...c.chatCharacter, thumbnailId: c.id, companion: true })
    }
    charactersById = new Map(characters.map((r) => [r.id, r]))
    await renderLibrary()
  }
  async function renderLibrary() {
    const revision = ++version
    applyCharacterCover()
    const q = $('#librarySearch').value.trim().toLowerCase()
    $('#libraryTitle').textContent = role ? '聊天记录' : '读了么'
    $('#brand').hidden = !!role
    $('#libraryBack').hidden = !role
    await syncNavigation()
    $('#librarySearch').placeholder = role ? '搜索标题或已加载备注' : '搜索角色名称'
    let html = ''
    if (!role) {
      const pending = chats.filter((c) => !boundRole(c))
      const recent = chats.find((c) => c.id === indexState.lastChat)
      if (recent && boundRole(recent)) {
        html += `<button class="continue" data-chat="${esc(recent.id)}">${icon('bookmark')}<span><span class="small-label muted">继续阅读</span><strong>${esc(boundRole(recent).name)} · ${esc(recent.name)}</strong></span>${icon('next')}</button>`
      }
      html += `<div class="library-heading"><h2>我的角色</h2><span class="count">${characters.filter((r) => chats.some((c) => boundRole(c)?.id === r.id)).length}</span><button class="right" data-action="refresh">刷新资源库</button></div>`
      const roles = characters.filter(
        (r) => r.name.toLowerCase().includes(q) && chats.some((c) => boundRole(c)?.id === r.id),
      )
      html += roles
        .slice(0, listLimit)
        .map(
          (r) =>
            `<button class="role-row" data-role="${esc(r.id)}">${avatar(r)}<span class="role-info"><span class="role-name serif">${esc(r.name)}</span><span class="role-sub">${r.companion ? '聊天随附资料' : '已绑定角色卡'}</span></span><span class="role-count"><span><b>${chats.filter((c) => boundRole(c)?.id === r.id).length}</b>份聊天</span>${icon('next')}</span></button>`,
        )
        .join('')
      if (roles.length > listLimit)
        html += '<button class="secondary" data-action="moreList">显示更多角色</button>'
      if (pending.length)
        html += `<button class="role-row" data-role="unbound"><span class="avatar serif">?</span><span class="role-info"><span class="role-name serif">待绑定</span><span class="role-sub">选择角色卡后即可阅读，不按同名猜测</span></span><span class="role-count"><b>${pending.length}</b>${icon('next')}</span></button>`
      if (!chats.length)
        html +=
          '<p class="empty">还没有聊天记录。<br>返回资源库，导入酒馆导出的 JSONL 文件，再来这里绑定角色。</p>'
      else if (!roles.length && !pending.length) html += '<p class="empty">没有找到角色</p>'
    } else {
      const r = characters.find((r) => r.id === role)
      html = `<div class="character-head">${r ? avatar(r) : '<span class="avatar">?</span>'}<h2 class="serif">${r ? esc(r.name) : '待绑定聊天'}</h2></div>`
      const group = chats.filter((c) =>
        role === 'unbound' ? !boundRole(c) : boundRole(c)?.id === role,
      )
      const shown = group.slice(0, listLimit)
      for (const c of shown) {
        await getState(c.id)
        if (revision !== version) return
      }
      const list = shown
        .filter((c) =>
          (c.name + (stateCache.get(c.id)?.note || '') + (stateCache.get(c.id)?.title || ''))
            .toLowerCase()
            .includes(q),
        )
        .sort((a, b) => Number(stateCache.get(b.id)?.pinned) - Number(stateCache.get(a.id)?.pinned))
      html +=
        list
          .map((c) => {
            const s = stateCache.get(c.id)
            return `<div class="chat-row"><button class="chat-open" data-chat="${esc(c.id)}"><div class="chat-title serif">${s.pinned ? '◆ ' : ''}${esc(s.title || c.name)}</div><div class="chat-meta"><span>${c.messageCount} 楼</span><span>${s.position ? `读至 ${s.position.floor + 1} 楼` : '未开始'}</span>${!boundRole(c) ? '<span>点击绑定角色</span>' : ''}</div>${s.note ? `<p class="chat-note">${esc(s.note)}</p>` : ''}</button><button class="icon" data-note="${esc(c.id)}" aria-label="备注与整理">${icon('more')}</button></div>`
          })
          .join('') || '<p class="empty">没有找到聊天记录</p>'
      if (group.length > listLimit)
        html += '<button class="secondary" data-action="moreList">加载更多记录</button>'
    }
    if (revision !== version) return
    $('#libraryContent').innerHTML = html
    observeAvatars()
  }
  async function selectRole(id) {
    role = id
    listLimit = 30
    $('#librarySearch').value = ''
    $('#librarySearchWrap').hidden = true
    await renderLibrary()
    window.scrollTo(0, 0)
  }
  function bindPanel(c) {
    sheet(
      '绑定角色卡',
      `<p>${esc(c.name)}</p><p class="hint">角色名和文件名仅供参考。请选择这份聊天实际对应的角色卡。</p><label class="field-label" for="bindSelect">角色卡</label><select id="bindSelect"><option value="">请选择</option>${characters
        .filter((r) => !r.companion)
        .map((r) => `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.id.slice(-6))}</option>`)
        .join(
          '',
        )}</select><div class="button-row"><button class="primary" id="bindConfirm">确认绑定</button></div>`,
    )
    $('#bindConfirm').onclick = () =>
      run(async () => {
        const id = $('#bindSelect').value
        if (!id) throw Error('请先选择角色卡')
        await api.resources.bindChat(c.id, id)
        $('#sheet').close()
        await refresh()
        notify('角色绑定已保存到资源库')
      })
  }
  async function notePanel(id) {
    const c = chats.find((c) => c.id === id),
      s = await getState(id)
    sheet(
      '备注与整理',
      `<p class="hint">原始名称：${esc(c.name)}</p><label class="field-label" for="displayName">显示名称</label><input class="searchbox" id="displayName" maxlength="160" value="${esc(s.title)}" placeholder="留空使用原名称"><label class="field-label" for="noteInput" style="margin-top:18px">备注</label><textarea id="noteInput" maxlength="500">${esc(s.note)}</textarea><div class="setting-row"><label for="pinned">置顶这份聊天</label><input id="pinned" type="checkbox" ${s.pinned ? 'checked' : ''}></div><div class="button-row"><button class="secondary" id="rebind">更换绑定角色</button><button class="primary" id="saveNote">保存</button></div>`,
    )
    $('#rebind').onclick = () => bindPanel(c)
    $('#saveNote').onclick = () =>
      run(async () => {
        const next = {
          ...s,
          title: $('#displayName').value.trim(),
          note: $('#noteInput').value.trim(),
          pinned: $('#pinned').checked,
        }
        await store('chat:' + id, next)
        stateCache.set(id, next)
        $('#sheet').close()
        await renderLibrary()
        notify('备注已保存')
      })
  }
  function applyPrefs() {
    const themes = {
      paper: ['#f6f3ec', '#fffcf6', '#303a32', '#85887c', '#dddfd3', '#586c4e', '#e8ebdf'],
      green: ['#e8eddf', '#f3f6ed', '#344134', '#7a8874', '#ccd5c3', '#506c48', '#dbe4d2'],
      night: ['#202622', '#2a322b', '#d0d3c6', '#909c8d', '#3c463d', '#9caf8a', '#313d32'],
    }
    const colors = themes[prefs.theme] || themes.paper
    ;['paper', 'surface', 'ink', 'muted', 'line', 'accent', 'soft'].forEach((k, i) =>
      document.documentElement.style.setProperty('--' + k, colors[i]),
    )
    for (const [k, v] of Object.entries({
      font: prefs.font + 'px',
      leading: prefs.leading,
      measure: prefs.width + 'px',
    }))
      document.documentElement.style.setProperty('--' + k, v)
    document.documentElement.style.colorScheme = prefs.theme === 'night' ? 'dark' : 'light'
    $('#reader').classList.toggle('page-mode', prefs.mode === 'page')
    $('#readingFlow').classList.toggle(
      'tavern-layout',
      prefs.layout === 'tavern' && prefs.renderMode !== 'plain',
    )
    shadow.querySelector('#chat')?.classList.toggle('page-layout', prefs.mode === 'page')
    $('#readingFlow').style.transform = ''
    $('#readingFlow').style.setProperty('--column-width', $('#readingViewport').clientWidth + 'px')
    if (runtime.builtinReader) run(syncNavigation)
  }
  function masked(text) {
    if (!prefs.mask) return text
    const words = [...(pageData?.userNames || []), state.userName, ...prefs.words.split(/[,，\n]/)]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
    const escaped = [...new Set(words)].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(
      escaped.concat('\\{\\{\\s*[uU][sS][eE][rR]\\s*\\}\\}').join('|'),
      'g',
    )
    return text.replace(pattern, () => prefs.replacement || '某某')
  }
  function maskNodes(root) {
    if (!prefs.mask) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) {
      if (!node.parentElement.closest('style,script')) node.textContent = masked(node.textContent)
    }
  }
  const panelFrames = new Set()
  const lazyPanels = new Map()
  const floorDocuments = new Map()
  let panelEpoch = 0
  const panelObserver = new IntersectionObserver(
    (entries) => {
      for (const item of entries) {
        const state = lazyPanels.get(item.target)
        if (!state) continue
        state.visible = item.isIntersecting
        if (item.isIntersecting) run(() => mountPanel(item.target, state))
        else if (state.frame && state.frame.dataset.followPage !== String(page)) {
          state.height = state.frame.getBoundingClientRect().height
          item.target.style.height = state.height + 'px'
          panelFrames.delete(state.frame)
          state.frame.remove()
          state.frame = null
          item.target.append(state.staticHost)
        }
      }
    },
    { root: $('#readingViewport'), rootMargin: '100% 100%' },
  )
  async function mountPanel(panel, item) {
    if (item.frame || item.loading) return
    item.loading = true
    const epoch = panelEpoch
    try {
      if (!floorDocuments.has(item.entry.index))
        floorDocuments.set(
          item.entry.index,
          api.resources.readChat({
            ...readOptions(),
            offset: item.entry.index,
            limit: 1,
            interactive: true,
            panelInk: window.getComputedStyle(panel.parentElement).color,
          }),
        )
      const result = await floorDocuments.get(item.entry.index)
      if (epoch !== panelEpoch || !panel.isConnected || !item.visible) return
      if (result.contentHash !== pageData.contentHash) throw Error('聊天原件已变化，请重新打开阅读')
      const doc = result.messages[0]?.interactiveFrontends?.[item.index]
      if (!doc) return
      const frame = document.createElement('iframe')
      const bounds = panel.getBoundingClientRect()
      const viewport = $('#readingViewport').getBoundingClientRect()
      if (
        prefs.mode === 'page' &&
        bounds.left < viewport.right &&
        bounds.right > viewport.left &&
        bounds.top < viewport.bottom &&
        bounds.bottom > viewport.top
      )
        frame.dataset.followPage = String(page)
      frame.title = `第 ${item.entry.index + 1} 楼状态栏 ${item.index + 1}`
      frame.className = 'panel-loading'
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
      frame.style.cssText = `display:block;width:100%;height:${item.height || panel.getBoundingClientRect().height || 1}px;border:0;break-inside:avoid;`
      frame.src = result.previewDocumentUrl
      frame.addEventListener(
        'load',
        () => {
          if (frame.isConnected && epoch === panelEpoch)
            frame.contentWindow?.postMessage({ type: 'srl:preview-document', html: doc }, '*')
        },
        { once: true },
      )
      item.frame = frame
      panelFrames.add(frame)
      // Keep the already readable projection until the child reports real layout.
      panel.append(frame)
    } catch (error) {
      if (epoch === panelEpoch) {
        floorDocuments.delete(item.entry.index)
        throw error
      }
    } finally {
      item.loading = false
    }
  }
  let pagePosition = null
  function clearPanelFrames() {
    panelEpoch++
    panelObserver.disconnect()
    lazyPanels.clear()
    floorDocuments.clear()
    const frames = [...panelFrames]
    panelFrames.clear()
    pagePosition = null
    for (const frame of frames) frame.remove()
  }
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'SRL_PREVIEW_HEIGHT') return
    const frame = [...panelFrames.keys()].find((item) => item.contentWindow === event.source)
    const height = Number(event.data.height)
    if (!frame || !Number.isFinite(height) || height <= 0) return
    const nextHeight = Math.min(100000, Math.ceil(height)) + 'px'
    const follow = frame.dataset.followPage === String(page)
    delete frame.dataset.followPage
    const loading = frame.classList.contains('panel-loading')
    if (!loading && frame.style.height === nextHeight) return
    const pos = prefs.mode === 'page' ? pagePosition || currentPosition() : currentPosition()
    const active = shadow.activeElement === frame || follow
    const viewport = $('#readingViewport').getBoundingClientRect()
    const inView = (element) => {
      const rect = element.getBoundingClientRect()
      return (
        rect.right > viewport.left + 2 &&
        rect.left < viewport.right - 2 &&
        rect.bottom > viewport.top &&
        rect.top < viewport.bottom
      )
    }
    // Several short placeholders can share a column. A later one finishing must
    // not pull the reader to its new column after earlier panels have grown.
    const anchor =
      prefs.mode === 'page'
        ? active && !loading && inView(frame)
          ? frame.parentElement
          : [...shadow.querySelectorAll('[data-chat-frontend]')].find(inView)
        : null
    const top = anchor?.getBoundingClientRect().top
    if (loading) {
      const panel = frame.parentElement
      // Do not detach/reinsert the iframe: that restarts its document and scripts.
      for (const child of [...panel.childNodes]) if (child !== frame) child.remove()
      panel.style.height = ''
      frame.classList.remove('panel-loading')
    }
    frame.style.height = nextHeight
    if (anchor) {
      calculatePages()
      const flow = $('#readingFlow').getBoundingClientRect()
      page = Math.max(
        0,
        Math.round(
          (anchor.getBoundingClientRect().left - flow.left) /
            ($('#readingViewport').clientWidth + 48),
        ),
      )
      calculatePages()
      $('#readingViewport').scrollTop += anchor.getBoundingClientRect().top - top
      pagePosition = currentPosition()
    } else restore(pos)
  })
  function enableInteractions(position = currentPosition()) {
    if (prefs.mask) throw Error('请先关闭隐藏身份，再启用交互状态栏')
    if (!runtime.network) throw Error('请在扩展管理中使用兼容模式打开，再启用交互状态栏')
    sheet(
      '启用完整阅读',
      '<p class="hint">状态栏会直接在正文中交互，可读取当前楼层的归档快照，不会修改聊天原件。远程资源仍由独立开关控制。开启后可直接在正文操作；可随时在阅读显示中关闭。</p><button class="primary" id="enableInteractions">启用完整模式</button>',
    )
    $('#enableInteractions').onclick = () =>
      run(async () => {
        prefs.renderMode = 'full'
        await savePrefs()
        $('#sheet').close()
        await read(pageData.messages[0]?.index || 0, position)
      })
  }
  let pendingStyleId = ''
  let fontKey = ''
  const readerFontStyle = document.createElement('style')
  document.head.append(readerFontStyle)
  async function syncReaderFonts() {
    const key = (prefs.styleId || '') + ':' + prefs.remote
    if (key === fontKey) return
    fontKey = key
    readerFontStyle.textContent = ''
    if (!prefs.styleId) return
    const result = await api.resources.readerStyle(prefs.styleId, {
      fonts: true,
      remote: prefs.remote && runtime.network,
    })
    if (key !== fontKey) return
    readerFontStyle.textContent = result.fonts?.css || ''
    if (result.fonts?.errors?.length) notify(result.fonts.errors[0])
    await document.fonts.ready
    if (key === fontKey && pageData) mediaLayoutChanged()
  }
  function renderPage() {
    clearPanelFrames()
    const scroll = $('#readingViewport')
    shadow.innerHTML = ''
    const style = document.createElement('style')
    style.textContent =
      bodyStyles +
      '\n:host{display:block}p{margin:0 0 1em;text-align:justify;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{display:block;max-width:100%;overflow:auto}.mes_text{overflow-wrap:anywhere}.floor{break-inside:auto}' +
      (prefs.remote
        ? prefs.css
        : prefs.css.replace(/url\(\s*([^)]*)\)/gi, (match, url) =>
            /^['"]?data:/i.test(url.trim()) ? match : 'none',
          )) +
      '\n#chat .mes_block{min-width:0;max-width:100%;box-sizing:border-box}#chat.page-layout .mes_block{transform:none!important}#chat:not(.tavern-layout) .mes_text,#chat:not(.tavern-layout) .mes_text :is(p,q,em,strong,a,span){font-size:var(--font)!important;line-height:var(--leading)!important}'
    shadow.append(style)
    const content = document.createElement('div')
    content.id = 'chat'
    content.className =
      'reading-flow' +
      (prefs.layout === 'tavern' && prefs.renderMode !== 'plain' ? ' tavern-layout' : '')
    shadow.append(content)
    for (const entry of pageData.messages) {
      const m = entry.message
      if (prefs.hideUser && m.is_user) continue
      const section = document.createElement('section')
      section.setAttribute('is_user', String(m.is_user))
      section.setAttribute('mesid', String(entry.index))
      section.className = 'floor mes ' + (m.is_user ? 'user' : '')
      section.dataset.floor = entry.index
      section.classList.add(m.is_user ? 'user_mes' : 'bot_mes')
      section.setAttribute('ch_name', masked(m.name))
      const block = document.createElement('div')
      block.className = 'mes_block'
      if (prefs.renderMode !== 'plain' && !m.is_user && avatarCache.get(role)) {
        const portrait = document.createElement('div')
        portrait.className = 'mesAvatarWrapper'
        portrait.innerHTML = `<div class="avatar"><img src="${esc(avatarCache.get(role))}" alt="${esc(masked(m.name))}"></div>`
        section.append(portrait)
      }
      const speaker = document.createElement('div')
      speaker.className = 'speaker ch_name name_text'
      speaker.textContent =
        (m.is_user && prefs.mask ? '你' : masked(m.name)) +
        ' · ' +
        (entry.index + 1) +
        (state.marks.some((x) => x.floor === entry.index) ? ' ◆' : '')
      block.append(speaker)
      const body = document.createElement('div')
      body.className = 'mes_text'
      body.innerHTML =
        entry.html ||
        (prefs.renderMode === 'plain' ? '<p class="muted">本楼没有正文文字，可继续翻阅。</p>' : '')
      // Keep a whole HTML opening with its avatar/name in one extensible page.
      // Splitting that header from an oversized panel creates header-only columns.
      section.classList.toggle(
        'frontend-only',
        body.children.length === 1 &&
          body.firstElementChild.matches('[data-chat-frontend]') &&
          ![...body.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()),
      )
      body.querySelectorAll('[data-chat-frontend]').forEach((panel) => {
        const index = Number(panel.dataset.chatFrontend)
        const staticHost = document.createElement('div')
        panel.append(staticHost)
        const root = staticHost.attachShadow({ mode: 'open' })
        root.addEventListener('load', mediaLayoutChanged, true)
        root.innerHTML = entry.frontends?.[index] || ''
        maskNodes(root)
        if (!prefs.mask && prefs.renderMode === 'full') {
          lazyPanels.set(panel, {
            entry,
            index,
            staticHost,
            visible: false,
            frame: null,
            loading: false,
          })
          panelObserver.observe(panel)
        } else
          panel.addEventListener('click', (event) => {
            event.stopPropagation()
            run(async () => enableInteractions())
          })
      })
      maskNodes(body)
      block.append(body)
      section.append(block)
      if (entry.errors?.length) {
        const warning = document.createElement('p')
        warning.className = 'error'
        warning.textContent = '部分正则未执行：' + entry.errors.join('；')
        section.append(warning)
      }
      content.append(section)
    }
    if (pageData.nextOffset === null && pageData.messages.length) {
      const end = document.createElement('p')
      end.className = 'reading-end'
      end.textContent = '已阅读完全部内容'
      ;(content.lastElementChild?.querySelector('.mes_block') || content).append(end)
    }
    // Page turns already cross chapter/batch boundaries; a flow footer creates empty columns.
    if (prefs.mode === 'scroll') {
      const nav = document.createElement('div')
      nav.id = 'chapterNav'
      nav.innerHTML = `${pageData.messages[0]?.index > 0 ? '<button data-batch="prev">' + (prefs.progressMode === 'chapters' ? '上一章' : '上一段') + '</button>' : '<span></span>'}${pageData.nextOffset !== null ? '<button data-batch="next">' + (prefs.progressMode === 'chapters' ? '下一章' : '继续阅读下一段') + '</button>' : ''}`
      content.append(nav)
    }
    applyPrefs()
    page = 0
    scroll.scrollTop = 0
    calculatePages()
  }
  function currentPosition() {
    const rect = $('#readingViewport').getBoundingClientRect()
    const extended =
      prefs.mode === 'page' &&
      [...shadow.querySelectorAll('[data-chat-frontend],img,video,svg,table')].find((el) => {
        const r = el.getBoundingClientRect()
        return (
          r.right > rect.left + 5 &&
          r.left < rect.right - 5 &&
          r.bottom > rect.top + 5 &&
          r.top < rect.bottom
        )
      })
    let element =
      (extended && extended.closest('[data-floor]')) ||
      [...shadow.querySelectorAll('[data-floor]')].find((el) =>
        [...el.getClientRects()].some(
          (r) => r.right > rect.left + 5 && r.left < rect.right - 5 && r.bottom > rect.top + 5,
        ),
      )
    if (!element) element = shadow.querySelector('[data-floor]')
    return {
      floor: Number(element?.dataset.floor || pageData?.messages[0]?.index || 0),
      mode: prefs.mode,
      pageScroll: prefs.mode === 'page' ? $('#readingViewport').scrollTop : 0,
      pageOffset:
        prefs.mode === 'page' && element
          ? Math.max(
              0,
              Math.round((rect.left - element.getBoundingClientRect().left) / (rect.width + 48)),
            )
          : 0,
      offset:
        prefs.mode === 'scroll'
          ? Math.max(0, rect.top - (element?.getBoundingClientRect().top || rect.top))
          : 0,
      hash: pageData?.contentHash,
    }
  }
  function calculatePages() {
    if (!pageData) return
    const vp = $('#readingViewport'),
      flow = $('#readingFlow')
    flow.style.setProperty('--column-width', vp.clientWidth + 'px')
    flow.style.setProperty('--page-height', vp.clientHeight + 'px')
    let contentWidth = 0
    if (prefs.mode === 'page') {
      const left = flow.getBoundingClientRect().left
      const include = (rects) => {
        for (const rect of rects)
          if (rect.width && rect.height) contentWidth = Math.max(contentWidth, rect.right - left)
      }
      for (const body of shadow.querySelectorAll('.mes_text,.reading-end')) {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        while (walker.nextNode())
          if (walker.currentNode.textContent.trim()) {
            range.selectNodeContents(walker.currentNode)
            include(range.getClientRects())
          }
      }
      for (const media of shadow.querySelectorAll('[data-chat-frontend],img,video,svg,table'))
        include(media.getClientRects())
    }
    // Author padding/shadows must not produce a last page containing only the bubble's rounded edge.
    pages =
      prefs.mode === 'page'
        ? Math.max(1, Math.ceil((contentWidth + 48) / (vp.clientWidth + 48)))
        : 1
    page = Math.min(Math.max(0, page), pages - 1)
    flow.style.transform =
      prefs.mode === 'page' ? `translateX(${-page * (vp.clientWidth + 48)}px)` : ''
    const flowRect = flow.getBoundingClientRect()
    let height = vp.clientHeight
    if (prefs.mode === 'page') {
      for (const block of shadow.querySelectorAll(
        '[data-chat-frontend], img, video, svg, table, .reading-end',
      )) {
        for (const rect of block.getClientRects()) {
          const column = Math.round((rect.left - flowRect.left) / (vp.clientWidth + 48))
          if (column === page) height = Math.max(height, rect.bottom - flowRect.top + 18)
        }
      }
    }
    $('#readingPage').style.height = prefs.mode === 'page' ? Math.ceil(height) + 'px' : ''
    positionLabel()
  }
  function mediaLayoutChanged() {
    if (pageData && !$('#reader').hidden) calculatePages()
  }
  function positionLabel() {
    if (!pageData) return
    $('#readerPosition').textContent =
      `第 ${currentPosition().floor + 1} / ${pageData.total} 楼${prefs.mode === 'page' ? ` · 本段 ${page + 1}/${pages} 页` : ''}`
    $('#prevPage').disabled = page === 0 && pageData.messages[0]?.index === 0
    $('#nextPage').disabled = page === pages - 1 && pageData.nextOffset === null
  }
  function restore(pos) {
    pagePosition = prefs.mode === 'page' ? pos : null
    calculatePages()
    if (!pos) return
    const el = shadow.querySelector(`[data-floor="${pos.floor}"]`)
    if (!el) return
    const vp = $('#readingViewport')
    if (prefs.mode === 'page') {
      const x =
        el.getBoundingClientRect().left -
        vp.getBoundingClientRect().left +
        page * (vp.clientWidth + 48)
      page =
        Math.floor((x + 1) / (vp.clientWidth + 48)) +
        (pos.mode === 'page' ? pos.pageOffset || 0 : 0)
      calculatePages()
      vp.scrollTop = pos.mode === 'page' ? pos.pageScroll || 0 : 0
    } else {
      vp.scrollTop +=
        el.getBoundingClientRect().top - vp.getBoundingClientRect().top + (pos.offset || 0)
    }
    positionLabel()
  }
  function readOptions() {
    return {
      id: chat.id,
      regex: prefs.regex,
      ruleOverrides: roleAppearance?.enabled ? {} : state.ruleOverrides || {},
      profileRuleOverrides: roleAppearance?.enabled ? roleAppearance.rules || {} : {},
      replyOverrides: state.replyOverrides || {},
      blendPanels: prefs.blendPanels,
      panelAppearance: prefs.panelAppearance,
      theme: prefs.theme,
      remote: prefs.renderMode !== 'plain' && prefs.remote,
      textOnly: prefs.renderMode === 'plain',
      userName: state.userName,
    }
  }
  async function read(offset = 0, pos = null) {
    const version = ++readVersion
    run(syncReaderFonts)
    const activeId = chat.id
    $('#readerSubtitle').textContent = '正在读取…'
    const result = await api.resources.readChat({
      ...readOptions(),
      id: activeId,
      offset,
      limit: prefs.progressMode === 'chapters' ? 1 : 3,
      interactive: false,
      prefetch: true,
    })
    if (chat?.id !== activeId || version !== readVersion) return
    pageData = result
    renderPage()
    if (pos?.hash && pos.hash !== result.contentHash) {
      notify('聊天原件已变化，请重新确认阅读位置')
      pos = null
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => {
        if (chat?.id === activeId && version === readVersion) restore(pos)
        resolve()
      }),
    )
    if (chat?.id !== activeId || version !== readVersion) return
    $('#readerSubtitle').textContent =
      boundRole(chat).name +
      ' · ' +
      (prefs.mask
        ? '已隐藏用户身份'
        : prefs.renderMode === 'full'
          ? '完整阅读'
          : prefs.renderMode === 'plain'
            ? '纯净阅读'
            : '精简阅读')
  }
  async function openChat(id) {
    const c = chats.find((c) => c.id === id)
    if (!c) return
    if (!boundRole(c)) {
      bindPanel(c)
      return
    }
    chat = c
    role = boundRole(c).id
    state = await getState(id)
    roleAppearance = (await api.storage.get('appearance:' + role)) || null
    resolveAppearance()
    background = ''
    $('#reader').style.backgroundImage = ''
    $('#reader').style.setProperty('--veil', 0)
    pageData = null
    shadow.innerHTML = '<p>正在读取聊天记录…</p>'
    $('#library').hidden = true
    $('#reader').hidden = false
    await syncNavigation()
    document.body.style.overflow = 'hidden'
    $('#readerTitle').textContent = state.title || chat.name
    toggleChrome(false)
    clearTimeout(toastTimer)
    $('#toast').hidden = true
    try {
      const floor = state.position?.floor || 0
      await read(
        prefs.progressMode === 'chapters' ? floor : Math.floor(floor / 3) * 3,
        state.position,
      )
      indexState.lastChat = id
      await store('reader-index-v1', indexState)
    } catch (e) {
      shadow.innerHTML = ''
      toggleChrome(true)
      throw e
    }
  }
  async function recordPosition() {
    if (!chat || !pageData || $('#reader').hidden) return
    state.position = currentPosition()
    pagePosition = prefs.mode === 'page' ? state.position : null
    await saveState()
  }
  async function leaveReader() {
    readVersion++
    clearTimeout(saveTimer)
    await recordPosition()
    clearPanelFrames()
    $('#reader').hidden = true
    $('#library').hidden = false
    document.body.style.overflow = ''
    $('#sheet').close()
    roleAppearance = null
    resolveAppearance()
    await renderLibrary()
  }
  function toggleChrome(value = !chrome) {
    chrome = value
    $('#reader').classList.toggle('reader-show', chrome)
    $('#reader').classList.toggle('reader-hide', !chrome)
  }
  async function syncNavigation() {
    if (!runtime.builtinReader) return
    await api.ui.setReaderNavigation({
      page: !$('#reader').hidden ? 'reader' : role ? 'chats' : 'roles',
      cover: prefs.characterCover === true,
      colors: Object.fromEntries(
        ['paper', 'ink', 'muted', 'line', 'accent', 'soft'].map((key) => [
          key,
          document.documentElement.style.getPropertyValue('--' + key).trim(),
        ]),
      ),
    })
  }
  async function navigateBack() {
    if ($('#sheet').open) {
      $('#sheet').close()
    } else if (!$('#reader').hidden) {
      await leaveReader()
    } else if (role) {
      role = null
      listLimit = 30
      $('#librarySearch').value = ''
      await renderLibrary()
    } else {
      await api.ui.exitFullscreen()
    }
  }
  async function turn(delta) {
    if (prefs.mode !== 'page') return
    $('#readingViewport').scrollTop = 0
    if (delta > 0 && page === pages - 1 && pageData.nextOffset !== null) {
      await read(pageData.nextOffset)
    } else if (delta < 0 && page === 0 && pageData.messages[0].index > 0) {
      await read(
        Math.max(0, pageData.messages[0].index - (prefs.progressMode === 'chapters' ? 1 : 3)),
      )
      page = pages - 1
      calculatePages()
    } else {
      page = Math.min(pages - 1, Math.max(0, page + delta))
      calculatePages()
    }
    await recordPosition()
  }
  async function jump(floor) {
    if (!Number.isInteger(floor) || floor < 0 || floor >= pageData.total)
      throw Error('楼层超出范围')
    prior = currentPosition()
    $('#sheet').close()
    const pos = { floor, offset: 0 }
    if (pageData.messages.some((e) => e.index === floor)) {
      restore(pos)
    } else await read(prefs.progressMode === 'chapters' ? floor : Math.floor(floor / 3) * 3, pos)
    await recordPosition()
  }
  async function markFloor(floor, quote = '') {
    const entry = pageData.messages.find((e) => e.index === floor)
    if (!entry) return
    const item = {
      floor,
      replyId:
        Array.isArray(entry.message.swipes) && entry.message.swipes.length
          ? Number(entry.message.swipe_id) || 0
          : null,
      quote: masked(quote || entry.message.mes).slice(0, 240),
      hash: pageData.contentHash,
    }
    if (
      state.marks.some(
        (m) => m.floor === floor && m.replyId === item.replyId && m.quote === item.quote,
      )
    ) {
      notify('已经收藏过这里')
      return
    }
    const next = [...state.marks, item]
    if (next.length > 100) throw Error('单份聊天最多保留 100 条收藏，请先整理')
    const updated = { ...state, marks: next }
    await store('chat:' + chat.id, updated)
    Object.assign(state, updated)
    notify('已收藏第 ' + (floor + 1) + ' 楼')
  }
  async function variableReviewPanel(floor) {
    sheet(
      '变量变化回顾',
      '<div id="variableResults"><p class="hint">正在读取已保存的快照…</p></div>',
    )
    const target = $('#variableResults'),
      id = chat.id
    if (!api.resources.chatVariables) throw Error('请更新配套资源库后使用变量变化回顾')
    const result = await api.resources.chatVariables({
      id,
      floor,
      replyOverrides: state.replyOverrides || {},
    })
    if (!target.isConnected || !$('#sheet').open || chat?.id !== id) return
    if (result.contentHash !== pageData.contentHash) throw Error('聊天原件已变化，请重新打开阅读')
    const message =
      result.status === 'missing'
        ? '本楼当前回复没有保存变量快照，无法判断变化。'
        : result.status === 'initial'
          ? '这是此前首次保存的变量快照，没有更早的快照可供比较。'
          : result.status === 'incompatible'
            ? '前后快照类型不同，无法直接比较。'
            : result.truncated
              ? '快照较大，以下仅展示部分比较结果。'
              : result.changes.length
                ? '以下是已保存快照之间的差异。'
                : '两份已保存快照的变量没有变化。'
    target.innerHTML = `<p class="field-label">第 ${floor + 1} 楼 · 回复 ${result.replyId + 1}</p><p class="hint">${message}</p>${result.baseline && result.status !== 'missing' ? `<p class="hint">对比第 ${result.baseline.floor + 1} 楼 · 回复 ${result.baseline.replyId + 1}${result.missingFloors ? `；中间 ${result.missingFloors} 楼未保存快照，变化不能全部归因于本楼` : ''}。</p>` : ''}<div class="button-row"><button class="primary" data-variable-jump="${floor}">回到本楼原文</button>${result.baseline ? `<button class="secondary" data-variable-jump="${result.baseline.floor}">查看对比楼层</button>` : ''}</div><div class="button-row"><button class="secondary" data-variable-floor="${floor - 1}" ${floor === 0 ? 'disabled' : ''}>上一楼</button><button class="secondary" data-variable-floor="${floor + 1}" ${floor + 1 >= result.total ? 'disabled' : ''}>下一楼</button></div><div class="variable-changes">${result.changes.map((change) => `<article class="variable-change"><div class="variable-change-heading"><strong>${esc(masked(change.path))}</strong><span>${{ added: '新增', removed: '移除', changed: '修改' }[change.type]}${typeof change.delta === 'number' ? ` ${change.delta > 0 ? '+' : ''}${change.delta}` : ''}</span></div><div class="variable-value"><small>之前</small><span>${esc(masked(change.before))}</span></div><div class="variable-value"><small>现在</small><span>${esc(masked(change.after))}</span></div></article>`).join('')}</div>`
    $$('[data-variable-floor]').forEach(
      (button) =>
        (button.onclick = () =>
          run(() => variableReviewPanel(Number(button.dataset.variableFloor)))),
    )
    $$('[data-variable-jump]').forEach(
      (button) =>
        (button.onclick = () =>
          run(async () => {
            $('#sheet').close()
            await jump(Number(button.dataset.variableJump))
          })),
    )
  }
  function floorPanel(floor, quote = '') {
    const entry = pageData.messages.find((e) => e.index === floor)
    if (!entry) return
    sheet(
      `第 ${floor + 1} 楼`,
      `<div class="selected-text">${esc(masked(quote || entry.message.mes).slice(0, 800))}</div><div class="button-row"><button class="primary" id="markFloor">${quote ? '收藏选中文字' : '收藏整楼'}</button><button class="secondary" id="variableReview">变量变化回顾</button><button class="secondary" id="fullPreview">${prefs.renderMode === 'full' ? '切回精简阅读' : '原位完整阅读'}</button>${Array.isArray(entry.message.swipes) && entry.message.swipes.length > 1 ? '<button class="secondary" id="floorSwipes">切换回复（' + entry.message.swipes.length + '）</button>' : ''}</div>`,
    )
    $('#markFloor').onclick = () =>
      run(async () => {
        await markFloor(floor, quote)
        $('#sheet').close()
      })
    $('#variableReview').onclick = () => run(() => variableReviewPanel(floor))
    $('#fullPreview').onclick = () =>
      run(() =>
        setReadingMode(prefs.renderMode === 'full' ? 'simple' : 'full', { floor, offset: 0 }),
      )
    if ($('#floorSwipes')) $('#floorSwipes').onclick = () => swipePanel(entry)
  }
  function swipePanel(entry) {
    sheet(
      `第 ${entry.index + 1} 楼 · 切换回复`,
      `<button class="secondary" id="compareReplies">比较两条回复</button><p class="hint">在正文中阅读所选回复及其已保存变量，只改变读了么的阅读选择。</p>${entry.message.swipes.map((s, i) => `<button class="result" data-reply="${i}" data-reply-floor="${entry.index}"><small>回复 ${i + 1}${i === Number(entry.message.swipe_id || 0) ? ' · 正在阅读' : ''}${i === entry.archivedSwipeId ? ' · 归档选中' : ''}</small><span>${esc(masked(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).slice(0, 100))}</span></button>`).join('')}`,
    )
    $('#compareReplies').onclick = () => comparePanel(entry)
  }
  function comparePanel(entry) {
    const options = entry.message.swipes
      .map((_, i) => `<option value="${i}">回复 ${i + 1}</option>`)
      .join('')
    sheet(
      '回复差异',
      `<div class="reply-compare-pickers"><label>原回复<select id="compareFrom">${options}</select></label><label>对比回复<select id="compareTo">${options}</select></label></div><button class="primary" id="runCompare">查看差异</button><p class="hint">按当前正则比较正文，＋为新增，−为删除；不运行状态栏。超长正文比较前 30000 字。</p><div id="replyDiff"></div>`,
    )
    $('#compareFrom').value = String(Number(entry.message.swipe_id) || 0)
    $('#compareTo').value = String(
      (Number(entry.message.swipe_id || 0) + 1) % entry.message.swipes.length,
    )
    $('#runCompare').onclick = () =>
      run(async () => {
        const target = $('#replyDiff')
        target.textContent = '正在比较…'
        const result = await api.resources.readChat({
          ...readOptions(),
          offset: entry.index,
          limit: 1,
          interactive: false,
          compareReplies: [Number($('#compareFrom').value), Number($('#compareTo').value)],
        })
        if (!target.isConnected) return
        const diff = result.replyDiff
        if (!diff) throw Error('请更新配套资源库后使用回复比较')
        target.innerHTML =
          diff.lines
            .map(
              (line) =>
                `<div class="reply-diff ${line.type}"><b>${line.type === 'added' ? '＋' : line.type === 'removed' ? '−' : '·'}</b><span>${esc(masked(line.text))}</span></div>`,
            )
            .join('') || '<p class="hint">这两条回复没有可比较的正文。</p>'
        if (diff.errors.length) notify('部分正则未执行：' + diff.errors.join('；'), true)
      })
  }
  async function setReadingMode(mode, pos = currentPosition()) {
    if (!['plain', 'simple', 'full'].includes(mode)) return
    if (mode === 'full') return enableInteractions(pos)
    prefs.renderMode = mode
    await savePrefs()
    $('#sheet').close()
    await read(pageData.messages[0]?.index || 0, pos)
  }
  function progressTabs() {
    return `<div class="segmented"><button data-progress-mode="jump" class="${prefs.progressMode === 'jump' ? 'active' : ''}">楼层跳转</button><button data-progress-mode="chapters" class="${prefs.progressMode === 'chapters' ? 'active' : ''}">章节目录</button></div>`
  }
  async function chapterPanel(offset = 0) {
    sheet('章节目录', progressTabs() + '<p class="hint">正在读取目录…</p>')
    const id = chat.id
    const result = await api.resources.chatChapters({ id, offset })
    if (!$('#sheet').open || chat?.id !== id || prefs.progressMode !== 'chapters') return
    sheet(
      '章节目录',
      progressTabs() +
        `<div class="results">${result.items.map((item) => `<button class="result" data-jump="${item.floor}"><small>第 ${item.floor + 1} 章 · ${esc(masked(item.name))}${item.replies > 1 ? ' · ' + item.replies + ' 个回复' : ''}</small><span>${esc(masked(item.text))}</span></button>`).join('')}</div><div class="button-row"><button class="secondary" data-chapter-page="${Math.max(0, offset - 50)}" ${offset === 0 ? 'disabled' : ''}>上一页</button><span class="muted">${Math.floor(offset / 50) + 1} / ${Math.max(1, Math.ceil(result.total / 50))}</span><button class="secondary" data-chapter-page="${result.nextOffset || 0}" ${result.nextOffset === null ? 'disabled' : ''}>下一页</button></div>`,
    )
  }
  async function libraryStylePanel(offset = 0) {
    sheet('选择资源库美化', '<p class="hint">正在读取…</p>')
    const result = await api.resources.list({ types: ['beautification'], offset, limit: 25 })
    if (!$('#sheet').open) return
    sheet(
      '选择资源库美化',
      `<div class="results">${result.items.map((item) => `<button class="result" data-library-style="${esc(item.id)}"><span>${esc(item.name)}</span><small>${esc(item.description || '')}</small></button>`).join('') || '<p class="hint">资源库中还没有美化，可先导入 CSS 或酒馆主题 JSON。</p>'}</div><div class="button-row"><button class="secondary" data-style-page="${Math.max(0, offset - 25)}" ${offset === 0 ? 'disabled' : ''}>上一页</button><button class="secondary" data-style-page="${result.nextOffset || 0}" ${result.nextOffset === null ? 'disabled' : ''}>下一页</button></div>`,
    )
  }

  function regexPanel() {
    const rules = pageData?.regexRules || []
    sheet(
      '显示正则',
      `<p class="hint">按全局 → 预设 → 角色卡顺序执行。默认沿用导出时的开关；${roleAppearance?.enabled ? '更改保存到角色专属方案，仅复用于内容一致的规则。' : '更改只影响这份聊天。'}只列出显示正则，不重跑写入正文或仅发送给模型的规则。</p>${pageData?.presetName ? `<p class="hint">导出时所选预设：${esc(pageData.presetName)}（不代表聊天当时的预设）</p>` : ''}${[
        'global',
        'preset',
        'character',
      ]
        .map(
          (scope) =>
            `<details open><summary>${{ global: '全局', preset: '预设', character: '角色卡' }[scope]}</summary>${
              rules
                .filter((r) => r.scope === scope)
                .map(
                  (r) =>
                    `<div class="setting-row"><label for="rule-${esc(r.key)}">${esc(r.name)}</label><input id="rule-${esc(r.key)}" type="checkbox" data-rule="${esc(r.key)}" ${r.enabled ? 'checked' : ''}></div>`,
                )
                .join('') || '<p class="hint">未随附显示规则</p>'
            }</details>`,
        )
        .join(
          '',
        )}<div class="button-row"><button class="secondary" id="resetRules">恢复导出时开关</button><button class="primary" id="applyRules">应用</button></div>`,
    )
    const apply = async (overrides) => {
      const pos = currentPosition()
      if (roleAppearance?.enabled) {
        const saved = { ...roleAppearance.rules }
        for (const rule of rules)
          if (rule.signature) {
            if (typeof overrides[rule.key] === 'boolean')
              saved[rule.signature] = overrides[rule.key]
            else delete saved[rule.signature]
          }
        roleAppearance.rules = saved
        await store('appearance:' + role, roleAppearance)
      } else {
        state.ruleOverrides = overrides
        await saveState()
      }
      $('#sheet').close()
      await read(pageData.messages[0]?.index || 0, pos)
      notify(roleAppearance?.enabled ? '角色专属正则方案已更新' : '此聊天的显示正则已更新')
    }
    $('#applyRules').onclick = () =>
      run(() =>
        apply(Object.fromEntries($$('[data-rule]').map((el) => [el.dataset.rule, el.checked]))),
      )
    $('#resetRules').onclick = () => run(() => apply({}))
  }
  async function panel(name) {
    if (!pageData && name !== 'display' && name !== 'appearance') return
    if (name === 'progress') {
      if (prefs.progressMode === 'chapters')
        return chapterPanel(Math.floor(currentPosition().floor / 50) * 50)
      sheet(
        '阅读进度',
        `${progressTabs()}<label class="field-label">共 ${pageData.total} 楼</label><input id="floorNumber" class="searchbox" type="number" min="1" max="${pageData.total}" value="${currentPosition().floor + 1}" aria-label="跳转楼层"><div class="button-row"><button class="secondary" id="top">回到开头</button><button class="primary" id="jump">跳转</button><button class="secondary" id="bottom">回到末楼</button></div>${prior ? '<button class="text-button" id="prior">返回刚才的位置</button>' : ''}`,
      )
      $('#jump').onclick = () => run(() => jump(Number($('#floorNumber').value) - 1))
      $('#top').onclick = () => run(() => jump(0))
      $('#bottom').onclick = () => run(() => jump(pageData.total - 1))
      if ($('#prior'))
        $('#prior').onclick = () =>
          run(async () => {
            const p = prior
            await jump(p.floor)
            restore(p)
          })
    } else if (name === 'bookmarks') {
      sheet(
        '收藏与摘录',
        `<button class="secondary" id="markCurrent">收藏当前楼层</button><div class="results">${state.marks.map((m, i) => `<div class="floor-picker"><button data-mark-jump="${i}"><span class="muted">第 ${m.floor + 1} 楼${Number.isInteger(m.replyId) ? ` · 回复 ${m.replyId + 1}` : m.replyId === null ? '' : ' · 旧收藏'}${m.hash !== pageData.contentHash ? ' · 原文已变化' : ''}</span><br>${esc(masked(m.quote))}</button><button class="icon" data-unmark="${i}" aria-label="取消收藏">${icon('close')}</button></div>`).join('') || '<p class="empty">长按正文，把想重读的那一楼留在这里。</p>'}</div>`,
      )
      $('#markCurrent').onclick = () =>
        run(async () => {
          await markFloor(currentPosition().floor)
          await panel('bookmarks')
        })
    } else if (name === 'search') {
      sheet(
        '查找正文',
        '<input id="textSearch" class="searchbox" placeholder="输入关键词" aria-label="搜索正文"><div class="button-row"><button id="runSearch" class="primary">搜索整份聊天</button></div><div id="searchResults" class="results"></div>',
      )
      $('#runSearch').onclick = () =>
        run(async () => {
          const q = $('#textSearch').value.trim()
          if (!q) return
          const token = ++searchVersion
          const id = chat.id
          $('#searchResults').textContent = '正在分段搜索…'
          const result = await api.resources.searchChat({ id, query: q })
          if (token !== searchVersion || !$('#sheet').open) return
          const results = result.results.map((r) => ({ ...r, text: masked(r.text) }))
          const offset = result.nextOffset
          $('#searchResults').innerHTML =
            results
              .map(
                (r) =>
                  `<button class="result" data-jump="${r.floor}"><small>第 ${r.floor + 1} 楼</small><span>${esc(r.text)}</span></button>`,
              )
              .join('') || '<p class="empty">未找到匹配内容</p>'
          if (offset !== null)
            $('#searchResults').insertAdjacentHTML(
              'beforeend',
              '<p class="hint">先显示前 100 个结果，请缩小关键词范围。</p>',
            )
        })
    } else if (name === 'display') {
      const segments = (key, items) =>
        `<div class="segmented">${items.map(([v, t]) => `<button data-setting="${key}" data-value="${v}" class="${prefs[key] === v ? 'active' : ''}">${t}</button>`).join('')}</div>`
      sheet(
        '阅读显示',
        `<label class="field-label">阅读方式</label>${segments('mode', [
          ['scroll', '上下滚动'],
          ['page', '左右翻页'],
        ])}<label class="field-label">阅读效果</label><div class="segmented"><button data-reading-mode="plain" class="${prefs.renderMode === 'plain' ? 'active' : ''}">纯净</button><button data-reading-mode="simple" class="${prefs.renderMode === 'simple' ? 'active' : ''}">精简</button><button data-reading-mode="full" class="${prefs.renderMode === 'full' ? 'active' : ''}">完整</button></div><label class="field-label">排版</label>${segments(
          'layout',
          [
            ['novel', '小说排版'],
            ['tavern', '酒馆排版'],
          ],
        )}${[
          ['regex', '启用显示正则'],

          ['remote', '允许远程图片与媒体'],
          ['blendPanels', '状态栏背景融入阅读页'],
          ['hideUser', '只看角色回复'],
          ['mask', '隐藏用户身份'],
        ]
          .map(
            ([k, t]) =>
              `<div class="setting-row"><label for="opt-${k}">${t}</label><input type="checkbox" id="opt-${k}" data-option="${k}" ${prefs[k] ? 'checked' : ''}></div>`,
          )
          .join(
            '',
          )}<p class="hint">纯净只读正文，不加载 HTML 状态栏与媒体；精简显示静态状态栏；完整支持展开和切换。显示正则包含角色卡规则及互传随附的全局规则。隐藏身份时自动使用精简模式。</p><button class="secondary" id="regexRules">管理显示正则</button><details class="identity-settings"><summary>用户名称与打码</summary><div class="identity-form"><p class="hint">自动识别聊天中的用户名，也可补充别称。只改变阅读显示。</p><label class="identity-field"><span>人设名称</span><input id="userName" class="searchbox" value="${esc(state.userName)}" placeholder="识别不准确时填写" aria-label="用户人设名称"></label><label class="identity-field"><span>额外打码词</span><textarea id="maskWords" rows="3" placeholder="每行一个名字或别称">${esc(prefs.words)}</textarea></label><div class="identity-actions"><label class="identity-field"><span>替换文字</span><input id="replacement" class="searchbox" value="${esc(prefs.replacement)}" placeholder="例如：某某" aria-label="打码替换词"></label><button class="primary" id="saveMask">保存设置</button></div></div></details>`,
      )
      $$('[data-option]').forEach(
        (el) =>
          (el.onchange = () =>
            run(async () => {
              const key = el.dataset.option
              if (key === 'remote' && el.checked && !runtime.network) {
                el.checked = false
                throw Error('请在扩展管理中使用兼容模式打开，以允许 HTTPS 图片和媒体')
              }
              prefs[key] = el.checked
              await savePrefs()
              const pos = pageData ? currentPosition() : state.position
              await read(pageData?.messages[0]?.index || 0, pos)
            })),
      )
      $('#regexRules').onclick = () => regexPanel()
      $('#saveMask').onclick = () =>
        run(async () => {
          state.userName = $('#userName').value.trim()
          await saveState()
          prefs.words = $('#maskWords').value
          prefs.replacement = $('#replacement').value || '某某'
          await savePrefs()
          const pos = pageData ? currentPosition() : null
          await read(pageData?.messages[0]?.index || 0, pos)
          notify('身份显示设置已保存')
        })
    } else if (name === 'appearance') {
      pendingStyleId = prefs.styleId || ''
      sheet(
        '阅读外观',
        `<div class="setting-row"><label for="appearanceScope">外观配置</label><select id="appearanceScope"><option value="default">跟随默认外观</option><option value="character">角色专属外观</option></select></div><p class="hint">${roleAppearance?.enabled ? `正在调整「${esc(boundRole(chat).name)}」的外观与正则方案，同角色聊天共用。` : '正在调整默认外观，所有跟随默认的角色共用；正则开关仍按聊天保存。'}</p><div class="setting-row"><label for="panelAppearance">状态栏配色</label><select id="panelAppearance"><option value="author">保留作者配色</option><option value="reader">融入阅读主题</option></select></div><p class="hint">正文独立排版；融合模式统一文字与面板配色，简化背景和阴影；图片元素不改色。</p><div class="themes">${[
          ['paper', '纸', '#f6f3ec'],
          ['green', '绿', '#e8eddf'],
          ['night', '夜', '#202622'],
        ]
          .map(
            ([v, t, b]) =>
              `<button class="swatch ${prefs.theme === v ? 'active' : ''}" data-theme="${v}" style="background:${b};color:${v === 'night' ? '#d0d3c6' : '#303a32'}">${t}</button>`,
          )
          .join(
            '',
          )}</div><div class="setting-row"><span>文字大小</span><div class="stepper"><button id="fontMinus">−</button><span id="fontValue">${prefs.font}px</span><button id="fontPlus">＋</button></div></div><div class="setting-row"><label for="lineRange">行间距</label><input id="lineRange" type="range" min="1.5" max="2.5" step=".05" value="${prefs.leading}"></div><div class="button-row"><button class="secondary" id="pickBg">选择阅读背景</button><button class="secondary" id="clearBg">移除背景</button></div><p class="hint">图片背景仅本次有效。为保持文字可读，自动叠加纸色遮罩。</p><details><summary>自定义 CSS / 导入美化</summary><p class="hint">样式仅作用正文，不影响返回和设置。支持 CSS 与含 custom_css 的主题 JSON；酒馆整套界面选择器不保证直接兼容。</p><textarea class="code" id="cssInput" aria-label="正文 CSS">${esc(prefs.css)}</textarea><div class="button-row"><button class="secondary" id="libraryCss">资源库美化</button><button class="secondary" id="importCss">导入文件</button><button class="primary" id="applyCss">应用 CSS</button></div></details><div class="button-row"><button class="secondary" id="appearanceRules">正则方案</button><button class="text-button" id="resetAppearance">${roleAppearance?.values ? '重置角色外观' : '恢复初始外观'}</button></div>`,
      )
      $('#appearanceScope').value = roleAppearance?.enabled ? 'character' : 'default'
      $('#appearanceScope').onchange = (event) =>
        run(() => changeAppearanceMode(event.target.value === 'character'))
      $('#appearanceRules').onclick = () => regexPanel()
      $('#panelAppearance').value = prefs.panelAppearance || 'author'
      $('#panelAppearance').onchange = (event) =>
        run(async () => {
          const pos = currentPosition()
          prefs.panelAppearance = event.target.value
          await savePrefs()
          await read(pageData.messages[0]?.index || 0, pos)
        })
      const update = async (change, rebuild = false) => {
        const pos = pageData ? currentPosition() : null
        change()
        applyPrefs()
        if (pageData) {
          if (rebuild) renderPage()
          restore(pos)
        }
        await savePrefs()
      }
      $('#fontMinus').onclick = () =>
        run(async () => {
          await update(() => (prefs.font = Math.max(14, prefs.font - 1)))
          $('#fontValue').textContent = prefs.font + 'px'
        })
      $('#fontPlus').onclick = () =>
        run(async () => {
          await update(() => (prefs.font = Math.min(30, prefs.font + 1)))
          $('#fontValue').textContent = prefs.font + 'px'
        })
      $('#lineRange').onchange = (e) =>
        run(() => update(() => (prefs.leading = Number(e.target.value))))
      $('#pickBg').onclick = () => $('#backgroundFile').click()
      $('#clearBg').onclick = () => {
        background = ''
        $('#reader').style.backgroundImage = ''
        $('#reader').style.setProperty('--veil', 0)
      }
      $('#libraryCss').onclick = () => run(() => libraryStylePanel())
      $('#importCss').onclick = () => $('#cssFile').click()
      $('#applyCss').onclick = () =>
        run(async () => {
          const css = $('#cssInput').value
          if (css.length > 30000) throw Error('正文 CSS 请控制在 30000 字符以内')
          await update(() => {
            prefs.css = css
            prefs.styleId = pendingStyleId
          }, true)
          run(syncReaderFonts)
          notify('CSS 已应用')
        })
      $('#resetAppearance').onclick = () =>
        run(async () => {
          if (roleAppearance?.values) return changeAppearanceMode(false, true)
          await update(() =>
            Object.assign(prefs, {
              font: 18,
              leading: 1.85,
              theme: 'paper',
              css: '',
              styleId: '',
              panelAppearance: 'author',
            }),
          )
          if (pageData) await read(pageData.messages[0]?.index || 0, currentPosition())
          background = ''
          $('#reader').style.backgroundImage = ''
          $('#reader').style.setProperty('--veil', 0)
          await panel('appearance')
        })
    }
  }
  function dataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(Error('文件读取失败'))
      reader.readAsDataURL(blob)
    })
  }
  function longPress(target, selector, handler) {
    let start
    const cancel = () => clearTimeout(holdTimer)
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const node = e.target.closest(selector)
      if (
        !node ||
        e.composedPath().some((el) => el?.matches?.('a,input,textarea,summary,select')) ||
        (target === shadow && e.composedPath().some((el) => el?.matches?.('button')))
      )
        return
      start = { x: e.clientX, y: e.clientY }
      cancel()
      holdTimer = setTimeout(() => {
        suppress = true
        run(() => handler(node))
      }, 550)
    })
    target.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 9) cancel()
    })
    for (const name of ['pointerup', 'pointercancel', 'pointerleave'])
      target.addEventListener(name, cancel)
    target.addEventListener('contextmenu', (e) => {
      const node = e.target.closest(selector)
      if (node) {
        e.preventDefault()
        cancel()
        run(() => handler(node))
      }
    })
  }
  $('#brand').innerHTML = icon('book')
  for (const [id, name] of [
    ['libraryBack', 'back'],
    ['searchToggle', 'search'],
    ['characterCover', 'image'],
    ['sheetClose', 'close'],
    ['readerMenu', 'menu'],
    ['readerBack', 'back'],
    ['readerMore', 'more'],
    ['readerFullscreen', 'full'],
    ['prevPage', 'back'],
    ['nextPage', 'next'],
  ])
    $('#' + id).innerHTML = icon(name)
  for (const [name, ic, text] of [
    ['progress', 'progress', '进度'],
    ['search', 'search', '查找'],
    ['bookmarks', 'bookmark', '收藏'],
    ['display', 'sliders', '显示'],
    ['appearance', 'sun', '外观'],
  ])
    $(`[data-panel="${name}"]`).innerHTML = icon(ic) + text
  $('#libraryContent').onclick = (e) =>
    run(async () => {
      if (suppress) {
        suppress = false
        return
      }
      const t = e.target.closest('button')
      if (!t) return
      if (t.dataset.chat) await openChat(t.dataset.chat)
      else if (t.dataset.role) await selectRole(t.dataset.role)
      else if (t.dataset.note) await notePanel(t.dataset.note)
      else if (t.dataset.action === 'refresh') await refresh()
      else if (t.dataset.action === 'moreList') {
        listLimit += 30
        await renderLibrary()
      }
    })
  $('#libraryBack').onclick = () => run(navigateBack)
  window.addEventListener('srlappnavigation', (event) => {
    if (!runtime.builtinReader) return
    if (event.detail === 'back') run(navigateBack)
    if (event.detail === 'search') $('#searchToggle').click()
    if (event.detail === 'cover') $('#characterCover').click()
  })
  window.addEventListener('srlappback', (event) => {
    if (!runtime.builtinReader) return
    event.preventDefault()
    run(navigateBack)
  })
  $('#librarySearch').oninput = () => run(renderLibrary)
  $('#searchToggle').onclick = () => {
    $('#librarySearchWrap').hidden = !$('#librarySearchWrap').hidden
    if (!$('#librarySearchWrap').hidden) $('#librarySearch').focus()
  }
  $('#characterCover').onclick = () =>
    run(async () => {
      prefs.characterCover = !prefs.characterCover
      applyCharacterCover()
      await syncNavigation()
      await savePrefs()
    })
  $('#aboutBtn').onclick = () =>
    sheet(
      '关于读了么',
      '<p>从资源库读取聊天记录，按明确绑定的角色卡整理。</p><p class="hint">导入入口在资源库。备份时选择“聊天记录”和“读了么阅读数据”，保留聊天、配套资源以及备注、收藏、进度和外观。卸载 APP 默认保留阅读数据。</p><p class="hint">支持 JSONL / 严格 JSON 聊天。纯净模式只读正文；精简模式显示静态状态栏；完整模式原位交互，只读取已保存变量，不补猜历史。</p><button class="secondary" id="refreshAbout">刷新资源库</button>',
    )
  $('#sheetClose').onclick = () => $('#sheet').close()
  // Only suppress the compatibility click belonging to the hold/swipe, never a new gesture.
  document.addEventListener(
    'pointerdown',
    () => {
      suppress = false
    },
    true,
  )
  $('#sheet').addEventListener('close', () => {
    suppress = false
    searchVersion++
  })
  $('#sheet').addEventListener('click', (e) => {
    if (suppress) {
      suppress = false
      return
    }
    if (e.target === $('#sheet')) {
      const r = $('#sheet').getBoundingClientRect()
      if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right) $('#sheet').close()
    }
  })
  $('#sheetBody').onclick = (e) =>
    run(async () => {
      const t = e.target.closest('button')
      if (!t) return
      if (t.dataset.readingMode) {
        if (t.dataset.readingMode !== prefs.renderMode) await setReadingMode(t.dataset.readingMode)
      }
      if (t.dataset.progressMode) {
        const controls = $('#sheetBody').firstElementChild
        const pos = currentPosition()
        prefs.progressMode = t.dataset.progressMode
        await savePrefs()
        await read(
          prefs.progressMode === 'chapters' ? pos.floor : Math.floor(pos.floor / 3) * 3,
          pos,
        )
        if ($('#sheet').open && controls?.isConnected) await panel('progress')
      }
      if (t.dataset.chapterPage !== undefined) await chapterPanel(Number(t.dataset.chapterPage))
      if (t.dataset.stylePage !== undefined) await libraryStylePanel(Number(t.dataset.stylePage))
      if (t.dataset.libraryStyle) {
        const selected = await api.resources.readerStyle(t.dataset.libraryStyle)
        if (!selected.css.trim()) throw Error('这份美化没有可识别的聊天区域 CSS')
        await panel('appearance')
        pendingStyleId = t.dataset.libraryStyle
        $('#cssInput').value = selected.css
        $('#cssInput').closest('details').open = true
        notify('已提取“' + selected.name + '”的聊天样式，点击应用 CSS')
      }
      if (t.dataset.reply !== undefined) {
        const floor = Number(t.dataset.replyFloor)
        state.replyOverrides = { ...state.replyOverrides, [floor]: Number(t.dataset.reply) }
        await saveState()
        $('#sheet').close()
        await read(pageData.messages[0]?.index || 0, { floor, offset: 0 })
        notify('正在阅读回复 ' + (Number(t.dataset.reply) + 1))
      }
      if (t.id === 'refreshAbout') {
        $('#sheet').close()
        await refresh()
      }
      if (t.dataset.jump !== undefined) await jump(Number(t.dataset.jump))
      if (t.dataset.setting) {
        if (prefs[t.dataset.setting] === t.dataset.value) return
        const controls = $('#sheetBody').firstElementChild
        const pos = pageData ? currentPosition() : null
        prefs[t.dataset.setting] = t.dataset.value
        if (pageData) {
          renderPage()
          restore(pos)
        }
        await savePrefs()
        if ($('#sheet').open && controls?.isConnected) await panel('display')
      }
      if (t.dataset.theme) {
        const controls = $('#sheetBody').firstElementChild
        const pos = pageData ? currentPosition() : null
        prefs.theme = t.dataset.theme
        applyPrefs()
        if (pageData) await read(pageData.messages[0]?.index || 0, pos)
        await savePrefs()
        if ($('#sheet').open && controls?.isConnected) await panel('appearance')
      }
      if (t.dataset.unmark !== undefined) {
        state.marks.splice(Number(t.dataset.unmark), 1)
        await saveState()
        await panel('bookmarks')
      }
      if (t.dataset.markJump !== undefined) {
        const m = state.marks[Number(t.dataset.markJump)]
        if (m.hash !== pageData.contentHash) {
          notify('原文已变化，保留摘录但不自动跳到可能错误的楼层')
          return
        }
        if (Number.isInteger(m.replyId)) {
          state.replyOverrides = { ...state.replyOverrides, [m.floor]: m.replyId }
          await saveState()
          $('#sheet').close()
          await read(prefs.progressMode === 'chapters' ? m.floor : Math.floor(m.floor / 3) * 3, {
            floor: m.floor,
            offset: 0,
          })
        } else await jump(m.floor)
      }
    })
  $('#readerBack').onclick = () => run(leaveReader)
  $('#readerMenu').onclick = () => toggleChrome(true)
  $('#readerPosition').onclick = () => run(() => panel('progress'))
  $('#readerMore').onclick = () =>
    floorPanel(currentPosition().floor, window.getSelection()?.toString() || '')
  $('#readerFullscreen').onclick = () => run(() => api.ui.exitFullscreen())
  $$('[data-panel]').forEach((b) => (b.onclick = () => run(() => panel(b.dataset.panel))))
  $('#prevPage').onclick = () => run(() => turn(-1))
  $('#nextPage').onclick = () => run(() => turn(1))
  longPress($('#libraryContent'), '.chat-open', (el) => notePanel(el.dataset.chat))
  longPress(shadow, '[data-floor]', (el) =>
    floorPanel(Number(el.dataset.floor), window.getSelection()?.toString() || ''),
  )
  shadow.addEventListener('load', mediaLayoutChanged, true)
  shadow.addEventListener('click', (e) => {
    const interactive = e
      .composedPath()
      .some((el) => el?.matches?.('a,summary,input,textarea,button,select'))
    run(async () => {
      if (suppress) {
        suppress = false
        return
      }
      const t = e.target.closest('button')
      if (t?.dataset.batch) {
        const offset =
          t.dataset.batch === 'next'
            ? pageData.nextOffset
            : Math.max(0, pageData.messages[0].index - (prefs.progressMode === 'chapters' ? 1 : 3))
        if (offset !== null) {
          await read(offset)
          await recordPosition()
        }
      } else if (!interactive && !window.getSelection()?.toString()) toggleChrome()
    })
  })
  let down
  $('#readingViewport').addEventListener('pointerdown', (e) => {
    down = {
      x: e.clientX,
      y: e.clientY,
      blocked: e.composedPath().some((el) => el?.matches?.('button,a,input,summary,table')),
    }
  })
  $('#readingViewport').addEventListener('pointerup', (e) => {
    if (!down) return
    const d = down
    down = null
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y
    if (
      !d.blocked &&
      prefs.mode === 'page' &&
      Math.abs(dx) > 55 &&
      Math.abs(dx) > Math.abs(dy) * 1.4 &&
      !window.getSelection()?.toString()
    ) {
      suppress = true
      run(() => turn(dx < 0 ? 1 : -1))
    }
  })
  $('#readingViewport').addEventListener(
    'scroll',
    () => {
      positionLabel()
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => run(recordPosition), 600)
    },
    { passive: true },
  )
  $('#backgroundFile').onchange = (e) =>
    run(async () => {
      const f = e.target.files[0]
      if (!f) return
      if (f.size > 2 * 1024 * 1024) throw Error('背景图片请控制在 2 MiB 以内')
      background = await dataUrl(f)
      $('#reader').style.backgroundImage = `url("${background}")`
      $('#reader').style.setProperty('--veil', 0.85)
      e.target.value = ''
    })
  $('#cssFile').onchange = (e) =>
    run(async () => {
      const f = e.target.files[0]
      if (!f) return
      if (f.size > 50000) throw Error('美化文件过大')
      let source = await f.text()
      if (f.name.endsWith('.json')) {
        const obj = JSON.parse(source)
        if (typeof obj.custom_css !== 'string') throw Error('主题 JSON 缺少 custom_css')
        source = obj.custom_css
      }
      $('#cssInput').value = source
      pendingStyleId = ''
      e.target.value = ''
      notify('已载入，请点击应用 CSS')
    })
  document.addEventListener('keydown', (e) => {
    if ($('#reader').hidden || $('#sheet').open || e.target.matches('input,textarea')) return
    if (e.key === 'ArrowLeft') run(() => turn(-1))
    if (e.key === 'ArrowRight') run(() => turn(1))
    if (e.key === 'Escape') toggleChrome(false)
  })
  let size = ''
  new ResizeObserver(() => {
    if (!pageData || $('#reader').hidden) return
    const vp = $('#readingViewport'),
      next = vp.clientWidth + 'x' + vp.clientHeight
    if (next === size) return
    size = next
    const pos = pagePosition || state.position
    requestAnimationFrame(() => (pos ? restore(pos) : calculatePages()))
  }).observe($('#readingViewport'))
  Promise.resolve()
    .then(async () => {
      if (!api) throw Error('请将读了么安装包导入资源库的“扩展”，不能作为普通网页单独打开')
      await api.ready()
      if (!api.resources.readChat)
        throw Error('资源库尚未支持聊天记录接口，请先使用本分支构建的测试版本')
      const capabilities = await api.capabilities()
      runtime = capabilities.runtime || {}
      document.documentElement.classList.toggle('builtin-shell', runtime.builtinReader === true)
      $('#readerFullscreen').hidden = runtime.builtinReader === true
      const savedPrefs = (await api.storage.get('preferences-v1')) || {}
      defaultPrefs = {
        ...defaultPrefs,
        ...savedPrefs,
        renderMode: ['plain', 'simple', 'full'].includes(savedPrefs.renderMode)
          ? savedPrefs.renderMode
          : savedPrefs.interactive
            ? 'full'
            : 'simple',
      }
      delete defaultPrefs.interactive
      prefs = { ...defaultPrefs }
      indexState = (await api.storage.get('reader-index-v1')) || {}
      bodyStyles = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
      applyPrefs()
      await refresh()
    })
    .catch((error) => {
      loading(error.message)
      notify(error.message, true)
    })
})()
