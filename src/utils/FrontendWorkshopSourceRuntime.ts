import { installFrontendWorkshopLayerView } from './FrontendWorkshopLayerRuntime'
import {
  readFrontendWorkshopRuntimeLayout,
  type FrontendWorkshopRuntimeLayout,
} from './FrontendWorkshopRuntimeLayout'
import { installFrontendWorkshopCanvasPan } from './FrontendWorkshopCanvasPan'
import {
  installFrontendWorkshopSourceDomAnchors,
  projectFrontendWorkshopSourceDomAnchors,
} from './FrontendWorkshopSourceDomAnchors'
import type { FrontendWorkshopSourceDocument } from '../types/FrontendWorkshopSourceDocument'
import type { PreviewVendorLibs } from './PreviewVendorLibs'
import { buildPreviewFontStylesheet } from './PreviewFontStylesheet'
import {
  buildRenderCompatibilityChildAdapter,
  buildRenderCompatibilityHostRuntime,
  createRenderCompatibilityContextFromPreviewSession,
  RENDER_COMPATIBILITY_EVENTS,
  RENDER_COMPATIBILITY_PROTOCOL,
  type PreviewSessionContext,
  type RenderCompatibilityContext,
  type RenderCompatibilityDiagnostic,
} from './RenderCompatibilityRuntime'

export const FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL = 'srl-fw-source-runtime-v1' as const
export const FRONTEND_WORKSHOP_SOURCE_RUNTIME_DOM_SNAPSHOT_MAX_NODES = 2000 as const

export const FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS = {
  mount: 'SRL_FW_SOURCE_MOUNT',
  pagehide: 'SRL_FW_SOURCE_PAGEHIDE',
  height: 'SRL_FW_SOURCE_HEIGHT',
  error: 'SRL_FW_SOURCE_ERROR',
  viewport: 'SRL_FW_SOURCE_VIEWPORT',
  scroll: 'SRL_FW_SOURCE_SCROLL',
  domSnapshotRequest: 'SRL_FW_SOURCE_DOM_SNAPSHOT_REQUEST',
  domSnapshot: 'SRL_FW_SOURCE_DOM_SNAPSHOT',
  domSelectionMode: 'SRL_FW_SOURCE_DOM_SELECTION_MODE',
  domSelectRequest: 'SRL_FW_SOURCE_DOM_SELECT_REQUEST',
  domSelection: 'SRL_FW_SOURCE_DOM_SELECTION',
  compatibilityDiagnostic: 'SRL_FW_SOURCE_COMPATIBILITY_DIAGNOSTIC',
  greetingNavigate: 'SRL_FW_SOURCE_GREETING_NAVIGATE',
  canvasPan: 'SRL_FW_SOURCE_CANVAS_PAN',
} as const

export type FrontendWorkshopSourceRuntimeNetworkMode = 'offline' | 'host'
export type FrontendWorkshopSourceRuntimeSizingMode = 'content' | 'viewport'
export type FrontendWorkshopSourceRuntimeDomNodeKind = 'element' | 'text'
export type FrontendWorkshopSourceRuntimeDomTreeScope = 'document' | 'shadow'

export interface FrontendWorkshopSourceRuntimeDomNodeSnapshot {
  runtimeNodeId: string
  nodeKind: FrontendWorkshopSourceRuntimeDomNodeKind
  treeScope: FrontendWorkshopSourceRuntimeDomTreeScope
  firstSeenSequence: number
  parentRuntimeNodeId?: string
  shadowHostRuntimeNodeId?: string
  tagName?: string
  elementId?: string
  textLength?: number
  label?: string
  sourceEntityId?: string
}

export interface FrontendWorkshopSourceRuntimeDomSnapshot {
  projectId: string
  sourceRevision: number
  instanceId: string
  runtimeNonce: string
  requestId: string
  snapshotSequence: number
  nodes: readonly FrontendWorkshopSourceRuntimeDomNodeSnapshot[]
  truncated: boolean
}

