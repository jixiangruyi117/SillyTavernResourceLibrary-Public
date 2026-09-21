/** @vitest-environment jsdom */
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import {
  usePersonalResourceNavigation,
  type PersonalResourceNavigationState,
} from './UsePersonalResourceNavigation'
import type { Resource } from '../types/Resource'

it('keeps a newly saved resource in the organizer and delegates back to draft-aware owners', async () => {
  const personalNavigation: PersonalResourceNavigationState = { kind: ref(), back: ref() }
  const organizingResource = ref<Resource>()
  const editorBack = vi.fn()
  const organizerClose = vi.fn()
  const context = {
    personalNavigation,
    organizingResource,
    isImportChooserOpen: ref(true),
    handleLibraryChanged: vi.fn(async () => {}),
    openResourceDetail: async (resource: Resource) => {
      organizingResource.value = resource
    },
    closeResourceDetail: vi.fn(() => {
      organizingResource.value = undefined
    }),
  }
  let navigation!: ReturnType<typeof usePersonalResourceNavigation>
  const wrapper = mount(
    defineComponent({
      setup() {
        navigation = usePersonalResourceNavigation(
          context,
          ref({ requestBack: editorBack }),
          ref({ requestClose: organizerClose }),
        )
        return () => null
      },
    }),
  )
  navigation.createPersonal('extraStory')
  await flushPromises()
  expect(context.isImportChooserOpen.value).toBe(false)
  personalNavigation.back.value?.()
  expect(editorBack).toHaveBeenCalledOnce()
  expect(personalNavigation.kind.value).toBe('extraStory')

  const saved = { id: 'newly-saved', type: 'extraStory' } as Resource
  await navigation.personalSaved(saved)
  await flushPromises()
  expect(personalNavigation.kind.value).toBeUndefined()
  expect(organizingResource.value).toEqual(saved)
  expect(context.handleLibraryChanged).toHaveBeenCalledOnce()
  personalNavigation.back.value?.()
  expect(organizerClose).toHaveBeenCalledOnce()
  expect(organizingResource.value).toEqual(saved)
  expect(context.closeResourceDetail).not.toHaveBeenCalled()

  organizingResource.value = { ...saved, type: 'pocketPhone' }
  await flushPromises()
  personalNavigation.back.value?.()
  expect(organizerClose).toHaveBeenCalledTimes(2)
  navigation.closePersonal()
  await flushPromises()
  expect(personalNavigation.back.value).toBeUndefined()
  wrapper.unmount()
})
