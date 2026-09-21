import type { FrontendWorkshopSourceComponent } from '../types/FrontendWorkshopSourceComponent'

export interface FrontendWorkshopSourceComponentStorage {
  list(): Promise<FrontendWorkshopSourceComponent[]>
  get(id: string): Promise<FrontendWorkshopSourceComponent | undefined>
  /** expectedRevision=0 表示 create-if-absent；正整数表示 revision CAS。 */
  putIfRevision(
    component: FrontendWorkshopSourceComponent,
    expectedRevision: number,
  ): Promise<boolean>
  setProjectAssociation(
    id: string,
    projectId: string,
    associated: boolean,
  ): Promise<FrontendWorkshopSourceComponent | undefined>
  delete(id: string): Promise<void>
}
