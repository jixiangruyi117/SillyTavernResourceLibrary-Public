type ResourceDisposer = () => void

export class ResourceScope {
  private readonly disposers: ResourceDisposer[] = []
  private disposed = false

  add(disposer: ResourceDisposer): ResourceDisposer {
    if (this.disposed) {
      disposer()
      return disposer
    }
    this.disposers.push(disposer)
    return disposer
  }

  timeout(callback: () => void, delay: number): number {
    const id = window.setTimeout(callback, delay)
    this.add(() => window.clearTimeout(id))
    return id
  }

  interval(callback: () => void, delay: number): number {
    const id = window.setInterval(callback, delay)
    this.add(() => window.clearInterval(id))
    return id
  }

  abortController(): AbortController {
    const controller = new AbortController()
    this.add(() => controller.abort())
    return controller
  }

  objectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    this.add(() => URL.revokeObjectURL(url))
    return url
  }

  observer<T extends { disconnect(): void }>(observer: T): T {
    this.add(() => observer.disconnect())
    return observer
  }

  worker<T extends { terminate(): void }>(worker: T): T {
    this.add(() => worker.terminate())
    return worker
  }

  iframe(frame: HTMLIFrameElement): HTMLIFrameElement {
    this.add(() => {
      frame.removeAttribute('srcdoc')
      frame.src = 'about:blank'
    })
    return frame
  }

  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): ResourceDisposer
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): ResourceDisposer
  listen(
    target: Window | Document,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): ResourceDisposer {
    target.addEventListener(type, listener, options)
    return this.add(() => target.removeEventListener(type, listener, options))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const disposer of this.disposers.splice(0).reverse()) disposer()
  }
}
