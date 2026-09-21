/** @vitest-environment jsdom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FeatureAppIcon from './FeatureAppIcon.vue'

const builtInIcons = [
  'draw',
  'appearance',
  'folders',
  'cloud',
  'bridge',
  'stitch',
  'frontend',
  'imageAlbum',
  'persona',
  'bundle',
  'extensions',
]

describe('FeatureAppIcon', () => {
  it.each(builtInIcons)('renders the %s built-in icon as SVG', (name) => {
    const wrapper = mount(FeatureAppIcon, { props: { name } })

    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 48 48')
  })
})
