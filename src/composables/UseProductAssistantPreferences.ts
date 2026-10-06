import { onBeforeUnmount, onMounted, ref } from 'vue'
import { productAssistantWorkspaceService as workspace } from '../core/AppContainer'

/** Both chat settings and the pet follow the one workspace preference owner. */
export function useProductAssistantPreferences() {
  const preferences = ref(workspace.preferences())
  let alive = true
  const unsubscribe = workspace.onPreferencesChange((value) => {
    if (alive) preferences.value = value
  })
  onMounted(async () => {
    try {
      const value = await workspace.loadPreferences()
      if (alive) preferences.value = value
    } catch {
      // The settings page reports storage errors; a failed read must not enable the pet.
      if (alive) preferences.value.desktopPet = false
    }
  })
  onBeforeUnmount(() => {
    alive = false
    unsubscribe()
  })
  return preferences
}
