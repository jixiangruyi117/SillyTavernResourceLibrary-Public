/// <reference lib="webworker" />

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

interface HashWorkerRequest {
  id: string
  blob: Blob
}

self.addEventListener('message', async (event: MessageEvent<HashWorkerRequest>) => {
  const { id, blob } = event.data
  try {
    const hash = sha256.create()
    const reader = blob.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
    }
    self.postMessage({ id, hash: bytesToHex(hash.digest()) })
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : '哈希 Worker 执行失败',
    })
  }
})
