import { BUILD_INFO } from '../core/BuildInfo'
import { hashBlob } from './HashService'

export const TAVERN_BRIDGE_PROTOCOL = 'srl-tavern-bridge'
export const TAVERN_BRIDGE_VERSION = BUILD_INFO.bridgeProtocolVersion
export const TAVERN_BRIDGE_CHUNK_SIZE = 256 * 1024
export const TAVERN_BRIDGE_MIN_IN_FLIGHT_CHUNKS = 2
export const TAVERN_BRIDGE_DEFAULT_IN_FLIGHT_CHUNKS = 4
export const TAVERN_BRIDGE_MAX_IN_FLIGHT_CHUNKS = 8
export const TAVERN_BRIDGE_MAX_FILE_SIZE = 256 * 1024 * 1024

export type TavernResourceKind =
  | 'chat'
  | 'character'
  | 'worldBook'
  | 'preset'
  | 'regexGlobal'
  | 'regexCharacter'
  | 'regexPreset'
  | 'quickReply'
  | 'theme'
  | 'scriptGlobal'
  | 'scriptCharacter'
  | 'scriptPreset'
  | 'userPersona'
  | 'userAvatar'
export type TavernConflictPolicy = 'copy' | 'overwrite' | 'skip'

export interface TavernResourceItem {
  id: string
  kind: TavernResourceKind
  name: string
  fileName: string
  detail: string
  contentHash?: string
  updatedAt?: number
  size?: number
}

export interface TavernBridgeEnvelope {
  protocol: typeof TAVERN_BRIDGE_PROTOCOL
  version: typeof TAVERN_BRIDGE_VERSION
  type: string
  [key: string]: unknown
}

export function tavernEnvelope(
  type: string,
  payload: Record<string, unknown> = {},
): TavernBridgeEnvelope {
  return {
    protocol: TAVERN_BRIDGE_PROTOCOL,
    version: TAVERN_BRIDGE_VERSION,
    type,
    ...payload,
  }
}

export function isTavernEnvelope(value: unknown): value is TavernBridgeEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as TavernBridgeEnvelope).protocol === TAVERN_BRIDGE_PROTOCOL &&
    (value as TavernBridgeEnvelope).version === TAVERN_BRIDGE_VERSION &&
    typeof (value as TavernBridgeEnvelope).type === 'string',
  )
}

export function bridgeInvitation(
  url = typeof window === 'undefined' ? 'http://localhost/' : window.location.href,
): {
  channel: string
  pairCode: string
  tavernOrigin: string
  relayBase?: string
  participantToken?: string
} | null {
  const params = new URL(url).searchParams
  const channel = params.get('srlBridge') ?? ''
  const pairCode = params.get('pair') ?? ''
  const tavernOrigin = params.get('stOrigin') ?? ''
  if (!channel || !/^\d{6}$/u.test(pairCode)) return null
  try {
    const origin = new URL(tavernOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== tavernOrigin)
      return null
  } catch {
    return null
  }
  const relayBase = params.get('relayBase') ?? ''
  const participantToken = params.get('relayToken') ?? ''
  if (relayBase || participantToken) {
    if (!channel.startsWith('relay-') || !participantToken) return null
    try {
      const relay = new URL(relayBase)
      if (!['http:', 'https:'].includes(relay.protocol) || relay.origin !== tavernOrigin)
        return null
    } catch {
      return null
    }
    return { channel, pairCode, tavernOrigin, relayBase, participantToken }
  }
  return { channel, pairCode, tavernOrigin }
}

export async function bridgeSha256(blob: Blob): Promise<string> {
  return hashBlob(blob)
}
