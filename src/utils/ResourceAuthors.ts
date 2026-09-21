import type { ResourceReference } from '../types/Resource'

type AuthorResource = Pick<ResourceReference, 'metadata'>

/** User annotation belongs to the library record, never to parsed creator metadata or source bytes. */
export function readAuthorNote(resource: AuthorResource): string {
  return typeof resource.metadata.authorNote === 'string' ? resource.metadata.authorNote.trim() : ''
}

export function readParsedAuthor(resource: AuthorResource): string {
  const values = [
    resource.metadata.creator,
    resource.metadata.author,
    resource.metadata.authors,
  ].flat()
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].join('、')
}

export function resourceAuthorSearchText(resource: AuthorResource): string {
  return (
    [readAuthorNote(resource), readParsedAuthor(resource)]
      .filter(Boolean)
      .join('\n')
      .toLocaleLowerCase() || '未知作者'
  )
}

export function resourceAuthorLabel(resource: AuthorResource): string {
  const note = readAuthorNote(resource)
  const parsed = readParsedAuthor(resource)
  return note ? `备注作者：${note}` : parsed ? `解析作者：${parsed}` : ''
}
