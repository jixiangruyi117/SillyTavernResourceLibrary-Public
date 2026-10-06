import type { UseTavernTransferActionsContext } from './UseTavernTransferActions'
import type { PersonaAvatarPlan, PersonaSendPlan } from '../types/TavernBridgeCenter'

import { chooseAction, confirmAction } from '../composables/UseConfirmDialog'

import { parseSillyTavernPersonaBackup } from '../parser/SillyTavernPersonaBackup'

import { resourceService } from '../core/AppContainer'

import { hashBlob } from '../services/HashService'

import type { TavernResourceItem } from '../services/TavernBridgeProtocol'

import { tavernBridgeService } from '../services/TavernBridgeService'

import {
  getRelatedResourceIds,
  isUserPersonaAvatarAttachment,
  RESOURCE_TYPE,
  type ResourceSummary,
} from '../types/Resource'

import { copyPersonaForTavern, personaContentMatches } from '../utils/TavernPersonaTransfer'

export async function preparePersonaSendPlans(
  operations: UseTavernTransferActionsContext,
  summaries: ResourceSummary[],
  signal?: AbortSignal,
): Promise<Map<string, PersonaSendPlan> | null> {
  const plans = new Map<string, PersonaSendPlan>()
  const personaSummaries = summaries.filter((item) => item.type === RESOURCE_TYPE.USER_PERSONA)
  if (!personaSummaries.length) return plans
  const prepared = await Promise.all(
    personaSummaries.map(async (summary) => {
      const resource = await resourceService.get(summary.id)
      if (!resource) throw new Error(`人设“${summary.name}”已不存在`)
      const local = parseSillyTavernPersonaBackup(JSON.parse(await resource.originalBlob.text()))
      return { summary, resource, local }
    }),
  )
  const needsPersonaInventory =
    operations.conflictPolicy.value === 'skip' &&
    prepared.some(({ local }) => local.entries.length === 1)
  const needsCharacterInventory = prepared.some(({ local }) =>
    local.entries.some((entry) => Object.keys(entry.profile.variants).length > 0),
  )
  const [personaInventory, tavernCharacters] = await (async (): Promise<
    [TavernResourceItem[], TavernResourceItem[]]
  > => {
    if (
      needsPersonaInventory &&
      needsCharacterInventory &&
      !operations.state.value.capabilities?.includes('catalog-kind-filter-v1')
    ) {
      const inventory = await tavernBridgeService.listResources(undefined, { signal })
      return [inventory, inventory.filter((item) => item.kind === 'character')]
    }
    const inventories = await Promise.all([
      needsPersonaInventory
        ? tavernBridgeService.listResources('userPersona', { signal })
        : Promise.resolve([]),
      needsCharacterInventory
        ? tavernBridgeService.listResources('character', { signal })
        : Promise.resolve([]),
    ])
    return [inventories[0], inventories[1]]
  })()
  const characterById = new Map(tavernCharacters.map((item) => [item.id, item]))
  const characterByAvatar = new Map(
    tavernCharacters.map((item) => [item.fileName.toLocaleLowerCase(), item]),
  )
  const characterByHash = new Map(
    tavernCharacters
      .filter((item) => item.contentHash)
      .map((item) => [item.contentHash!.toLocaleLowerCase(), item]),
  )
  const characterByName = new Map<string, TavernResourceItem[]>()
  for (const item of tavernCharacters) {
    const key = item.name.trim().toLocaleLowerCase()
    const matches = characterByName.get(key) ?? []
    matches.push(item)
    characterByName.set(key, matches)
  }
  const missingNames: string[] = []
  for (const { summary, local } of prepared) {
    let plan: PersonaSendPlan = {}
    if (operations.conflictPolicy.value === 'skip' && local.entries.length === 1) {
      const avatarId = local.entries[0]!.avatarId
      const remote = personaInventory.find((item) => item.id === `userPersona:${avatarId}`)
      if (remote) {
        const [remoteFile] = await tavernBridgeService.pullResources([remote], { signal })
        if (!remoteFile) throw new Error(`无法核对酒馆人设“${summary.name}”`)
        if (personaContentMatches(local.raw, JSON.parse(await remoteFile.text()), avatarId)) {
          if (!local.entries.some((entry) => Object.keys(entry.profile.variants).length)) {
            plans.set(summary.id, { skip: true })
            continue
          }
          plan.identicalPersona = true
        } else {
          const decision = await chooseAction({
            title: '酒馆人设已有不同内容',
            message: `“${summary.name}”仍使用酒馆原头像标识，但名称或描述已修改。跳过会保留酒馆原版；另存为新人设会生成新的头像标识，不覆盖原版，也不切换当前使用的人设。`,
            confirmLabel: '另存为新人设',
            alternativeLabel: '跳过这项',
            cancelLabel: '取消发送',
          })
          if (decision === 'cancel') return null
          if (decision === 'alternative') {
            plans.set(summary.id, { skip: true })
            continue
          }
          const nextAvatarId = `persona-${crypto.randomUUID()}.png`
          const copy = copyPersonaForTavern(local.raw, avatarId, nextAvatarId)
          plan = {
            avatarId: nextAvatarId,
            file: new File([JSON.stringify(copy, null, 2)], `${nextAvatarId.slice(0, -4)}.json`, {
              type: 'application/json',
            }),
          }
        }
      }
    }

    const characterTargets = new Map<string, Map<string, string>>()
    const missingCharacters: NonNullable<PersonaSendPlan['missingCharacters']> = []
    const mapCharacter = (personaAvatar: string, sourceId: string, targetAvatar: string) => {
      const mappings = characterTargets.get(personaAvatar) ?? new Map<string, string>()
      mappings.set(sourceId, targetAvatar)
      characterTargets.set(personaAvatar, mappings)
    }
    for (const entry of local.entries) {
      for (const sourceId of Object.keys(entry.profile.variants)) {
        const snapshot = entry.characterBindings[sourceId]
        const sourceAvatar = snapshot?.avatar || sourceId
        const exact =
          characterByAvatar.get(sourceAvatar.toLocaleLowerCase()) ??
          characterById.get(`character:${sourceAvatar}`)
        if (exact) {
          mapCharacter(entry.avatarId, sourceId, exact.fileName)
          continue
        }
        const hashMatch = snapshot?.hash
          ? characterByHash.get(snapshot.hash.toLocaleLowerCase())
          : undefined
        if (hashMatch) {
          mapCharacter(entry.avatarId, sourceId, hashMatch.fileName)
          continue
        }

        let sameName = snapshot?.name
          ? (characterByName.get(snapshot.name.trim().toLocaleLowerCase()) ?? [])
          : []
        if (!sameName.length && !snapshot) {
          const sourceName = sourceId.replace(/\.png$/iu, '').toLocaleLowerCase()
          sameName = characterByName.get(sourceName) ?? []
        }
        if (sameName.length === 1 && !snapshot?.hash) {
          mapCharacter(entry.avatarId, sourceId, sameName[0]!.fileName)
          continue
        }
        if (sameName.length && snapshot?.hash) {
          const files = await tavernBridgeService.pullResources(sameName, { signal })
          const matchedIndex = await (async () => {
            for (const [index, file] of files.entries()) {
              if ((await hashBlob(file)) === snapshot.hash) return index
            }
            return -1
          })()
          if (matchedIndex >= 0) {
            mapCharacter(entry.avatarId, sourceId, sameName[matchedIndex]!.fileName)
            continue
          }
        }

        const localCharacterSummary = operations.props.resources.find(
          (item) =>
            item.type === RESOURCE_TYPE.CHARACTER_CARD &&
            (snapshot?.hash
              ? item.contentHash === snapshot.hash
              : item.fileName.toLocaleLowerCase() === sourceAvatar.toLocaleLowerCase() ||
                item.name.trim().toLocaleLowerCase() ===
                  (snapshot?.name || sourceId.replace(/\.png$/iu, '')).trim().toLocaleLowerCase()),
        )
        let characterFile: File | undefined
        if (localCharacterSummary) {
          const localCharacter = await resourceService.get(localCharacterSummary.id)
          if (localCharacter) {
            characterFile = new File([localCharacter.originalBlob], sourceAvatar, {
              type: localCharacter.mimeType || 'image/png',
            })
          }
        }
        const identityLabel = snapshot?.name || sourceId.replace(/\.png$/iu, '')
        missingNames.push(
          `${summary.name} · ${identityLabel}${characterFile ? '' : '（资源库中找不到角色卡文件）'}`,
        )
        missingCharacters.push({
          personaAvatar: entry.avatarId,
          sourceId,
          avatarId: sourceAvatar,
          name: identityLabel,
          file: characterFile,
        })
      }
    }
    if (characterTargets.size || missingCharacters.length) {
      plan.characterTargets = characterTargets
      plan.missingCharacters = missingCharacters
    }
    if (plan.identicalPersona && !missingCharacters.length) plan.skip = true
    plans.set(summary.id, plan)
  }

  const hasMissing = Array.from(plans.values()).some((plan) => plan.missingCharacters?.length)
  if (hasMissing) {
    const decision = await chooseAction({
      title: '酒馆缺少角色卡',
      message: `以下角色卡还没有在酒馆中匹配到：\n${missingNames.join('\n')}\n\n选择“一并传入”会先尝试安全地导入资源库中已有的角色卡，再传入对应的角色专属人设。没有角色卡文件的项目无法补传。选择“只传已有角色卡的人设”时，会保留酒馆已匹配角色卡的专属设定；若一张也没有匹配，则只传全局人设。`,
      confirmLabel: '一并传入角色卡',
      alternativeLabel: '只传已有卡的人设',
      cancelLabel: '取消发送',
    })
    if (decision === 'cancel') return null
    for (const plan of plans.values()) {
      plan.sendMissingCharacters = decision === 'confirm'
      if (!plan.identicalPersona) continue
      if (decision === 'confirm') {
        plan.skipPersona = true
        continue
      }
      const overwriteConfirmed = await confirmAction({
        title: '更新酒馆中已有的人设',
        message:
          '酒馆里已经有相同的人设。为了按你的选择移除没有对应角色卡的专属设定，需要更新这份人设内容；全局描述和原生 connections 会保留。是否继续？',
        confirmLabel: '更新这份人设',
      })
      if (!overwriteConfirmed) return null
      plan.forceOverwritePersona = true
    }
  }
  return plans
}

