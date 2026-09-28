// What a data source answers. Two implementations: `live` (the machine's
// wikis through the CLI and their page frontmatter) and `fixtures` (the
// bundled demo dataset). Routes talk to this interface and nothing below it.

import type {
  Briefing,
  BriefingsView,
  DataSource,
  FleetView,
  Facets,
  NewView,
  PageView,
  ReplayDay,
  ReplayDays,
  Resolved,
  SearchParams,
  SearchView,
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
  /** With `at`, each of these three answers as the screen stood at that instant of a recorded day. */
  today(key: string, at?: string): Promise<TodayView>
  whatsNew(key: string, since: Since, at?: string): Promise<NewView>
  fleet(key: string, at?: string): Promise<FleetView>
  /** Days with commits to replay, and one day's events in order. */
  replayDays(key: string): Promise<ReplayDays>
  replayDay(key: string, date: string): Promise<ReplayDay>
  briefings(key: string): Promise<BriefingsView>
  briefing(key: string, id: string): Promise<Briefing | null>
  /** A page by its wiki-relative path, for the reader. */
  page(key: string, rel: string): Promise<PageView | null>
  /** Where a `[[wikilink]]` points, by the page's file stem, the way an editor resolves it. */
  resolve(key: string, link: string): Promise<Resolved | null>
  search(key: string, params: SearchParams): Promise<SearchView>
  facets(key: string): Promise<Facets>
}

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`)
  }
}

export const emptyCounts = () => ({ new: 0, updated: 0, waiting: 0, distilled: 0, failed: 0 })

/** `[[Sales playbook › Packaging|alias]]` → `sales playbook`: the page part, lowercased. */
export function linkStem(link: string): string {
  const target = link.split('|')[0] ?? ''
  const page = target.split(/[›>#]/)[0] ?? ''
  return page.trim().toLowerCase()
}

/** A file stem the way a link names it: `q4-renewal_terms` and `Q4 Renewal Terms` are one page. */
export function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
}
