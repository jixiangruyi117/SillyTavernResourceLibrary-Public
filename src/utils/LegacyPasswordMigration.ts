import { scryptAsync } from '@noble/hashes/scrypt.js'

export interface LegacyPasswordChallenge {
  token: string
  salt: string
  cost: number
  blockSize: number
  parallelism: number
  derivedKeyLength: number
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function createLegacyPasswordProof(
  password: string,
  challenge: LegacyPasswordChallenge,
): Promise<string> {
  if (
    challenge.cost !== 32768 ||
    challenge.blockSize !== 8 ||
    challenge.parallelism !== 1 ||
    challenge.derivedKeyLength !== 64
  )
    throw new Error('服务器返回了不受支持的旧密码参数')
  const derivedKey = await scryptAsync(
    new TextEncoder().encode(password),
    decodeBase64Url(challenge.salt),
    {
      N: challenge.cost,
      r: challenge.blockSize,
      p: challenge.parallelism,
      dkLen: challenge.derivedKeyLength,
      maxmem: 64 * 1024 * 1024,
      asyncTick: 5,
    },
  )
  const key = await crypto.subtle.importKey(
    'raw',
    derivedKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const proof = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(challenge.token))
  return encodeBase64Url(proof)
}
