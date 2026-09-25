/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
import { resetOpaquePreviewDocument, seedOpaquePreviewDocument } from './OpaquePreviewDocument'

it('seeds a fresh bootstrap after fullscreen reparenting, then connects the real document', () => {
  const postMessage = vi.fn()
  const frame = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement
  expect(seedOpaquePreviewDocument(frame, '<p>APP</p>')).toBe(true)
  expect(seedOpaquePreviewDocument(frame, '<p>APP</p>')).toBe(false)
  resetOpaquePreviewDocument(frame)
  expect(seedOpaquePreviewDocument(frame, '<p>APP</p>')).toBe(true)
  expect(seedOpaquePreviewDocument(frame, '<p>APP</p>')).toBe(false)
  expect(postMessage).toHaveBeenCalledTimes(2)
  expect(postMessage).toHaveBeenLastCalledWith(
    { type: 'srl:preview-document', html: '<p>APP</p>' },
    '*',
  )
})

it('does not reset another iframe or expose a host origin', () => {
  const frame = () => ({ contentWindow: { postMessage: vi.fn() } }) as unknown as HTMLIFrameElement
  const a = frame()
  const b = frame()
  seedOpaquePreviewDocument(a, 'A')
  seedOpaquePreviewDocument(b, 'B')
  resetOpaquePreviewDocument(a)
  expect(seedOpaquePreviewDocument(b, 'B')).toBe(false)
  expect(seedOpaquePreviewDocument(a, 'A')).toBe(true)
})
