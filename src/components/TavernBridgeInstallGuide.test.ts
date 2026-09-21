/** @vitest-environment jsdom */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BRIDGE_EXTENSION_NAME,
  BRIDGE_DOWNLOAD_VERSION,
  BRIDGE_REPO_URL,
  BRIDGE_SERVER_PLUGIN_INSTALL_COMMAND,
  BRIDGE_SERVER_PLUGIN_SCRIPT_URL,
} from '../utils/BridgeInstall'
import TavernBridgeInstallGuide from './TavernBridgeInstallGuide.vue'

const writeText = vi.fn(async (_value: string) => undefined)

describe('TavernBridgeInstallGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  it('推荐区展示 git 仓库链接、三步引导与安装验证说明', () => {
    const wrapper = mount(TavernBridgeInstallGuide)
    expect(wrapper.text()).toContain(BRIDGE_REPO_URL)
    const repoLink = wrapper.find(`a[href="${BRIDGE_REPO_URL}"]`)
    expect(repoLink.exists()).toBe(true)
    const steps = wrapper.findAll('.tavern-bridge-install__steps li')
    expect(steps).toHaveLength(3)
    expect(steps[1].text()).toContain('Install Extension')
    expect(wrapper.text()).toContain(`「${BRIDGE_EXTENSION_NAME}」`)
    expect(wrapper.text()).toContain('管理扩展')
  })

  it('复制按钮把仓库链接与一键命令写入剪贴板并显示已复制', async () => {
    const wrapper = mount(TavernBridgeInstallGuide)
    const buttons = wrapper.findAll('.tavern-bridge-install__copyline button')
    await buttons[0].trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(BRIDGE_REPO_URL)
    expect(buttons[0].text()).toBe('已复制')
    await buttons[1].trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(BRIDGE_SERVER_PLUGIN_INSTALL_COMMAND)
  })

  it('剪贴板不可用时给出可读提示而不是静默失败', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    const wrapper = mount(TavernBridgeInstallGuide)
    await wrapper.findAll('.tavern-bridge-install__copyline button')[0].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('复制失败')
  })

  it('服务端插件区带 Git Bash 提示与脚本源码链接，不出现整仓 git clone 写法', () => {
    const wrapper = mount(TavernBridgeInstallGuide)
    expect(wrapper.text()).toContain(BRIDGE_SERVER_PLUGIN_INSTALL_COMMAND)
    expect(wrapper.text()).toContain('Git Bash')
    expect(wrapper.text()).toContain('可先阅读脚本内容再执行')
    expect(wrapper.findAll('.tavern-bridge-install__notes li')).toHaveLength(3)
    expect(wrapper.find(`a[href="${BRIDGE_SERVER_PLUGIN_SCRIPT_URL}"]`).exists()).toBe(true)
    expect(wrapper.text()).not.toContain('git clone')
  })

  it('三个 ZIP 收进离线折叠区并注明适用场景与更新方式', () => {
    const wrapper = mount(TavernBridgeInstallGuide)
    const offline = wrapper.find('.tavern-bridge-install__offline')
    expect(offline.exists()).toBe(true)
    const links = offline.findAll('a[download]')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.attributes('href')).toContain(`v${BRIDGE_DOWNLOAD_VERSION}.zip`)
    }
    expect(offline.text()).toContain('没有 git 环境')
    expect(offline.text()).toContain('重新下载离线包')
  })
})
