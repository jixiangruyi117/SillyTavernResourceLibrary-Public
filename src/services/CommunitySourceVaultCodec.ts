import type {
  CommunitySource,
  CommunitySourceMessage,
  CommunitySourceSummary,
  EncryptedCommunitySourceMessageRecord,
  EncryptedCommunitySourceRecord,
  EncryptedResourceSourceBindingRecord,
  ResourceSourceBinding,
  StoredCommunitySource,
  StoredCommunitySourceMessage,
  StoredResourceSourceBinding,
} from '../types/CommunitySource'
import {
  isEncryptedCommunitySource,
  isEncryptedCommunitySourceMessage,
  isEncryptedResourceSourceBinding,
  toCommunitySourceSummary,
} from '../types/CommunitySource'
import type { EncryptedValue } from '../types/Vault'

export interface CommunitySourceJsonVaultCodec {
  protectJson(value: unknown): Promise<EncryptedValue>
  revealJson<T>(value: EncryptedValue): Promise<T>
}

type SourcePayload = Omit<CommunitySource, 'id' | 'platform' | 'sourceKeyHash' | 'updatedAt'>
type SourceSummaryPayload = Omit<
  CommunitySourceSummary,
  'id' | 'platform' | 'sourceKeyHash' | 'updatedAt'
>
type MessagePayload = Omit<
  CommunitySourceMessage,
  'id' | 'sourceId' | 'messageKeyHash' | 'kind' | 'capturedAt' | 'updatedAt'
>
type BindingPayload = Pick<ResourceSourceBinding, 'note'>

export async function encodeCommunitySource(
  source: CommunitySource,
  codec: CommunitySourceJsonVaultCodec,
): Promise<EncryptedCommunitySourceRecord> {
  const { id, platform, sourceKeyHash, updatedAt, ...payload } = source
  const summary = toCommunitySourceSummary(source)
  const {
    id: _summaryId,
    platform: _summaryPlatform,
    sourceKeyHash: _summarySourceKeyHash,
    updatedAt: _summaryUpdatedAt,
    ...summaryPayload
  } = summary
  return {
    id,
    platform,
    sourceKeyHash,
    updatedAt,
    encrypted: true,
    payload: await codec.protectJson(payload satisfies SourcePayload),
    summaryPayload: await codec.protectJson(summaryPayload satisfies SourceSummaryPayload),
  }
}

export async function decodeCommunitySource(
  source: StoredCommunitySource,
  codec: CommunitySourceJsonVaultCodec,
): Promise<CommunitySource> {
  if (!isEncryptedCommunitySource(source)) return structuredClone(source)
  const payload = await codec.revealJson<SourcePayload>(source.payload)
  return {
    id: source.id,
    platform: source.platform,
    sourceKeyHash: source.sourceKeyHash,
    updatedAt: source.updatedAt,
    ...payload,
  }
}

export async function decodeCommunitySourceSummary(
  source: StoredCommunitySource,
  codec: CommunitySourceJsonVaultCodec,
): Promise<CommunitySourceSummary> {
  if (!isEncryptedCommunitySource(source)) return toCommunitySourceSummary(source)
  if (!source.summaryPayload) {
    return toCommunitySourceSummary(await decodeCommunitySource(source, codec))
  }
  const payload = await codec.revealJson<SourceSummaryPayload>(source.summaryPayload)
  return {
    id: source.id,
    platform: source.platform,
    sourceKeyHash: source.sourceKeyHash,
    updatedAt: source.updatedAt,
    ...payload,
  }
}

export async function encodeCommunitySourceMessage(
  message: CommunitySourceMessage,
  codec: CommunitySourceJsonVaultCodec,
): Promise<EncryptedCommunitySourceMessageRecord> {
  const { id, sourceId, messageKeyHash, kind, capturedAt, updatedAt, ...payload } = message
  return {
    id,
    sourceId,
    messageKeyHash,
    kind,
    capturedAt,
    updatedAt,
    encrypted: true,
    payload: await codec.protectJson(payload satisfies MessagePayload),
  }
}

export async function decodeCommunitySourceMessage(
  message: StoredCommunitySourceMessage,
  codec: CommunitySourceJsonVaultCodec,
): Promise<CommunitySourceMessage> {
  if (!isEncryptedCommunitySourceMessage(message)) return structuredClone(message)
  const payload = await codec.revealJson<MessagePayload>(message.payload)
  return {
    id: message.id,
    sourceId: message.sourceId,
    messageKeyHash: message.messageKeyHash,
    kind: message.kind,
    capturedAt: message.capturedAt,
    updatedAt: message.updatedAt,
    ...payload,
  }
}

export async function encodeResourceSourceBinding(
  binding: ResourceSourceBinding,
  codec: CommunitySourceJsonVaultCodec,
): Promise<EncryptedResourceSourceBindingRecord> {
  const { id, resourceId, sourceId, createdAt, note } = binding
  return {
    id,
    resourceId,
    sourceId,
    createdAt,
    encrypted: true,
    payload: await codec.protectJson({ note } satisfies BindingPayload),
  }
}

export async function decodeResourceSourceBinding(
  binding: StoredResourceSourceBinding,
  codec: CommunitySourceJsonVaultCodec,
): Promise<ResourceSourceBinding> {
  if (!isEncryptedResourceSourceBinding(binding)) return structuredClone(binding)
  const payload = await codec.revealJson<BindingPayload>(binding.payload)
  return {
    id: binding.id,
    resourceId: binding.resourceId,
    sourceId: binding.sourceId,
    createdAt: binding.createdAt,
    ...(payload.note ? { note: payload.note } : {}),
  }
}
