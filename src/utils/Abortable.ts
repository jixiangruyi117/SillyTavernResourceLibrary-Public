/** Stop waiting for non-cancellable storage/legacy bridges; consume late settlements. */
export function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('操作已取消', 'AbortError'))
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}
