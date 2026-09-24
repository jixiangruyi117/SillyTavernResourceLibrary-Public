import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import process from 'node:process'
import { unzipSync } from 'fflate'

const root = resolve(import.meta.dirname, '..')
const privateKeyMarker = [
  '-----BEGIN ',
  '(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?',
  'PRIVATE KEY-----',
].join('')
const patterns = [
  { name: 'private key', value: new RegExp(privateKeyMarker, 'u') },
  {
    name: 'GitHub token',
    value: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/u,
  },
  {
    name: 'Cloudflare API credential',
    value: /\b(?:CLOUDFLARE|CF)_(?:API_)?(?:TOKEN|KEY)\s*[:=]\s*["']?([A-Za-z0-9_-]{30,})["']?/u,
    highEntropyCapture: true,
  },
  {
    name: 'Discord bot token',
    value: /\b[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{5,10}\.[A-Za-z0-9_-]{25,}\b/u,
  },
  {
    name: 'Discord webhook credential',
    value: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{50,}/u,
  },
  {
    name: 'Bearer credential',
    value: /\bBearer\s+([A-Za-z0-9._~+/-]{32,}={0,})/giu,
    highEntropyCapture: true,
  },
  {
    name: 'JWT credential',
    value: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/u,
  },
  { name: 'AWS access key', value: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: 'Slack token', value: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
  { name: 'OpenAI API key', value: /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/u },
  {
    name: 'hard-coded API credential',
    value:
      /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*['"]([A-Za-z0-9_+/.=-]{32,})['"]/giu,
    highEntropyCapture: true,
  },
]

function shannonEntropy(value) {
  const counts = new Map()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

function hasPlaceholder(value) {
  return /(?:your[-_ ]|example|placeholder|changeme|replace|dummy|fake|test|sample|xxxx|\.\.\.|<[^>]+>)/iu.test(
    value,
  )
}

function isCredentialMatch(pattern, match) {
  if (!pattern.highEntropyCapture) return true
  const candidate = match[1]
  return !hasPlaceholder(candidate) && shannonEntropy(candidate) >= 3.5
}

export function scanText(source) {
  const findings = []
  for (const pattern of patterns) {
    const flags = pattern.value.flags.includes('g')
      ? pattern.value.flags
      : `${pattern.value.flags}g`
    const matcher = new RegExp(pattern.value.source, flags)
    for (const match of source.matchAll(matcher)) {
      if (isCredentialMatch(pattern, match)) findings.push(pattern.name)
    }
  }
  return [...new Set(findings)]
}

const archiveExtensions = new Set(['.zip', '.srlapp', '.jar', '.apk', '.aab'])
const archiveSignature = [0x50, 0x4b, 0x03, 0x04]

function isArchive(buffer, path) {
  return (
    archiveExtensions.has(extname(path).toLowerCase()) ||
    archiveSignature.every((byte, index) => buffer[index] === byte)
  )
}

export function scanBuffer(buffer, path, depth = 0) {
  const bytes = Buffer.from(buffer)
  if (isArchive(bytes, path)) {
    if (depth >= 3) return [`${path}: archive nesting exceeds scan limit`]
    const findings = []
    try {
      for (const [entryPath, content] of Object.entries(unzipSync(bytes))) {
        const nestedPath = `${path}!/${entryPath}`
        findings.push(...scanBuffer(content, nestedPath, depth + 1))
      }
    } catch {
      findings.push(`${path}: archive could not be inspected`)
    }
    return findings
  }

  if (bytes.includes(0)) return []
  const source = bytes.toString('utf8')
  if (
    source.includes('\uFFFD') &&
    !/\.(?:md|txt|json|jsonc|ya?ml|xml|html|css|js|mjs|ts|vue|kt|java|gradle|ps1|sh)$/iu.test(path)
  ) {
    return []
  }
  return scanText(source).map((name) => `${path}: ${name}`)
}

export function scanGitTracked() {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
    },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const findings = []
  let scannedCount = 0
  for (const path of tracked) {
    const absolutePath = resolve(root, path)
    if (!existsSync(absolutePath)) continue
    scannedCount += 1
    findings.push(...scanBuffer(readFileSync(absolutePath), path))
  }
  return { trackedCount: scannedCount, findings }
}

export function scanGitHistory() {
  const commits = new Set([
    ...execFileSync('git', ['rev-list', '--all'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean),
    ...execFileSync('git', ['reflog', '--all', '--format=%H'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean),
  ])
  const blobs = new Map()
  const findings = []
  for (const commit of commits) {
    const entries = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', commit], {
      cwd: root,
    })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
    for (const entry of entries) {
      const [metadata, path] = entry.split('\t')
      const [mode, type, blob] = metadata.split(' ')
      if (type !== 'blob' || mode === '120000' || blobs.has(blob)) continue
      blobs.set(blob, `${commit}:${path}`)
    }
  }

  const blobEntries = [...blobs]
  for (let offset = 0; offset < blobEntries.length; offset += 32) {
    const batch = blobEntries.slice(offset, offset + 32)
    const output = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: `${batch.map(([blob]) => blob).join('\n')}\n`,
      maxBuffer: 256 * 1024 * 1024,
    })
    let cursor = 0
    for (const [expectedBlob, path] of batch) {
      const headerEnd = output.indexOf(0x0a, cursor)
      if (headerEnd < 0) throw new Error(`无法读取 Git blob 标头：${expectedBlob}`)
      const [actualBlob, type, sizeText] = output.toString('utf8', cursor, headerEnd).split(' ')
      const size = Number(sizeText)
      if (actualBlob !== expectedBlob || type !== 'blob' || !Number.isSafeInteger(size)) {
        throw new Error(`Git blob 响应异常：${expectedBlob}`)
      }
      const contentStart = headerEnd + 1
      findings.push(...scanBuffer(output.subarray(contentStart, contentStart + size), path))
      cursor = contentStart + size + 1
    }
  }
  return { commitCount: commits.size, blobCount: blobs.size, findings }
}

function report(label, findings) {
  if (findings.length) throw new Error(`${label} 发现疑似凭据：\n- ${findings.join('\n- ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const mode = process.argv[2]
  if (mode === '--history') {
    const { commitCount, blobCount, findings } = scanGitHistory()
    report('Git 历史 Secret scan', findings)
    process.stdout.write(
      `Git 历史 Secret scan 通过：检查 ${commitCount} 个 commit、${blobCount} 个唯一 blob\n`,
    )
  } else {
    const { trackedCount, findings } = scanGitTracked()
    report('Secret scan', findings)
    process.stdout.write(
      `Secret scan 通过：检查 ${trackedCount} 个 Git 跟踪或待提交路径及其中的文本资源\n`,
    )
  }
}
