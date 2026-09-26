export type CharacterCardContentSection = 'greeting' | 'worldBook' | 'regex' | 'helperScript'

export type CharacterCardContentOperation = 'add' | 'update' | 'delete'

/** A reversible, entry-scoped overlay kept beside the card's untouched source bytes. */
export interface CharacterCardContentEdit {
  id: string
  section: CharacterCardContentSection
  operation: CharacterCardContentOperation
  /** Stable id when the source entry has one; otherwise the source position/fingerprint. */
  targetKey: string
  label: string
  before?: unknown
  after?: unknown
  /** Set only after the user agrees to carry this item to future card versions. */
  migrateToVersions: boolean
  updatedAt: number
}
