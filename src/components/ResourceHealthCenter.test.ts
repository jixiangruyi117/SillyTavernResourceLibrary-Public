/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  scan: vi.fn(),
  info: vi.fn(),
  candidates: vi.fn(),
  preview: vi.fn(),
  recover: vi.fn(),
  repair: vi.fn(),
  accounting: vi.fn(),
  mirrors: vi.fn(),
  notice: vi.fn(),
}))
vi.mock('../core/AppContainer', () => ({
  nativeResourceRecoveryService: {
    listCandidates: api.candidates,
    preview: api.preview,
    recover: api.recover,
    repairExisting: api.repair,
    storageAccounting: api.accounting,
    nativeMirrorDuplicationSummary: api.mirrors,
  },
}))
vi.mock('../core/HealthCenter', () => ({ healthCenter: { scan: api.scan, repairSafe: vi.fn() } }))
vi.mock('../core/PlatformService', () => ({ getPlatformInfo: vi.fn() }))
vi.mock('../core/SafeStartup', () => ({ isSafeModeActive: () => false }))
vi.mock('../core/TaskCenter', () => ({ taskCenter: { list: () => [] } }))
vi.mock('../core/NoticeCenter', () => ({ noticeCenter: { push: api.notice, list: () => [] } }))
vi.mock('../storage/NativeResourceFileMirror', () => ({
  getNativeResourceStorageInfo: api.info,
}))
import ResourceHealthCenter from './ResourceHealthCenter.vue'
const accounting = {
  currentOriginalBytes: 10,
  versionOriginalBytes: 5,
  nativeReferenceBytes: 0,
  localSnapshotBytes: 20,
  restoreStagingBytes: 0,
  assetBytes: 12,
  thumbnailAssetBytes: 7,
  assetCount: 3,
  thumbnailAssetCount: 2,
  recoveredPlaceholderCount: 1,
  recoveredPlaceholderBytes: 9,
  pendingNativeLinkCount: 0,
}
const report = { created: 1, updated: 0, existing: 0, unsupported: 0, failed: 0, pendingLinks: 0 }
beforeEach(() => {
  vi.resetAllMocks()
  api.scan.mockResolvedValue([])
  api.info.mockResolvedValue({
    recoveryMetadataVersion: 1,
    totalBytes: 700,
    objectBytes: 180,
    objectCount: 1,
  })
  api.candidates.mockResolvedValue({
    candidates: [
      {
        contentHash: 'a'.repeat(64),
        size: 180,
        modifiedAt: 1,
        nativeId: 'surviving-native-id',
        nativeScope: 'current',
        fileName: '崩溃前角色卡.json',
      },
    ],
    scanned: 1,
  })
  api.preview.mockResolvedValue({ name: '找回的角色', type: 'characterCard' })
  api.recover.mockResolvedValue(report)
  api.repair.mockResolvedValue({ ...report, created: 0, updated: 1 })
  api.accounting.mockResolvedValue(accounting)
  api.mirrors.mockResolvedValue({ currentCount: 0, versionCount: 0, reclaimableBytes: 0 })
})
describe('ResourceHealthCenter recovery controls', () => {
  it('shows recognized names and emits a refresh without re-running the full audit after recovery', async () => {
    const view = mount(ResourceHealthCenter)
    await view
      .findAll('.resource-health__summary button')
      .find((button) => button.text() === '扫描')!
      .trigger('click')
    await flushPromises()
    expect(view.text()).toContain('找回的角色')
    await view.get('input[type=checkbox]').setValue(true)
    await view.get('.resource-health__actions .button--primary').trigger('click')
    await flushPromises()
    expect(api.recover).toHaveBeenCalledOnce()
    expect(api.recover).toHaveBeenCalledWith([
      {
        contentHash: 'a'.repeat(64),
        size: 180,
        nativeId: 'surviving-native-id',
        nativeScope: 'current',
        fileName: '崩溃前角色卡.json',
      },
    ])
    expect(api.scan).toHaveBeenCalledOnce()
    expect(api.candidates).toHaveBeenCalledTimes(2)
    expect(view.emitted('library-changed')).toHaveLength(1)
    view.unmount()
  })
  it('offers in-place repair for old placeholders and keeps accounting explicitly non-additive', async () => {
    const view = mount(ResourceHealthCenter)
    await view
      .findAll('.resource-health__summary button')
      .find((button) => button.text() === '扫描')!
      .trigger('click')
    await flushPromises()
    const repair = view.findAll('button').find((button) => button.text().includes('补全以前'))!
    await repair.trigger('click')
    await flushPromises()
    expect(api.repair).toHaveBeenCalledOnce()
    expect(api.scan).toHaveBeenCalledOnce()
    expect(view.text()).toContain('不能与总量相加')
    expect(view.text()).toContain('本地安全快照')
    expect(view.text()).toContain('其中缩略图')
    view.unmount()
  })
  it('inspects and recovers without full health scanning or repeated whole-library accounting', async () => {
    const view = mount(ResourceHealthCenter)
    await view
      .findAll('button')
      .find((button) => button.text() === '检查原件与空间')!
      .trigger('click')
    await flushPromises()
    await view.get('input[type=checkbox]').setValue(true)
    await view.get('.resource-health__actions .button--primary').trigger('click')
    await flushPromises()
    expect(api.scan).not.toHaveBeenCalled()
    expect(api.accounting).toHaveBeenCalledOnce()
    expect(api.candidates).toHaveBeenCalledTimes(2)
    view.unmount()
  })
  it('reports inspection errors without claiming empty storage or deleting files', async () => {
    api.info.mockRejectedValue(new Error('storage unavailable'))
    const view = mount(ResourceHealthCenter)
    await view
      .findAll('button')
      .find((button) => button.text() === '检查原件与空间')!
      .trigger('click')
    await flushPromises()
    expect(api.notice).toHaveBeenCalledWith({ type: 'error', message: 'storage unavailable' })
    expect(api.recover).not.toHaveBeenCalled()
    view.unmount()
  })
  it('does not attempt the new native API on an old APK', async () => {
    api.info.mockResolvedValue({ totalBytes: 700, objectBytes: 180, objectCount: 1 })
    const view = mount(ResourceHealthCenter)
    await view
      .findAll('.resource-health__summary button')
      .find((button) => button.text() === '扫描')!
      .trigger('click')
    await flushPromises()
    expect(api.preview).not.toHaveBeenCalled()
    expect(view.text()).toContain('仅更新网页无效')
    expect(
      view.get('.resource-health__actions .button--primary').attributes('disabled'),
    ).toBeDefined()
    view.unmount()
  })
})
