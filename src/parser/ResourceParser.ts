import type { ParsedResource } from '../types/Import'

export interface ResourceParser {
  supports(file: File): boolean
  parse(file: File): Promise<ParsedResource>
}

export class ResourceParserRegistry {
  private readonly parsers: ResourceParser[]

  constructor(parsers: ResourceParser[]) {
    this.parsers = parsers
  }

  async parse(file: File): Promise<ParsedResource> {
    const parser = this.parsers.find((candidate) => candidate.supports(file))

    if (!parser) {
      throw new Error('当前支持 PNG 角色卡、JSON/JSONL 聊天与 JSON 资源，以及 CSS/TXT 美化片段')
    }

    return parser.parse(file)
  }
}
