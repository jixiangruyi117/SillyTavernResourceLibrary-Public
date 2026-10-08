import { afterEach, describe, expect, it, vi } from 'vitest'
import { recognizeStoredVersions } from './ResourceVersionRecognitionService'
import {
  scanVersionRecognition,
  type VersionRecognitionWorkerRequest,
} from './ResourceVersionRecognitionProtocol'
import type { ResourceSummary } from '../types/Resource'

const resources = ['a', 'b'].map((id, index) => ({
  id,
  type: 'characterCard',
  name: id,
  fileName: `${id}.png`,
  mimeType: 'image/png',
  contentHash: id,
  fileSize: 1,
  createdAt: index,
  updatedAt: index,
  tags: ['original'],
  description: '',
  favorite: false,
  categoryId: '',
  metadata: {
    cardContentHash: id,
    cardCoreHash: 'same-core',
    card: { data: { description: 'large private body' } },
  },
})) as ResourceSummary[]
afterEach(() => vi.unstubAllGlobals())

describe('version recognition Worker boundary', () => {
  it('transfers only matching summaries and restores original resource references', async () => {
    let payload!: VersionRecognitionWorkerRequest
    const terminate = vi.fn()
    class FakeWorker {
      listeners = new Map<string, (event: { data: unknown }) => void>()
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        this.listeners.set(type, listener)
      }
      postMessage(request: VersionRecognitionWorkerRequest) {
        payload = request
        queueMicrotask(() =>
          this.listeners.get('message')!({ data: scanVersionRecognition(request) }),
        )
      }
      terminate = terminate
    }
    vi.stubGlobal('Worker', FakeWorker)
    const result = await recognizeStoredVersions(resources, [])
    expect(JSON.stringify(payload)).not.toContain('large private body')
    expect(payload.resources[0]!.tags).toEqual([])
    expect(result.groups[0]!.resources).toEqual([resources[1], resources[0]])
    expect(result.groups[0]!.resources[0]).toBe(resources[1])
    expect(terminate).toHaveBeenCalledOnce()
  })
  it('closing the panel terminates a pending scan without waiting for a Worker reply', async () => {
    const posted = vi.fn()
    const terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        addEventListener() {}
        postMessage = posted
        terminate = terminate
      },
    )
    const controller = new AbortController()
    const pending = recognizeStoredVersions(resources, [], {}, controller.signal)
    await vi.waitFor(() => expect(posted).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminate).toHaveBeenCalledOnce()
  })
  it('platforms without Workers use the same candidate semantics', async () => {
    vi.stubGlobal('Worker', undefined)
    const result = await recognizeStoredVersions(resources, [])
    expect(result.report.candidateGroups).toBe(1)
    expect(result.groups[0]).toMatchObject({ matchKind: 'version', recommendedKeeperId: 'b' })
  })
})