export async function preparePersonaAvatarPlans(
  operations: UseTavernTransferActionsContext,
  summaries: ResourceSummary[],
  personaPlans = new Map<string, PersonaSendPlan>(),
  signal?: AbortSignal,
): Promise<Map<string, PersonaAvatarPlan> | null> {
  const plans = new Map<string, PersonaAvatarPlan>()
  if (
    operations.personaAvatarMode.value === 'none' ||
    !summaries.some((item) => item.type === RESOURCE_TYPE.USER_PERSONA)
  ) {
    return plans
  }
  if (!operations.canCheckPersonaAvatars.value) {
    throw new Error('当前酒馆扩展不支持头像核对，请更新页面扩展后再传封面')
  }
  const unavailable: string[] = []
  for (const summary of summaries) {
    if (summary.type !== RESOURCE_TYPE.USER_PERSONA) continue
    if (personaPlans.get(summary.id)?.skip) continue
    const resource = await resourceService.get(summary.id)
    if (!resource) throw new Error(`人设“${summary.name}”已不存在`)
    const view = parseSillyTavernPersonaBackup(JSON.parse(await resource.originalBlob.text()))
    const avatarId =
      view.defaultPersona || (view.entries.length === 1 ? view.entries[0]!.avatarId : '')
    if (!avatarId) {
      unavailable.push(`${summary.name}（未设默认人设）`)
      continue
    }
    if (
      avatarId !== avatarId.trim() ||
      avatarId.length > 120 ||
      /[\\/:*?"<>|]/u.test(avatarId) ||
      Array.from(avatarId).some((character) => character.charCodeAt(0) < 32) ||
      !/\.png$/iu.test(avatarId)
    ) {
      unavailable.push(`${summary.name}（头像文件名不符合酒馆要求）`)
      continue
    }
    let avatar: Awaited<ReturnType<typeof resourceService.get>>
    for (const id of getRelatedResourceIds(resource)) {
      const candidate = await resourceService.get(id)
      if (
        candidate &&
        isUserPersonaAvatarAttachment(candidate) &&
        candidate.metadata.avatarId === avatarId
      ) {
        avatar = candidate
        break
      }
    }
    if (!avatar) {
      unavailable.push(`${summary.name}（没有已缓存的封面）`)
      continue
    }
    plans.set(summary.id, {
      avatarId: personaPlans.get(summary.id)?.avatarId ?? avatarId,
      file: new File([avatar.originalBlob], personaPlans.get(summary.id)?.avatarId ?? avatarId, {
        type: 'image/png',
      }),
      exists: false,
    })
  }
  if (!plans.size) return plans
  const existing = new Set<string>()
  const avatarIds = Array.from(plans.values(), (plan) => plan.avatarId)
  for (let index = 0; index < avatarIds.length; index += 100) {
    const batch = await tavernBridgeService.checkUserAvatarIds(
      avatarIds.slice(index, index + 100),
      { signal },
    )
    for (const id of batch) existing.add(id)
  }
  for (const plan of plans.values()) plan.exists = existing.has(plan.avatarId)
  const lines = summaries.flatMap((summary) => {
    const plan = plans.get(summary.id)
    if (!plan) return []
    const outcome = plan.exists
      ? operations.personaAvatarMode.value === 'replace'
        ? '替换酒馆同名头像'
        : '酒馆已有，保留原图'
      : '酒馆缺少，将新增'
    return [`${summary.name} → ${plan.avatarId}：${outcome}`]
  })
  const confirmed = await confirmAction({
    title: '核对人设封面传送',
    message: `${lines.join('\n')}${unavailable.length ? `\n无法传封面：${unavailable.join('、')}` : ''}\n头像与人设分别传送；一项失败时会报告实际结果，便于重试。`,
    confirmLabel: '按此范围发送',
    danger:
      operations.personaAvatarMode.value === 'replace' &&
      Array.from(plans.values()).some((plan) => plan.exists),
  })
  return confirmed ? plans : null
}
