import { z } from 'zod'

/** 本地内容携带的来源与授权摘要；不依赖在线资源广场或账号功能。 */
export const plazaImportSourceSchema = z.object({
  resourceId: z.string().uuid(),
  name: z.string().max(160),
  author: z.string().max(160),
  originalAuthor: z.string().optional(),
  license: z
    .object({
      repost: z.boolean(),
      modify: z.boolean(),
      shareModified: z.boolean(),
      commercial: z.boolean(),
      attribution: z.boolean(),
      notice: z.string(),
    })
    .optional(),
  importedAt: z.number(),
})

export type PlazaImportSource = z.infer<typeof plazaImportSourceSchema>

export function plazaSourceDescription(source: PlazaImportSource): string {
  const license = source.license
  return [
    `来源：资源广场 · ${source.name} · ${source.author}`,
    source.originalAuthor ? `原作者：${source.originalAuthor}` : '',
    license
      ? `二传${license.repost ? '允许' : '禁止'}；修改${license.modify ? '允许' : '禁止'}；修改后二传${license.shareModified ? '允许' : '禁止'}；商用${license.commercial ? '允许' : '禁止'}；署名${license.attribution ? '必须' : '非必须'}。${license.notice}`
      : '未提供授权说明，请联系作者确认',
  ]
    .filter(Boolean)
    .join('\\n')
}
