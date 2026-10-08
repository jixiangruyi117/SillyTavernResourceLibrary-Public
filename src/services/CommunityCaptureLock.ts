export const captureSaves = new Map<string, Promise<unknown>>()
const captureReaders = new Map<string, Set<Promise<unknown>>>()

export async function withCaptureSave<T>(
  sourceKeyHash: string,
  save: () => Promise<T>,
  mode: 'shared' | 'exclusive' = 'exclusive',
): Promise<T> {
  const previous = captureSaves.get(sourceKeyHash)
  const readers = captureReaders.get(sourceKeyHash) ?? new Set<Promise<unknown>>()
  const dependencies = mode === 'exclusive' ? [previous, ...readers] : [previous]
  const pending = Promise.all(dependencies.map((entry) => entry?.catch(() => undefined))).then(
    () => {
      if (typeof navigator === 'undefined' || !navigator.locks) return save()
      const name = `srl-community-source-capture:${sourceKeyHash}`
      return mode === 'shared'
        ? navigator.locks.request(name, { mode }, save)
        : navigator.locks.request(name, save)
    },
  )
  if (mode === 'exclusive') captureSaves.set(sourceKeyHash, pending)
  else {
    readers.add(pending)
    captureReaders.set(sourceKeyHash, readers)
  }
  try {
    return await pending
  } finally {
    if (captureSaves.get(sourceKeyHash) === pending) captureSaves.delete(sourceKeyHash)
    readers.delete(pending)
    if (captureReaders.get(sourceKeyHash) === readers && !readers.size)
      captureReaders.delete(sourceKeyHash)
  }
}
