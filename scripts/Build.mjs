import { spawnSync } from 'node:child_process'
import process from 'node:process'

function run(command, args) {
  const windowsCommand = [command, ...args].join(' ')
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', windowsCommand], {
          stdio: 'inherit',
        })
      : spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// SRL-PUBLIC-SYNC: BEGIN REPLACE id=main-build-preflights
// Validate the reviewed Public knowledge owners without account-service contracts.
run('node', ['scripts/Check-AssistantKnowledge.mjs'])
// SRL-PUBLIC-SYNC: END REPLACE id=main-build-preflights
run('pnpm', ['exec', 'vue-tsc', '-b'])
run('pnpm', ['exec', 'vite', 'build'])
run('node', ['scripts/Check-OfficialAppPackages.mjs'])
