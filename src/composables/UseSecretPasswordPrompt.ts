import { shallowRef } from 'vue'
export const secretPasswordRequest = shallowRef<{ message: string }>()
let pending: ((password: string | undefined) => void) | undefined
export function requestSecretPassword(message: string): Promise<string | undefined> {
  if (pending) throw new Error('请先完成当前密码操作')
  return new Promise((resolve) => {
    pending = resolve
    secretPasswordRequest.value = { message }
  })
}
export function resolveSecretPassword(password?: string): void {
  const resolve = pending
  pending = undefined
  secretPasswordRequest.value = undefined
  resolve?.(password)
}
