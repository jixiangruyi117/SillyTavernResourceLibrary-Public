/** @vitest-environment node */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const checkerFixture = `
  import { createHash } from 'node:crypto';
  import { checkAssistantKnowledge } from './scripts/Check-AssistantKnowledge.mjs';
  const source = Buffer.from('export const entry = "fixture"');
  const knowledge = Buffer.from("id: 'fixture'");
  const hash = value => createHash('sha256').update(value).digest('hex');
  const manifest = { knowledgeSha256: hash(knowledge), sources: [{
    path: 'src/Fixture.ts', guides: ['fixture'], sha256: hash(source)
  }] };
  const read = async path => path.endsWith('.json') ? JSON.stringify(manifest) :
    path.endsWith('ProductAssistantKnowledge.ts') ? knowledge : source;
`

describe('assistant knowledge update gate', () => {
  it('accepts matching documented fingerprints without gating shipping on unrelated edits', () => {
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `${checkerFixture} console.log(await checkAssistantKnowledge(process.cwd(), read));`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )
    expect(result.trim()).toBe('1')
  })
  it('blocks a changed owner until its instructions are reviewed', () => {
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `${checkerFixture}
      try {
        await checkAssistantKnowledge(process.cwd(), async path => {
          const content = await read(path);
          return path.endsWith('Fixture.ts') ? Buffer.concat([content, Buffer.from('// new entry')]) : content;
        });
        process.exit(2);
      } catch (error) { console.log(error.message) }
    `,
      ],
      { encoding: 'utf8' },
    )
    expect(result).toContain('src/Fixture.ts')
    expect(result).toContain('知识需要复核')
  })
})
