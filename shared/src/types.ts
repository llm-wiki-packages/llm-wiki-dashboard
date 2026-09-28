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

/** What the SSE stream at /api/events carries. */
export type DashboardEvent =
  | { type: 'hello'; now: string; source: DataSource }
  | { type: 'trace'; wiki: string; row: TraceRow }
  | { type: 'changed'; wiki: string; views: ViewName[] }
  | { type: 'heartbeat'; now: string }
