import { onBeforeUnmount, watchEffect, type Ref } from 'vue'
import { isPersonalResourceType, type PersonalResourceKind } from '../types/PersonalResource'
import type { Resource } from '../types/Resource'

export interface PersonalResourceNavigationState {
  kind: Ref<PersonalResourceKind | undefined>
  back: Ref<(() => void) | undefined>
}

interface PersonalResourceNavigationContext {
  personalNavigation: PersonalResourceNavigationState
  organizingResource: Ref<Resource | undefined>
  isImportChooserOpen: Ref<boolean>
  openResourceDetail: (resource: Resource) => Promise<void>
  closeResourceDetail: () => void
  handleLibraryChanged: () => Promise<void>
}

/** Owns the reader/editor/organizer transition; persistence stays in the existing services. */
export function usePersonalResourceNavigation(
  controller: PersonalResourceNavigationContext,
  personalEditor: Readonly<Ref<{ requestBack: () => void } | null>>,
  personalOrganizer: Readonly<Ref<{ requestClose: () => void } | null>>,
) {
  const newPersonalKind = controller.personalNavigation.kind
  watchEffect(() => {
    const resource = controller.organizingResource.value
    controller.personalNavigation.back.value =
      newPersonalKind.value || (resource && isPersonalResourceType(resource.type))
        ? () => {
            if (newPersonalKind.value && personalEditor.value) personalEditor.value.requestBack()
            else if (personalOrganizer.value) personalOrganizer.value.requestClose()
            else closePersonal()
          }
        : undefined
  })
  onBeforeUnmount(() => {
    controller.personalNavigation.back.value = undefined
  })
  async function personalSaved(resource: Resource) {
    await controller.openResourceDetail(resource)
    newPersonalKind.value = undefined
    await controller.handleLibraryChanged()
  }
  function createPersonal(kind: PersonalResourceKind) {
    newPersonalKind.value = kind
    controller.isImportChooserOpen.value = false
  }
  function closePersonal() {
    newPersonalKind.value = undefined
    controller.closeResourceDetail()
  }
  return {
    newPersonalKind,
    personalSaved,
    createPersonal,
    closePersonal,
  }
}
