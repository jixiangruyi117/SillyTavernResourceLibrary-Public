import type { VersionMatchOptions } from './ResourceVersionMatcher'
import type { ResourceSummary } from '../types/Resource'
import { withAbort } from '../utils/Abortable'
import { computeWorkerPool } from '../core/ComputeWorkerPool'
import {
  scanVersionRecognition,
  toVersionRecognitionSummary,
  type VersionRecognitionResult,
  type VersionRecognitionWorkerRequest,
  type VersionRecognitionWorkerResult,
} from './ResourceVersionRecognitionProtocol'

export function recognizeStoredVersions(
  resources: ResourceSummary[],
  versions: ResourceSummary[],
  options: VersionMatchOptions = {},
  signal?: AbortSignal,
): Promise<VersionRecognitionResult> {
  return withAbort(
    computeWorkerPool.run(
      'version-recognition',
      () => scanStoredVersions(resources, versions, options, signal),
      signal,
    ),
    signal,
  )
}

async function scanStoredVersions(
  resources: ResourceSummary[],
  versions: ResourceSummary[],
  options: VersionMatchOptions = {},
  signal?: AbortSignal,
): Promise<VersionRecognitionResult> {
  signal?.throwIfAborted()
  let worker: Worker | undefined
  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker(
        new URL('../workers/ResourceVersionRecognitionWorker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      /* Platforms without module Workers use the same optimized matcher. */
    }
  }
  try {
    const request: VersionRecognitionWorkerRequest = { resources: [], versions: [], options }
    for (const [source, destination] of [
      [resources, request.resources],
      [versions, request.versions],
    ] as const) {
      for (let start = 0; start < source.length; start += 256) {
        signal?.throwIfAborted()
        for (const resource of source.slice(start, start + 256))
          destination.push(toVersionRecognitionSummary(resource))
        if (start + 256 < source.length)
          await withAbort(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal)
      }
    }
    signal?.throwIfAborted()
    const result = worker
      ? await withAbort(
          new Promise<VersionRecognitionWorkerResult>((resolve, reject) => {
            worker!.addEventListener(
              'message',
              (event: MessageEvent<VersionRecognitionWorkerResult & { error?: string }>) => {
                if (event.data.error) reject(new Error(event.data.error))
                else resolve(event.data)
              },
              { once: true },
            )
            worker!.addEventListener(
              'error',
              () => reject(new Error('历史版本扫描 Worker 执行失败')),
              { once: true },
            )
            worker!.postMessage(request)
          }),
          signal,
        )
      : scanVersionRecognition(request)
    signal?.throwIfAborted()
    const byId = new Map(resources.map((resource) => [resource.id, resource]))
    return {
      report: result.report,
      groups: result.groups.map(({ resourceIds, ...group }) => ({
        ...group,
        resources: resourceIds.map((id) => byId.get(id)!),
      })),
    }
  } finally {
    worker?.terminate()
  }
}
