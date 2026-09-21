/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const {
  inspectExternalApp,
  installExternalApp,
  listExternalApps,
  getExternalApp,
  getExternalAppHealth,
  exportPackage,
  exportPreviewPackage,
} = vi.hoisted(() => ({
  inspectExternalApp: vi.fn(),
  installExternalApp: vi.fn(),
  listExternalApps: vi.fn<() => Promise<unknown[]>>(async () => []),
  getExternalApp: vi.fn(),
  getExternalAppHealth: vi.fn(),
  exportPackage: vi.fn(),
  exportPreviewPackage: vi.fn(),
}))

const { downloadBlob } = vi.hoisted(() => ({ downloadBlob: vi.fn() }))

vi.mock('../core/AppContainer', () => ({
  externalAppService: {
    inspect: inspectExternalApp,
    install: installExternalApp,
    list: listExternalApps,
    get: getExternalApp,
    getHealth: getExternalAppHealth,
    exportPackage,
    exportPreviewPackage,
    setEnabled: vi.fn(),
    clearData: vi.fn(),
    uninstall: vi.fn(),
  },
}))

vi.mock('../utils/LibraryFormatting', () => ({ downloadBlob }))

vi.mock('../composables/UseConfirmDialog', () => ({ confirmAction: vi.fn() }))

import ExternalAppManager from './ExternalAppManager.vue'

describe('ExternalAppManager', () => {
  it('requires an installation preview before it persists a third-party app', async () => {
    const manifest = {
      schemaVersion: 1 as const,
      id: 'com.example.counter',
      name: '离线计数器',
      version: '1.0.0',
      entry: 'index.html',
    }
    inspectExternalApp.mockResolvedValue({
      manifest,
      runtimeHtml: '<!doctype html><html></html>',
      compatibleRuntimeHtml: '<!doctype html><html></html>',
      sourceKind: 'srlapp',
      packageFingerprint: 'app-test',
      requestedPermissions: [],
      permissionLevel: 'isolated',
      requiresReauthorization: false,
      compatibility: [],
      packageBytes: 100,
    })
    installExternalApp.mockResolvedValue({ id: manifest.id, manifest })
    const wrapper = mount(ExternalAppManager)
    const file = new File(['package'], 'counter.srlapp', { type: 'application/zip' })
    const input = wrapper.get('input[type="file"]').element
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })

    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()

    expect(inspectExternalApp).toHaveBeenCalledWith(file)
    expect(installExternalApp).not.toHaveBeenCalled()
    expect(wrapper.get('.external-app-manager__preview').text()).toContain('离线计数器')

    await wrapper.get('.external-app-manager__confirm').trigger('click')
    await flushPromises()

    expect(installExternalApp).toHaveBeenCalledWith(
      expect.objectContaining({ manifest, packageFingerprint: 'app-test' }),
      'isolated',
    )
    expect(wrapper.emitted('installed')).toEqual([[manifest.id]])
  })

  it('shows each requested permission before installation', async () => {
    inspectExternalApp.mockResolvedValue({
      manifest: {
        schemaVersion: 2,
        id: 'com.example.writer',
        name: '资源整理器',
        version: '1.0.0',
        entry: 'index.html',
      },
      runtimeHtml: '<!doctype html><html></html>',
      compatibleRuntimeHtml: '<!doctype html><html></html>',
      sourceKind: 'srlapp',
      packageFingerprint: 'app-test',
      requestedPermissions: ['resources.library.read', 'resources.write'],
      permissionLevel: 'resourceAssistant',
      requiresReauthorization: false,
      compatibility: [
        {
          level: 'warning',
          code: 'isolated-persistence',
          message: '隔离运行时请改用 window.srlApp.storage。',
        },
      ],
      packageBytes: 100,
    })
    const wrapper = mount(ExternalAppManager)
    const file = new File(['package'], 'writer.srlapp', { type: 'application/zip' })
    const input = wrapper.get('input[type="file"]').element
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })

    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()

    expect(wrapper.get('.external-app-manager__permissions').text()).toContain(
      '查看资源库的资源摘要',
    )
    expect(wrapper.get('.external-app-manager__permissions').text()).toContain('修改普通资源字段')
    expect(wrapper.get('.external-app-manager__permission-accept').text()).toContain('实际调用')
    expect(wrapper.get('.external-app-manager__compatibility').text()).toContain(
      'window.srlApp.storage',
    )
  })

  it('keeps add choices and installed APP actions in compact sheets', async () => {
    listExternalApps.mockResolvedValue([
      {
        id: 'com.example.counter',
        enabled: true,
        installedAt: 1,
        updatedAt: 1,
        manifest: {
          schemaVersion: 2,
          id: 'com.example.counter',
          name: '离线计数器',
          version: '1.0.0',
          entry: 'index.html',
        },
      },
    ])
    getExternalApp.mockResolvedValue({
      id: 'com.example.counter',
      enabled: true,
      runtimeHtml: '<!doctype html><html></html>',
      installedAt: 1,
      updatedAt: 1,
      manifest: {
        schemaVersion: 2,
        id: 'com.example.counter',
        name: '离线计数器',
        version: '1.0.0',
        entry: 'index.html',
      },
    })
    getExternalAppHealth.mockResolvedValue({
      packageBytes: 100,
      dataBytes: 0,
      dataLimitBytes: 1024 * 1024,
      dataEntries: 0,
      consecutiveFailures: 0,
    })
    const wrapper = mount(ExternalAppManager)
    await flushPromises()

    await wrapper.get('[aria-label="添加第三方 APP"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('导入文件')
    expect(document.body.textContent).toContain('导入文件夹')

    await wrapper.get('.external-app-card').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('清除 APP 数据')
    expect(document.body.textContent).toContain('卸载 APP')
  })

  it('exports an app through the shared download channel', async () => {
    const manifest = {
      schemaVersion: 2 as const,
      id: 'com.example.counter',
      name: '离线计数器',
      version: '1.0.0',
      entry: 'index.html',
    }
    const packageFile = new File(['package'], 'com.example.counter-1.0.0.srlapp', {
      type: 'application/zip',
    })
    listExternalApps.mockResolvedValue([{ id: manifest.id, enabled: true, manifest }])
    getExternalApp.mockResolvedValue({ id: manifest.id, enabled: true, manifest })
    getExternalAppHealth.mockResolvedValue({
      packageBytes: 100,
      dataBytes: 0,
      dataLimitBytes: 1024 * 1024,
      dataEntries: 0,
      consecutiveFailures: 0,
    })
    exportPackage.mockResolvedValue(packageFile)
    const wrapper = mount(ExternalAppManager)
    await flushPromises()

    await wrapper.get('.external-app-card').trigger('click')
    await flushPromises()
    const exportButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === '导出为 .srlapp',
    )
    expect(exportButton).toBeDefined()
    exportButton?.click()
    await flushPromises()

    expect(exportPackage).toHaveBeenCalledWith(manifest.id)
    expect(downloadBlob).toHaveBeenCalledWith(packageFile, packageFile.name)
  })

  it('uses a single add entry instead of duplicate template or guide actions', async () => {
    const wrapper = mount(ExternalAppManager)
    await wrapper.get('[aria-label="添加第三方 APP"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('导入文件')
    expect(document.body.textContent).toContain('导入文件夹')
    expect(document.body.textContent).not.toContain('下载模板')
    expect(document.body.textContent).not.toContain('制作说明')
  })
})
