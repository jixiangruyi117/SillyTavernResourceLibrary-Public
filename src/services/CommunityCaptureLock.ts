export const captureSaves = new Map<string, Promise<unknown>>()

export async function withCaptureSave<T>(
  sourceKeyHash: string,
  save: () => Promise<T>,
): Promise<T> {
  const previous = captureSaves.get(sourceKeyHash)
  const pending = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(`srl-community-source-capture:${sourceKeyHash}`, save)
      : save(),
  )
  captureSaves.set(sourceKeyHash, pending)
  try {
    return await pending
  } finally {
    if (captureSaves.get(sourceKeyHash) === pending) captureSaves.delete(sourceKeyHash)
  }
}
