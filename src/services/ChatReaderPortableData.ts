import { CHAT_READER_APP_ID } from '../core/ChatReaderIdentity'
import type { ArchivePortableData } from '../types/Backup'
import type { ExternalAppDataRecord } from '../types/ExternalApp'

/** Merge restore may replace resource IDs: keep notes/bookmarks on the restored original. */
export function remapReaderPortableData(
  data: ArchivePortableData | undefined,
  ids: ReadonlyMap<string, string>,
): ArchivePortableData | undefined {
  if (!data) return data
  const remap = (record: ExternalAppDataRecord): ExternalAppDataRecord => {
    if (record.appId !== CHAT_READER_APP_ID) return record
    const match = /^(chat:|appearance:)(.+)$/.exec(record.key)
    const key = match ? match[1] + (ids.get(match[2]!) ?? match[2]) : record.key
    let value = record.value
    if (key === 'reader-index-v1' && value && typeof value === 'object') {
      const index = value as Record<string, unknown>
      value = {
        ...index,
        ...(typeof index.lastChat === 'string'
          ? { lastChat: ids.get(index.lastChat) ?? index.lastChat }
          : {}),
      }
    }
    // Import recalculates the composite row ID through externalAppDataId.
    return { ...record, key, value }
  }
  return {
    ...data,
    ...(data.chatReader ? { chatReader: data.chatReader.map(remap) } : {}),
    ...(data.externalApps
      ? { externalApps: { ...data.externalApps, data: data.externalApps.data.map(remap) } }
      : {}),
  }
}
