// What a data source answers. Two implementations: `live` (the machine's
// wikis through the CLI and their page frontmatter) and `fixtures` (the
// bundled demo dataset). Routes talk to this interface and nothing below it.

import type {
  Briefing,
  BriefingsView,
  DataSource,
  FleetView,
  NewView,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'
import type { Since } from './cli.js'

export interface WikiRoot {
  key: string
  name: string
  path: string
}

export interface Source {
  readonly kind: DataSource
  opsVersion(): Promise<string | null>
  roots(): Promise<WikiRoot[]>
  wikis(): Promise<WikiSummary[]>
  today(key: string): Promise<TodayView>
  whatsNew(key: string, since: Since): Promise<NewView>
  fleet(key: string): Promise<FleetView>
  briefings(key: string): Promise<BriefingsView>
  briefing(key: string, id: string): Promise<Briefing | null>
}

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`)
  }
}

export const emptyCounts = () => ({ new: 0, updated: 0, waiting: 0, distilled: 0, failed: 0 })
