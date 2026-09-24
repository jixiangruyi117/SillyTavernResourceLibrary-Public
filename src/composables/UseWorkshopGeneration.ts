import type { ComputedRef } from 'vue'
import { mainApiService } from '../core/AppContainer'
import type {
  MainApiConfig,
  MainApiContentPart,
  MainApiMessage,
  MainApiTokenUsage,
} from '../services/MainApiService'
import type {
  LockedAspect,
  ReferenceScope,
  TypographyPreset,
  WorkshopChatMessage,
  WorkshopGenerationFailure,
  WorkshopGenerationRequest,
  WorkshopGenerationTokenUsage,
  WorkshopPalette,
  WorkshopPromptSnapshot,
  WorkshopVersion,
} from '../types/FrontendWorkshopLegacyApp'
import {
  buildWorkshopContinuityInstruction,
  buildWorkshopRepairSystemPrompt,
  buildWorkshopSystemPrompt,
  compileWorkshopArtifact,
  createWorkshopLayoutReference,
  extractWorkshopDesign,
  normalizeWorkshopFontUrls,
  parseStatusFields,
  requiresWorkshopTexture,
  type FrontendWorkshopArtifact,
  type WorkshopGenerationOptions,
  type WorkshopPromptCustomizations,
  type WorkshopTargetSize,
  type WorkshopTextStyleRequirement,
} from '../utils/FrontendWorkshop'
import { compactReviewRequirementText } from '../utils/FrontendWorkshopLegacyReview'
import type { useWorkshopSessionState } from './UseWorkshopSessionState'

interface WorkshopGenerationContext extends Pick<
  ReturnType<typeof useWorkshopSessionState>,
  | 'titleTypography'
  | 'titleFontUrl'
  | 'bodyTypography'
  | 'bodyFontUrl'
  | 'customTextStyles'
  | 'excludedConversationVersionIds'
  | 'versions'
  | 'currentIndex'
  | 'source'
  | 'promptInjectionEnabled'
  | 'promptCustomizations'
  | 'dataMode'
  | 'interactions'
  | 'blocks'
  | 'imageUrls'
  | 'layoutReference'
  | 'designTokens'
  | 'conditionRules'
  | 'style'
  | 'refinement'
  | 'lockedAspects'
  | 'inspectedTargets'
  | 'referenceImages'
  | 'referenceScopes'
  | 'referenceGuidance'
  | 'sample'
  | 'conversation'
  | 'inspectionMode'
  | 'activeStep'
  | 'generationFailure'
  | 'error'
  | 'activeDesignPanel'
  | 'busy'
  | 'generationNotice'
  | 'manualRepair'
  | 'manualRepairGuideOpen'
> {
  typographyStack: (preset: TypographyPreset, customFamily: string) => string
  selectedTitleTypography: ComputedRef<{
    value: TypographyPreset
    label: string
    description: string
    stack: string
  }>
  selectedBodyTypography: ComputedRef<{
    value: TypographyPreset
    label: string
    description: string
    stack: string
  }>
  current: ComputedRef<WorkshopVersion | undefined>
  activePalette: ComputedRef<WorkshopPalette | undefined>
  selectedTargetSize: ComputedRef<WorkshopTargetSize | undefined>
  lockedAspectOptions: { value: LockedAspect; label: string }[]
  templateWithPlaceholders: (artifact: FrontendWorkshopArtifact) => string
  referenceScopeOptions: { value: ReferenceScope; label: string }[]
  activeApiLabel: ComputedRef<string>
  saveVersions: () => void
  saveApiPreference: () => Promise<void>
  resolveWorkshopApi: () => MainApiConfig | undefined
  workshopRequestOptions: { timeoutMs: number }
  describeWorkshopGenerationError: (cause: unknown) => string
}

