import { describe, expect, it } from 'vitest'
import { normalizeManifest } from './ExternalAppPackage'
import {
  normalizeExternalAppTools,
  validateExternalAppToolArguments,
  readExternalAppToolResult,
} from './ExternalAppTools'

const tool = {
  name: 'save_note',
  title: '记笔记',
  description: '保存一条 APP 笔记',
  version: '1.0.0',
  apiVersion: 'srl-app-tools@1',
  permissions: ['app.storage'],
  parameters: {
    type: 'object',
    properties: {
      noteText: { type: 'string', maxLength: 80 },
      count: { type: 'integer', enum: [1, 2] },
      tags: { type: 'array', maxItems: 2, items: { type: 'string' } },
    },
    required: ['noteText', 'count'],
    additionalProperties: false,
  },
}
const normalized = () => normalizeExternalAppTools([tool], ['app.storage'])[0]!
describe('custom tool declarations and arguments', () => {
  it('preserves declarations in the canonical manifest and validates real argument shape', () => {
    const manifest = normalizeManifest({
      schemaVersion: 2,
      apiVersion: 'srl-app-api@1',
      id: 'com.example.tools',
      name: '工具',
      version: '1.0.0',
      entry: 'index.html',
      permissions: ['app.storage'],
      tools: [tool],
    })
    expect(manifest.tools).toEqual([normalized()])
    expect(
      validateExternalAppToolArguments(normalized(), '{"noteText":"你好","count":2,"tags":["书"]}'),
    ).toEqual({ noteText: '你好', count: 2, tags: ['书'] })
  })
  it.each([
    { permissions: ['resources.write'] },
    { apiVersion: 'made-up' },
    { name: '../login' },
    { version: 'latest' },
    { unexpected: true },
    { parameters: { ...tool.parameters, additionalProperties: true } },
    {
      parameters: {
        ...tool.parameters,
        properties: { text: { type: 'string', pattern: '.*' } },
        required: ['text'],
      },
    },
    { parameters: { ...tool.parameters, required: ['missing'] } },
    {
      parameters: JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":[],"additionalProperties":false}',
      ),
    },
  ])('rejects unsupported/ambiguous declaration %j', (patch) => {
    expect(() => normalizeExternalAppTools([{ ...tool, ...patch }], ['app.storage'])).toThrow()
  })
  it('rejects duplicates, old-schema tools and excessive declarations', () => {
    expect(() => normalizeExternalAppTools([tool, tool], ['app.storage'])).toThrow('唯一')
    expect(() => normalizeExternalAppTools(Array(13).fill(tool), ['app.storage'])).toThrow('12')
    expect(() =>
      normalizeManifest({
        schemaVersion: 1,
        id: 'com.example.old',
        name: '旧',
        version: '1.0.0',
        entry: 'index.html',
        permissions: ['app.storage'],
        tools: [tool],
      }),
    ).toThrow('清单版本 2')
  })
  it.each([
    '{}',
    '{"noteText":1,"count":1}',
    '{"noteText":"x","count":3}',
    '{"noteText":"x","count":1,"extra":true}',
    '{"noteText":"x","count":1,"tags":["a","b","c"]}',
    JSON.stringify({ noteText: 'x'.repeat(81), count: 1 }),
    'null',
    '[]',
  ])('rejects invalid invocation %s', (args) => {
    expect(() => validateExternalAppToolArguments(normalized(), args)).toThrow()
  })
  it('bounds results and never leaks malformed private output through parser errors', () => {
    expect(readExternalAppToolResult('{"value":"私人笔记"}')).toEqual({ value: '私人笔记' })
    expect(() => readExternalAppToolResult('PRIVATE_FORM_SECRET')).toThrow('JSON 无效')
    expect(() => readExternalAppToolResult('['.repeat(11) + '0' + ']'.repeat(11))).toThrow(
      '过于复杂',
    )
    expect(() => readExternalAppToolResult('"' + 'x'.repeat(16000) + '"')).toThrow('16000')
  })
})
