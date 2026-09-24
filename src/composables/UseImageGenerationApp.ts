import { computed, onUnmounted, ref, watch } from 'vue'
import { confirmAction } from '../composables/UseConfirmDialog'
import { frontendWorkshopImageGenerationService } from '../core/ImageGenerationContainer'
import {
  frontendWorkshopImageHostingService,
  generatedImageAlbumService,
} from '../core/ImageAlbumContainer'
import { isNativeFileExportAvailable, saveBlobToNativeDestination } from '../core/NativeFileExport'
import {
  frontendWorkshopImageDraftService,
  type FrontendWorkshopImageDraft,
  type FrontendWorkshopImageTemplate,
} from '../services/FrontendWorkshopImageDraftService'
import type {
  FrontendWorkshopGeneratedImage,
  FrontendWorkshopImageGenerationRequest,
  FrontendWorkshopImageModelOption,
  FrontendWorkshopImageProvider,
} from '../services/FrontendWorkshopImageGenerationService'
import {
  NOVELAI_MODELS,
  previewOpenAiImageRequest,
} from '../services/FrontendWorkshopImageGenerationService'
import {
  getImageGenerationCapabilities,
  RELAY_CAPABILITY_KEYS,
  type NovelAiQualityMode,
  type RelayCapabilityKey,
} from '../services/ImageGenerationCapabilities'

export type ImageGenerationAppEvents = { back: []; 'open-album': [] }

export type AppSection = 'generate' | 'result' | 'storage' | 'cloud' | 'connection'

export type ProviderTab = 'openai' | 'novelai'

export type InternalTab =
  'prompt' | 'characters' | 'reference' | 'edit' | 'settings' | 'connection' | 'request'

