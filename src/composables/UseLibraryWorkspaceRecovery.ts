import type { Ref } from 'vue'
import type { FilterValue, SortValue } from '../types/AppView'
import { RESOURCE_TYPE, type ResourceType } from '../types/Resource'
interface LibraryWorkspaceRecoveryContext {
  isNativeApk: boolean
  WORKSPACE_RECOVERY_KEY: string
  activeFilter: Ref<FilterValue>
  activeCategoryId: Ref<string | null | undefined>
  activeTag: Ref<string, string>
  sortValue: Ref<SortValue>
  currentPage: Ref<number, number>
  selectedSplitResourceId: Ref<string | undefined>
  isFeatureHubOpen: Ref<boolean, boolean>
}
export function useLibraryWorkspaceRecovery(getContext: () => LibraryWorkspaceRecoveryContext) {
  function restoreWorkspaceSnapshot(): void {
    const context = getContext()

    if (!context.isNativeApk) return
    try {
      const saved = JSON.parse(
        localStorage.getItem(context.WORKSPACE_RECOVERY_KEY) ?? '{}',
      ) as Record<string, unknown>
      if (
        saved.filter === 'all' ||
        saved.filter === 'favorites' ||
        Object.values(RESOURCE_TYPE).includes(saved.filter as ResourceType)
      ) {
        context.activeFilter.value = saved.filter as FilterValue
      }
      if (typeof saved.categoryId === 'string' || saved.categoryId === null)
        context.activeCategoryId.value = saved.categoryId
      if (typeof saved.tag === 'string') context.activeTag.value = saved.tag
      if (saved.sort === 'newest' || saved.sort === 'name' || saved.sort === 'size')
        context.sortValue.value = saved.sort
      if (typeof saved.page === 'number' && Number.isInteger(saved.page) && saved.page > 0)
        context.currentPage.value = saved.page
      if (typeof saved.selectedId === 'string')
        context.selectedSplitResourceId.value = saved.selectedId
      if (saved.featureHub === true) context.isFeatureHubOpen.value = true
    } catch {
      // 现场快照失效时从默认首页打开，不能阻断本地资源读取。
    }
  }
  function saveWorkspaceSnapshot(): void {
    const context = getContext()

    if (!context.isNativeApk) return
    try {
      localStorage.setItem(
        context.WORKSPACE_RECOVERY_KEY,
        JSON.stringify({
          filter: context.activeFilter.value,
          categoryId: context.activeCategoryId.value,
          tag: context.activeTag.value,
          sort: context.sortValue.value,
          page: context.currentPage.value,
          selectedId: context.selectedSplitResourceId.value,
          featureHub: context.isFeatureHubOpen.value,
          savedAt: Date.now(),
        }),
      )
    } catch {
      // 部分系统 WebView 可能暂时拒绝写入；导入原件仍由原有暂存机制保护。
    }
  }
  return { restoreWorkspaceSnapshot, saveWorkspaceSnapshot }
}