export interface FrontendWorkshopSourceRuntimeDomRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FrontendWorkshopSourceRuntimeDomSelection {
  projectId: string
  sourceRevision: number
  instanceId: string
  runtimeNonce: string
  runtimeNodeId: string
  treeScope: FrontendWorkshopSourceRuntimeDomTreeScope
  tagName: string
  elementId?: string
  rect: FrontendWorkshopSourceRuntimeDomRect
  layout?: FrontendWorkshopRuntimeLayout
}

export interface FrontendWorkshopSourceRuntimeBuildOptions {
  sourceMapping?: boolean
  instanceId?: string
  runtimeNonce?: string
  iframeName?: string
  networkMode?: FrontendWorkshopSourceRuntimeNetworkMode
  sizingMode?: FrontendWorkshopSourceRuntimeSizingMode
  viewportHeight?: number
  vendorLibs?: PreviewVendorLibs
  previewSessionContext?: PreviewSessionContext
}

export interface FrontendWorkshopSourceRuntimeInstance {
  protocol: typeof FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL
  projectId: string
  sourceRevision: number
  instanceId: string
  runtimeNonce: string
  iframeName: string
  networkMode: FrontendWorkshopSourceRuntimeNetworkMode
  sandbox: string
  childDocument: string
  hostDocument: string
  compatibilityDiagnostics: readonly RenderCompatibilityDiagnostic[]
}

const SOURCE_RUNTIME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOptionalBoundedString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength)
}

function isBoundedDomRect(value: unknown): value is FrontendWorkshopSourceRuntimeDomRect {
  if (!isRecord(value)) return false
  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width)
  const height = Number(value.height)
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    Math.abs(x) <= 10_000_000 &&
    Math.abs(y) <= 10_000_000 &&
    width >= 0 &&
    height >= 0 &&
    width <= 10_000_000 &&
    height <= 10_000_000
  )
}

function isDomNodeSnapshot(
  value: unknown,
  snapshotSequence: number,
): value is FrontendWorkshopSourceRuntimeDomNodeSnapshot {
  if (!isRecord(value)) return false
  if (
    typeof value.runtimeNodeId !== 'string' ||
    !value.runtimeNodeId ||
    value.runtimeNodeId.length > 128
  ) {
    return false
  }
  if (value.nodeKind !== 'element' && value.nodeKind !== 'text') return false
  if (value.treeScope !== 'document' && value.treeScope !== 'shadow') return false
  if (
    !Number.isInteger(value.firstSeenSequence) ||
    Number(value.firstSeenSequence) < 1 ||
    Number(value.firstSeenSequence) > snapshotSequence
  ) {
    return false
  }
  if (!isOptionalBoundedString(value.parentRuntimeNodeId, 128)) return false
  if (!isOptionalBoundedString(value.shadowHostRuntimeNodeId, 128)) return false

  if (value.nodeKind === 'element') {
    if (typeof value.tagName !== 'string' || !value.tagName || value.tagName.length > 128)
      return false
    if (
      !isOptionalBoundedString(value.elementId, 1024) ||
      !isOptionalBoundedString(value.sourceEntityId, 128) ||
      !isOptionalBoundedString(value.label, 100)
    )
      return false
    return true
  }

  return Number.isInteger(value.textLength) && Number(value.textLength) >= 0
}

export function isFrontendWorkshopSourceRuntimeDomSnapshot(
  value: unknown,
): value is FrontendWorkshopSourceRuntimeDomSnapshot {
  if (!isRecord(value)) return false
  if (typeof value.projectId !== 'string' || !value.projectId) return false
  if (!Number.isInteger(value.sourceRevision) || Number(value.sourceRevision) < 1) return false
  if (typeof value.instanceId !== 'string' || !value.instanceId) return false
  if (typeof value.runtimeNonce !== 'string' || !value.runtimeNonce) return false
  if (typeof value.requestId !== 'string' || value.requestId.length > 128) return false
  if (!Number.isInteger(value.snapshotSequence) || Number(value.snapshotSequence) < 1) return false
  if (typeof value.truncated !== 'boolean' || !Array.isArray(value.nodes)) return false
  if (value.nodes.length > FRONTEND_WORKSHOP_SOURCE_RUNTIME_DOM_SNAPSHOT_MAX_NODES) return false
  return value.nodes.every((node) => isDomNodeSnapshot(node, Number(value.snapshotSequence)))
}

