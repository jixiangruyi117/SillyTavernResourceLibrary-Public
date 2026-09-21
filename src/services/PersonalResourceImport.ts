import { parsePersonalResource } from '../types/PersonalResource'
import { secretResourceService } from './SecretResourceService'

export async function protectPersonalImport(
  file: File,
  requestPassword: () => Promise<string | undefined>,
): Promise<File> {
  if (!/\.json$/i.test(file.name) || file.size > 2 * 1024 * 1024) return file
  let value: unknown
  try {
    value = JSON.parse(await file.text())
  } catch {
    return file
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('format' in value) ||
    value.format !== 'srl-personal-resource'
  )
    return file
  const document = parsePersonalResource(value)
  if (document.kind !== 'secret' || !document.fields.some((field) => field.private && field.value))
    return file
  if (!(await secretResourceService.hasPassword()))
    throw new Error('请先在总设置中设置密钥统一密码，再导入原文件；原文件未修改')
  const password = secretResourceService.isUnlocked() ? undefined : await requestPassword()
  if (!password && !secretResourceService.isUnlocked())
    throw new Error('已取消密钥导入；原文件未修改')
  const protectedDocument = await secretResourceService.protect(document, password)
  return new File([JSON.stringify(protectedDocument)], file.name, { type: 'application/json' })
}

export async function validateSecretResource(blob: Blob): Promise<void> {
  if (blob.size > 2 * 1024 * 1024) throw new Error('密钥资源超过大小限制')
  const document = parsePersonalResource(JSON.parse(await blob.text()))
  if (
    document.kind !== 'secret' ||
    document.fields.some((field) => field.private && field.value) ||
    (document.fields.some((field) => field.private) && !document.protected)
  )
    throw new Error('备份内密钥资源没有正确加密；请在总设置中设置统一密码后，通过文件导入加密')
}