export function useImageGenerationApp() {
  const section = ref<AppSection>('generate')

  const provider = ref<ProviderTab>('novelai')

  const config = ref({
    openai: frontendWorkshopImageGenerationService.getSavedConfig('openai'),
    novelai: frontendWorkshopImageGenerationService.getSavedConfig('novelai'),
  })

  const prompt = ref('')

  const imageText = ref('')

  const promptHints = ref({ 人物: '', 场景: '', 构图: '', 风格: '' })

  const negativePrompt = ref('')

  const width = ref(832)

  const height = ref(1216)

  const openAiQuality = ref<'auto' | 'low' | 'medium' | 'high'>('auto')

  const openAiBackground = ref<'auto' | 'opaque' | 'transparent'>('auto')

  const outputFormat = ref<'png' | 'jpeg' | 'webp'>('png')

  const outputCompression = ref(90)

  const novelAiSampler = ref<
    | 'k_dpmpp_2m'
    | 'k_euler_ancestral'
    | 'k_euler'
    | 'k_dpm_2'
    | 'k_dpmpp_2s_ancestral'
    | 'k_dpmpp_sde'
    | 'k_dpm_fast'
    | 'ddim'
  >('k_dpmpp_2m')

  const novelAiSteps = ref(28)

  const novelAiScale = ref(5)

  const novelAiSeed = ref<number | undefined>()

  const novelAiQualityMode = ref<NovelAiQualityMode>('standard')

  const novelAiUcPreset = ref('none')

  const novelAiTransparentBackground = ref(false)

  const novelAiSmea = ref(false)

  const novelAiSmeaDyn = ref(false)

  const busy = ref(false)

  const error = ref('')

  const notice = ref('')

  const candidates = ref<
    Array<{ image: FrontendWorkshopGeneratedImage; albumItemId: string; hostedUrl: string }>
  >([])

  const candidateIndex = ref(0)

  const currentCandidate = computed(() => candidates.value[candidateIndex.value])

  const result = computed(() => currentCandidate.value?.image)

  const resultUrl = computed(() => result.value?.dataUrl ?? result.value?.temporaryUrl ?? '')

  const albumSaved = computed(() => Boolean(currentCandidate.value?.albumItemId))

  const assetName = ref('')

  const category = ref('')

  const hostedUrl = computed(() => currentCandidate.value?.hostedUrl ?? '')

  const hostingBusy = ref(false)

  const rememberedImageBed = frontendWorkshopImageHostingService.getSelfHostedConfiguration()

  const selfHostedOrigin = ref(rememberedImageBed?.origin ?? '')

  const selfHostedToken = ref(rememberedImageBed?.token ?? '')

  const rememberSelfHosted = ref(rememberedImageBed?.remember ?? false)

  const selfHostedReady = ref(Boolean(rememberedImageBed))

  let generationController: AbortController | undefined

  let draftSaveTimer: ReturnType<typeof setTimeout> | undefined

  const internalTab = ref<InternalTab>('prompt')

  const modelOptions = ref<FrontendWorkshopImageModelOption[]>([])

  const modelsBusy = ref(false)

  const modelOptionsEndpoint = ref('')

  const characters = ref<
    Array<{ prompt: string; negativePrompt: string; positioned: boolean; x: number; y: number }>
  >([])

  const inputImages = ref<
    Array<{
      blob: Blob
      url: string
      name: string
      role: 'identity' | 'outfit' | 'composition' | 'scene' | 'reference'
    }>
  >([])

  const editInstruction = ref('')

  const preserve = ref<NonNullable<FrontendWorkshopImageGenerationRequest['openAiPreserve']>>({})

  const mask = ref<File>()

  const parentImageId = ref('')

  const additionalJson = ref('')

  const currentConfig = computed(() => config.value[provider.value])

  const visibleModels = computed(() => {
    const options =
      provider.value === 'novelai'
        ? NOVELAI_MODELS
        : modelOptions.value.length
          ? modelOptions.value
          : provider.value === 'openai'
            ? ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'].map((id) => ({ id, name: id }))
            : []
    return options.some((item) => item.id === currentConfig.value.model)
      ? options
      : [...options, { id: currentConfig.value.model, name: currentConfig.value.model }]
  })

  const previewMeta = computed(() => {
    const image = result.value
    if (image) {
      const model = image.manifest?.model ?? '未知模型'
      return `${model} · ${image.width} × ${image.height}`
    }
    return `${currentConfig.value.model} · ${width.value} × ${height.value}`
  })

  const capabilities = computed(() =>
    getImageGenerationCapabilities(
      provider.value,
      currentConfig.value.model,
      currentConfig.value.relayCapabilities,
      currentConfig.value.endpoint,
    ),
  )

  const internalTabs = computed<Array<{ id: InternalTab; label: string }>>(() =>
    provider.value === 'novelai'
      ? [
          { id: 'prompt', label: 'Prompt' },
          { id: 'characters', label: '角色' },
          { id: 'reference', label: '参考' },
          { id: 'settings', label: '设置' },
        ]
      : [
          { id: 'prompt', label: 'Prompt' },
          { id: 'reference', label: '参考' },
          { id: 'edit', label: '编辑' },
          { id: 'settings', label: '设置' },
          { id: 'request', label: '请求' },
        ],
  )

  const capabilityLabels: Record<RelayCapabilityKey, string> = {
    quality: 'quality',
    outputFormat: 'output_format',
    outputCompression: 'output_compression',
    background: 'background',
    imageEdit: 'edits',
    imageInput: 'image input',
    multiImage: 'multi-image',
    mask: 'mask',
  }

  const preserveLabels = {
    identity: '人物身份',
    face: '面部',
    hairstyle: '发型',
    composition: '构图',
    background: '背景',
    lighting: '光照',
  }

  const openAiSize = computed({
    get: () => `${width.value}x${height.value}`,
    set: (value) => {
      ;[width.value, height.value] = value.split('x').map(Number)
    },
  })

  const activeImageText = computed(() =>
    capabilities.value.textRendering === 'supported' ? imageText.value.trim() : '',
  )

  const generationRequest = computed<FrontendWorkshopImageGenerationRequest>(() => ({
    prompt: [
      prompt.value,
      ...(provider.value === 'openai'
        ? Object.entries(promptHints.value)
            .filter(([, value]) => value.trim())
            .map(([key, value]) => `${key}：${value.trim()}`)
        : []),
      ...(activeImageText.value ? [`Text in image: ${JSON.stringify(activeImageText.value)}`] : []),
    ]
      .filter(Boolean)
      .join('\n'),
    width: width.value,
    height: height.value,
    ...(provider.value === 'novelai'
      ? {
          negativePrompt: negativePrompt.value,
          seed: novelAiSeed.value,
          novelAiSampler: novelAiSampler.value,
          novelAiSteps: novelAiSteps.value,
          novelAiScale: novelAiScale.value,
          novelAiQualityMode: activeImageText.value ? 'off' : novelAiQualityMode.value,
          novelAiUcPreset: novelAiUcPreset.value,
          novelAiTransparentBackground:
            capabilities.value.transparentBackground === 'supported' &&
            novelAiTransparentBackground.value,
          novelAiCharacters:
            capabilities.value.multiCharacter === 'supported'
              ? characters.value.map((c) => ({
                  prompt: c.prompt,
                  negativePrompt: c.negativePrompt,
                  ...(c.positioned ? { position: { x: c.x, y: c.y } } : {}),
                }))
              : [],
          novelAiSmea: capabilities.value.smea === 'supported' && novelAiSmea.value,
          novelAiSmeaDyn: capabilities.value.smea === 'supported' && novelAiSmeaDyn.value,
        }
      : {
          openAiQuality: openAiQuality.value,
          openAiBackground: openAiBackground.value,
          outputFormat: outputFormat.value,
          outputCompression: outputCompression.value,
          openAiInputImages: inputImages.value.map((image) => ({
            blob: image.blob,
            role: image.role,
          })),
          openAiEditInstruction: editInstruction.value,
          openAiPreserve: { ...preserve.value },
          openAiMask: mask.value,
          parentImageId: parentImageId.value || undefined,
          additionalJson: additionalJson.value,
        }),
  }))

  const requestPreview = computed(() => {
    if (provider.value !== 'openai') return { text: '', error: '' }
    try {
      return {
        text: JSON.stringify(
          previewOpenAiImageRequest(currentConfig.value, generationRequest.value),
          null,
          2,
        ),
        error: '',
      }
    } catch (cause) {
      return { text: '', error: cause instanceof Error ? cause.message : '请求无效' }
    }
  })

  const canGenerate = computed(
    () =>
      busy.value ||
      (!hostingBusy.value &&
        Boolean(
          prompt.value.trim() || (provider.value !== 'novelai' && editInstruction.value.trim()),
        ) &&
        !requestPreview.value.error),
  )

  watch([provider, () => currentConfig.value.model], () => {
    if (provider.value !== 'novelai') return
    if (!capabilities.value.qualityModes.includes(novelAiQualityMode.value)) {
      novelAiQualityMode.value = capabilities.value.qualityModes.includes('standard')
        ? 'standard'
        : 'off'
    }
    if (capabilities.value.ucPreset !== 'supported') novelAiUcPreset.value = 'none'
  })

  const templates = ref(frontendWorkshopImageDraftService.listTemplates())

  const templateName = ref('')

  const canSaveToPhone = isNativeFileExportAvailable()

  function currentDraft(): FrontendWorkshopImageDraft {
    return {
      version: 1,
      provider: provider.value,
      endpoint: config.value[provider.value].endpoint,
      model: config.value[provider.value].model,
      prompt: prompt.value,
      negativePrompt: negativePrompt.value,
      imageText: imageText.value,
      promptHints: { ...promptHints.value },
      novelAiCharacters: characters.value.map((character) => ({ ...character })),
      width: width.value,
      height: height.value,
      openAiQuality: openAiQuality.value,
      openAiBackground: openAiBackground.value,
      outputFormat: outputFormat.value,
      outputCompression: outputCompression.value,
      novelAiSampler: novelAiSampler.value,
      novelAiSteps: novelAiSteps.value,
      novelAiScale: novelAiScale.value,
      novelAiSeed: novelAiSeed.value,
      novelAiQualityToggle: novelAiQualityMode.value !== 'off',
      novelAiQualityMode: novelAiQualityMode.value,
      novelAiUcPreset: novelAiUcPreset.value,
      novelAiTransparentBackground: novelAiTransparentBackground.value,
      novelAiSmea: novelAiSmea.value,
      novelAiSmeaDyn: novelAiSmeaDyn.value,
      savedAt: Date.now(),
    }
  }

  function applyDraft(draft?: FrontendWorkshopImageDraft): void {
    if (draft) {
      config.value[provider.value].endpoint =
        draft.endpoint ||
        frontendWorkshopImageGenerationService.defaultConfig(provider.value).endpoint
      config.value[provider.value].model = draft.model
    }
    prompt.value = draft?.prompt ?? ''
    negativePrompt.value = draft?.negativePrompt ?? ''
    imageText.value = draft?.imageText ?? ''
    promptHints.value = { 人物: '', 场景: '', 构图: '', 风格: '', ...draft?.promptHints }
    characters.value = (draft?.novelAiCharacters ?? []).map((character) => ({ ...character }))
    width.value = draft?.width ?? (provider.value === 'novelai' ? 832 : 1024)
    height.value = draft?.height ?? (provider.value === 'novelai' ? 1216 : 1024)
    openAiQuality.value = draft?.openAiQuality ?? 'auto'
    openAiBackground.value = draft?.openAiBackground ?? 'auto'
    outputFormat.value = draft?.outputFormat ?? 'png'
    outputCompression.value = draft?.outputCompression ?? 90
    novelAiSampler.value = draft?.novelAiSampler ?? 'k_dpmpp_2m'
    novelAiSteps.value = draft?.novelAiSteps ?? 28
    novelAiScale.value = draft?.novelAiScale ?? 5
    novelAiSeed.value = draft?.novelAiSeed
    novelAiQualityMode.value =
      draft?.novelAiQualityMode ?? (draft?.novelAiQualityToggle === false ? 'off' : 'standard')
    novelAiUcPreset.value = draft?.novelAiUcPreset ?? 'none'
    novelAiTransparentBackground.value = draft?.novelAiTransparentBackground ?? false
    novelAiSmea.value = draft?.novelAiSmea ?? false
    novelAiSmeaDyn.value = draft?.novelAiSmeaDyn ?? false
  }

  const savedDraft = frontendWorkshopImageDraftService.loadDraft()

  if (savedDraft) {
    provider.value = savedDraft.provider
    applyDraft(savedDraft)
  }

  watch(
    currentDraft,
    (draft) => {
      if (draftSaveTimer !== undefined) clearTimeout(draftSaveTimer)
      const snapshot = { ...draft }
      draftSaveTimer = setTimeout(() => {
        draftSaveTimer = undefined
        frontendWorkshopImageDraftService.saveDraft(snapshot)
      }, 300)
    },
    { deep: true },
  )

  function flushDraft(): void {
    if (draftSaveTimer !== undefined) {
      clearTimeout(draftSaveTimer)
      draftSaveTimer = undefined
    }
    frontendWorkshopImageDraftService.saveDraft(currentDraft())
  }

  function saveTemplate(): void {
    if (!templateName.value.trim()) return
    frontendWorkshopImageDraftService.saveTemplate(templateName.value, currentDraft())
    templates.value = frontendWorkshopImageDraftService.listTemplates()
    templateName.value = ''
  }

  function useTemplate(template: FrontendWorkshopImageTemplate): void {
    chooseProvider(template.draft.provider)
    applyDraft(template.draft)
  }

  function overwriteTemplate(template: FrontendWorkshopImageTemplate): void {
    frontendWorkshopImageDraftService.overwriteTemplate(template.id, currentDraft())
    templates.value = frontendWorkshopImageDraftService.listTemplates()
  }

  async function deleteTemplate(template: FrontendWorkshopImageTemplate): Promise<void> {
    if (
      !(await confirmAction({
        title: '删除生图模板',
        message: `删除“${template.name}”？`,
        confirmLabel: '删除模板',
        danger: true,
      }))
    )
      return
    frontendWorkshopImageDraftService.deleteTemplate(template.id)
    templates.value = frontendWorkshopImageDraftService.listTemplates()
  }

  async function saveToPhone(): Promise<void> {
    if (!result.value || !canSaveToPhone) return
    try {
      const image = result.value
      await saveBlobToNativeDestination(
        await frontendWorkshopImageGenerationService.toBlob(image),
        `${assetName.value.trim() || image.id}.${image.extension}`,
        'pictures',
      )
      notice.value = '已保存到手机相册。'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存到手机相册失败。'
    }
  }

  async function loadModels(): Promise<void> {
    if (modelsBusy.value) return
    modelsBusy.value = true
    error.value = ''
    const current = { ...currentConfig.value }
    try {
      const models = await frontendWorkshopImageGenerationService.listModels(current)
      if (current.provider !== provider.value || current.endpoint !== currentConfig.value.endpoint)
        return
      modelOptions.value = models.options
      modelOptionsEndpoint.value = current.endpoint.trim()
      applyModelMetadata()
      notice.value = models.message
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '拉取模型失败'
    } finally {
      modelsBusy.value = false
    }
  }

  function applyModelMetadata(): void {
    if (provider.value !== 'openai') return
    const current = config.value.openai
    const previous = current.relayCapabilities
    current.relayCapabilities = {
      endpoint: current.endpoint.trim(),
      model: current.model.trim(),
      declared:
        modelOptionsEndpoint.value === current.endpoint.trim()
          ? modelOptions.value.find((option) => option.id === current.model)?.capabilities
          : undefined,
      manual:
        previous?.endpoint === current.endpoint.trim() && previous.model === current.model.trim()
          ? previous.manual
          : {},
    }
  }

  function resetEndpoint(): void {
    config.value[provider.value].endpoint = frontendWorkshopImageGenerationService.defaultConfig(
      provider.value,
    ).endpoint
    applyModelMetadata()
  }

  function confirmCapability(key: RelayCapabilityKey, event: Event): void {
    if (provider.value !== 'openai') return
    const current = config.value.openai
    const existing = current.relayCapabilities
    const scoped =
      existing?.endpoint === current.endpoint.trim() && existing?.model === current.model.trim()
    const evidence = scoped
      ? existing
      : { endpoint: current.endpoint.trim(), model: current.model.trim() }
    current.relayCapabilities = {
      ...evidence,
      manual: { ...evidence.manual, [key]: (event.target as HTMLInputElement).checked },
    }
  }

  function addCharacter(): void {
    if (characters.value.length < capabilities.value.maxCharacters)
      characters.value.push({ prompt: '', negativePrompt: '', positioned: false, x: 0.5, y: 0.5 })
  }

  function removeInputImage(index: number): void {
    const image = inputImages.value.splice(index, 1)[0]
    if (image) URL.revokeObjectURL(image.url)
    if (index === 0) {
      parentImageId.value = ''
      mask.value = undefined
    }
  }

  function uploadImages(event: Event): void {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    error.value = ''
    const max =
      capabilities.value.multiImage === 'supported' ? capabilities.value.maxInputImages : 1
    if (files.length + inputImages.value.length > max) {
      error.value = `当前最多可用 ${max} 张参考图`
      return
    }
    const total = [...files, ...inputImages.value.map((image) => image.blob)].reduce(
      (sum, blob) => sum + blob.size,
      0,
    )
    if (
      total > 100 * 1024 * 1024 ||
      files.some(
        (file) =>
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
          !file.size ||
          file.size >= 50 * 1024 * 1024,
      )
    ) {
      error.value = '请使用 PNG / JPEG / WebP，单张小于 50 MiB，合计不超过 100 MiB'
      return
    }
    for (const file of files)
      inputImages.value.push({
        blob: file,
        url: URL.createObjectURL(file),
        name: file.name,
        role: 'reference',
      })
  }

  function uploadMask(event: Event): void {
    const input = event.target as HTMLInputElement
    mask.value = input.files?.[0]
    input.value = ''
  }

  async function continueEditing(): Promise<void> {
    if (!result.value || result.value.provider === 'novelai') return
    try {
      const image = result.value
      const blob = await frontendWorkshopImageGenerationService.toBlob(image)
      const item = await generatedImageAlbumService.saveGenerated(image)
      chooseProvider(image.provider)
      while (inputImages.value.length) removeInputImage(0)
      inputImages.value.push({
        blob,
        url: URL.createObjectURL(blob),
        name: item.name,
        role: 'reference',
      })
      parentImageId.value = item.id
      section.value = 'generate'
      internalTab.value = provider.value === 'openai' ? 'edit' : 'prompt'
      editInstruction.value = ''
      notice.value = '原图已保存到相册；请填写下一步修改指令。'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法继续编辑'
    }
  }

  async function saveConnection(): Promise<void> {
    try {
      config.value[provider.value] = await frontendWorkshopImageGenerationService.saveConfiguration(
        currentConfig.value,
      )
      notice.value = '连接已保存。'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '连接保存失败'
    }
  }

  function appendPrompt(fragment: string): void {
    prompt.value = [prompt.value.trim(), fragment].filter(Boolean).join(', ')
  }

  function reuseResult(): void {
    if (!result.value) return
    chooseProvider(result.value.provider)
    if (result.value.manifest) config.value[provider.value].model = result.value.manifest.model
    prompt.value = result.value.prompt
    negativePrompt.value = result.value.negativePrompt ?? ''
    imageText.value = ''
    promptHints.value = { 人物: '', 场景: '', 构图: '', 风格: '' }
    width.value = result.value.width
    height.value = result.value.height
    if (result.value.provider === 'novelai') novelAiSeed.value = result.value.seed
    section.value = 'generate'
  }

  function providerLabel(value: FrontendWorkshopImageProvider): string {
    if (value === 'novelai') return 'NovelAI'
    if (value === 'openai') return 'OpenAI'
    return 'OpenAI'
  }

  function selectTab(tab: InternalTab): void {
    internalTab.value = tab
    section.value = 'generate'
  }

  function chooseProvider(next: ProviderTab): void {
    flushDraft()
    if (next !== provider.value) {
      while (inputImages.value.length) removeInputImage(0)
      mask.value = undefined
      parentImageId.value = ''
      editInstruction.value = ''
      preserve.value = {}
    }
    section.value = 'generate'
    provider.value = next
    applyDraft(frontendWorkshopImageDraftService.loadDraft(next))
    internalTab.value = 'prompt'
    modelOptions.value = []
    modelOptionsEndpoint.value = ''
    error.value = ''
    notice.value = ''
    if (
      next !== 'novelai' &&
      !capabilities.value.sizes.includes(`${width.value}x${height.value}`)
    ) {
      width.value = 1024
      height.value = 1024
    }
  }

  async function generate(): Promise<void> {
    if (busy.value) {
      generationController?.abort()
      return
    }
    if (!canGenerate.value) {
      error.value = '请先填写画面描述。'
      return
    }
    busy.value = true
    error.value = ''
    notice.value = ''
    generationController = new AbortController()
    try {
      const current = { ...config.value[provider.value] }
      const image = await frontendWorkshopImageGenerationService.generate(
        current,
        generationRequest.value,
        { signal: generationController.signal, requestId: crypto.randomUUID() },
      )
      candidates.value.push({ image, albumItemId: '', hostedUrl: '' })
      candidateIndex.value = candidates.value.length - 1
      if (image.provider === 'novelai' && provider.value === current.provider)
        novelAiSeed.value = image.seed
      section.value = 'generate'
      try {
        config.value[current.provider] =
          await frontendWorkshopImageGenerationService.saveConfiguration(current)
      } catch {
        notice.value = '图片已生成；当前连接配置未能持久保存。'
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError')
        error.value = '已取消本次生成。'
      else error.value = cause instanceof Error ? cause.message : '生图失败，请检查连接和参数。'
    } finally {
      busy.value = false
      generationController = undefined
    }
  }

  async function saveToAlbum(): Promise<void> {
    if (!currentCandidate.value || albumSaved.value) return
    const candidate = currentCandidate.value
    error.value = ''
    try {
      const item = await generatedImageAlbumService.saveGenerated(candidate.image, {
        name: assetName.value.trim() || candidate.image.prompt.slice(0, 42),
        category: category.value,
      })
      candidate.albumItemId = item.id
      notice.value = '已保存到生图相册。'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存到相册失败。'
    }
  }

  async function saveSelfHostedConnection(): Promise<void> {
    error.value = ''
    try {
      const saved = await frontendWorkshopImageHostingService.saveSelfHostedConfiguration({
        origin: selfHostedOrigin.value,
        token: selfHostedToken.value,
        remember: rememberSelfHosted.value,
      })
      selfHostedOrigin.value = saved.origin
      selfHostedToken.value = saved.token
      selfHostedReady.value = true
      notice.value = saved.remember
        ? '自建图床连接已保存在本机。'
        : '自建图床仅在本次打开期间连接。'
    } catch (cause) {
      selfHostedReady.value = false
      error.value = cause instanceof Error ? cause.message : '自建图床连接无效。'
    }
  }

  async function hostResult(): Promise<void> {
    if (!result.value || hostingBusy.value || busy.value) return
    hostingBusy.value = true
    error.value = ''
    try {
      const candidate = currentCandidate.value!
      const image = candidate.image
      const item = await generatedImageAlbumService.saveGenerated(image, {
        name: assetName.value,
        category: category.value,
      })
      candidate.albumItemId = item.id
      const blob = await generatedImageAlbumService.getOriginalBlob(item.id)
      const name = assetName.value.trim() || image.prompt.slice(0, 60) || '生成图片'
      const hosted = await frontendWorkshopImageHostingService.uploadBlobSelfHosted(blob, name)
      await generatedImageAlbumService.setHostedUrl(item.id, hosted, 'self-hosted')
      candidate.hostedUrl = hosted.url
      notice.value = '已生成稳定 HTTPS 直链，并同步记录到生图相册。'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '图片托管失败。'
    } finally {
      hostingBusy.value = false
    }
  }

  onUnmounted(() => {
    generationController?.abort()
    flushDraft()
    for (const image of inputImages.value) URL.revokeObjectURL(image.url)
  })
  return {
    section,
    resultUrl,
    previewMeta,
    provider,
    busy,
    chooseProvider,
    providerLabel,
    config,
    applyModelMetadata,
    visibleModels,
    loadModels,
    internalTabs,
    internalTab,
    selectTab,
    prompt,
    appendPrompt,
    notice,
    capabilities,
    imageText,
    promptHints,
    characters,
    addCharacter,
    uploadImages,
    inputImages,
    removeInputImage,
    editInstruction,
    preserveLabels,
    preserve,
    uploadMask,
    mask,
    openAiSize,
    novelAiQualityMode,
    activeImageText,
    novelAiTransparentBackground,
    novelAiSeed,
    novelAiUcPreset,
    novelAiSampler,
    novelAiSteps,
    novelAiScale,
    width,
    height,
    negativePrompt,
    novelAiSmea,
    novelAiSmeaDyn,
    openAiQuality,
    openAiBackground,
    outputFormat,
    outputCompression,
    additionalJson,
    requestPreview,
    modelsBusy,
    saveConnection,
    resetEndpoint,
    RELAY_CAPABILITY_KEYS,
    capabilityLabels,
    confirmCapability,
    templates,
    saveTemplate,
    templateName,
    useTemplate,
    overwriteTemplate,
    deleteTemplate,
    error,
    canGenerate,
    generate,
    result,
    reuseResult,
    continueEditing,
    candidates,
    candidateIndex,
    hostingBusy,
    getImageGenerationCapabilities,
    assetName,
    category,
    albumSaved,
    saveToAlbum,
    canSaveToPhone,
    saveToPhone,
    selfHostedOrigin,
    selfHostedToken,
    rememberSelfHosted,
    saveSelfHostedConnection,
    selfHostedReady,
    hostResult,
    hostedUrl,
  }
}
