import {
  type StatusField,
  type WorkshopDesignTokens,
  type WorkshopGenerationOptions,
  type FrontendWorkshopArtifact,
  type WorkshopWorldbookArtifact,
  type WorkshopStressCase,
  type WorkshopMvuTurn,
} from '../types/FrontendWorkshopLegacy'
import { normalizeGenerationOptions } from './FrontendWorkshopLegacyGenerationOptions'
import { parseStatusFields } from './FrontendWorkshopLegacyDesignParser'
import {
  normalizeWorkshopLocalSvgReferences,
  assertSafeTemplate,
} from './FrontendWorkshopLegacyValidation'
import {
  buildFindRegex,
  buildPrompt,
  buildMvuSample,
  buildMvuReplacement,
} from './FrontendWorkshopLegacyRendering'
import { setPath, applyTavernRegex } from './FrontendWorkshopLegacyValues'

export {
  type StatusField,
  type WorkshopDataMode,
  type WorkshopInteraction,
  type WorkshopMaterial,
  type WorkshopShadow,
  type WorkshopBorder,
  type WorkshopDensity,
  type WorkshopBlock,
  type WorkshopTextStyleRequirement,
  type WorkshopDesignTokens,
  type WorkshopPromptCustomizations,
  type WorkshopPromptInjectionEnabled,
  type WorkshopConditionOperator,
  type WorkshopConditionRule,
  type WorkshopLayoutItem,
  type WorkshopLayoutViewport,
  type WorkshopLayoutReference,
  type WorkshopTargetSize,
  type WorkshopGenerationOptions,
  type TavernRegexArtifact,
  type FrontendWorkshopArtifact,
  type WorkshopWorldbookArtifact,
  type WorkshopSampleIssue,
  type WorkshopStressCase,
  type WorkshopMvuTurn,
} from '../types/FrontendWorkshopLegacy'
export { applyTavernRegex } from './FrontendWorkshopLegacyValues'
export {
  normalizeWorkshopImageUrls,
  normalizeWorkshopFontUrls,
  normalizeWorkshopPaletteColors,
  parseWorkshopPaletteText,
  extractWorkshopPaletteColors,
} from './FrontendWorkshopLegacyResources'
export {
  normalizeWorkshopLayoutReference,
  createWorkshopLayoutReference,
  resizeWorkshopLayoutReference,
  describeWorkshopLayoutReference,
} from './FrontendWorkshopLegacyLayout'
export {
  describeWorkshopMaterialRecipe,
  requiresWorkshopTexture,
} from './FrontendWorkshopLegacyGenerationOptions'
export {
  parseStatusFields,
  serializeStatusFields,
  extractJsonObject,
  extractWorkshopDesign,
} from './FrontendWorkshopLegacyDesignParser'
export {
  formatWorkshopValidationIssues,
  WorkshopValidationError,
} from './FrontendWorkshopLegacyValidation'
export {
  renderWorkshopPreview,
  renderWorkshopInspectablePreview,
  inspectWorkshopSample,
} from './FrontendWorkshopLegacyRendering'
export {
  buildWorkshopContinuityInstruction,
  buildWorkshopSystemPrompt,
  buildWorkshopRepairSystemPrompt,
} from './FrontendWorkshopLegacyPrompts'