export function isFrontendWorkshopSourceRuntimeDomSelection(
  value: unknown,
): value is FrontendWorkshopSourceRuntimeDomSelection {
  if (!isRecord(value)) return false
  if (typeof value.projectId !== 'string' || !value.projectId) return false
  if (!Number.isInteger(value.sourceRevision) || Number(value.sourceRevision) < 1) return false
  if (typeof value.instanceId !== 'string' || !value.instanceId) return false
  if (typeof value.runtimeNonce !== 'string' || !value.runtimeNonce) return false
  if (
    typeof value.runtimeNodeId !== 'string' ||
    !value.runtimeNodeId ||
    value.runtimeNodeId.length > 128
  ) {
    return false
  }
  if (value.treeScope !== 'document' && value.treeScope !== 'shadow') return false
  if (typeof value.tagName !== 'string' || !value.tagName || value.tagName.length > 128)
    return false
  if (value.layout !== undefined) {
    const layout = value.layout
    if (
      !isRecord(layout) ||
      !isOptionalBoundedString(layout.translate, 256) ||
      typeof layout.translate !== 'string' ||
      typeof layout.movable !== 'boolean' ||
      !Number.isFinite(layout.scaleX) ||
      !Number.isFinite(layout.scaleY) ||
      Number(layout.scaleX) <= 0 ||
      Number(layout.scaleY) <= 0
    )
      return false
  }
  return isOptionalBoundedString(value.elementId, 1024) && isBoundedDomRect(value.rect)
}

export function createFrontendWorkshopPreviewSessionContext(
  input: PreviewSessionContext | undefined,
): PreviewSessionContext {
  return input ?? {}
}

function createRuntimeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid
    ? `${prefix}-${uuid}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029')
}

function inlineScript(source: string | undefined): string {
  if (!source) return ''
  return `<script>${source.replace(/<\/script/giu, '<\\/script')}</script>`
}

function inlineStyle(source: string | undefined): string {
  if (!source) return ''
  return `<style>${source.replace(/<\/style/giu, '<\\/style')}</style>`
}

function buildChildVendorPrelude(libs: PreviewVendorLibs | undefined): string {
  const styles = [
    buildPreviewFontStylesheet(libs?.fontAwesomeCss),
    inlineStyle(libs?.jqueryUiCss),
    inlineStyle(libs?.toastrCss),
  ]
  const scripts = [
    inlineScript(libs?.jquery),
    inlineScript(libs?.jqueryUi),
    inlineScript(libs?.jqueryUiTouchPunch),
    inlineScript(libs?.lodash),
    inlineScript(libs?.showdown),
    inlineScript(libs?.vue),
    inlineScript(libs?.vueRouter),
    inlineScript(libs?.toastr),
    inlineScript(libs?.tailwind),
    inlineScript(libs?.vendorGlobals),
  ]
  return [...styles, ...scripts].filter(Boolean).join('\n')
}

function buildOfflinePolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
    "style-src 'unsafe-inline' data: blob:",
    'img-src data: blob:',
    'font-src data: blob:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    'worker-src data: blob:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function buildEphemeralStorageRuntime(): string {
  return `<script>(()=>{'use strict';
const createStorage=()=>{const values=new Map();return{get length(){return values.size},clear(){values.clear()},getItem(key){key=String(key);return values.has(key)?values.get(key):null},key(index){index=Number(index);return Number.isInteger(index)&&index>=0?Array.from(values.keys())[index]??null:null},removeItem(key){values.delete(String(key))},setItem(key,value){values.set(String(key),String(value))}}};
const install=(name)=>{try{Object.defineProperty(window,name,{configurable:true,enumerable:true,value:createStorage()})}catch{}};
install('localStorage');install('sessionStorage');
})();</script>`
}

function buildChildLifecycleRuntime(
  identity: {
    projectId: string
    sourceRevision: number
    instanceId: string
    runtimeNonce: string
    iframeName: string
    viewportHeight: number
  },
  projection?: ReturnType<typeof projectFrontendWorkshopSourceDomAnchors>,
): string {
  return `<script>(()=>{'use strict';
const identity=${scriptJson(identity)};
const protocol=${scriptJson(FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL)};
const events=${scriptJson(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS)};
const maxDomNodes=${FRONTEND_WORKSHOP_SOURCE_RUNTIME_DOM_SNAPSHOT_MAX_NODES};
let resizeObserver;
let heightQueued=false;
let heightFrame;
let heightTimer;
let disposed=false;
let domSnapshotSequence=0;
let domSelectionMode=false;
let canvasPanEnabled=false;
let nextDomNodeId=1;
const domNodeMetadata=new WeakMap();
const sourceAnchors=${projection ? `(${installFrontendWorkshopSourceDomAnchors.toString()})(window,${scriptJson(projection.attribute)},${scriptJson(projection.anchors)})` : 'undefined'};
const selectableDomNodes=new Map();
const post=(type,data={})=>parent.postMessage({protocol,type,...identity,...data},'*');
const matchesIdentity=data=>Boolean(data&&data.protocol===protocol&&data.instanceId===identity.instanceId&&data.runtimeNonce===identity.runtimeNonce&&data.projectId===identity.projectId&&Number(data.sourceRevision)===identity.sourceRevision);
const applyViewport=(height)=>{height=Number(height);if(!Number.isFinite(height)||height<=0)return;document.documentElement.style.setProperty('--TH-viewport-height',Math.ceil(height)+'px')};
const reportHeight=()=>{heightQueued=false;heightFrame=undefined;heightTimer=undefined;if(disposed)return;const body=document.body;const height=body?.scrollHeight||0;if(Number.isFinite(height)&&height>0)post(events.height,{height:Math.ceil(height)})};
const queueHeight=()=>{if(disposed||heightQueued)return;heightQueued=true;if(typeof requestAnimationFrame==='function')heightFrame=requestAnimationFrame(reportHeight);else heightTimer=setTimeout(reportHeight,0)};
const getDomNodeMetadata=(node,sequence)=>{let metadata=domNodeMetadata.get(node);if(metadata)return metadata;metadata={runtimeNodeId:'runtime-node-'+nextDomNodeId++,firstSeenSequence:sequence};domNodeMetadata.set(node,metadata);return metadata};
const domTreeScope=node=>{const root=node?.getRootNode?.();return typeof ShadowRoot!=='undefined'&&root instanceof ShadowRoot?'shadow':'document'};
const captureDomSnapshot=requestId=>{selectableDomNodes.clear();const snapshotSequence=++domSnapshotSequence;const nodes=[];const body=document.body;const stack=[];if(body)for(let index=body.childNodes.length-1;index>=0;index-=1)stack.push({node:body.childNodes[index],treeScope:'document'});while(stack.length&&nodes.length<maxDomNodes){const entry=stack.pop();const node=entry.node;if(!node||(node.nodeType!==1&&node.nodeType!==3))continue;const metadata=getDomNodeMetadata(node,snapshotSequence);const item={runtimeNodeId:metadata.runtimeNodeId,nodeKind:node.nodeType===1?'element':'text',treeScope:entry.treeScope,firstSeenSequence:metadata.firstSeenSequence};if(entry.parentRuntimeNodeId)item.parentRuntimeNodeId=entry.parentRuntimeNodeId;if(entry.shadowHostRuntimeNodeId)item.shadowHostRuntimeNodeId=entry.shadowHostRuntimeNodeId;if(node.nodeType===1){item.tagName=String(node.localName||node.nodeName||'').toLowerCase();const sourceEntityId=sourceAnchors?.get(node);if(sourceEntityId)item.sourceEntityId=sourceEntityId;const elementId=node.getAttribute?.('id');if(elementId)item.elementId=String(elementId).slice(0,1024);if(!['script','style','link','meta'].includes(item.tagName)){selectableDomNodes.set(item.runtimeNodeId,node);item.label=String(node.getAttribute?.('aria-label')||node.getAttribute?.('alt')||node.textContent||'').trim().slice(0,100)}}else item.textLength=String(node.nodeValue||'').length;nodes.push(item);if(node.nodeType!==1)continue;const lightChildren=node.childNodes;for(let index=lightChildren.length-1;index>=0;index-=1)stack.push({node:lightChildren[index],treeScope:entry.treeScope,parentRuntimeNodeId:metadata.runtimeNodeId,shadowHostRuntimeNodeId:entry.shadowHostRuntimeNodeId});const shadow=node.shadowRoot;if(shadow)for(let index=shadow.childNodes.length-1;index>=0;index-=1)stack.push({node:shadow.childNodes[index],treeScope:'shadow',shadowHostRuntimeNodeId:metadata.runtimeNodeId})}post(events.domSnapshot,{requestId:String(requestId||'').slice(0,128),snapshotSequence,nodes,truncated:stack.length>0})};
let layerView;
const readLayout=(${readFrontendWorkshopRuntimeLayout.toString()});
const publishDomSelection=node=>{if(!node?.isConnected||(layerView&&!layerView.selectable(node)))return;const metadata=getDomNodeMetadata(node,Math.max(1,domSnapshotSequence+1));const tagName=String(node.localName||node.nodeName||'').toLowerCase();if(!tagName)return;const elementId=node.getAttribute?.('id');const rect=node.getBoundingClientRect();post(events.domSelection,{runtimeNodeId:metadata.runtimeNodeId,treeScope:domTreeScope(node),tagName,...(elementId?{elementId:String(elementId).slice(0,1024)}:{}),layout:readLayout(node),rect:{x:rect.left,y:rect.top,width:rect.width,height:rect.height}})};
const disposeCanvasPan=(${installFrontendWorkshopCanvasPan.toString()})(window,()=>canvasPanEnabled,data=>post(events.canvasPan,{...data,x:data.x/window.innerWidth,y:data.y/window.innerHeight}));
const selectDomNode=event=>{if(!domSelectionMode)return;const path=typeof event.composedPath==='function'?event.composedPath():[event.target];const node=path.find(candidate=>candidate&&candidate.nodeType===1&&candidate!==document.documentElement&&candidate!==document.body);if(!node)return;event.preventDefault();event.stopImmediatePropagation();publishDomSelection(node)};
const mount=()=>{if(disposed)return;applyViewport(identity.viewportHeight||window.innerHeight);post(events.mount,{readyState:document.readyState});queueHeight();if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(queueHeight);if(document.body)resizeObserver.observe(document.body)}else if(typeof MutationObserver==='function'){const observer=new MutationObserver(queueHeight);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});resizeObserver={disconnect:()=>observer.disconnect()}};window.addEventListener('load',queueHeight,{once:true});try{document.fonts?.ready?.then(queueHeight).catch(()=>{})}catch{}};
const scrollAtPoint=data=>{if(![data.deltaX,data.deltaY,data.x,data.y].every(Number.isFinite))return;let node=document.elementFromPoint(Math.max(0,Math.min(window.innerWidth-1,data.x*window.innerWidth)),Math.max(0,Math.min(window.innerHeight-1,data.y*window.innerHeight)));let dx=data.deltaX,dy=data.deltaY;while(node&&node!==document.scrollingElement){const style=getComputedStyle(node);const left=node.scrollLeft,top=node.scrollTop;const canX=/^(auto|scroll|overlay)$/.test(style.overflowX)&&node.scrollWidth>node.clientWidth;const canY=/^(auto|scroll|overlay)$/.test(style.overflowY)&&node.scrollHeight>node.clientHeight;if(canX||canY){node.scrollBy({left:canX?dx:0,top:canY?dy:0,behavior:'instant'});dx-=node.scrollLeft-left;dy-=node.scrollTop-top;if(canX&&style.overscrollBehaviorX!=='auto')dx=0;if(canY&&style.overscrollBehaviorY!=='auto')dy=0;if(!dx&&!dy)return}node=node.parentElement||node.getRootNode?.().host}window.scrollBy({left:dx,top:dy,behavior:'instant'})};
const handleMessage=event=>{const data=event.data;if(event.source!==parent||!matchesIdentity(data))return;if(data.type===events.viewport){applyViewport(data.height);queueHeight();return}if(data.type===events.scroll){scrollAtPoint(data);return}if(data.type===events.domSelectRequest){const node=selectableDomNodes.get(data.runtimeNodeId);if(node&&domSelectionMode){node.scrollIntoView({block:'nearest',inline:'nearest'});publishDomSelection(node)}return}if(data.type===events.domSelectionMode){domSelectionMode=Boolean(data.enabled);canvasPanEnabled=Boolean(data.canvasPanEnabled);if(data.layerView&&!layerView)layerView=(${installFrontendWorkshopLayerView.toString()})(window);layerView?.update(data.layerView);return}if(data.type===events.domSnapshotRequest)captureDomSnapshot(data.requestId)};
const handleError=event=>{const target=event.target;if(target&&target!==window&&target.nodeType===1){post(events.error,{kind:'resource',message:'资源加载失败：'+String(target.localName||'')+' '+String(target.getAttribute?.('src')||target.getAttribute?.('href')||'').split('?')[0].slice(0,500)});return}post(events.error,{kind:'error',message:String(event.message||'').slice(0,2000),filename:String(event.filename||''),line:Number(event.lineno)||0,column:Number(event.colno)||0})};
const handlePolicy=event=>post(events.error,{kind:'policy',message:'预览网络策略阻止资源：'+String(event.effectiveDirective||'')+' '+String(event.blockedURI||'').split('?')[0].slice(0,500)});
const handleUnhandledRejection=event=>{const reason=event.reason;post(events.error,{kind:'unhandledrejection',message:reason instanceof Error?reason.message.slice(0,2000):String(reason??'').slice(0,2000)})};
const cleanup=()=>{if(disposed)return;disposed=true;sourceAnchors?.dispose();layerView?.dispose();disposeCanvasPan();selectableDomNodes.clear();try{resizeObserver?.disconnect?.()}catch{}if(heightFrame!==undefined&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(heightFrame);if(heightTimer!==undefined)clearTimeout(heightTimer);window.removeEventListener('click',selectDomNode,true);window.removeEventListener('message',handleMessage);window.removeEventListener('error',handleError,true);window.removeEventListener('securitypolicyviolation',handlePolicy);window.removeEventListener('unhandledrejection',handleUnhandledRejection);window.removeEventListener('load',queueHeight);document.removeEventListener('DOMContentLoaded',mount);post(events.pagehide,{lifetimeMs:Date.now()-(window.__SRL_FW_SOURCE_STARTED_AT__||Date.now())});delete window.__SRL_FW_SOURCE_RUNTIME__;delete window.__SRL_FW_SOURCE_STARTED_AT__};
window.addEventListener('click',selectDomNode,true);
window.addEventListener('message',handleMessage);
window.addEventListener('error',handleError,true);
window.addEventListener('securitypolicyviolation',handlePolicy);
window.addEventListener('unhandledrejection',handleUnhandledRejection);
window.addEventListener('pagehide',cleanup,{once:true});
window.__SRL_FW_SOURCE_STARTED_AT__=Date.now();
window.__SRL_FW_SOURCE_RUNTIME__={protocol,projectId:identity.projectId,sourceRevision:identity.sourceRevision,instanceId:identity.instanceId,iframeName:identity.iframeName};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();</script>`
}

function buildSourceChildDocument(
  source: FrontendWorkshopSourceDocument,
  options: Required<
    Pick<
      FrontendWorkshopSourceRuntimeBuildOptions,
      'instanceId' | 'runtimeNonce' | 'iframeName' | 'networkMode' | 'viewportHeight' | 'sizingMode'
    >
  > & { vendorLibs?: PreviewVendorLibs; sourceMapping?: boolean },
  compatibilityContext: RenderCompatibilityContext,
): string {
  const policy =
    options.networkMode === 'offline'
      ? `<meta http-equiv="Content-Security-Policy" content="${buildOfflinePolicy()}">`
      : ''
  const identity = {
    projectId: source.projectId,
    sourceRevision: source.revision,
    instanceId: options.instanceId,
    runtimeNonce: options.runtimeNonce,
    iframeName: options.iframeName,
    viewportHeight: options.viewportHeight,
  }
  const projection = options.sourceMapping
    ? projectFrontendWorkshopSourceDomAnchors(
        source.authorSource,
        createRuntimeId('data-srl-source'),
      )
    : undefined

  // In content mode the outer preview owns scrolling. A transient root scrollbar
  // during height propagation would change text wrapping and feed back into height.
  const contentSizingStyle =
    options.sizingMode === 'content'
      ? '<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>'
      : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${policy}
${contentSizingStyle}
${buildEphemeralStorageRuntime()}
${buildChildVendorPrelude(options.vendorLibs)}
${buildRenderCompatibilityHostRuntime(compatibilityContext, 1)}
${buildRenderCompatibilityChildAdapter(undefined, { hostScope: 'self' })}
${buildChildLifecycleRuntime(identity, projection)}
</head>
<body>
${projection?.html ?? source.authorSource}
</body>
</html>`
}

