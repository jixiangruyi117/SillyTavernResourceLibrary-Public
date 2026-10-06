import { describe, expect, it } from 'vitest'

import {
  analyzeResourceLink,
  getResourceLinkRiskBadges,
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TYPE,
  type ResourceLink,
} from './Resource'

describe('Resource link analysis', () => {
  it('只凭 GitHub 仓库 URL 不臆断为 SillyTavern 扩展', () => {
    const link = analyzeResourceLink('https://github.com/owner/repo')

    expect(link).toMatchObject({
      url: 'https://github.com/owner/repo',
      type: RESOURCE_LINK_TYPE.GITHUB,
      purpose: RESOURCE_LINK_PURPOSE.REPOSITORY,
      installTarget: RESOURCE_INSTALL_TARGET.NONE,
      github: { owner: 'owner', repo: 'repo' },
    })
  })

  it('识别固定版本的 GitHub tree 链接', () => {
    const link = analyzeResourceLink('https://github.com/N0VI028/JS-Slash-Runner/tree/v4.8.7')

    expect(link.versionRef).toEqual({ kind: 'tag', value: 'v4.8.7' })
    expect(getResourceLinkRiskBadges(link as ResourceLink)).toContain('固定版本')
  })

  it('识别 raw GitHub 脚本为酒馆助手脚本入口', () => {
    const link = analyzeResourceLink(
      'https://raw.githubusercontent.com/owner/repo/main/scripts/helper.js',
    )

    expect(link).toMatchObject({
      type: RESOURCE_LINK_TYPE.GITHUB,
      purpose: RESOURCE_LINK_PURPOSE.RAW_FILE,
      installTarget: RESOURCE_INSTALL_TARGET.TAVERN_HELPER_SCRIPT,
      versionRef: { kind: 'branch', value: 'main' },
      github: { owner: 'owner', repo: 'repo', path: 'scripts/helper.js' },
    })
    expect(getResourceLinkRiskBadges(link as ResourceLink)).toEqual(
      expect.arrayContaining(['酒馆助手脚本', '可执行内容', '需手动确认', '移动分支']),
    )
  })

  it('识别 GitHub Release 资源包为固定版本下载入口', () => {
    const link = analyzeResourceLink(
      'https://github.com/owner/repo/releases/download/v1.0.0/ext.zip',
    )

    expect(link).toMatchObject({
      purpose: RESOURCE_LINK_PURPOSE.RELEASE,
      installTarget: RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION,
      versionRef: { kind: 'release', value: 'v1.0.0' },
      github: { owner: 'owner', repo: 'repo', releaseTag: 'v1.0.0', assetName: 'ext.zip' },
    })
  })

  it('拒绝不可点击的协议', () => {
    expect(analyzeResourceLink('javascript:alert(1)')).toEqual({})
  })
})
