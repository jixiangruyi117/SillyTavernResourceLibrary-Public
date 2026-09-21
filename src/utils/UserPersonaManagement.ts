import type { UserPersonaDraft, UserPersonaTemplate } from '../types/UserPersona'

export const USER_PERSONA_TEMPLATES: UserPersonaTemplate[] = [
  {
    id: 'blank',
    name: '空白人设',
    description: '',
  },
  {
    id: 'brief',
    name: '简洁自我介绍',
    description: '{{user}} 是一名……\n\n{{user}} 的说话方式与偏好是……',
  },
  {
    id: 'roleplay',
    name: '角色扮演玩家',
    description:
      '姓名：{{user}}\n身份：\n外貌与气质：\n性格与表达习惯：\n与当前故事的关系：\n\n{{user}} 会保持角色设定，并根据剧情自然行动。',
  },
  {
    id: 'creative',
    name: '创作协作身份',
    description:
      '{{user}} 正在参与一场创作。\n\n偏好的叙事风格：\n希望避免的内容：\n创作目标：\n\n请把 {{user}} 视为故事中的真实参与者，而不是旁观者。',
  },
]

export function applyUserPersonaTemplate(
  draft: UserPersonaDraft,
  templateId: string,
  templates: readonly UserPersonaTemplate[] = USER_PERSONA_TEMPLATES,
): UserPersonaDraft {
  const template = templates.find((item) => item.id === templateId)
  if (!template) return { ...draft, connections: draft.connections.map((item) => ({ ...item })) }
  return {
    ...draft,
    description: template.description,
    connections: draft.connections.map((item) => ({ ...item })),
  }
}