function buildOuterBridgeRuntime(identity: {
  projectId: string
  sourceRevision: number
  instanceId: string
  runtimeNonce: string
  iframeName: string
  viewportHeight: number
  sizingMode: FrontendWorkshopSourceRuntimeSizingMode
}): string {
  return `<script>(()=>{'use strict';
const identity=${scriptJson(identity)};
const protocol=${scriptJson(FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL)};
const events=${scriptJson(FRONTEND_WORKSHOP_SOURCE_RUNTIME_EVENTS)};
const frame=document.getElementById(identity.iframeName);
if(!frame)return;
const forward=new Set([events.mount,events.pagehide,events.height,events.error,events.domSnapshot,events.domSelection,events.canvasPan]);
const matchesIdentity=data=>Boolean(data&&data.protocol===protocol&&data.instanceId===identity.instanceId&&data.runtimeNonce===identity.runtimeNonce&&data.projectId===identity.projectId&&Number(data.sourceRevision)===identity.sourceRevision);
const sendViewport=height=>{frame.contentWindow?.postMessage({protocol,type:events.viewport,projectId:identity.projectId,sourceRevision:identity.sourceRevision,instanceId:identity.instanceId,runtimeNonce:identity.runtimeNonce,height},'*')};
const handleMessage=event=>{const data=event.data;if(event.source===frame.contentWindow&&data?.protocol===${scriptJson(RENDER_COMPATIBILITY_PROTOCOL)}&&data?.type===${scriptJson(RENDER_COMPATIBILITY_EVENTS.greetingNavigate)}){parent.postMessage({...identity,protocol,type:events.greetingNavigate,target:data.target},'*');return}if(event.source===frame.contentWindow&&data?.protocol===${scriptJson(RENDER_COMPATIBILITY_PROTOCOL)}&&data?.type===${scriptJson(RENDER_COMPATIBILITY_EVENTS.diagnostic)}){parent.postMessage({...identity,protocol,type:events.compatibilityDiagnostic,diagnostic:data.diagnostic},'*');return}if(event.source===frame.contentWindow&&matchesIdentity(data)&&forward.has(data.type)){if(identity.sizingMode==='content'&&data.type===events.height&&Number.isFinite(Number(data.height))&&Number(data.height)>0)frame.style.height=Math.ceil(Number(data.height))+'px';parent.postMessage(data,'*');return}if(event.source===parent&&matchesIdentity(data)){if(data.type===events.viewport){sendViewport(data.height);return}if(data.type===events.domSnapshotRequest||data.type===events.domSelectionMode||data.type===events.domSelectRequest||data.type===events.scroll)frame.contentWindow?.postMessage(data,'*')}};
const handleFrameLoad=()=>{if(identity.sizingMode==='content')frame.style.height=Math.max(1,Math.ceil(identity.viewportHeight||window.innerHeight||844))+'px';sendViewport(identity.viewportHeight||window.innerHeight)};
const cleanup=()=>{window.removeEventListener('message',handleMessage);window.removeEventListener('pagehide',cleanup);frame.removeEventListener('load',handleFrameLoad)};
window.addEventListener('message',handleMessage);
window.addEventListener('pagehide',cleanup,{once:true});
frame.addEventListener('load',handleFrameLoad);
})();</script>`
}

