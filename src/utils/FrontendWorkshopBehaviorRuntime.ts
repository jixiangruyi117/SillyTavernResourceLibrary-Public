import type {
  FrontendWorkshopBehaviorCondition,
  FrontendWorkshopBehaviorTrigger,
  FrontendWorkshopProject,
} from '../types/FrontendWorkshopProject'

export interface FrontendWorkshopBehaviorRuntimeState {
  activeStateIds: Record<string, string>
  variables: Record<string, string | number | boolean>
  currentPageId: string
}

export interface FrontendWorkshopBehaviorDispatchResult {
  state: FrontendWorkshopBehaviorRuntimeState
  executedBehaviorIds: string[]
}

export function createFrontendWorkshopBehaviorRuntimeState(
  project: FrontendWorkshopProject,
  pageId = project.pages[0]?.id ?? '',
): FrontendWorkshopBehaviorRuntimeState {
  return {
    activeStateIds: Object.fromEntries(
      (project.states ?? []).map((group) => [group.id, group.defaultStateId]),
    ),
    variables: Object.fromEntries(
      (project.variables ?? []).map((variable) => [variable.id, variable.value]),
    ),
    currentPageId: project.pages.some((page) => page.id === pageId)
      ? pageId
      : (project.pages[0]?.id ?? ''),
  }
}

function matchesCondition(
  actual: string | number | boolean | undefined,
  condition: FrontendWorkshopBehaviorCondition,
): boolean {
  if (actual === undefined) return false
  if (condition.operator === 'eq') return actual === condition.value
  if (condition.operator === 'neq') return actual !== condition.value
  if (typeof actual !== 'number' || typeof condition.value !== 'number') return false
  if (condition.operator === 'gt') return actual > condition.value
  if (condition.operator === 'gte') return actual >= condition.value
  if (condition.operator === 'lt') return actual < condition.value
  return actual <= condition.value
}

export function dispatchFrontendWorkshopBehavior(
  project: FrontendWorkshopProject,
  current: FrontendWorkshopBehaviorRuntimeState,
  nodeId: string,
  trigger: FrontendWorkshopBehaviorTrigger,
): FrontendWorkshopBehaviorDispatchResult {
  const state: FrontendWorkshopBehaviorRuntimeState = {
    activeStateIds: { ...current.activeStateIds },
    variables: { ...current.variables },
    currentPageId: current.currentPageId,
  }
  const groups = new Map((project.states ?? []).map((group) => [group.id, group]))
  const variableIds = new Set((project.variables ?? []).map((variable) => variable.id))
  const pageIds = new Set(project.pages.map((page) => page.id))
  const executedBehaviorIds: string[] = []
  for (const behavior of project.behaviors ?? []) {
    if (
      behavior.trigger !== trigger ||
      !behavior.targetNodeIds.includes(nodeId) ||
      !behavior.conditions.every((condition) =>
        matchesCondition(state.variables[condition.variableId], condition),
      )
    )
      continue
    behavior.actions.forEach((action) => {
      if (action.type === 'toggleState') {
        const group = groups.get(action.stateGroupId)
        if (!group?.states.length) return
        const index = group.states.findIndex((item) => item.id === state.activeStateIds[group.id])
        state.activeStateIds[group.id] =
          group.states[(index + 1 + group.states.length) % group.states.length]!.id
      } else if (action.type === 'setState') {
        const group = groups.get(action.stateGroupId)
        if (group?.states.some((item) => item.id === action.stateId))
          state.activeStateIds[group.id] = action.stateId
      } else if (action.type === 'setVariable') {
        if (variableIds.has(action.variableId)) state.variables[action.variableId] = action.value
      } else if (pageIds.has(action.pageId)) state.currentPageId = action.pageId
    })
    executedBehaviorIds.push(behavior.id)
    if (behavior.propagation === 'stop') break
  }
  return { state, executedBehaviorIds }
}

