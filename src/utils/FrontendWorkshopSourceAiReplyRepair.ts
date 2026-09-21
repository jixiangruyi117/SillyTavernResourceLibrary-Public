import type { FrontendWorkshopSourceAiGeneration } from '../services/FrontendWorkshopSourceAiSessionService'

/** A failed reply is repairable only while its original context and received text remain available. */
export function getFrontendWorkshopSourceAiRepairReceipt(
  generation: FrontendWorkshopSourceAiGeneration | undefined,
) {
  if (generation?.status !== 'failed' || !generation.bundle || generation.recoveryBlocked)
    return undefined
  return [...(generation.receipts ?? [])]
    .reverse()
    .find(
      (receipt) => receipt.rawText.trim() && ['invalid', 'interrupted'].includes(receipt.status),
    )
}
