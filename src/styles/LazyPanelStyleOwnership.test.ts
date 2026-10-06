import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('lazy panel style ownership', () => {
  it.each([
    ['../components/AiTaggingPanel.vue', '../styles/AiTagging.css'],
    ['../components/CategoryManager.vue', '../styles/DataTransferPanels.css'],
    ['../components/DataVaultPanel.vue', '../styles/DataTransferPanels.css'],
    ['../components/DuplicateCleaner.vue', '../styles/DuplicateCleaner.css'],
    ['../components/ExtractedAssetCleaner.vue', '../styles/DuplicateCleaner.css'],
    ['../components/ParsedCharacterTagCleaner.vue', '../styles/DuplicateCleaner.css'],
    ['../components/VersionImportDialog.vue', '../styles/VersionArchive.css'],
    ['../components/FolderLibraryView.vue', '../styles/FolderLibrary.css'],
  ])('%s loads its required styles directly', (componentPath, stylesheet) => {
    expect(source(componentPath)).toContain(stylesheet)
  })

  it('keeps cleaner layout rules with their owner and loads overlay rules at the app entry', () => {
    expect(source('./AppearanceStudio.css')).not.toContain('.duplicate-cleaner')
    expect(source('../App.vue')).toContain("'./styles/DuplicateCleaner.css'")
  })
})
