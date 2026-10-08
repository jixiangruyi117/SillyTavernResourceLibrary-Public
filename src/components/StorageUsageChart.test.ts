/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StorageUsageChart from './StorageUsageChart.vue'

describe('storage usage chart', () => {
  it('opens the same details from a slice, keyboard or readable legend including tiny parts', async () => {
    const view = mount(StorageUsageChart, {
      props: {
        totalLabel: '本次盘点 1 GiB',
        slices: [
          { id: 'originals', label: '资源原件', bytes: 1024 ** 3, color: '#407e79' },
          { id: 'cache', label: '临时缓存', bytes: 1, color: '#b8943e' },
        ],
      },
    })
    await view.get('path').trigger('click')
    await view.findAll('path')[1]!.trigger('keydown', { key: 'Enter' })
    await view.findAll('button')[1]!.trigger('click')
    expect(view.emitted('select')).toEqual([['originals'], ['cache'], ['cache']])
    expect(view.text()).toContain('<1%')
    expect(view.get('path').attributes('d')).not.toContain('NaN')
    view.unmount()
  })
  it('draws a full circle for a single category and omits zero-byte categories', () => {
    const view = mount(StorageUsageChart, {
      props: {
        totalLabel: '盘点',
        slices: [
          { id: 'all', label: '浏览器存储', bytes: 100, color: '#407e79' },
          { id: 'empty', label: '空', bytes: 0, color: '#b8943e' },
        ],
      },
    })
    expect(view.findAll('path')).toHaveLength(1)
    expect(view.get('path').attributes('d')).toContain('80 150')
    expect(view.text()).toContain('100%')
    view.unmount()
  })
})
