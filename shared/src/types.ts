// The API contract between server and client. The server builds these from
// the ops CLI's `--json` answers and the wiki's page frontmatter; the client
// renders them and nothing else. Every route under /api answers one of these.

export type Mode = 'read' | 'write'
export type DataSource = 'live' | 'fixtures'
export type Health = 'ok' | 'attention' | 'failing'

/** What the UI needs to boot: name, mode, and where the data comes from. */
export interface AppConfig {
  productName: string
  tagline: string
  nouns: {
    wiki: [string, string]
    channel: [string, string]
    machine: [string, string]
    briefing: [string, string]
  }
  mode: Mode
  source: DataSource
  version: string
  opsVersion: string | null
  machine: string
  now: string
  ask: AskOptions
}

/** What the Ask gear may choose from; the server refuses anything outside these lists. */
export interface AskOptions {
  models: string[]
  efforts: string[]
  defaultModel: string
  defaultEffort: string
  defaultPrefix: string
}

/** One question for the wiki, run as `<prefix> <q>` in an agent session. */
export interface AskRequest {
  q: string
  model: string
  effort: string
  /** A slash command naming the skill, like `/ask`. */
  prefix: string
}

export interface AskAnswer {
  q: string
  /** Markdown with [[wikilink]] citations. */
  answer: string
  skill: string
  model: string
  effort: string
  elapsedS: number
  session?: string
}

export interface HealthReport {
  ok: boolean
  version: string
  mode: Mode
  source: DataSource
  opsVersion: string | null
  cliFound: boolean
  now: string
}

export interface RunSummary {
  op: string
  outcome: string
  when: string
  actor: string
  summary: string
}

export interface WikiSummary {
  key: string
  name: string
  path: string
  pages: number
  channels: number
  bundlesEnabled: number
  bundlesTotal: number
  health: Health
  healthNote?: string
  machines: number
  running: number
  lastRun?: RunSummary
  nextDue?: { bundle: string; at: string }
}

export interface Machine {
  name: string
  thisMachine: boolean
  capabilities: string[]
  lastSeen: string | null
  state: 'live' | 'idle' | 'stale' | 'unknown'
  running: number
  leases: number
}

/** One watched source, as the UI shows it: the engine's job plus its counts today. */
export interface ChannelSummary {
  id: string
  name: string
  kind: string
  host?: string
  job?: string
  area?: string
  machine?: string
  every?: string
  /** A job watches this source; false when it is only seen through pages. */
  watched: boolean
  state: 'idle' | 'running' | 'parked' | 'blocked' | 'paused' | 'failed'
  stateNote?: string
  counts: Counts
}

export interface Counts {
  new: number
  updated: number
  waiting: number
  distilled: number
  failed: number
}

export type ItemKind = keyof Counts

export interface NewItem {
  path: string
  title: string
  kind: ItemKind
  when: string
  channel: string
  area?: string
  sub?: string
  resource?: string
}

export interface AreaSummary {
  name: string
  count: number
  counts: Counts
  channels: ChannelSummary[]
  /** One sentence an agent wrote about the area today; absent before the briefing ran. */
  headline?: string
}

export interface NowItem {
  id: string
  what: string
  who: string
  machine: string
  stage: string
  state: 'running' | 'parked' | 'blocked' | 'pending'
  since: string
  note?: string
}

export interface PlanItem {
  time: string
  bundle: string
  text: string
  status: 'done' | 'failed' | 'running' | 'upcoming'
  machine?: string
}

export interface Attention {
  id: string
  title: string
  detail: string
  severity: 'info' | 'attention' | 'failing'
  action?: { label: string; href: string }
}

export interface Briefing {
  id: string
  kind: string
  title: string
  when: string
  path: string
  summary: string
  /** Markdown body, present on the single-report route only. */
  body?: string
}

/** One wiki page, for the in-app reader a wikilink opens. */
export interface PageView {
  path: string
  title: string
  kind: string
  when: string
  areas: string[]
  resource?: string
  body: string
}

export interface Resolved {
  link: string
  path: string
}

export interface TodayView {
  wiki: WikiSummary
  since: string
  totals: { pages: number; areas: number; counts: Counts }
  lede: string
  areas: AreaSummary[]
  now: NowItem[]
  plan: PlanItem[]
  attention: Attention[]
  briefing?: Briefing
}

export interface NewView {
  wiki: WikiSummary
  since: string
  totals: { pages: number; counts: Counts }
  areas: AreaSummary[]
  items: NewItem[]
}

export interface FleetView {
  wiki: WikiSummary
  machines: Machine[]
  channels: ChannelSummary[]
  health: { machinesSeen: number; machinesTotal: number; runsOk: number; runsTotal: number; attention: number }
  attention: Attention[]
  plan: PlanItem[]
}

export interface BriefingsView {
  wiki: WikiSummary
  reports: Briefing[]
}

export interface TraceRow {
  at: string
  kind: string
  argv: string[]
  rc: number
  elapsed_s?: number
  signal?: string
  stderr_tail?: string
}

export type ViewName = 'today' | 'new' | 'fleet' | 'briefings'

/** One thing that happened on a replayed day: a page landing, or a run starting or ending. */
export interface ReplayEvent {
  at: string
  kind: 'page' | 'run-start' | 'run-end'
  title: string
  /** A page's kind, or a run's outcome. */
  detail?: string
  path?: string
  /** The channel's display name, for a page. */
  channel?: string
  machine?: string
}

/** A recorded day, in the order it happened. `start`/`end` bound the local day. */
export interface ReplayDay {
  date: string
  start: string
  end: string
  events: ReplayEvent[]
}

/** Days with something to replay, newest first, with how many commits each carries. */
export interface ReplayDays {
  days: Array<{ date: string; commits: number }>
}

/** What the SSE stream at /api/events carries. */
export type DashboardEvent =
  | { type: 'hello'; now: string; source: DataSource }
  | { type: 'trace'; wiki: string; row: TraceRow }
  | { type: 'changed'; wiki: string; views: ViewName[] }
  | { type: 'heartbeat'; now: string }

/** The search filters the engine takes; every value is a comma-joined OR, and a leading `-` negates. */
export const SEARCH_FILTER_KINDS = [
  'author',
  'group',
  'group_type',
  'type',
  'source_host',
  'area',
  'tag',
  'bundle_id',
  'under',
  'curation',
] as const
export type SearchFilterKind = (typeof SEARCH_FILTER_KINDS)[number]

export interface SearchParams {
  q: string
  k?: number
  filters?: Partial<Record<SearchFilterKind, string>>
  capturedFrom?: string
  capturedTo?: string
}

export interface SearchHit {
  rank: number
  score: number
  path: string
  title: string
  snippet: string
  documentId?: string
  curation?: string
}

export interface SearchView {
  q: string
  backend: string
  degraded: boolean
  count: number
  hits: SearchHit[]
  /** Filters the engine could not honor exactly, as it names them. */
  emulated: string[]
  degradations: string[]
}

/** The values the filters can take, read off the wiki's pages. */
export interface Facets {
  areas: string[]
  tags: string[]
  types: string[]
  groups: string[]
  groupTypes: string[]
  hosts: string[]
  authors: string[]
  curations: string[]
  unders: string[]
}
