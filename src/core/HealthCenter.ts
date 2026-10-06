export type HealthIssueSeverity = 'warning' | 'error'

export interface HealthIssue {
  id: string
  kind: string
  label: string
  details: string
  severity: HealthIssueSeverity
  safeRepair?: () => Promise<void>
}

export interface HealthScanner {
  id: string
  scan(): Promise<HealthIssue[]>
}

export class HealthCenter {
  private readonly scanners = new Map<string, HealthScanner>()

  register(scanner: HealthScanner): () => void {
    this.scanners.set(scanner.id, scanner)
    return () => {
      if (this.scanners.get(scanner.id) === scanner) this.scanners.delete(scanner.id)
    }
  }

  async scan(): Promise<HealthIssue[]> {
    const results: HealthIssue[] = []
    for (const scanner of this.scanners.values()) {
      try {
        results.push(...(await scanner.scan()))
      } catch (error) {
        results.push({
          id: `scanner-failed:${scanner.id}`,
          kind: 'health-scanner-failed',
          label: '部分健康检查未完成',
          details: error instanceof Error ? error.message : '检查器返回了未知错误',
          severity: 'warning',
        })
      }
    }
    return results
  }

  async repairSafe(issues: HealthIssue[]): Promise<number> {
    let repaired = 0
    for (const issue of issues) {
      if (!issue.safeRepair) continue
      await issue.safeRepair()
      repaired += 1
    }
    return repaired
  }
}

export const healthCenter = new HealthCenter()
