import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE, type Resource } from '../types/Resource'

const nativePlugin = vi.hoisted(() => ({
  getStorageInfo: vi.fn(),
  beginWrite: vi.fn(),
  appendWrite: vi.fn(),
  commitWrite: vi.fn(),
  abortWrite: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  clearTemporaryCaches: vi.fn(),
  getObjectPath: vi.fn(),
  linkObjects: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    convertFileSrc: (path: string) => `https://local.invalid/${encodeURIComponent(path)}`,
  },
  registerPlugin: () => nativePlugin,
}))

import {
  clearNativeResourceFiles,
  clearNativeTemporaryCaches,
  getNativeResourceStorageInfo,
  linkNativeResourceObjects,
  readNativeResourceObject,
  stageNativeResourceFile,
} from './NativeResourceFileMirror'

function resource(body = 'hello'): Resource {
  return {
    id: 'resource-1',
    type: RESOURCE_TYPE.OTHER,
    name: '资源',
    description: '',
    fileName: 'resource.json',
    mimeType: 'application/json',
    fileSize: body.length,
    contentHash: 'a'.repeat(64),
    favorite: false,
    categoryId: null,
    tags: [],
    metadata: {},
    originalBlob: new Blob([body]),
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('NativeResourceFileMirror', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nativePlugin.beginWrite.mockResolvedValue({ alreadyPresent: false, token: 'token-1' })
    nativePlugin.appendWrite.mockResolvedValue(undefined)
    nativePlugin.commitWrite.mockResolvedValue(undefined)
    nativePlugin.abortWrite.mockResolvedValue(undefined)
    nativePlugin.clear.mockResolvedValue(undefined)
    nativePlugin.clearTemporaryCaches.mockResolvedValue({ clearedBytes: 12 })
    nativePlugin.getStorageInfo.mockResolvedValue({
      storageVersion: 2,
      path: '/storage/Documents/SRL/library',
      currentCount: 1,
      versionCount: 2,
      objectCount: 2,
      objectBytes: 7,
      appDataBytes: 20,
      externalDataBytes: 30,
      totalBytes: 50,
      availableBytes: 100,
    })
    nativePlugin.getObjectPath.mockResolvedValue({ path: 'file:///library/object.bin', size: 5 })
    nativePlugin.linkObjects.mockResolvedValue({ linked: 1 })
  })

  it('分块写入后只在调用 commit 时提交原生文件', async () => {
    const handle = await stageNativeResourceFile(resource(), 'current')

    expect(nativePlugin.beginWrite).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'current', id: 'resource-1', size: 5 }),
    )
    expect(nativePlugin.appendWrite).toHaveBeenCalledWith({
      token: 'token-1',
      data: btoa('hello'),
    })
    expect(nativePlugin.commitWrite).not.toHaveBeenCalled()

    await handle.commit()
    expect(nativePlugin.commitWrite).toHaveBeenCalledWith({ token: 'token-1' })
  })

  it('暴露原生目录状态并能在保险库开启前清理明文镜像', async () => {
    await expect(getNativeResourceStorageInfo()).resolves.toEqual({
      storageVersion: 2,
      path: '/storage/Documents/SRL/library',
      currentCount: 1,
      versionCount: 2,
      objectCount: 2,
      objectBytes: 7,
      appDataBytes: 20,
      externalDataBytes: 30,
      totalBytes: 50,
      availableBytes: 100,
    })
    await clearNativeResourceFiles()
    expect(nativePlugin.clear).toHaveBeenCalledOnce()
  })

  it('请求清理 APK 的可丢弃缓存目录', async () => {
    await expect(clearNativeTemporaryCaches()).resolves.toBe(12)
    expect(nativePlugin.clearTemporaryCaches).toHaveBeenCalledOnce()
    expect(nativePlugin.clear).not.toHaveBeenCalled()
  })

  it('按需从 NativeLibrary 文件 URL 读取对象，不经过 Base64 bridge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['hello'], { type: 'application/json' }))),
    )

    const blob = await readNativeResourceObject('a'.repeat(64), 5, 'application/json')

    await expect(blob.text()).resolves.toBe('hello')
    expect(nativePlugin.getObjectPath).toHaveBeenCalledWith({
      contentHash: 'a'.repeat(64),
      size: 5,
    })
    expect(nativePlugin.appendWrite).not.toHaveBeenCalled()
  })

  it('恢复索引只链接已校验内容寻址对象，不重新发送文件内容', async () => {
    await expect(
      linkNativeResourceObjects([
        {
          scope: 'current',
          id: 'resource-1',
          fileName: 'resource.json',
          mimeType: 'application/json',
          resourceType: 'other',
          hiddenFromDocuments: false,
          contentHash: 'a'.repeat(64),
          size: 5,
          updatedAt: 2,
        },
      ]),
    ).resolves.toBe(1)
    expect(nativePlugin.linkObjects).toHaveBeenCalledOnce()
    expect(nativePlugin.appendWrite).not.toHaveBeenCalled()
  })
})
