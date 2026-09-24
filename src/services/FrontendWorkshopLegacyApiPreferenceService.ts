import type { MainApiConfig } from './MainApiService'
import { localCredentialStore, type LocalCredentialRepository } from './LocalCredentialStore'

export type FrontendWorkshopLegacyApiMode = 'main' | 'saved' | 'custom'

export interface FrontendWorkshopLegacyApiPreference {
  mode: FrontendWorkshopLegacyApiMode
  savedProfileId: string
  custom: MainApiConfig
  credentialPersistence?: 'local' | 'session'
}

const STORAGE_KEY = 'srl.frontendWorkshop.api.v1'
const CREDENTIAL_IDENTIFIER = 'frontend-workshop-legacy:custom-api'

export class FrontendWorkshopLegacyApiPreferenceService {
  private current?: FrontendWorkshopLegacyApiPreference
  private readonly credentialStore: LocalCredentialRepository

  constructor(credentialStore: LocalCredentialRepository = localCredentialStore) {
    this.credentialStore = credentialStore
  }

  async initializeCredentials(fallback: FrontendWorkshopLegacyApiPreference): Promise<void> {
    const preference = this.current ?? this.read(fallback)
    if (preference.credentialPersistence === 'session') {
      await this.credentialStore.clear(CREDENTIAL_IDENTIFIER)
    } else if (preference.custom.apiKey) {
      // 旧明文只有在受保护存储成功后才会从 localStorage 删除。
      await this.credentialStore.save(CREDENTIAL_IDENTIFIER, preference.custom.apiKey)
    } else {
      preference.custom.apiKey = await this.credentialStore.read(CREDENTIAL_IDENTIFIER)
    }
    this.current = preference
    this.writeSanitized(preference)
  }

  getPreference(
    fallback: FrontendWorkshopLegacyApiPreference,
  ): FrontendWorkshopLegacyApiPreference {
    this.current ??= this.read(fallback)
    return this.clone(this.current)
  }

  async savePreference(
    value: FrontendWorkshopLegacyApiPreference,
  ): Promise<FrontendWorkshopLegacyApiPreference> {
    const normalized = this.normalize(value, value)
    if (normalized.credentialPersistence === 'local' && normalized.custom.apiKey) {
      await this.credentialStore.save(CREDENTIAL_IDENTIFIER, normalized.custom.apiKey)
    } else {
      await this.credentialStore.clear(CREDENTIAL_IDENTIFIER)
    }
    this.current = normalized
    this.writeSanitized(normalized)
    return this.clone(normalized)
  }

  exportCustomConfiguration(): MainApiConfig | undefined {
    return this.current?.custom.apiKey ? { ...this.current.custom } : undefined
  }

  async importCustomConfiguration(value: MainApiConfig): Promise<void> {
    const fallback: FrontendWorkshopLegacyApiPreference = {
      mode: 'main',
      savedProfileId: '',
      custom: value,
      credentialPersistence: 'local',
    }
    const current = this.current ?? this.read(fallback)
    await this.savePreference({
      ...current,
      custom: { ...value },
      credentialPersistence: 'local',
    })
  }

  private read(fallback: FrontendWorkshopLegacyApiPreference): FrontendWorkshopLegacyApiPreference {
    try {
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null',
      ) as Partial<FrontendWorkshopLegacyApiPreference> | null
      return stored ? this.normalize(stored, fallback) : this.clone(fallback)
    } catch {
      return this.clone(fallback)
    }
  }

  private normalize(
    value: Partial<FrontendWorkshopLegacyApiPreference>,
    fallback: FrontendWorkshopLegacyApiPreference,
  ): FrontendWorkshopLegacyApiPreference {
    return {
      mode:
        value.mode === 'saved' || value.mode === 'custom' || value.mode === 'main'
          ? value.mode
          : fallback.mode,
      savedProfileId: String(value.savedProfileId ?? fallback.savedProfileId),
      custom: { ...fallback.custom, ...value.custom },
      credentialPersistence: value.credentialPersistence === 'session' ? 'session' : 'local',
    }
  }

  private writeSanitized(value: FrontendWorkshopLegacyApiPreference): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...value, custom: { ...value.custom, apiKey: '' } }),
    )
  }

  private clone(value: FrontendWorkshopLegacyApiPreference): FrontendWorkshopLegacyApiPreference {
    return { ...value, custom: { ...value.custom } }
  }
}

export const frontendWorkshopLegacyApiPreferenceService =
  new FrontendWorkshopLegacyApiPreferenceService()
