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
// Public does not include the private main repository's audit commands.
// SRL-PUBLIC-SYNC: END REPLACE id=main-build-preflights
run('pnpm', ['exec', 'vue-tsc', '-b'])
run('pnpm', ['exec', 'vite', 'build'])
run('node', ['scripts/Check-OfficialAppPackages.mjs'])