export function compileWorkshopArtifact(
  source: string,
  aiResult: Record<string, unknown>,
  options?: Partial<WorkshopGenerationOptions>,
): FrontendWorkshopArtifact {
  const normalizedOptions = normalizeGenerationOptions(options)
  const effectiveBlocks = normalizedOptions.promptInjectionEnabled.blocks
    ? normalizedOptions.blocks
    : []
  const effectiveConditionRules = normalizedOptions.promptInjectionEnabled.conditions
    ? normalizedOptions.conditionRules
    : []
  const fields = parseStatusFields(source)
  if (!fields.length) throw new Error('请至少输入一行状态字段，例如“姓名：林言”')
  if (normalizedOptions.dataMode !== 'mvu' && effectiveConditionRules.length)
    throw new Error('数值条件样式需要读取 MVU 变量，请先把“数据怎么变化”切换为 MVU')
  const htmlTemplate = normalizeWorkshopLocalSvgReferences(
    String(aiResult.htmlTemplate ?? '').trim(),
  )
  assertSafeTemplate(
    htmlTemplate,
    fields,
    normalizedOptions.interactions,
    effectiveBlocks,
    normalizedOptions.imageUrls,
    normalizedOptions.fontUrls,
    normalizedOptions.textStyles,
    effectiveConditionRules,
    normalizedOptions.textureRequired,
  )
  const replaceString =
    normalizedOptions.dataMode === 'mvu'
      ? buildMvuReplacement(fields, htmlTemplate, effectiveConditionRules)
      : fields.reduce(
          (result, _field, index) => result.replaceAll(`{{field_${index + 1}}}`, `$${index + 1}`),
          htmlTemplate,
        )
  const title =
    String(aiResult.title ?? '自定义状态栏')
      .trim()
      .slice(0, 60) || '自定义状态栏'
  const sampleOutput =
    normalizedOptions.dataMode === 'mvu'
      ? buildMvuSample(fields)
      : `<StatusPlaceHolder>\n${fields
          .map((field) => `${field.label}: ${field.example}`)
          .join('\n')}\n</StatusPlaceHolder>`
  const artifact: FrontendWorkshopArtifact = {
    title,
    fields,
    prompt: buildPrompt(fields, normalizedOptions.dataMode),
    sampleOutput,
    styleNote: String(aiResult.styleNote ?? '').trim(),
    dataMode: normalizedOptions.dataMode,
    interactions: normalizedOptions.interactions,
    blocks: effectiveBlocks,
    imageUrls: normalizedOptions.imageUrls,
    fontUrls: normalizedOptions.fontUrls,
    textStyles: normalizedOptions.textStyles,
    palette: normalizedOptions.paletteColors.length
      ? {
          name: normalizedOptions.paletteName || '自定义色卡',
          colors: normalizedOptions.paletteColors,
        }
      : undefined,
    layoutReference: normalizedOptions.layoutReference.items.length
      ? normalizedOptions.layoutReference
      : undefined,
    targetSize: normalizedOptions.targetSize,
    designTokens: normalizedOptions.designTokens as WorkshopDesignTokens,
    conditionRules: effectiveConditionRules,
    htmlTemplate,
    compatibility:
      normalizedOptions.dataMode === 'mvu'
        ? {
            levelLabel:
              normalizedOptions.imageUrls.length || normalizedOptions.fontUrls.length
                ? '酒馆 + 酒馆助手 + MVU + 提示词模板 + 外部资源'
                : '酒馆 + 酒馆助手 + MVU + 提示词模板',
            dataLabel: '已有 MVU 变量',
            persistenceLabel: '由 MVU 跨回合保存',
            dependencies: [
              'SillyTavern 内置正则',
              '酒馆助手',
              'MVU',
              'ST-Prompt-Template（开启“处理消息内容”）',
              ...(normalizedOptions.imageUrls.length ? ['联网图片'] : []),
              ...(normalizedOptions.fontUrls.length ? ['联网字体'] : []),
            ],
            verificationNote:
              normalizedOptions.imageUrls.length || normalizedOptions.fontUrls.length
                ? '正则替换后由 ST-Prompt-Template 执行 EJS，并通过酒馆助手读取 MVU 楼层变量；未开启“处理消息内容”时 EJS 不会执行。初始化、更新规则及外部资源可用性仍由真实酒馆环境决定。'
                : '正则替换后由 ST-Prompt-Template 执行 EJS，并通过酒馆助手读取 MVU 楼层变量；未开启“处理消息内容”时 EJS 不会执行。初始化和更新规则仍使用角色卡原有配置。',
          }
        : {
            levelLabel:
              normalizedOptions.imageUrls.length || normalizedOptions.fontUrls.length
                ? '纯酒馆 + 外部资源'
                : '纯酒馆',
            dataLabel: '每轮完整状态块',
            persistenceLabel: '依赖 AI 每轮重新输出',
            dependencies: [
              'SillyTavern 内置正则',
              ...(normalizedOptions.imageUrls.length ? ['联网图片'] : []),
              ...(normalizedOptions.fontUrls.length ? ['联网字体'] : []),
            ],
            verificationNote:
              normalizedOptions.imageUrls.length || normalizedOptions.fontUrls.length
                ? '无需 MVU；外部资源失效时状态文字仍应可读，字段缺失时本轮状态栏无法完整匹配。'
                : '无需 MVU；字段缺失时本轮状态栏将无法完整匹配。',
          },
    regex: {
      id: crypto.randomUUID(),
      scriptName: title,
      findRegex: buildFindRegex(fields, normalizedOptions.dataMode),
      replaceString,
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
  }
  if (normalizedOptions.dataMode === 'reply') {
    const preview = applyTavernRegex(artifact.regex, sampleOutput)
    if (
      preview === sampleOutput ||
      fields.some((_field, index) => preview.includes(`$${index + 1}`))
    )
      throw new Error('生成结果没有通过酒馆正则捕获验证')
  } else if (applyTavernRegex(artifact.regex, '<StatusPlaceHolder/>') === '<StatusPlaceHolder/>') {
    throw new Error('生成结果没有通过 MVU 状态栏占位符验证')
  }
  return artifact
}

export function buildWorkshopStressCases(artifact: FrontendWorkshopArtifact): WorkshopStressCase[] {
  if (artifact.dataMode === 'mvu') {
    const buildVariables = (transform: (field: StatusField, index: number) => unknown) => {
      const statData: Record<string, unknown> = {}
      artifact.fields.forEach((field, index) =>
        setPath(statData, field.path, [transform(field, index), '校样条件']),
      )
      return JSON.stringify({ stat_data: statData }, null, 2)
    }
    const missingData = JSON.parse(buildVariables((field) => field.example)) as Record<
      string,
      unknown
    >
    if (artifact.fields[0]) {
      const segments = artifact.fields[0].path.split('.')
      let cursor = (missingData.stat_data ?? {}) as Record<string, unknown>
      segments.forEach((segment, index) => {
        if (index === segments.length - 1) delete cursor[segment]
        else cursor = (cursor[segment] ?? {}) as Record<string, unknown>
      })
    }
    return [
      {
        id: 'long-values',
        label: '超长内容',
        sample: buildVariables((field) => `${field.example} · ${'很长的校样内容'.repeat(8)}`),
      },
      { id: 'missing-field', label: '缺失变量', sample: JSON.stringify(missingData, null, 2) },
      {
        id: 'type-error',
        label: '类型错误',
        sample: buildVariables((field) =>
          field.kind === 'number' || field.kind === 'percent' ? '不是数字' : { unexpected: true },
        ),
      },
    ]
  }
  const buildReply = (transform: (field: StatusField, index: number) => string) =>
    `<StatusPlaceHolder>\n${artifact.fields
      .map((field, index) => `${field.label}: ${transform(field, index)}`)
      .join('\n')}\n</StatusPlaceHolder>`
  return [
    {
      id: 'long-values',
      label: '超长内容',
      sample: buildReply((field) => `${field.example} · ${'很长的校样内容'.repeat(8)}`),
    },
    {
      id: 'missing-field',
      label: '缺失字段',
      sample: `<StatusPlaceHolder>\n${artifact.fields
        .slice(1)
        .map((field) => `${field.label}: ${field.example}`)
        .join('\n')}\n</StatusPlaceHolder>`,
    },
    {
      id: 'type-error',
      label: '异常数值',
      sample: buildReply((field) =>
        field.kind === 'number' || field.kind === 'percent' ? '不是数字' : field.example,
      ),
    },
  ]
}

/** 生成完全本地、可重复的十回合 MVU 校样，不读取或写入真实酒馆变量。 */
export function buildWorkshopMvuTurns(
  artifact: FrontendWorkshopArtifact,
  count = 10,
): WorkshopMvuTurn[] {
  if (artifact.dataMode !== 'mvu') return []
  return Array.from({ length: Math.max(1, Math.min(20, count)) }, (_unused, index) => {
    const statData: Record<string, unknown> = {}
    const changedFields: string[] = []
    artifact.fields.forEach((field, fieldIndex) => {
      let value: unknown = field.example
      if (field.kind === 'number') {
        value = (Number.parseFloat(field.example) || fieldIndex * 7) + index * (fieldIndex + 1)
      } else if (field.kind === 'percent') {
        value = `${Math.min(100, (Number.parseFloat(field.example) || 20) + index * 8)}%`
      } else if (field.kind === 'tags') {
        value = index % 3 === 0 ? `${field.example}、第${index + 1}回合` : field.example
      } else if (field.kind === 'longText') {
        value = `${field.example}${index ? `；本回合发生了第 ${index + 1} 次变化` : ''}`
      } else if (index && (fieldIndex + index) % 3 === 0) {
        value = `${field.example} · 变化${index}`
      }
      if (index && value !== field.example) changedFields.push(field.label)
      setPath(statData, field.path, [value, `第 ${index + 1} 回合校样`])
    })
    return {
      turn: index + 1,
      label: `第 ${index + 1} 回合`,
      changedFields,
      sample: JSON.stringify({ stat_data: statData }, null, 2),
    }
  })
}

/** 生成可直接导入 SillyTavern 的原生世界书；正则与世界书仍保持为两个标准文件。 */
export function buildWorkshopWorldbook(
  artifact: FrontendWorkshopArtifact,
): WorkshopWorldbookArtifact {
  return {
    entries: {
      '0': {
        uid: 0,
        key: [],
        keysecondary: [],
        comment:
          artifact.dataMode === 'mvu'
            ? `${artifact.title} · 状态栏输出协议 · 需酒馆助手、MVU、ST-Prompt-Template`
            : `${artifact.title} · 状态栏输出协议`,
        content: artifact.prompt,
        constant: true,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: false,
        order: 100,
        position: 4,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: 0,
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        outletName: '',
        triggers: [],
      },
    },
  }
}
