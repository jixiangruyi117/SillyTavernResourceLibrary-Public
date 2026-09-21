import { type Category, type ResourceSummary } from '../types/Resource'

export type UserPersonaAppProps = { resources: ResourceSummary[]; categories: Category[] }

export type UserPersonaAppEvents = { back: []; 'library-changed': [] }
