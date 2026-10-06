import { appearanceScopes, type AppearanceScope } from './AppearanceScopes'

export function isAssistantAuthenticationVisible(): boolean {
  return Array.from(document.querySelectorAll('.auth-portal,.auth-login-dialog[open]')).some(
    (node) => node.getClientRects().length > 0,
  )
}

/** Read only registered page identity, never arbitrary DOM text or form data. */
export function getAssistantVisibleScope(): AppearanceScope | undefined {
  if (isAssistantAuthenticationVisible()) return undefined
  const scopes = appearanceScopes()
  const priority = [
    ...scopes.filter((scope) => scope.value === 'settings' || scope.value === 'details'),
    ...scopes.filter((scope) => scope.appId),
    ...scopes.filter((scope) => ['features', 'library'].includes(scope.value)),
  ]
  return priority.find((scope) =>
    Array.from(document.querySelectorAll<HTMLElement>(scope.selector)).some((element) => {
      if (element.closest('.assistant-pet-dialog')) return false
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }),
  )
}
