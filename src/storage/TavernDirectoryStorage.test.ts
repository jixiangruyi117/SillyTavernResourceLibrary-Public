import { describe, expect, it } from 'vitest'
import { locateTavernUserDirectory } from './TavernDirectoryStorage'
type Directory = Parameters<typeof locateTavernUserDirectory>[0]
function folder(name: string, users: Record<string, Directory> = {}, user = false): Directory {
  return {
    name,
    kind: 'directory',
    async getFileHandle(file: string) {
      if (user && file === 'settings.json') return {}
      throw new DOMException('', 'NotFoundError')
    },
    async getDirectoryHandle(child: string) {
      if (user && child === 'characters') return folder(child)
      if (users[child]) return users[child]
      throw new DOMException('', 'NotFoundError')
    },
    async *values() {
      for (const dir of Object.values(users)) yield dir
    },
  } as unknown as Directory
}
describe('bounded Tavern folder discovery', () => {
  it('accepts the user folder, data folder and installation root', async () => {
    const user = folder('default-user', {}, true)
    const data = folder('data', { 'default-user': user })
    expect(await locateTavernUserDirectory(user)).toBe(user)
    expect(await locateTavernUserDirectory(data)).toBe(user)
    expect(await locateTavernUserDirectory(folder('SillyTavern', { data }))).toBe(user)
  })
  it('never silently chooses one of multiple accounts or an unrelated folder', async () => {
    await expect(
      locateTavernUserDirectory(
        folder('data', { a: folder('a', {}, true), b: folder('b', {}, true) }),
      ),
    ).rejects.toThrow('多个酒馆用户')
    await expect(locateTavernUserDirectory(folder('Downloads'))).rejects.toThrow('没有找到')
  })
})