export function useWorkshopGeneration(getContext: () => WorkshopGenerationContext) {
  function buildTypographyRequirements(): {
    instruction: string
    fontUrls: string[]
    textStyles: WorkshopTextStyleRequirement[]
  } {
    const context = getContext()

    const fontFaces: string[] = []
    const rawFontUrls: string[] = []
    const resolveRole = (
      roleLabel: string,
      preset: TypographyPreset,
      fontUrl: string,
      customFamily: string,
    ): string => {
      if (preset !== 'custom') return context.typographyStack(preset, customFamily)
      if (!fontUrl.trim()) throw new Error(`${roleLabel}选择了自定义字体，请填写 HTTPS 字体直链`)
      const normalizedUrl = normalizeWorkshopFontUrls([fontUrl])[0]!
      rawFontUrls.push(normalizedUrl)
      fontFaces.push(
        `${roleLabel}必须生成 @font-face，font-family 使用 "${customFamily}"，src 使用 url("${normalizedUrl}")，并设置 font-display: swap。`,
      )
      return context.typographyStack(preset, customFamily)
    }
    const titleStack = resolveRole(
      '标题',
      context.titleTypography.value,
      context.titleFontUrl.value,
      'SRLUserFontTitle',
    )
    const bodyStack = resolveRole(
      '正文',
      context.bodyTypography.value,
      context.bodyFontUrl.value,
      'SRLUserFontBody',
    )
    const customRules = context.customTextStyles.value.map((textStyle, index) => {
      const family = `SRLUserFontStyle${index + 1}`
      const stack = resolveRole(
        `自定义文字样式「${textStyle.label}」`,
        textStyle.typography,
        textStyle.fontUrl,
        family,
      )
      return `「${textStyle.label}」使用 ${stack}，并用于 data-srl-text-style="${textStyle.id}" 的可见文字。`
    })
    return {
      instruction: `\n\n排版要求：标题使用「${context.selectedTitleTypography.value.label}」方向（${titleStack}）；正文使用「${context.selectedBodyTypography.value.label}」方向（${bodyStack}）。${
        fontFaces.length
          ? `只允许加载用户给出的字体文件，禁止 @import；${fontFaces.join('')}`
          : '不得使用 @import 或远程字体；字体不存在时必须按给定字体栈安全回退。'
      }${customRules.length ? ` 自定义文字样式：${customRules.join(' ')}` : ''}`,
      fontUrls: normalizeWorkshopFontUrls(rawFontUrls),
      textStyles: context.customTextStyles.value.map((textStyle) => ({
        id: textStyle.id,
        label: textStyle.label,
      })),
    }
  }

  function acceptedRefinementInstruction(requirementSeen = new Set<string>()): string {
    const context = getContext()

    const refinements: string[] = []
    const excluded = new Set(context.excludedConversationVersionIds.value)
    const byId = new Map(context.versions.value.map((version) => [version.id, version]))
    // 当前轮会作为“本轮最高优先级修改”单独注入，不能再写进历史约束。
    let version: WorkshopVersion | undefined = context.current.value?.parentVersionId
      ? byId.get(context.current.value.parentVersionId)
      : undefined
    const seen = new Set<string>()
    while (version && !seen.has(version.id) && refinements.length < 8) {
      seen.add(version.id)
      if (!excluded.has(version.id) && version.refinement.trim())
        refinements.unshift(version.refinement)
      version = version.parentVersionId ? byId.get(version.parentVersionId) : undefined
    }
    if (!seen.size && !refinements.length && context.currentIndex.value >= 0) {
      refinements.push(
        ...context.versions.value
          .slice(0, context.currentIndex.value + 1)
          .filter((item) => !excluded.has(item.id))
          .map((item) => item.refinement)
          .filter(Boolean)
          .slice(-8),
      )
    }
    return buildWorkshopContinuityInstruction(
      refinements
        .map((item) => compactReviewRequirementText(item, requirementSeen).value)
        .filter(Boolean),
    )
  }

  function mergeGenerationUsage(
    currentUsage: WorkshopGenerationTokenUsage | undefined,
    nextUsage: MainApiTokenUsage,
  ): WorkshopGenerationTokenUsage {
    return {
      inputTokens: (currentUsage?.inputTokens ?? 0) + nextUsage.inputTokens,
      outputTokens: (currentUsage?.outputTokens ?? 0) + nextUsage.outputTokens,
      totalTokens: (currentUsage?.totalTokens ?? 0) + nextUsage.totalTokens,
      source:
        currentUsage?.source === 'estimated' || nextUsage.source === 'estimated'
          ? 'estimated'
          : 'provider',
      requests: (currentUsage?.requests ?? 0) + 1,
    }
  }

  function createGenerationRequest(isRefinement: boolean): WorkshopGenerationRequest {
    const context = getContext()

    const fields = parseStatusFields(context.source.value)
    if (!fields.length) throw new Error('请先输入至少一行状态字段')
    if (isRefinement && !context.current.value) throw new Error('请先生成一版状态栏')
    const typographyRequirements = buildTypographyRequirements()
    const effectivePromptCustomizations: WorkshopPromptCustomizations = {
      material: context.promptInjectionEnabled.material
        ? context.promptCustomizations.material
        : '',
      conditions: context.promptInjectionEnabled.conditions
        ? context.promptCustomizations.conditions
        : '',
      blocks: context.promptInjectionEnabled.blocks ? context.promptCustomizations.blocks : '',
    }
    const generationOptions: WorkshopGenerationOptions = {
      dataMode: isRefinement
        ? context.current.value!.artifact.dataMode === 'mvu'
          ? 'mvu'
          : 'reply'
        : context.dataMode.value,
      interactions: isRefinement
        ? Array.isArray(context.current.value!.artifact.interactions)
          ? context.current.value!.artifact.interactions
          : []
        : [...context.interactions.value],
      blocks: context.promptInjectionEnabled.blocks ? [...context.blocks.value] : [],
      imageUrls: [...context.imageUrls.value],
      fontUrls: typographyRequirements.fontUrls,
      textStyles: typographyRequirements.textStyles,
      paletteName: context.activePalette.value?.name ?? '',
      paletteColors: context.activePalette.value?.colors ?? [],
      layoutReference: context.layoutReference.value
        ? createWorkshopLayoutReference(
            fields,
            context.imageUrls.value,
            context.layoutReference.value,
            context.selectedTargetSize.value,
          )
        : undefined,
      targetSize: context.selectedTargetSize.value,
      designTokens: { ...context.designTokens },
      conditionRules: context.promptInjectionEnabled.conditions
        ? context.conditionRules.value.map((rule) => ({ ...rule }))
        : [],
      promptCustomizations: effectivePromptCustomizations,
      promptInjectionEnabled: { ...context.promptInjectionEnabled },
      textureRequired:
        context.designTokens.material === 'paper' ||
        requiresWorkshopTexture(
          context.style.value,
          context.refinement.value,
          effectivePromptCustomizations.material,
        ),
    }
    const typographyInstruction = typographyRequirements.instruction
    const lockInstruction =
      isRefinement && context.lockedAspects.value.length
        ? `\n\n本次修改必须保持：${context.lockedAspects.value
            .map(
              (item) =>
                context.lockedAspectOptions.find((option) => option.value === item)?.label ?? item,
            )
            .join('、')}。除用户明确要求外，不得改动这些部分。`
        : ''
    const targetInstruction =
      isRefinement && context.inspectedTargets.value.length
        ? `\n\n本轮只修改这些预览区域：${context.inspectedTargets.value
            .map((target) => target.label)
            .join('、')}。其他区域除实现本次要求所必需的最小联动外，保持当前结构和视觉不变。`
        : ''
    const requirementSeen = new Set<string>()
    const continuityInstruction = isRefinement ? acceptedRefinementInstruction(requirementSeen) : ''
    const rawLatestRequest = context.refinement.value.trim()
    const compactLatestRequest = compactReviewRequirementText(
      rawLatestRequest,
      requirementSeen,
    ).value.trim()
    const latestRequest =
      compactLatestRequest ||
      (rawLatestRequest
        ? '本轮用户要求与已注入的历史约束完全相同，不重复注入；请按该约束继续执行。'
        : '优化层级、可读性与手机端表现')
    const instruction = isRefinement
      ? `【当前模板】
${context.templateWithPlaceholders(context.current.value!.artifact)}

【必须保留的技术与历史约束】
不得删除或改写任何字段占位符。${typographyInstruction}${lockInstruction}${targetInstruction}${continuityInstruction}

【本轮最高优先级修改｜用户原话】
${latestRequest}

【执行要求】
先把上面的用户原话拆成逐条清单，再在内部逐项落实；不能只完成其中一部分。除本轮明确要求及其必要联动外，保持其他区域不变。完成后再次逐句复核本轮要求。`
      : `【状态字段契约】
${context.source.value}

【本轮最高优先级风格要求｜用户原话】
${context.style.value}${typographyInstruction}

【执行要求】
逐句提取风格中的颜色、材质、排版、氛围、禁止项和移动端密度，选择一个连贯视觉概念后全部落实。先完成 320px 酒馆消息位，再扩展到更宽视口；输出前逐句复核，不允许只完成一半。`
    const referenceInstruction = context.referenceImages.value.length
      ? `\n\n参考图只允许参考：${
          context.referenceScopes.value
            .map(
              (scope) =>
                context.referenceScopeOptions.find((option) => option.value === scope)?.label ??
                scope,
            )
            .join('、') || '用户补充说明'
        }。${context.referenceGuidance.value.trim() || '提取适合本状态栏的设计规律，不要照搬图片文字，也不要猜测或声称识别出准确商业字体。'}`
      : ''
    const userPrompt = `${instruction}${referenceInstruction}`
    return {
      fields,
      generationOptions,
      systemPrompt: buildWorkshopSystemPrompt(fields, generationOptions),
      userPrompt,
      userContent: context.referenceImages.value.length
        ? [
            { type: 'text', text: userPrompt },
            ...context.referenceImages.value.map((image): MainApiContentPart => ({
              type: 'image',
              dataUrl: image.dataUrl,
            })),
          ]
        : userPrompt,
    }
  }

  function buildGenerationFailure(
    cause: unknown,
    isRefinement: boolean,
  ): WorkshopGenerationFailure {
    const context = getContext()

    const detail = cause instanceof Error ? cause.message : '生成请求没有返回可识别的错误信息'
    let hint = '请检查接口配置与网络连接后重试；当前版本没有被覆盖。'
    if (/429|rate limit|quota|额度|频率/i.test(detail)) {
      hint = '请求频率或额度不足。请稍后重试、降低并发，或切换到额度充足的接口。'
    } else if (/401|403|unauthorized|forbidden|密钥|鉴权/i.test(detail)) {
      hint = '接口拒绝了身份验证。请检查 API 密钥、代理权限和模型访问权限。'
    } else if (/timeout|超时/i.test(detail)) {
      hint = '请求已超时。请检查网络和代理状态，或换用响应更快的模型后重试。'
    } else if (/cors|failed to fetch|network|网络/i.test(detail)) {
      hint = '浏览器没有连通接口，常见原因是 CORS、代理地址或网络异常。请先测试当前接口。'
    } else if (/自动修复后仍不完整|本地校验|模板/i.test(detail)) {
      hint = 'AI 连续两次输出都未通过本地结构校验。请查看原始原因并缩小本轮修改范围后重试。'
    }
    return {
      title: isRefinement ? '下一版没有生成' : '这一版没有生成',
      detail,
      hint,
      apiLabel: context.activeApiLabel.value,
    }
  }

  function acceptGeneratedArtifact(
    artifact: FrontendWorkshopArtifact,
    options: {
      isRefinement: boolean
      promptSnapshot: WorkshopPromptSnapshot
      tokenUsage: WorkshopGenerationTokenUsage
      generationOptions: WorkshopGenerationOptions
      repairReason?: string
      manualRepair?: boolean
    },
  ): void {
    const context = getContext()

    const version: WorkshopVersion = {
      id: crypto.randomUUID(),
      parentVersionId: options.isRefinement ? context.current.value?.id : undefined,
      createdAt: Date.now(),
      source: context.source.value,
      style: context.style.value,
      refinement: options.isRefinement ? context.refinement.value : '',
      titleTypography: context.titleTypography.value,
      bodyTypography: context.bodyTypography.value,
      referenceScopes: [...context.referenceScopes.value],
      lockedAspects: [...context.lockedAspects.value],
      blocks: [...context.blocks.value],
      imageUrls: [...(options.generationOptions.imageUrls ?? [])],
      palette: context.activePalette.value
        ? { ...context.activePalette.value, colors: [...context.activePalette.value.colors] }
        : undefined,
      titleFontUrl: context.titleFontUrl.value,
      bodyFontUrl: context.bodyFontUrl.value,
      customTextStyles: context.customTextStyles.value.map((textStyle) => ({ ...textStyle })),
      layoutReference: options.generationOptions.layoutReference,
      targetSize: options.generationOptions.targetSize,
      designTokens: { ...context.designTokens },
      conditionRules: context.conditionRules.value.map((rule) => ({ ...rule })),
      promptCustomizations: { ...context.promptCustomizations },
      promptInjectionEnabled: { ...context.promptInjectionEnabled },
      promptSnapshot: options.promptSnapshot,
      tokenUsage: options.tokenUsage,
      artifact,
    }
    context.versions.value = [...context.versions.value, version].slice(-20)
    context.currentIndex.value = context.versions.value.length - 1
    context.sample.value = artifact.sampleOutput
    const chatUpdate: WorkshopChatMessage[] = [
      ...context.conversation.value,
      {
        id: crypto.randomUUID(),
        role: 'user',
        versionId: version.id,
        content: options.isRefinement
          ? `${context.inspectedTargets.value.length ? `[${context.inspectedTargets.value.map((item) => item.label).join('、')}] ` : ''}${context.refinement.value.trim() || '优化层级、可读性与手机端表现'}`
          : `生成「${artifact.title}」：${context.style.value}`,
        createdAt: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        versionId: version.id,
        content: options.manualRepair
          ? `已按手动修复后的代码生成 V${context.versions.value.length}，并重新通过本地结构与安全校验。仍建议在真实酒馆中复核。`
          : options.repairReason
            ? `第一次输出漏项后已自动补全；V${context.versions.value.length} 已通过本地结构与安全校验，仍建议在真实酒馆中复核。`
            : `已生成 V${context.versions.value.length} 并通过本地结构与安全校验。你可以继续描述想改的地方，最终请在真实酒馆中复核。`,
        createdAt: Date.now(),
      },
    ]
    context.conversation.value = [...context.conversation.value, ...chatUpdate].slice(-30)
    context.refinement.value = ''
    context.inspectedTargets.value = []
    context.inspectionMode.value = false
    context.activeStep.value = 'proof'
    context.generationFailure.value = undefined
    context.saveVersions()
  }

  function resolveRepairSource(response: string): string {
    try {
      const template = extractWorkshopDesign(response).htmlTemplate
      return typeof template === 'string' && template.trim() ? template : response
    } catch {
      return response
    }
  }

  async function generate(isRefinement = false): Promise<void> {
    const context = getContext()

    const fields = parseStatusFields(context.source.value)
    if (!fields.length) {
      context.error.value = '请先输入至少一行状态字段'
      return
    }
    if (
      context.promptInjectionEnabled.blocks &&
      context.blocks.value.includes('image-banner') &&
      !context.imageUrls.value.length
    ) {
      context.error.value = '选择“图片横幅”后，请先添加至少一条 HTTPS 成品图片直链'
      context.activeDesignPanel.value = 'appearance'
      return
    }
    if (isRefinement && !context.current.value) return
    context.busy.value = true
    context.error.value = ''
    context.generationNotice.value = ''
    context.generationFailure.value = undefined
    context.manualRepair.value = undefined
    context.manualRepairGuideOpen.value = false
    try {
      const request = createGenerationRequest(isRefinement)
      const { generationOptions } = request
      await context.saveApiPreference()
      const api = context.resolveWorkshopApi()
      const messages: MainApiMessage[] = [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ]
      const promptSnapshot: WorkshopPromptSnapshot = {
        createdAt: Date.now(),
        messages: [
          { role: 'system', label: 'System 完整提示词', content: request.systemPrompt },
          { role: 'user', label: '本轮用户提示词', content: request.userPrompt },
        ],
        referenceImageNames: context.referenceImages.value.map((image) => image.name),
      }
      let completion = await mainApiService.completeWithUsage(
        messages,
        api,
        context.workshopRequestOptions,
      )
      let response = completion.text
      let tokenUsage = mergeGenerationUsage(undefined, completion.usage)
      let artifact: FrontendWorkshopArtifact
      let repairReason = ''
      try {
        artifact = compileWorkshopArtifact(
          context.source.value,
          extractWorkshopDesign(response),
          generationOptions,
        )
      } catch (firstCause) {
        repairReason = context.describeWorkshopGenerationError(firstCause)
        context.generationNotice.value = `第一次结果未通过：${repairReason}。正在自动要求 AI 补全并重新校验…`
        const repairPrompt = `上次输出未通过本地校验，请一次性修复下面列出的全部问题：
${repairReason}

【当前完整模板或原始输出】
${resolveRepairSource(response)}

修复优先级：字段占位符与可见文本节点 > 安全限制与外链协议 > 组件积木与条件标记 > radio/checkbox 无脚本结构 > CSS 作用域与选择器命中 > 移动端窄栏排版。
请保留已完成的视觉设计，只修复上述问题及必要联动。`
        const repairSystemPrompt = buildWorkshopRepairSystemPrompt(fields, generationOptions)
        const repairApi: MainApiConfig = {
          ...(api ?? mainApiService.getConfig()),
          temperature: Math.min(0.2, Math.max(0, (api ?? mainApiService.getConfig()).temperature)),
          topP: 1,
        }
        promptSnapshot.messages.push({
          role: 'system',
          label: '自动修复紧凑协议',
          content: repairSystemPrompt,
        })
        promptSnapshot.messages.push({
          role: 'user',
          label: '自动修复：当前代码与问题',
          content: repairPrompt,
        })
        completion = await mainApiService.completeWithUsage(
          [
            { role: 'system', content: repairSystemPrompt },
            {
              role: 'user',
              content: repairPrompt,
            },
          ],
          repairApi,
          context.workshopRequestOptions,
        )
        response = completion.text
        tokenUsage = mergeGenerationUsage(tokenUsage, completion.usage)
        try {
          artifact = compileWorkshopArtifact(
            context.source.value,
            extractWorkshopDesign(response),
            generationOptions,
          )
        } catch (secondCause) {
          const secondReason = context.describeWorkshopGenerationError(secondCause)
          context.manualRepair.value = {
            response,
            issues: secondReason,
            generationOptions,
            isRefinement,
            promptSnapshot,
            tokenUsage,
          }
          throw new Error(
            `AI 自动修复后仍不完整。第一次：${repairReason}；第二次：${secondReason}`,
            {
              cause: secondCause,
            },
          )
        }
        context.generationNotice.value = `AI 第一次漏项后已自动修复，并重新通过全部本地校验：${repairReason}`
      }
      const version: WorkshopVersion = {
        id: crypto.randomUUID(),
        parentVersionId: isRefinement ? context.current.value?.id : undefined,
        createdAt: Date.now(),
        source: context.source.value,
        style: context.style.value,
        refinement: isRefinement ? context.refinement.value : '',
        titleTypography: context.titleTypography.value,
        bodyTypography: context.bodyTypography.value,
        referenceScopes: [...context.referenceScopes.value],
        lockedAspects: [...context.lockedAspects.value],
        blocks: [...context.blocks.value],
        imageUrls: [...generationOptions.imageUrls!],
        palette: context.activePalette.value
          ? { ...context.activePalette.value, colors: [...context.activePalette.value.colors] }
          : undefined,
        titleFontUrl: context.titleFontUrl.value,
        bodyFontUrl: context.bodyFontUrl.value,
        customTextStyles: context.customTextStyles.value.map((textStyle) => ({ ...textStyle })),
        layoutReference: generationOptions.layoutReference,
        targetSize: generationOptions.targetSize,
        designTokens: { ...context.designTokens },
        conditionRules: context.conditionRules.value.map((rule) => ({ ...rule })),
        promptCustomizations: { ...context.promptCustomizations },
        promptInjectionEnabled: { ...context.promptInjectionEnabled },
        promptSnapshot,
        tokenUsage,
        artifact,
      }
      context.versions.value = [...context.versions.value, version].slice(-20)
      context.currentIndex.value = context.versions.value.length - 1
      context.sample.value = artifact.sampleOutput
      const chatUpdate: WorkshopChatMessage[] = [
        {
          id: crypto.randomUUID(),
          role: 'user',
          versionId: version.id,
          content: isRefinement
            ? `${context.inspectedTargets.value.length ? `[${context.inspectedTargets.value.map((item) => item.label).join('、')}] ` : ''}${context.refinement.value.trim() || '优化层级、可读性与手机端表现'}`
            : `生成「${artifact.title}」：${context.style.value}`,
          createdAt: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          versionId: version.id,
          content: repairReason
            ? `第一次输出漏项后已自动补全；V${context.versions.value.length} 已通过本地结构与安全校验，仍建议在真实酒馆中复核。`
            : `已生成 V${context.versions.value.length} 并通过本地结构与安全校验。你可以继续描述想改的地方，最终请在真实酒馆中复核。`,
          createdAt: Date.now(),
        },
      ]
      context.conversation.value = [...context.conversation.value, ...chatUpdate].slice(-30)
      context.refinement.value = ''
      context.inspectedTargets.value = []
      context.inspectionMode.value = false
      context.activeStep.value = 'proof'
      context.generationFailure.value = undefined
      context.saveVersions()
    } catch (cause) {
      context.error.value = cause instanceof Error ? cause.message : '生成失败'
      context.generationFailure.value = buildGenerationFailure(cause, isRefinement)
    } finally {
      context.busy.value = false
    }
  }
  return {
    buildTypographyRequirements,
    acceptedRefinementInstruction,
    mergeGenerationUsage,
    createGenerationRequest,
    buildGenerationFailure,
    acceptGeneratedArtifact,
    resolveRepairSource,
    generate,
  }
}
