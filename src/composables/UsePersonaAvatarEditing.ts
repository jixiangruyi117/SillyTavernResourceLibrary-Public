import type { Ref, ShallowRef } from 'vue'
import { userPersonaService } from '../core/AppContainer'
import { platform } from '../core/PlatformService'
import { type Resource, type ResourceSummary } from '../types/Resource'
import { type UserPersonaDraft } from '../types/UserPersona'
import { normalizeUserPersonaAvatarId } from '../utils/UserPersonaAvatar'

interface PersonaAvatarEditingContext {
  cachedAvatarPreview: Ref<string, string>
  cachedAvatarResource: Ref<Resource | null>
  avatarPreviewFailed: Ref<boolean, boolean>
  pendingAvatarPreview: Ref<string, string>
  pendingAvatarFile: Ref<File | null>
  avatarSourceUrl: Ref<string, string>
  avatarResourcesByAvatarId: Ref<Map<string, Resource>>
  initialAvatarResourceIds: Ref<Set<string>>
  emit: ((event: 'back') => void) & ((event: 'library-changed') => void)
  errorMessage: Ref<string, string>
  statusMessage: Ref<string, string>
  avatarInput: Readonly<ShallowRef<HTMLInputElement | null>>
  draft: Ref<UserPersonaDraft>
}

export function usePersonaAvatarEditing(getContext: () => PersonaAvatarEditingContext) {
  function revokePreview(value: string): void {
    if (value.startsWith('blob:')) URL.revokeObjectURL(value)
  }

  function setCachedAvatar(resource: Resource | null): void {
    const context = getContext()

    revokePreview(context.cachedAvatarPreview.value)
    context.cachedAvatarResource.value = resource
    context.cachedAvatarPreview.value = resource
      ? URL.createObjectURL(new Blob([resource.originalBlob], { type: 'image/png' }))
      : ''
    context.avatarPreviewFailed.value = false
  }

  function setPendingAvatar(file: File | null): void {
    const context = getContext()

    revokePreview(context.pendingAvatarPreview.value)
    context.pendingAvatarFile.value = file
    context.pendingAvatarPreview.value = file ? URL.createObjectURL(file) : ''
    context.avatarPreviewFailed.value = false
  }

  function clearAvatarEditor(): void {
    const context = getContext()

    context.avatarSourceUrl.value = ''
    setPendingAvatar(null)
    setCachedAvatar(null)
  }

  function avatarIdOf(resource: Resource): string {
    return typeof resource.metadata.avatarId === 'string' ? resource.metadata.avatarId : ''
  }

  function avatarSourceOf(resource: Resource): string {
    return typeof resource.metadata.sourceUrl === 'string' ? resource.metadata.sourceUrl : ''
  }

  async function loadAvatarResources(resourceIds: string[]): Promise<void> {
    const context = getContext()

    const loaded = await Promise.all(
      resourceIds.map((resourceId) => userPersonaService.loadAvatarResource(resourceId)),
    )
    const next = new Map<string, Resource>()
    const initialIds = new Set<string>()
    for (const resource of loaded) {
      if (!resource) continue
      const avatarId = avatarIdOf(resource)
      if (!avatarId) continue
      next.set(avatarId, resource)
      initialIds.add(resource.id)
    }
    context.avatarResourcesByAvatarId.value = next
    context.initialAvatarResourceIds.value = initialIds
  }

  function fileBaseName(value: string): string {
    return value.replace(/\.[^.]+$/u, '')
  }

  function characterAvatarId(resource: ResourceSummary): string {
    return /\.png$/i.test(resource.fileName) ? resource.fileName : `${resource.name}.png`
  }

  function recordCachedAvatar(resource: Resource): void {
    const context = getContext()

    setPendingAvatar(null)
    setCachedAvatar(resource)
    context.avatarSourceUrl.value = avatarSourceOf(resource)
    context.avatarPreviewFailed.value = false
  }

  async function ensureAvatarCached(avatarId: string): Promise<Resource | null> {
    const context = getContext()

    const normalizedId = normalizeUserPersonaAvatarId(avatarId)
    let resource: Resource | null = context.cachedAvatarResource.value
    if (context.pendingAvatarFile.value) {
      resource = await userPersonaService.cacheAvatarFile(
        context.pendingAvatarFile.value,
        normalizedId,
      )
    } else if (context.avatarSourceUrl.value.trim()) {
      const cachedSource = resource ? avatarSourceOf(resource) : ''
      if (
        !resource ||
        avatarIdOf(resource) !== normalizedId ||
        cachedSource !== context.avatarSourceUrl.value.trim()
      ) {
        resource = await userPersonaService.cacheAvatarFromUrl(
          context.avatarSourceUrl.value,
          normalizedId,
        )
      }
    } else if (resource && avatarIdOf(resource) !== normalizedId) {
      resource = await userPersonaService.cacheAvatarFile(
        resource.originalBlob,
        normalizedId,
        avatarSourceOf(resource),
      )
    }
    if (resource && resource !== context.cachedAvatarResource.value) {
      recordCachedAvatar(resource)
      context.emit('library-changed')
    }
    return resource
  }

  function applyAvatarFile(file: File): void {
    const context = getContext()

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      context.errorMessage.value = '头像仅支持 PNG、JPG 或 WebP 图片'
      return
    }
    context.avatarSourceUrl.value = ''
    setPendingAvatar(file)
    context.errorMessage.value = ''
    context.statusMessage.value = '头像将在保存时设为封面'
  }

  function onAvatarFileChange(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = ''
    if (!file) return
    applyAvatarFile(file)
  }

  function onAvatarUrlInput(): void {
    setPendingAvatar(null)
    getContext().avatarPreviewFailed.value = false
  }

  async function chooseAvatarImage(): Promise<void> {
    const context = getContext()

    if (!(await platform.files.isImagePickerAvailable())) {
      context.avatarInput.value?.click()
      return
    }
    try {
      const file = await platform.files.pickImage()
      if (file) applyAvatarFile(file)
    } catch (error) {
      context.errorMessage.value = error instanceof Error ? error.message : '无法读取所选头像'
    }
  }

  function removeAvatarBinding(): void {
    const context = getContext()

    clearAvatarEditor()
    context.statusMessage.value = '保存后移除封面'
  }

  function applyAvatarBindingForSave(
    originalAvatarId: string,
    nextAvatarId: string,
    resource: Resource | null,
  ): void {
    const context = getContext()

    const next = new Map(context.avatarResourcesByAvatarId.value)
    if (originalAvatarId && originalAvatarId !== '__new__') next.delete(originalAvatarId)
    if (resource) next.set(nextAvatarId, resource)
    else next.delete(nextAvatarId)
    context.avatarResourcesByAvatarId.value = next
  }
  return {
    revokePreview,
    setCachedAvatar,
    setPendingAvatar,
    clearAvatarEditor,
    avatarIdOf,
    avatarSourceOf,
    loadAvatarResources,
    fileBaseName,
    characterAvatarId,
    recordCachedAvatar,
    ensureAvatarCached,
    applyAvatarFile,
    onAvatarFileChange,
    onAvatarUrlInput,
    chooseAvatarImage,
    removeAvatarBinding,
    applyAvatarBindingForSave,
  }
}
