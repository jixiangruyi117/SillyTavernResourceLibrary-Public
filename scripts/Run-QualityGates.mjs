import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import console from 'node:console'

export function qualityGatePlan(stage, run, port = 5180) {
  if (!['candidate', 'release'].includes(stage))
    throw new Error('门禁阶段必须为 candidate 或 release')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/u.test(run))
    throw new Error('无效的门禁运行名称（最多50字符）')
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5173)
    throw new Error('门禁需要明确隔离端口，不能占用 5173')
  const pnpm = (name, label) => ({ kind: 'pnpm', args: [name], label })
  const steps = [
    pnpm('check', '源码、结构、功能完整性、类型、单元测试与生产构建'),
    pnpm('auth:test', '真实本地认证服务契约测试'),
    pnpm('audit:pwa-offline', '离线产物合同'),
    pnpm('audit:bundle-budget', '静态资源预算'),
  ]
  if (stage === 'release')
    steps.push(pnpm('audit:secrets', '既有源码凭据检查（不替代公开增量隐私审计）'))
  for (const suite of stage === 'release'
    ? ['official-apps', 'appearance', 'detail-layout']
    : ['official-apps'])
    for (const engine of ['chromium', 'webkit'])
      steps.push({
        kind: 'node',
        args: [
          'scripts/Run-IsolatedAudit.mjs',
          '--suite',
          suite,
          '--run',
          `${run}-${suite}-${engine}`,
          '--port',
          String(port),
          '--engine',
          engine,
        ],
        label: `${suite} / ${engine} / fixture认证与真实候选包`,
      })
  return steps
}

export async function executeGateStep(step) {
  const pnpmEntry = process.env.npm_execpath
  if (step.kind === 'pnpm' && process.platform === 'win32' && !pnpmEntry)
    throw new Error('Windows 请通过 pnpm check:candidate / pnpm check:release 启动门禁')
  const node = step.kind === 'node' || Boolean(pnpmEntry)
  const args = step.kind === 'pnpm' && pnpmEntry ? [pnpmEntry, ...step.args] : step.args
  await new Promise((accept, reject) => {
    const child = spawn(node ? process.execPath : 'pnpm', args, {
      stdio: 'inherit',
      windowsHide: true,
    })
    const stop = () => child.kill('SIGTERM')
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      if (code === 0) accept()
      else reject(new Error(`${step.label}：${signal || `退出码 ${code}`}`))
    })
  })
}

export async function runQualityGates(steps, execute = executeGateStep) {
  for (const step of steps) {
    console.log(`门禁：${step.label}`)
    await execute(step)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const stage = args.shift() || 'candidate'
  const options = {}
  try {
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]
      if (!['--run', '--port'].includes(key) || !args[index + 1] || key in options)
        throw new Error(`无效的门禁参数：${key}`)
      options[key] = args[index + 1]
    }
    const run = options['--run'] || `${stage}-${Date.now()}`
    const port = Number(options['--port'] || process.env.SRL_GATE_PORT || 5180)
    await runQualityGates(qualityGatePlan(stage, run, port))
    console.log(`${stage} 门禁通过；未执行任何部署、迁移、上传或 APK 构建`)
  } catch (error) {
    console.error(`门禁阻塞：${error.message}`)
    process.exitCode = 1
  }
}
