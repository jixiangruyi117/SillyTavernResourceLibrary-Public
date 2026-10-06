/** Runs user-authorized JavaScript in the resource-library page's origin. */
export async function runAssistantPageScript(code: string, signal: AbortSignal): Promise<unknown> {
  const source = code.trim()
  if (!source || source.length > 30_000) throw new Error('脚本不能为空或超过30000字')
  signal.throwIfAborted()
  const execute = new Function(
    'signal',
    `"use strict"; return (async () => {\n${source}\n})()`,
  ) as (signal: AbortSignal) => Promise<unknown>
  const result = await execute(signal)
  signal.throwIfAborted()
  if (result === undefined) return undefined
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(result)
  } catch {
    throw new Error('脚本已运行，但返回值无法序列化给 AI')
  }
  if (serialized === undefined) return String(result).slice(0, 16_000)
  if (serialized.length > 16_000) throw new Error('脚本已运行，但返回结果超过16000字，未发送给 AI')
  return JSON.parse(serialized) as unknown
}
