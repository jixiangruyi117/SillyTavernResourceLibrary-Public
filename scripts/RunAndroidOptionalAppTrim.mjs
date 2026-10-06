import process from 'node:process'
import { spawnSync } from 'node:child_process'

// CI needs Capacitor's generated Gradle/plugin files but does not produce a distributable APK.
// The production-only trim is implemented in PowerShell, so skip only that size optimization on
// non-Windows hosts instead of turning a successful Capacitor sync into a failed native build.
if (process.platform !== 'win32') process.exit(0)

const result = spawnSync(
  'powershell',
  [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'scripts/Trim-AndroidOptionalApps.ps1',
  ],
  { stdio: 'inherit' },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
