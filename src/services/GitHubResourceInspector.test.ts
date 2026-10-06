import { describe, expect, it, vi } from 'vitest'

import {
  RESOURCE_INSTALL_TARGET,
  RESOURCE_LINK_PURPOSE,
  RESOURCE_LINK_TRUST_MODE,
  RESOURCE_LINK_TYPE,
  type ResourceLink,
} from '../types/Resource'
import {
  inspectGitHubResource,
  readGitHubReadme,
  summarizeGitHubReadme,
} from './GitHubResourceInspector'

function repositoryLink(): ResourceLink {
  return {
    id: 'link',
    label: '',
    url: 'https://github.com/owner/repo',
    type: RESOURCE_LINK_TYPE.GITHUB,
    purpose: RESOURCE_LINK_PURPOSE.REPOSITORY,
    installTarget: RESOURCE_INSTALL_TARGET.NONE,
    trustMode: RESOURCE_LINK_TRUST_MODE.LINK_ONLY,
    github: { owner: 'owner', repo: 'repo' },
    createdAt: 1,
  }
}

describe('GitHubResourceInspector', () => {
  it('从仓库说明、README 和 SillyTavern manifest 形成有证据的识别结果', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/repos/owner/repo')) {
        return new Response(
          JSON.stringify({
            full_name: 'owner/repo',
            name: 'repo',
            description: '仓库描述',
            homepage: 'https://example.com',
            topics: ['sillytavern', 'extension'],
            default_branch: 'main',
            pushed_at: '2026-09-18T07:25:00Z',
            archived: false,
            owner: { login: 'repo-author' },
            license: { spdx_id: 'MIT' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/repos/owner/repo/releases/latest')) {
        return new Response(
          JSON.stringify({
            name: '资源整理助手 2.1',
            tag_name: 'v2.1.0',
            published_at: '2026-09-19T08:00:00Z',
            prerelease: false,
            assets: [
              {
                name: 'resource-helper.zip',
                browser_download_url: 'https://example.com/resource-helper.zip',
                size: 1536,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/main/README.md')) {
        return new Response('# 项目\n\n这是一个帮助用户整理酒馆资源的扩展。\n\n## 功能\n', {
          status: 200,
        })
      }
      if (url.endsWith('/main/manifest.json')) {
        return new Response(
          JSON.stringify({
            display_name: '资源整理助手',
            js: 'index.js',
            description: '在 SillyTavern 中整理资源。',
            version: '2.0.0',
            author: 'Tester',
            minimum_client_version: '1.18.0',
            requires: ['TavernHelper'],
          }),
          { status: 200 },
        )
      }
      return new Response('', { status: 404 })
    })

    const result = await inspectGitHubResource(repositoryLink(), fetchMock as typeof fetch)

    expect(result).toMatchObject({
      status: 'identified',
      name: '资源整理助手',
      summary: '在 SillyTavern 中整理资源。',
      installTarget: RESOURCE_INSTALL_TARGET.SILLYTAVERN_EXTENSION,
      trustMode: RESOURCE_LINK_TRUST_MODE.METADATA_SNAPSHOT,
      manifest: { version: '2.0.0', requires: ['TavernHelper'] },
      author: 'repo-author',
      license: 'MIT',
      updatedAt: '2026-09-18T07:25:00Z',
      latestRelease: {
        name: '资源整理助手 2.1',
        tagName: 'v2.1.0',
        assets: [{ name: 'resource-helper.zip', size: 1536 }],
      },
    })
    expect(result?.evidence).toEqual(
      expect.arrayContaining(['GitHub 仓库元数据', 'README', 'SillyTavern manifest.json']),
    )
  })

  it('GitHub API 限流时仍从公开 README 识别仓库用途', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/repos/owner/repo')) {
        return new Response(JSON.stringify({ message: 'rate limit exceeded' }), { status: 403 })
      }
      if (url.endsWith('/main/README.md')) {
        return new Response('# 角色卡工具\n\n用于批量检查、整理和修复 SillyTavern 角色卡。', {
          status: 200,
        })
      }
      return new Response('', { status: 404 })
    })

    const result = await inspectGitHubResource(repositoryLink(), fetchMock as typeof fetch)

    expect(result).toMatchObject({
      status: 'described',
      name: 'owner/repo',
      summary: '用于批量检查、整理和修复 SillyTavern 角色卡。',
      warning: 'GitHub 仓库接口不可用，当前说明来自公开 README/manifest。',
      installTarget: RESOURCE_INSTALL_TARGET.NONE,
    })
    expect(result?.evidence).toEqual(['README'])
  })

  it('没有 manifest 时只描述仓库，不把普通仓库标成酒馆扩展', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/repos/owner/repo')) {
        return new Response(
          JSON.stringify({
            full_name: 'owner/repo',
            name: 'repo',
            description: '普通工具仓库',
            default_branch: 'main',
          }),
          { status: 200 },
        )
      }
      return new Response('', { status: 404 })
    })

    const result = await inspectGitHubResource(repositoryLink(), fetchMock as typeof fetch)

    expect(result).toMatchObject({
      status: 'described',
      summary: '普通工具仓库',
      installTarget: RESOURCE_INSTALL_TARGET.NONE,
    })
  })

  it('仓库接口与公开文件都不可用时保留明确的不可用结果', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      return url.endsWith('/repos/owner/repo')
        ? new Response(JSON.stringify({ message: 'rate limit exceeded' }), { status: 403 })
        : new Response('', { status: 404 })
    })

    const result = await inspectGitHubResource(repositoryLink(), fetchMock as typeof fetch)

    expect(result).toMatchObject({
      status: 'unavailable',
      name: 'owner/repo',
      summary: '',
      warning: 'GitHub 公开接口已限流，且没有读取到公开 README/manifest；链接仍会保留。',
      installTarget: RESOURCE_INSTALL_TARGET.NONE,
    })
    expect(result?.evidence).toEqual([])
  })

  it('README 摘要跳过徽章并保留可读的首段与标题', () => {
    expect(
      summarizeGitHubReadme(
        '# 工具\n\n[![Build](https://example.com/badge.svg)](https://example.com)\n\n用于管理酒馆角色卡、世界书和脚本资源。\n\n## 安装\n',
      ),
    ).toEqual({ excerpt: '用于管理酒馆角色卡、世界书和脚本资源。', headings: ['工具', '安装'] })
  })

  it('README 的长项目标题不会冒充功能摘要', () => {
    expect(
      summarizeGitHubReadme(
        '# SillyTavern Resource Collection Toolkit\n\n集中整理角色卡、世界书与预设，并提供重复资源检查。',
      ).excerpt,
    ).toBe('集中整理角色卡、世界书与预设，并提供重复资源检查。')
  })

  it('按已识别分支读取完整 README，并在缺失时回退到小写文件名', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      return url.endsWith('/release/readme.md')
        ? new Response('# 完整说明\n\n这里是完整 README。')
        : new Response('', { status: 404 })
    })

    await expect(
      readGitHubReadme(
        { ...repositoryLink(), versionRef: { kind: 'branch', value: 'release' } },
        'main',
        fetchMock as typeof fetch,
      ),
    ).resolves.toEqual({
      markdown: '# 完整说明\n\n这里是完整 README。',
      ref: 'release',
      fileName: 'readme.md',
    })
  })

  it('不会仅因 README 超过 1 MiB 而拒绝用户显式打开阅读页', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('# 完整说明', {
          status: 200,
          headers: { 'content-length': String(1024 * 1024 + 1) },
        }),
    )

    await expect(
      readGitHubReadme(repositoryLink(), 'main', fetchMock as typeof fetch),
    ).resolves.toEqual({ markdown: '# 完整说明', ref: 'main', fileName: 'README.md' })
  })
})
