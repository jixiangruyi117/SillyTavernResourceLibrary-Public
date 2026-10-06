import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLoadedObjectUrl } from './UseLoadedObjectUrl'

beforeEach(() => {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('useLoadedObjectUrl', () => {
  it('releases the old URL only after the replacement has loaded', () => {
    const scope = effectScope()
    const preview = scope.run(() => useLoadedObjectUrl())!

    preview.replacePreview('blob:first')
    preview.replacePreview('blob:second')

    expect(preview.previewUrl.value).toBe('blob:second')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    preview.confirmPreviewLoaded()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:second')
    scope.stop()
  })

  it('releases the current and pending URLs when the owning scope is disposed', () => {
    const scope = effectScope()
    const preview = scope.run(() => useLoadedObjectUrl())!

    preview.replacePreview('blob:first')
    preview.replacePreview('blob:second')
    scope.stop()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second')
    expect(preview.previewUrl.value).toBe('')
  })

  it('releases the current URL immediately when the preview is cleared', () => {
    const scope = effectScope()
    const preview = scope.run(() => useLoadedObjectUrl())!

    preview.replacePreview('blob:first')
    preview.replacePreview('')

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(preview.previewUrl.value).toBe('')
    scope.stop()
  })
})
