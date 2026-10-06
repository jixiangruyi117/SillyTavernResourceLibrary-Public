import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDiscordBridgeManualSource } from '../src/services/DiscordBridgeDeployService.ts'

/** Derive one Dashboard-ready module from the same entry and dependencies as Wrangler. */
export async function buildDiscordManualWorkerSource(root = process.cwd()): Promise<string> {
  const entry = join(root, 'workers/discord-source-bridge/src/index.ts')
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      {
        name: 'discord-manual-schema',
        setup(builder) {
          builder.onLoad(
            { filter: /discord-source-bridge[\\/]src[\\/]index\.ts$/ },
            async ({ path }) => ({
              contents: buildDiscordBridgeManualSource(await readFile(path, 'utf8')),
              loader: 'ts',
              resolveDir: join(root, 'workers/discord-source-bridge/src'),
            }),
          )
        },
      },
    ],
  })
  const source = result.outputFiles[0]?.text
  if (!source) throw new Error('Discord 手动部署脚本生成失败')
  return source
}