function buildSourceHostDocument(
  source: FrontendWorkshopSourceDocument,
  childDocument: string,
  options: Required<
    Pick<
      FrontendWorkshopSourceRuntimeBuildOptions,
      'instanceId' | 'runtimeNonce' | 'iframeName' | 'networkMode' | 'viewportHeight' | 'sizingMode'
    >
  > & { vendorLibs?: PreviewVendorLibs },
): string {
  const outerIdentity = {
    projectId: source.projectId,
    sourceRevision: source.revision,
    instanceId: options.instanceId,
    runtimeNonce: options.runtimeNonce,
    iframeName: options.iframeName,
    viewportHeight: options.viewportHeight,
    sizingMode: options.sizingMode,
  }
  const childJson = scriptJson(childDocument)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>html,body{margin:0;padding:0;max-width:100%;${options.sizingMode === 'viewport' ? 'height:100%;' : ''}overflow:hidden;}iframe{display:block;width:100%;height:${options.sizingMode === 'viewport' ? '100%' : `${options.viewportHeight}px`};border:0;}</style>
</head>
<body>
<iframe id="${options.iframeName}" name="${options.iframeName}" title="FrontendWorkshop Source Runtime"></iframe>
${buildOuterBridgeRuntime(outerIdentity)}
<script>(()=>{'use strict';const frame=document.getElementById(${scriptJson(options.iframeName)});if(frame)frame.srcdoc=${childJson};})();</script>
</body>
</html>`
}

/**
 * S2 runtime projection. `authorSource` is never normalized or sanitized here.
 * The returned host/child documents are disposable runtime artifacts; Source Document remains truth.
 */
export function createFrontendWorkshopSourceRuntimeInstance(
  source: FrontendWorkshopSourceDocument,
  options: FrontendWorkshopSourceRuntimeBuildOptions = {},
): FrontendWorkshopSourceRuntimeInstance {
  if (!source.projectId) throw new Error('Source Runtime 缺少 projectId')
  if (typeof source.authorSource !== 'string')
    throw new Error('Source Runtime 的 Author Source 必须是字符串')
  if (source.hostProfile !== 'tavern-helper-message') {
    throw new Error(`Source Runtime 暂不认识 host profile：${source.hostProfile}`)
  }

  const resolved = {
    instanceId: options.instanceId ?? createRuntimeId('fw-instance'),
    runtimeNonce: options.runtimeNonce ?? createRuntimeId('fw-runtime'),
    iframeName: options.iframeName ?? 'TH-message--0--0',
    networkMode: options.networkMode ?? 'offline',
    sizingMode: options.sizingMode ?? 'content',
    viewportHeight: Math.max(1, Math.trunc(options.viewportHeight ?? 844)),
    vendorLibs: options.vendorLibs,
    sourceMapping: options.sourceMapping,
  }
  const previewSessionContext = createFrontendWorkshopPreviewSessionContext(
    options.previewSessionContext,
  )
  const compatibilityContext =
    createRenderCompatibilityContextFromPreviewSession(previewSessionContext)
  const childDocument = buildSourceChildDocument(source, resolved, compatibilityContext)
  const hostDocument = buildSourceHostDocument(source, childDocument, resolved)

  return {
    protocol: FRONTEND_WORKSHOP_SOURCE_RUNTIME_PROTOCOL,
    projectId: source.projectId,
    sourceRevision: source.revision,
    instanceId: resolved.instanceId,
    runtimeNonce: resolved.runtimeNonce,
    iframeName: resolved.iframeName,
    networkMode: resolved.networkMode,
    sandbox: SOURCE_RUNTIME_SANDBOX,
    childDocument,
    hostDocument,
    compatibilityDiagnostics: compatibilityContext.diagnostics,
  }
}
