import type { TavernResourceKind } from './TavernBridgeProtocol'
export interface ParcelFile {
  file: File
  kind: TavernResourceKind
  displayName: string
  targetName?: string
  operationId?: string
}
export function createParcel(
  base: string,
  files: ParcelFile[],
  progress?: (message: string) => void,
  options?: {
    signal?: AbortSignal
    fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  },
): Promise<{ ticket: string; expiresAt: number }>
export function readParcel(
  base: string,
  ticket: string,
  progress?: (message: string) => void,
  options?: {
    signal?: AbortSignal
    fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  },
): Promise<ParcelFile[]>
export function removeParcel(
  base: string,
  ticket: string,
  options?: {
    signal?: AbortSignal
    fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  },
): Promise<void>