/** 最终交付与受控 Preview 共用的唯一浏览器 State / Behavior runtime。 */
export function frontendWorkshopBehaviorRuntimeScript(): string {
  return `<script data-srl-workshop-behavior-runtime="1">(()=>{const current=document.currentScript;const root=(current&&current.parentElement&&current.parentElement.querySelector('[data-srl-behavior-config]'))||document.querySelector('[data-srl-behavior-config]');if(!root)return;let config;try{config=JSON.parse(root.dataset.srlBehaviorConfig||'')}catch{return}const variables=new Map((config.variables||[]).map((item)=>[item.id,item.value]));const states=new Map((config.states||[]).map((group)=>[group.id,group.defaultStateId]));const baseline=new Map;const setVariable=(id,value)=>{variables.set(id,value);root.dispatchEvent(new CustomEvent('srl:variable',{detail:{id,value}}))};root.addEventListener('srl:variable',(event)=>{const detail=event.detail||{};if(typeof detail.id==='string')variables.set(detail.id,detail.value)});const applyVariants=()=>{for(const group of config.states||[]){const stateId=states.get(group.id);for(const variant of group.variants||[]){if(variant.stateId!==stateId)continue;for(const override of variant.nodeOverrides||[]){const node=root.querySelector('[data-srl-node="'+CSS.escape(override.nodeId)+'"]');if(!node)continue;if(!baseline.has(node))baseline.set(node,{display:node.style.display,opacity:node.style.opacity,color:node.style.color,background:node.style.background});const base=baseline.get(node);node.style.display=override.visible===false?'none':base.display;const style=override.style||{};node.style.opacity=style.opacity===undefined?base.opacity:String(Math.max(0,Math.min(1,Number(style.opacity))));node.style.color=typeof style.textColor==='string'?style.textColor:base.color;node.style.background=typeof style.surfaceColor==='string'?style.surfaceColor:base.background}}}};const compare=(left,operator,right)=>{if(operator==='eq')return left===right;if(operator==='neq')return left!==right;const a=Number(left),b=Number(right);if(!Number.isFinite(a)||!Number.isFinite(b))return false;if(operator==='gt')return a>b;if(operator==='gte')return a>=b;if(operator==='lt')return a<b;return a<=b};const apply=(action)=>{if(action.type==='toggleState'){const group=(config.states||[]).find((item)=>item.id===action.stateGroupId);if(!group||!group.states.length)return;const index=Math.max(0,group.states.findIndex((state)=>state.id===states.get(group.id)));states.set(group.id,group.states[(index+1)%group.states.length].id);applyVariants()}else if(action.type==='setState'){states.set(action.stateGroupId,action.stateId);applyVariants()}else if(action.type==='setVariable'){setVariable(action.variableId,action.value)}else if(action.type==='openScreen'&&Number.isInteger(action.pageIndex)&&action.pageIndex>=0){const setter=globalThis.setChatMessages;if(typeof setter==='function')setter([{message_id:0,swipe_id:action.pageIndex}])}};const dispatch=(event,nodeId,trigger)=>{for(const behavior of config.behaviors||[]){if(behavior.trigger!==trigger||!behavior.targetNodeIds.includes(nodeId)||!(behavior.conditions||[]).every((condition)=>compare(variables.get(condition.variableId),condition.operator,condition.value)))continue;(behavior.actions||[]).forEach(apply);if(behavior.propagation!=='continue'){event.stopPropagation();return true}}return false};const nodeIdsAt=(event)=>{const ids=[];const seen=new Set;let node=event.target&&event.target.closest&&event.target.closest('[data-srl-node]');while(node&&root.contains(node)){const id=node.dataset&&node.dataset.srlNode;if(id&&!seen.has(id)){seen.add(id);ids.push(id)}const parent=node.parentElement;node=parent&&parent.closest?parent.closest('[data-srl-node]'):null}return ids};const dispatchIds=(event,ids,trigger)=>{for(const id of ids){if(dispatch(event,id,trigger))break}};const updateControl=(event)=>{const control=event.target;if(!control||!control.matches||!control.matches('[data-srl-control]'))return;const variableId=control.dataset.srlVariable;if(!variableId)return;if(control.dataset.srlControl==='radio'&&!control.checked)return;let value=control.dataset.srlControl==='checkbox'?Boolean(control.checked):control.value;if(control.dataset.srlControl==='number'){const number=Number(value);value=Number.isFinite(number)?number:''}setVariable(variableId,value)};applyVariants();root.addEventListener('input',updateControl);root.addEventListener('change',updateControl);let pressTimer=0,startX=0,startY=0,startIds=[],longPressDispatched=false,skipTouchClickUntil=0;const clearPress=()=>{clearTimeout(pressTimer);pressTimer=0};root.addEventListener('click',(event)=>{if(Date.now()<skipTouchClickUntil)return;dispatchIds(event,nodeIdsAt(event),'tap')});root.addEventListener('pointerdown',(event)=>{clearPress();startX=event.clientX;startY=event.clientY;startIds=nodeIdsAt(event);longPressDispatched=false;pressTimer=setTimeout(()=>{longPressDispatched=true;dispatchIds(event,startIds,'longPress')},520)});root.addEventListener('pointermove',(event)=>{if(Math.hypot(event.clientX-startX,event.clientY-startY)>10)clearPress()});root.addEventListener('pointerup',(event)=>{clearPress();const dx=event.clientX-startX,dy=event.clientY-startY;if(Math.abs(dx)>36&&Math.abs(dx)>Math.abs(dy))dispatchIds(event,startIds,dx<0?'swipeLeft':'swipeRight');else if(event.pointerType==='touch'&&!longPressDispatched){skipTouchClickUntil=Date.now()+700;dispatchIds(event,startIds,'tap')}});root.addEventListener('pointercancel',clearPress)})();</script>`
}
