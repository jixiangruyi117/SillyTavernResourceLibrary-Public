import { afterEach, expect, it, vi } from 'vitest'
const secrets = vi.hoisted(() => ({ hasPassword: vi.fn(), isUnlocked: vi.fn(), protect: vi.fn() }))
vi.mock('./SecretResourceService', () => ({ secretResourceService: secrets }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (uri: string) => uri },
  registerPlugin: () => ({}),
}))
import { protectPersonalImport } from './PersonalResourceImport'
import { rememberNativeFile, nativeFileSource } from '../core/NativeFileSource'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it('prompts and protects the real private fields of a native shared JSON before persistence', async () => {
  const value = {
    format: 'srl-personal-resource',
    version: 1,
    kind: 'secret',
    name: 'Key',
    text: '',
    url: '',
    attachments: [],
    fields: [{ id: 'key', label: 'Key', value: 'private', private: true }],
  }
  const bytes = new Blob([JSON.stringify(value)])
  const placeholder = rememberNativeFile(new File([], 'key.json'), 'file:///key', bytes.size)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes }))
  secrets.hasPassword.mockResolvedValue(true)
  secrets.isUnlocked.mockReturnValue(false)
  secrets.protect.mockResolvedValue({
    ...value,
    fields: [{ ...value.fields[0], value: '' }],
    protected: { data: 'sealed' },
  })
  const password = vi.fn().mockResolvedValue('password')
  const file = await protectPersonalImport(placeholder, password)
  expect(password).toHaveBeenCalledOnce()
  expect(secrets.protect).toHaveBeenCalledWith(value, 'password')
  expect(JSON.parse(await file.text()).fields[0].value).toBe('')
  expect(nativeFileSource(file)).toBeUndefined()
})

it('uses declared native size to skip oversized JSON without fetching it into the WebView', async () => {
  const file = rememberNativeFile(new File([], 'large.json'), 'file:///large', 3 * 1024 * 1024)
  const fetchFile = vi.fn()
  vi.stubGlobal('fetch', fetchFile)
  expect(await protectPersonalImport(file, vi.fn())).toBe(file)
  expect(fetchFile).not.toHaveBeenCalled()
})
