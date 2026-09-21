interface SearchItem {
  id: string
  contentHash: string
  blob?: Blob
}

interface SearchRequest {
  type: 'search'
  requestId: number
  query: string
  items: SearchItem[]
}

interface ResetRequest {
  type: 'reset'
}

const contentByHash = new Map<string, string>()

self.onmessage = async (event: MessageEvent<SearchRequest | ResetRequest>) => {
  const request = event.data
  if (request.type === 'reset') {
    contentByHash.clear()
    return
  }

  const matchedIds: string[] = []
  const indexedHashes: string[] = []
  for (const item of request.items) {
    let content = contentByHash.get(item.contentHash)
    if (content === undefined && item.blob) {
      content = (await item.blob.text()).toLocaleLowerCase()
      contentByHash.set(item.contentHash, content)
      indexedHashes.push(item.contentHash)
    }
    if (content?.includes(request.query)) matchedIds.push(item.id)
  }

  self.postMessage({
    type: 'result',
    requestId: request.requestId,
    matchedIds,
    indexedHashes,
  })
}

export {}
