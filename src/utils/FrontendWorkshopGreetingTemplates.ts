import archive from '../templates/FrontendWorkshopArchive.html?raw'
import observatory from '../templates/FrontendWorkshopObservatory.html?raw'
import deepSea from '../templates/FrontendWorkshopDeepSea.html?raw'

/** Starter assets only: after creation the Source document is the sole editable truth. */
export const frontendWorkshopGreetingTemplates = [
  {
    id: 'deep-sea',
    name: '深海观测档案 · 开场白',
    description: '9 个图层、4 个开场白、3D 轮盘与人物视差',
    source: deepSea,
  },
  {
    id: 'archive',
    name: '折页档案 · 开场白',
    description: '角色、作者说明与开场白导航',
    source: archive,
  },
  {
    id: 'observatory',
    name: '星图剧场 · 人物志',
    description: '空间旋转、章节叙事与 MVU 状态',
    source: observatory,
  },
] as const

export const frontendWorkshopBlankSource =
  '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>我的开场白</title>\n<style>\n*{box-sizing:border-box}body{margin:0;font:16px/1.7 system-ui;color:#dedbd5;background:#191b20}main{max-width:960px;margin:auto;padding:clamp(24px,6vw,64px)}\n</style>\n</head>\n<body>\n<main><h1>故事从这里开始</h1><p>替换这段文字，或打开肘肘更健康一起创作。</p></main>\n</body>\n</html>'
