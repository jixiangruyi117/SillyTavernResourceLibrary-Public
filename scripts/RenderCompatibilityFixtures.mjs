/* global document, window */
export const createRenderCompatibilityFixtures = async () => {
  const [previewModule, vendorModule, mvuModule] = await Promise.all([
    import('/src/utils/RichContentPreview.ts'),
    import('/src/utils/PreviewVendorLibs.ts'),
    import('/src/utils/RenderCompatibilityMvu.ts'),
  ])
  const { buildRenderCompatibilitySwipeMarkup, buildRichContentPreview } = previewModule
  const vendorLibs = await vendorModule.loadPreviewVendorLibs({
    fontAwesome: true,
    jquery: true,
    jqueryUi: true,
    jqueryUiTouchPunch: true,
    lodash: true,
    showdown: true,
    tailwind: true,
    toastr: true,
    vue: true,
    vueRouter: true,
    yamlAndZod: true,
  })
  const vendorCases = {}
  for (const [name, sources] of Object.entries({
    pureVue: ['Vue.createApp({}).mount("#app")'],
    draggable: ['$("#panel").draggable()'],
    fontAwesome: ['<i class="fa-solid fa-star"></i>'],
  })) {
    const needs = vendorModule.mergePreviewVendorLibNeeds(sources)
    const libs = await vendorModule.loadPreviewVendorLibs(needs)
    vendorCases[name] = {
      loaded: vendorModule.loadedPreviewVendorNames(libs),
      needs,
    }
  }
  const mvuCharacterData = {
    extensions: { tavern_helper: { variables: { characterSeed: 'character' } } },
    character_book: {
      entries: [{ comment: '[initvar] audit base', content: 'hp: 1\nlabel: base' }],
    },
  }
  const mvuGreetings = [
    `<initvar>
$meta:
  extensible: true
  required: [requiredKey]
hp: 10
requiredKey: 1
optionalKey: 2
bag:
  $meta: { extensible: true }
  old: 1
list:
  - { $arrayMeta: true, $meta: { extensible: true } }
  - a
  - b
</initvar>
<UpdateVariable>
_.assign("bag", "new", 3);
_.insert("list", 1, "x");
_.remove("optionalKey");
_.unset("list", "a");
_.delete("requiredKey");
</UpdateVariable>`,
    '<initvar>\nhp: 20\n</initvar>',
  ]
  const mvuState = mvuModule.buildRenderCompatibilityMvuPreviewState({
    characterData: mvuCharacterData,
    greetings: mvuGreetings,
    charName: '审计角色',
  })
  const trusted = { allowRemoteResources: false, allowScripts: true }
  const safe = { allowRemoteResources: false, allowScripts: false }
  const frontend = (body) => `\`\`\`html\n<html><body>${body}</body></html>\n\`\`\``
  const lifecycleGreetings = [
    frontend('<main id="lifecycle-opening">开场 A</main>'),
    frontend('<main id="lifecycle-opening">开场 B</main>'),
  ]
  const navigationGreetings = [
    frontend(
      '<a id="navigate-opening" href="javascript:void(0)" onclick="setChatMessages([{message_id:0,swipe_id:1}])"><span>下一条</span></a><p id="navigation-opening">开场 A</p>',
    ),
    frontend('<p id="navigation-opening">开场 B</p>'),
  ]
  const carouselImage =
    'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20300%20400%22%3E%3Cdefs%3E%3ClinearGradient%20id=%22g%22%20x2=%221%22%20y2=%221%22%3E%3Cstop%20stop-color=%22%232e3548%22/%3E%3Cstop%20offset=%221%22%20stop-color=%22%23d9a7b8%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width=%22300%22%20height=%22400%22%20fill=%22url(%23g)%22/%3E%3Ccircle%20cx=%22150%22%20cy=%22130%22%20r=%2264%22%20fill=%22%23f6d9d1%22/%3E%3Cpath%20d=%22M54%20400c8-105%2045-158%2096-158s88%2053%2096%20158%22%20fill=%22%231b2233%22/%3E%3C/svg%3E'
  const previews = {
    short: buildRichContentPreview(
      frontend('<article id="short">短内容</article>'),
      'short',
      trusted,
      [],
      {
        renderShell: 'content',
        greetingContents: ['一', '二'],
      },
    ),
    viewport: buildRichContentPreview(
      frontend(`<style>#viewport{min-height:100vh}#viewport-inline,#viewport-script{position:absolute;inset:0 auto auto 0}</style>
<main id="viewport">viewport</main>
<aside id="viewport-inline" style="min-height:50vh">inline</aside>
<section id="viewport-script">script</section>
<script>document.querySelector('#viewport-script').style.minHeight='25vh';</script>`),
      'viewport',
      trusted,
      [],
      { renderShell: 'content' },
    ),
    fixed: buildRichContentPreview(
      frontend('<main id="fixed" style="position:fixed;inset:0">fixed</main>'),
      'fixed',
      trusted,
      [],
      { renderShell: 'content' },
    ),
    nativeViewport: buildRichContentPreview(
      frontend(`<main id="native-viewport" style="position:relative;height:200px">
<div id="native-height" style="position:absolute;height:50vh"></div>
<div id="native-max-height" style="position:absolute;height:180px;max-height:25vh"></div>
<div id="native-dvh" style="position:absolute;min-height:10dvh"></div>
<div id="native-svh" style="position:absolute;min-height:10svh"></div>
<div id="native-lvh" style="position:absolute;min-height:10lvh"></div>
</main>`),
      'native-viewport',
      trusted,
      [],
      { renderShell: 'content' },
    ),
    carousel: buildRichContentPreview(
      frontend(`<style>
html{background:#eefafa}body{background:#f8ffff;color:#4b3a3a;font-family:system-ui,sans-serif}
.carousel-shell{width:100%;overflow:hidden;padding:28px 0 40px}
.carousel-track{display:flex;align-items:flex-start;gap:18px;width:max-content;transform:translateX(calc((100vw - min(68vw,310px))/2 - min(68vw,310px) - 18px))}
.person-card{flex:0 0 min(68vw,310px);overflow:hidden;border:2px solid #efc8d4;border-radius:28px;background:#fff;box-shadow:0 12px 30px rgba(144,91,112,.14)}
.person-card--side{transform:scale(.9);transform-origin:top center}
.person-card--center{transform:translateY(14px)}
.person-card img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover}
.person-card__body{padding:18px 20px 24px}.person-card h2{margin:8px 0 12px;font-size:28px}.person-card p{margin:8px 0;line-height:1.65}
@media(max-width:430px){.carousel-shell{padding-top:18px}.carousel-track{gap:12px;transform:translateX(calc((100vw - 72vw)/2 - 72vw - 12px))}.person-card{flex-basis:72vw;border-radius:22px}.person-card__body{padding:16px 18px 22px}}
</style>
<section class="carousel-shell" aria-label="人物卡横向轮播"><div class="carousel-track">
<article class="person-card person-card--side"><img src="${carouselImage}" alt="侧边人物一"><div class="person-card__body"><h2>临川</h2><p>沉静、敏锐。</p></div></article>
<article class="person-card person-card--center"><img src="${carouselImage}" alt="中间人物"><div class="person-card__body"><h2>司洛</h2><p>生日 2001 年 12 月 15 日</p><p>性格慵懒、随性，偶尔锋利，但会认真守住同伴的边界。</p><p>中间卡片刻意高于两侧，用于验证 transform 与 overflow 下的稳定测高。</p></div></article>
<article class="person-card person-card--side"><img src="${carouselImage}" alt="侧边人物二"><div class="person-card__body"><h2>鹿言</h2><p>温柔、从容。</p></div></article>
</div></section>`),
      'carousel',
      trusted,
      [],
      { renderShell: 'content' },
    ),
    api: buildRichContentPreview(
      frontend(`<main id="api" class="flex"><i id="api-icon" class="fa-solid fa-star"></i>api</main><script>
window.addEventListener('load',async()=>{try{
  const directMvu=window.Mvu;
  await waitGlobalInitialized('auditShared');
  await waitGlobalInitialized('Mvu');
  const shared=window.auditShared;
  const mvu=window.Mvu;
  const wrappedValue=errorCatched(value=>value+1)(1);
  let wrappedAsync=false;
  await TavernHelper.errorCatched(async()=>{await Promise.resolve();wrappedAsync=true})();
  const originalToastrError=window.toastr.error;
  let wrappedReported=false;
  let wrappedRethrown=false;
  window.toastr.error=()=>{wrappedReported=true};
  try{errorCatched(()=>{throw new Error('audit wrapped error')})()}catch(error){wrappedRethrown=error?.message==='audit wrapped error'}
  window.toastr.error=originalToastrError;
  const drawer=document.createElement('section');
  drawer.innerHTML='<button id="audit-drawer-toggle" type="button">toggle</button><div id="audit-drawer-body" hidden>ready</div>';
  document.body.append(drawer);
  await errorCatched(async()=>{
    await waitGlobalInitialized('Mvu');
    $('#audit-drawer-toggle').off('click').on('click',()=>$('#audit-drawer-body').prop('hidden',false));
  })();
  $('#audit-drawer-toggle').trigger('click');
  const wrappedStatus=wrappedValue===2&&wrappedAsync&&wrappedReported&&wrappedRethrown&&$('#audit-drawer-body').prop('hidden')===false;
  replaceVariables({chatSeed:'chat'},{type:'chat'});
  const ranged=getChatMessages('0-{{lastMessageId}}',{include_swipes:true})[0];
  const detachedSnapshot=getChatMessages(0,{include_swipes:true});
  detachedSnapshot[0].swipes_data[0].snapshotMutation='local-only';
  const snapshotIsolated=getChatMessages(0)[0].data.snapshotMutation===undefined;
  const negative=getChatMessages(-1)[0];
  const filtered=getChatMessages('0',{role:'user'});
  const variables=getAllVariables();
  const context=SillyTavern.getContext();
  const firstMvu=mvu.getCurrentMvuData();
  const firstData={...ranged.swipes_data[0],auditTouched:true};
  await setChatMessage({data:firstData},0,{swipe_id:'current'});
  const apiEvents=[];
  eventOn(tavern_events.MESSAGE_SWIPED,(...args)=>apiEvents.push(['swiped',...args]));
  eventOn(tavern_events.MESSAGE_UPDATED,(...args)=>apiEvents.push(['updated',...args]));
  eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED,(...args)=>apiEvents.push(['rendered',...args]));
  await setChatMessages([{message_id:0,data:{...getChatMessages(0)[0].data,refreshAffected:true}}]);
  const affectedEvents=apiEvents.splice(0);
  await setChatMessages([{message_id:0,data:{...getChatMessages(0)[0].data,refreshNone:true}}],{refresh:'none'});
  const noneEvents=apiEvents.splice(0);
  const registered=formatAsDisplayedMessage(ranged.message,{message_id:'last_char'});
  const dynamic=formatAsDisplayedMessage('**动态**',{message_id:'last_char'});
  const tavernHelperDynamic=TavernHelper.formatAsDisplayedMessage('**TavernHelper 动态**',{message_id:0});
  const assignment=document.createElement('div');
  assignment.innerHTML=dynamic;
  assignment.insertAdjacentHTML('beforeend',tavernHelperDynamic);
  const displayed=retrieveDisplayedMessage(0);
  displayed.append('<span data-srl-displayed-dom="yes"></span>');
  const displayedDom=displayed.length===1&&displayed.is('div.mes_text')&&displayed.find('[data-srl-displayed-dom="yes"]').length===1;
  displayed.find('[data-srl-displayed-dom="yes"]').remove();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const iconStyle=getComputedStyle(document.querySelector('#api-icon'));
  const apiStyle=getComputedStyle(document.querySelector('#api'));
  document.documentElement.dataset.api=JSON.stringify({
    range:ranged.message_id===0&&ranged.swipe_id===0&&ranged.swipes.length===2&&ranged.swipes_data.length===2,
    negative:negative.message_id===0,
    filtered:filtered.length===0,
    messageSnapshot:snapshotIsolated,
    messageEvents:JSON.stringify(affectedEvents)===JSON.stringify([['rendered',0]])&&noneEvents.length===0,
    displayedDom,
    data:firstData.stat_data.hp===10,
    variables:variables.characterSeed==='character'&&variables.chatSeed==='chat'&&variables.globalSeed==='global'&&!('scriptSeed' in variables),
    script:shared.scriptSeed==='script'&&shared.scriptId==='audit-script'&&shared.frameName.startsWith('TH-script--')&&shared.mvuDirect===true,
    context:context.characterId===0&&context.chat[0].message_id===0&&typeof context.getChatMessages==='function',
    globals:window.auditShared===shared&&directMvu===mvu&&window.Mvu===mvu,
    errorCatched:wrappedStatus,
    formatter:typeof registered==='string'&&typeof dynamic==='string'&&typeof tavernHelperDynamic==='string'&&!(dynamic instanceof Promise)&&dynamic==='**动态**'&&tavernHelperDynamic==='**TavernHelper 动态**'&&!assignment.innerHTML.includes('[object Promise]'),
    mvu:firstMvu.stat_data.hp===10&&firstMvu.stat_data.bag?.new===3&&JSON.stringify(firstMvu.stat_data.list)===JSON.stringify(['x','x','b'])&&!('optionalKey' in firstMvu.stat_data)&&!('requiredKey' in firstMvu.stat_data),
    vendors:typeof jQuery==='function'&&typeof jQuery.fn.draggable==='function'&&typeof Vue.createApp==='function'&&typeof VueRouter.createRouter==='function'&&typeof YAML.parse==='function'&&typeof z.object==='function'&&typeof toastr.info==='function'&&typeof _.get==='function'&&typeof showdown.Converter==='function',
    touchPunch:typeof jQuery.ui.mouse.prototype._touchStart==='function',
    fontAwesome:iconStyle.fontFamily.includes('Font Awesome'),
    tailwind:apiStyle.display==='flex'
  });
}catch(error){document.documentElement.dataset.apiError=String(error?.stack||error)}});
</script>`),
      'api',
      trusted,
      [
        {
          id: 'audit-script',
          name: 'audit-script',
          source: 'character',
          data: { scriptSeed: 'script' },
          content: `
const directMvu=window.Mvu;
const before=getVariables({type:'script'});
replaceVariables({scriptSeed:before.scriptSeed},{type:'script'});
replaceVariables({globalSeed:'global'},{type:'global'});
initializeGlobal('auditShared',{scriptSeed:getVariables({type:'script'}).scriptSeed,scriptId:getScriptId(),frameName:getIframeName(),mvuDirect:typeof directMvu?.getMvuData==='function'});
`,
        },
      ],
      {
        renderShell: 'content',
        greetingContents: mvuGreetings,
        characterData: mvuCharacterData,
        swipesData: mvuState.swipesData,
        mvuRecognized: mvuState.recognized,
        mvuErrors: mvuState.errors,
        unsupportedMvuOpeningUpdates: mvuState.unsupportedOpeningUpdates,
        vendorLibs,
      },
    ),
    noMvu: buildRichContentPreview(
      frontend(`<main id="no-mvu">no mvu</main><script>
window.addEventListener('load',()=>{document.documentElement.dataset.noMvu=String(typeof window.Mvu==='undefined')});
</script>`),
      'no-mvu',
      trusted,
      [],
      { renderShell: 'content', greetingContents: ['普通开场'] },
    ),
    lifecycle: buildRichContentPreview(
      lifecycleGreetings[0],
      'lifecycle',
      trusted,
      [
        {
          id: 'lifecycle-script',
          name: 'lifecycle-script',
          source: 'character',
          data: { bootCount: 0, swipeCount: 0, persistent: 'kept' },
          content: `
const before=getVariables({type:'script'});
const lifecycle={bootCount:Number(before.bootCount||0)+1,swipeCount:Number(before.swipeCount||0),persistent:String(before.persistent||'kept')};
replaceVariables(lifecycle,{type:'script'});
initializeGlobal('auditLifecycle',lifecycle);
eventOn(tavern_events.MESSAGE_SWIPED,()=>{
  lifecycle.swipeCount+=1;
  const current=getChatMessages(0)[0];
  lifecycle.lastSwipe=current.swipe_id;
  lifecycle.lastData=current.data.opening;
  replaceVariables({...lifecycle},{type:'script'});
});
window.__SRL_AUDIT_LIFECYCLE__=lifecycle;
`,
        },
      ],
      {
        renderShell: 'content',
        greetingContents: lifecycleGreetings,
        swipesData: [{ opening: 'A' }, { opening: 'B' }],
        vendorLibs,
      },
    ),
    navigation: buildRichContentPreview(navigationGreetings[0], 'navigation', trusted, [], {
      renderShell: 'content',
      greetingContents: navigationGreetings,
    }),
    safe: buildRichContentPreview(
      frontend(
        '<main id="safe">safe</main><script>document.documentElement.dataset.unsafe="yes"</script><img src="https://example.invalid/a.png">',
      ),
      'safe',
      safe,
      [],
      { renderShell: 'content' },
    ),
  }
  const root = document.getElementById('audit')
  const frames = {}
  const productionSwipeMarkup = {
    api: [undefined, buildRenderCompatibilitySwipeMarkup(mvuGreetings[1], trusted, { vendorLibs })],
    lifecycle: lifecycleGreetings.map((source) =>
      buildRenderCompatibilitySwipeMarkup(source, trusted, { vendorLibs }),
    ),
    navigation: navigationGreetings.map((source) =>
      buildRenderCompatibilitySwipeMarkup(source, trusted, { vendorLibs }),
    ),
  }
  const productionNames = new Set(['api', 'noMvu', 'lifecycle', 'carousel', 'navigation'])
  const productionPaths = {}
  window.__SRL_PRODUCTION_PATHS__ = productionPaths
  for (const [name, preview] of Object.entries(previews)) {
    if (productionNames.has(name)) continue
    const frame = document.createElement('iframe')
    frame.dataset.audit = name
    frame.sandbox.add('allow-scripts', 'allow-same-origin')
    frame.srcdoc = preview.document
    root.append(frame)
    frames[name] = frame
  }
  const mountProductionPreview = (name, preview) => {
    const frame = document.createElement('iframe')
    frame.dataset.audit = name
    frame.sandbox.add('allow-scripts', 'allow-same-origin')
    productionPaths[name] = {
      directSrcdoc: true,
      heights: [],
      initialSandbox: frame.getAttribute('sandbox'),
    }
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow) return
      if (event.data?.type === 'SRL_GREETING_NAVIGATE') {
        const target = Number(event.data.target)
        frame.contentWindow?.postMessage(
          {
            protocol: 'srl-render-compat-v1',
            type: 'SRL_RENDER_COMPAT_SWIPE_TRANSITION',
            target,
            rendered: productionSwipeMarkup[name]?.[target],
          },
          '*',
        )
      }
    })
    frame.srcdoc = preview.document
    root.append(frame)
    frames[name] = frame
  }
  mountProductionPreview('api', previews.api)
  mountProductionPreview('noMvu', previews.noMvu)
  mountProductionPreview('lifecycle', previews.lifecycle)
  mountProductionPreview('carousel', previews.carousel)
  mountProductionPreview('navigation', previews.navigation)
  window.__SRL_SEND_PREVIEW_SWIPE__ = (name, target) => {
    frames[name]?.contentWindow?.postMessage(
      {
        protocol: 'srl-render-compat-v1',
        type: 'SRL_RENDER_COMPAT_SWIPE_TRANSITION',
        target,
        rendered: productionSwipeMarkup[name]?.[target],
      },
      '*',
    )
  }
  window.addEventListener('message', (event) => {
    for (const frame of Object.values(frames)) {
      if (frame.contentWindow === event.source && event.data?.type === 'SRL_PREVIEW_HEIGHT') {
        const height = Math.ceil(Number(event.data.height))
        frame.style.height = `${height}px`
        productionPaths[frame.dataset.audit]?.heights.push(height)
      }
    }
  })
  const result = Object.fromEntries(
    Object.entries(previews).map(([name, preview]) => [
      name,
      {
        blockedScripts: preview.blockedScripts,
        blockedExternalAssets: preview.blockedExternalAssets,
        diagnostics: preview.compatibilityDiagnostics,
        hasExternalVendorScript:
          name === 'api' && /<script\b[^>]*\bsrc\s*=/iu.test(preview.document),
      },
    ]),
  )
  result.vendorCases = vendorCases
  return result
}
