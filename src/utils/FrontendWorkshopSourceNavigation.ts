export const FRONTEND_WORKSHOP_SOURCE_LOCATE_EVENT = 'srl:frontend-workshop-source-locate'

export interface FrontendWorkshopSourceLocateRequest {
  projectId: string
  sourceRevision: number
  range: { start: number; end: number }
  confidence: 'exact' | 'inferred'
}

export function requestFrontendWorkshopSourceLocate(
  request: FrontendWorkshopSourceLocateRequest,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<FrontendWorkshopSourceLocateRequest>(FRONTEND_WORKSHOP_SOURCE_LOCATE_EVENT, {
      detail: {
        ...request,
        range: { ...request.range },
      },
    }),
  )
}
