export type SettingValueType = 'boolean' | 'number' | 'string' | 'json'
export type SettingScope = 'device' | 'account' | 'project' | 'session' | 'native'
export type SettingPlatform = 'all' | 'web' | 'android'

export interface SettingDefinition<T = unknown> {
  key: string
  type: SettingValueType
  defaultValue: T
  scope: SettingScope
  portable: boolean
  secret: boolean
  platform: SettingPlatform
  validate(value: unknown): value is T
  migrate?: (value: unknown) => T
}

function stringSetting(
  key: string,
  defaultValue: string,
  options: Omit<SettingDefinition<string>, 'key' | 'type' | 'defaultValue' | 'validate'> &
    Partial<Pick<SettingDefinition<string>, 'validate'>>,
): SettingDefinition<string> {
  return {
    key,
    type: 'string',
    defaultValue,
    ...options,
    validate: options.validate ?? ((value): value is string => typeof value === 'string'),
  }
}

function booleanSetting(
  key: string,
  defaultValue: boolean,
  options: Omit<SettingDefinition<boolean>, 'key' | 'type' | 'defaultValue' | 'validate'> &
    Partial<Pick<SettingDefinition<boolean>, 'validate'>>,
): SettingDefinition<boolean> {
  return {
    key,
    type: 'boolean',
    defaultValue,
    ...options,
    validate: options.validate ?? ((value): value is boolean => typeof value === 'boolean'),
  }
}

const DEFINITIONS = [
  booleanSetting('srl.library.hideChatDisplayRegex', true, {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
  }),
  booleanSetting('srl.library.showManuallyBoundResources', true, {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
  }),
  stringSetting('srl-theme', 'light', {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
    validate: (value): value is string => value === 'light' || value === 'dark',
  }),
  stringSetting('srl.ui.layoutMode', 'grid', {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
    validate: (value): value is string => ['grid', 'list', 'split'].includes(String(value)),
  }),
  stringSetting('srl.ui.fontScale', 'standard', {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
    validate: (value): value is string => ['small', 'standard', 'large'].includes(String(value)),
  }),
  booleanSetting('srl.native.haptics.enabled', true, {
    scope: 'native',
    portable: false,
    secret: false,
    platform: 'android',
  }),
  stringSetting('srl.native-export.image-destination', 'ask', {
    scope: 'native',
    portable: false,
    secret: false,
    platform: 'android',
    validate: (value): value is string =>
      ['ask', 'pictures', 'downloads', 'directory'].includes(String(value)),
  }),
  booleanSetting('srl.preview.allowRemoteResources', false, {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
  }),
  booleanSetting('srl.preview.allowScripts', false, {
    scope: 'device',
    portable: true,
    secret: false,
    platform: 'all',
  }),
  stringSetting('srl.mainApi.profiles.v2', '', {
    scope: 'device',
    portable: false,
    secret: true,
    platform: 'all',
  }),
  stringSetting('srl.cloudBackup.localSecrets.v1', '', {
    scope: 'device',
    portable: false,
    secret: true,
    platform: 'all',
  }),
  stringSetting('srl.appResume.v1', '', {
    scope: 'session',
    portable: false,
    secret: false,
    platform: 'all',
  }),
] satisfies SettingDefinition[]

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]))

export const settingsRegistry = {
  list(): readonly SettingDefinition[] {
    return DEFINITIONS
  },
  get(key: string): SettingDefinition | undefined {
    return BY_KEY.get(key)
  },
  normalize<T>(definition: SettingDefinition<T>, value: unknown): T {
    if (definition.validate(value)) return value
    if (definition.migrate) return definition.migrate(value)
    return definition.defaultValue
  },
  portableKeys(): string[] {
    return DEFINITIONS.filter((definition) => definition.portable && !definition.secret).map(
      (definition) => definition.key,
    )
  },
  assertPortableRecord(record: Record<string, unknown>): void {
    for (const key of Object.keys(record)) {
      const definition = BY_KEY.get(key)
      if (!definition?.portable || definition.secret) throw new Error(`设置 ${key} 不允许带出本机`)
    }
  },
} as const
