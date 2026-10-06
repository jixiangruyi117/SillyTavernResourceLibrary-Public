import { hostedApiFetchBinary } from '../core/HostedApiTransport'

export const ASSISTANT_PET_ASSET_FILES = [
  'assistant-pet.png',
  'assistant-pet-chat.png',
  'assistant-pet-curious.png',
  'assistant-pet-drool.png',
  'assistant-pet-happy.png',
  'assistant-pet-lifted.png',
  'assistant-pet-love.png',
  'assistant-pet-ponder.png',
  'assistant-pet-run.png',
  'assistant-pet-sleep.png',
  'assistant-pet-surprised.png',
  'assistant-pet-thinking.png',
  'assistant-pet-walk.png',
] as const

export type AssistantPetAssetFile = (typeof ASSISTANT_PET_ASSET_FILES)[number]
export type AssistantPetAssets = Partial<Record<AssistantPetAssetFile, string>>

export const ASSISTANT_PET_ASSET_CACHE_NAME = 'srl-assistant-pet-assets-v1'
const objectUrls = new Set<string>()

function requestFor(file: AssistantPetAssetFile): Request {
  return new Request(new URL(`/icons/${file}`, location.origin))
}

export async function hasDownloadedAssistantPetAssets(): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  const cache = await caches.open(ASSISTANT_PET_ASSET_CACHE_NAME)
  const keys = new Set((await cache.keys()).map((request) => request.url))
  return ASSISTANT_PET_ASSET_FILES.every((file) => keys.has(requestFor(file).url))
}

export async function loadAssistantPetAssets(): Promise<AssistantPetAssets | undefined> {
  if (!('caches' in globalThis)) return undefined
  const cache = await caches.open(ASSISTANT_PET_ASSET_CACHE_NAME)
  const responses = await Promise.all(
    ASSISTANT_PET_ASSET_FILES.map(
      async (file) => [file, await cache.match(requestFor(file))] as const,
    ),
  )
  if (responses.some(([, response]) => !response?.ok)) return undefined
  const assets: AssistantPetAssets = {}
  for (const [file, response] of responses) {
    const blob = await response!.blob()
    const url = URL.createObjectURL(blob)
    objectUrls.add(url)
    assets[file] = url
  }
  return assets
}

export async function downloadAssistantPetAssets(): Promise<void> {
  if (!('caches' in globalThis)) throw new Error('此浏览器不支持桌宠图片缓存')
  const cache = await caches.open(ASSISTANT_PET_ASSET_CACHE_NAME)
  try {
    for (const file of ASSISTANT_PET_ASSET_FILES) {
      const request = requestFor(file)
      // In the packaged APK, relative fetches resolve to the WebView's local shell.
      // Fetch the public artwork through the shared native-aware transport instead.
      const response = await hostedApiFetchBinary(`/icons/${file}`, 2 * 1024 * 1024)
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png'))
        throw new Error('桌宠图片下载失败')
      await cache.put(request, response.clone())
    }
    if (!(await hasDownloadedAssistantPetAssets())) throw new Error('桌宠图片未能完整保存')
  } catch (error) {
    await caches.delete(ASSISTANT_PET_ASSET_CACHE_NAME)
    throw error
  }
}

export function releaseAssistantPetAssets(assets: AssistantPetAssets): void {
  for (const url of Object.values(assets)) {
    if (!url) continue
    URL.revokeObjectURL(url)
    objectUrls.delete(url)
  }
}

export async function clearAssistantPetAssets(): Promise<void> {
  if ('caches' in globalThis) await caches.delete(ASSISTANT_PET_ASSET_CACHE_NAME)
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
}
