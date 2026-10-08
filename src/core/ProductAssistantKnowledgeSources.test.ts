/** @vitest-environment node */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('assistant knowledge update gate', () => {
  it('requires reviewed fingerprints for the real documented owners before shipping', () => {
    const result = execFileSync(process.execPath, ['scripts/Check-AssistantKnowledge.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result).toContain('知识源检查通过')
  })
  it('blocks a changed owner until its instructions are reviewed', () => {
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { readFile } from 'node:fs/promises';
      import { checkAssistantKnowledge } from './scripts/Check-AssistantKnowledge.mjs';
      try {
        await checkAssistantKnowledge(process.cwd(), async (path, ...options) => {
          const content = await readFile(path, ...options);
          return path.endsWith('UseFeatureHub.ts') ? Buffer.concat([content, Buffer.from('// new entry')]) : content;
        });
        process.exit(2);
      } catch (error) { console.log(error.message) }
    `,
      ],
      { encoding: 'utf8' },
    )
    expect(result).toContain('UseFeatureHub.ts')
    expect(result).toContain('知识需要复核')
  })
})
