import {
  scanVersionRecognition,
  type VersionRecognitionWorkerRequest,
} from '../services/ResourceVersionRecognitionProtocol'

const context = self as unknown as {
  onmessage: (event: MessageEvent<VersionRecognitionWorkerRequest>) => void
  postMessage(value: unknown): void
}
context.onmessage = (event) => {
  try {
    context.postMessage(scanVersionRecognition(event.data))
  } catch (error) {
    context.postMessage({ error: error instanceof Error ? error.message : '历史版本扫描失败' })
  }
}
