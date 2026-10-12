// The live source: the machine's registered wikis, read through the CLI's
// `--json` answers and each wiki's page frontmatter. Every CLI shape this
// file relies on is named where it is read, so a CLI change is one edit here.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  LearnedView,
  Provenance,
  AskEvent,
  AskStatus,
  AreaSummary,
  Attention,
  Facets,
  SearchHit,
  SearchParams,
  SearchView,
  Briefing,
  BriefingsView,
  ChannelSummary,
  Counts,
  FleetView,
  ItemKind,
  JobSummary,
  JobView,
  Machine,
  NewItem,
  NewView,
  NowItem,
  PageView,
  PlanItem,
  Resolved,
  Routine,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'
import { brand } from '@dashboard/shared/brand'
import { config } from '../config/index.js'
import { ASK_SANDBOX, CliError, type Runner, type Since } from './cli.js'
import { isPage, readBody, readPages, type PageMeta } from './pages.js'
import { Busy, NotFound, Unsupported, emptyCounts, linkStem, stemKey, type Source, type WikiRoot } from './source.js'
import { replayViews } from './replay.js'
import { mergeAttention, readHead, readReport } from './briefs.js'
import type { Timeline } from './timeline.js'

// ---- CLI answer shapes (only the keys read here) ----------------------------

interface WikisLs {
  wikis: Array<{ key: string; name: string; path: string }>
}
export interface Status {
  machine: string
  peers?: Array<{ machine: string; capabilities?: string[]; last_seen?: string | null; state?: string }>
  problems?: unknown
  git?: { unpushed?: number; behind?: number; dirty?: number }
}
interface SearchStatus {
  serving?: string
  realm_ready?: boolean
  realm_reason?: string
  corpus_files?: number
}
/** A ticket in `jobs due`'s queue lists: this machine's queues, so a running one runs here. */
interface DueRow {
  id?: string
  job?: string
  stage?: string
  reason?: string
  /** Seconds since a running ticket was claimed; a pending group's oldest is `oldest_age_s`. */
  age_s?: number
  oldest_age_s?: number
}
/** `jobs due`'s `jobs` list: only the stages due here now, keyed by `slug`; a clock stage says why. */
interface DueJob {
  slug: string
  stage?: string
  due_since?: string | null
  held_by?: string | null
  reasons?: string[]
}
interface JobsDue {
  running?: DueRow[]
  pending?: DueRow[]
  review?: DueRow[]
  parked?: DueRow[]
  jobs?: DueJob[]
  caps?: Record<string, { cap: number; active: number }>
}
interface JobsLs {
  jobs: Array<{
    slug: string
    description?: string
    /** `pipeline` (the capture chain) or `routines` (skills in order): the grouping the record derives. */
    kind?: 'pipeline' | 'routines'
    claim?: string
    /** The job's pin, when it has one. */
    machine?: string | null
    /** A pipeline job's; a routines job's target is empty and it has no dest. */
    target?: string | null
    dest?: string | null
    every?: string
    /** A pipeline job's harvest unit; a routines job's first routine. The whole list is `jobs show`'s. */
    skill?: string | null
    state?: string
    /** Whether the job's clock stage is owed a run on this machine now. */
    due?: boolean
    /** Every stage, lease and status: who holds it, and when its newest ok run started. */
    stages?: Array<{ stage: string; skipped?: boolean; holder?: string | null; stalled?: boolean; ok_started?: string | null }>
    blocked?: { reason?: string } | string | null
  }>
}
type Job = JobsLs['jobs'][number]
/** A routine entry as the record writes it: exactly one of `skill`, `op` or `run`. */
interface RoutineEntry {
  skill?: string
  op?: string
  run?: string
  args?: string[]
}
/** `jobs show <slug> --json`: the folded record whole, and who holds its claim. */
interface JobsShow {
  job?: {
    slug: string
    details?: string[]
    window?: string | null
    routines?: RoutineEntry[] | null
  } | null
  /** `any` and `sticky` name a holder; `none` lists every machine's last run instead. */
  claim?: {
    kind?: string
    holder?: { machine?: string; text?: string } | null
    machines?: Array<{ machine: string; last_run?: string | null; outcome?: string }>
  }
}
interface OpSince {
  runs: Array<{ op: string; outcome: string; summary?: string; when: string; actor?: string }>
}
interface GitChanged {
  files: string[]
}
interface SearchAnswer {
  backend?: string
  degraded?: boolean
  count?: number
  emulated_filters?: string[]
  degradations?: string[]
  hits?: Array<{
    rank: number
    score: number
    locator?: string
    source_path?: string
    title?: string
    snippet?: string
    document_id?: string
    curation?: string
  }>
}

// ---- helpers ------------------------------------------------------------------

const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0)
const add = (a: Counts, k: ItemKind) => {
  a[k] += 1
}

function hostOf(target?: string | null): string | undefined {
  if (!target) return undefined
  try {
    return new URL(target).hostname.replace(/^www\./, '')
  } catch {
    return target.split(/[/:]/)[0]
  }
}

export function kindOf(p: PageMeta): ItemKind {
  if (p.extracted === 'failed') return 'failed'
  if (p.extracted === 'queued' || p.extracted === 'false') return 'waiting'
  if (p.rel.startsWith('wiki/') && (p.generated?.stage === 'distill' || (p.sources?.length ?? 0) > 0))
    return 'distilled'
  if ((p.documentRevision ?? 1) > 1 || p.generated?.stage === 'revise') return 'updated'
  return 'new'
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export function channelIdOf(p: PageMeta): string {
  if (p.job) return p.job
  if (p.group) return slug(p.group)
  if (p.channel) return slug(p.channel)
  if (p.host) return p.host
  const parts = p.rel.split('/')
  return parts.length > 2 ? parts.slice(0, 3).join('/') : parts[0] ?? 'wiki'
}

export function channelNameOf(p: PageMeta): string {
  if (p.group) return p.groupType ? `${p.group} · ${p.groupType}` : p.group
  if (p.channel) return p.channel
  if (p.host) return p.host
  if (p.rel.startsWith('wiki/')) return `Distilled by the ${brand.wikiNoun}`
  return p.rel.split('/').slice(0, 3).join(' · ')
}

export function whenOf(p: PageMeta): string {
  return p.harvested?.at ?? p.generated?.at ?? new Date().toISOString()
}

/** A job's record as `jobs show` folds it; absent where the show failed. */
type JobRecord = NonNullable<JobsShow['job']>

/** The stage a machine holds a live lease on, and so is running. */
const heldOf = (j: Job) => j.stages?.find((s) => s.holder && !s.stalled)

function stateOfJob(j: Job, due: JobsDue): ChannelSummary['state'] {
  if (j.state === 'paused') return 'paused'
  if (j.blocked && (typeof j.blocked === 'string' || j.blocked.reason)) return 'blocked'
  const slug = j.slug
  if (heldOf(j) || due.running?.some((r) => r.job === slug)) return 'running'
  if (due.parked?.some((r) => r.job === slug)) return 'parked'
  return 'idle'
}

function noteOfJob(j: Job, due: JobsDue): string | undefined {
  if (j.blocked) return typeof j.blocked === 'string' ? j.blocked : j.blocked.reason
  const parked = due.parked?.find((r) => r.job === j.slug)
  if (parked) return parked.reason ?? 'parked'
  const held = heldOf(j)
  if (held) return `${held.stage} on ${held.holder}`
  const running = due.running?.find((r) => r.job === j.slug)
  if (running) return running.stage ? `${running.stage} here` : 'running'
  return undefined
}

/** When the job's newest ok run started, on its clock stage: harvest for a pipeline, routine for a routines job. */
function lastOk(j: Job): string | undefined {
  const clock = j.kind === 'routines' ? 'routine' : 'harvest'
  return j.stages?.find((s) => s.stage === clock)?.ok_started ?? undefined
}

/** A chain part-way through is a state, not a fault: `jobs due` says how far it has got. */
const CHAIN = /^chain in progress \(\d+ of \d+\)$/

/** Why an active job is waiting, when the waiting is a state: a chain part-way through, or a first run waiting for its window. */
function waitOf(j: Job, row?: DueJob, rec?: JobRecord): string | undefined {
  const chain = row?.reasons?.find((x) => CHAIN.test(x))
  if (chain) return chain
  // The CLI's own words for a windowed job that has never run (dueness: "missed" needs an occurrence it was due in).
  if (j.state === 'active' && !j.due && rec?.window && !lastOk(j)) return `never run — waits for the ${rec.window} window`
  return undefined
}

function sinceMidnight(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function hoursSinceMidnight(): Since {
  const h = Math.max(1, Math.ceil((Date.now() - new Date(sinceMidnight()).getTime()) / 3_600_000))
  return `${h}h` as Since
}

function windowStart(window?: string | null): string | undefined {
  const m = /^(\d{2}):(\d{2})/.exec(window ?? '')
  if (!m) return undefined
  const d = new Date()
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.toISOString()
}

/** When `window` next opens: today's start if it is still ahead, else tomorrow's. */
function windowOpens(window?: string | null): string | undefined {
  const start = windowStart(window)
  if (!start) return undefined
  return Date.parse(start) > Date.now() ? start : new Date(Date.parse(start) + 86_400_000).toISOString()
}

const PERIOD_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

/** `6h` in milliseconds; none for `once` or a cadence the CLI's own grammar would not read. */
function periodMs(every?: string): number | undefined {
  const m = /^(\d+)([smhdw])$/.exec(every ?? '')
  return m ? Number(m[1]) * PERIOD_MS[m[2]!]! : undefined
}

/** When an active job that is neither due nor running comes due: its window's next opening, else its period after its last ok run.
 *  A `d` or `w` cadence with a window counts whole occurrences, so a window opening is the earliest it can run. */
function comesDue(j: Job, rec?: JobRecord): string | undefined {
  if (j.state !== 'active' || j.due || heldOf(j)) return undefined
  if (rec?.window) return windowOpens(rec.window)
  const last = lastOk(j)
  const period = periodMs(j.every)
  if (!last || !period) return undefined
  const at = Date.parse(last) + period
  return at > Date.now() ? new Date(at).toISOString() : undefined
}

/** How long a job's record is held, and how many `jobs show` run at once to read them. */
const RECORD_MS = 60_000
const SHOW_AT_ONCE = 4

/** Run `fn` over `items`, at most `n` at a time. */
async function eachLimited<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
  }))
}

/** The skill that writes the wiki's report; the job that runs it writes the briefings. */
const REPORT_SKILL = 'llm-wiki:wiki-report'

/** A routine entry as a step: exactly one of a skill, a host op or a unit's script. */
function routineOf(e: RoutineEntry): Routine | undefined {
  const args = e.args?.length ? { args: e.args } : {}
  if (e.skill) return { verb: 'skill', name: e.skill, ...args }
  if (e.op) return { verb: 'op', name: e.op }
  if (e.run) return { verb: 'run', name: e.run, ...args }
  return undefined
}

const routinesOf = (rec?: JobRecord): Routine[] => (rec?.routines ?? []).map(routineOf).filter((r): r is Routine => r !== undefined)

/** What a job runs: a routines job's steps in order (its first alone when the record could not be read), a pipeline's harvest unit. */
function skillsOf(j: Job, rec?: JobRecord): string[] {
  const steps = j.kind === 'routines' ? routinesOf(rec).map((r) => r.name) : []
  return steps.length ? steps : j.skill ? [j.skill] : []
}

/** Every declared job with its state: pipelines first, then routines, each by slug. */
function jobsOf(js: JobsLs, d: JobsDue, recs: Map<string, JobRecord>): JobSummary[] {
  const rows = new Map((d.jobs ?? []).map((r) => [r.slug, r]))
  return js.jobs
    .map<JobSummary>((j) => {
      const rec = recs.get(j.slug)
      return {
        slug: j.slug,
        description: j.description ?? '',
        kind: j.kind === 'routines' ? 'routines' : 'pipeline',
        claim: j.claim,
        machine: j.machine ?? undefined,
        skills: skillsOf(j, rec),
        host: hostOf(j.target),
        every: j.every,
        window: rec?.window ?? undefined,
        state: stateOfJob(j, d),
        note: noteOfJob(j, d) ?? waitOf(j, rows.get(j.slug), rec),
      }
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug))
}

/** Why Ask is off, in plain words, with the command that fixes it when one does. */
const askOff = {
  jailed: () =>
    new Unsupported('Ask needs the dashboard to run outside a jail, because a confined process cannot start another. Start it with npm start instead'),
  noTemplate: (key: string) =>
    new Unsupported(
      `This wiki has no ${ASK_SANDBOX} sandbox yet, which answers run in`,
      `${config.cliName} wiki ${key} sandboxes seed ${ASK_SANDBOX} && ${config.cliName} wiki ${key} sandboxes enable ${ASK_SANDBOX}`,
    ),
  notEnabled: (key: string) =>
    new Unsupported(
      `Answers run in the ${ASK_SANDBOX} sandbox, which is not enabled on this machine for this wiki`,
      `${config.cliName} wiki ${key} sandboxes enable ${ASK_SANDBOX}`,
    ),
}

/** A `harness run` refusal (its one `error` line before the spawn) as the error the route answers with. */
export function refusal(errorKey: string, message: string, wiki: string): Error {
  const k = `${errorKey} ${message}`.toLowerCase()
  if (/confined|jail/.test(k)) return askOff.jailed()
  if (/seed|template|missing/.test(k)) return askOff.noTemplate(wiki)
  if (/not.enabled/.test(k)) return askOff.notEnabled(wiki)
  if (/busy|already running|in progress|lock/.test(k))
    return new Busy('This wiki is already answering a question, from here or elsewhere on this machine; wait for it')
  if (/floor|read.?only|permission/.test(k))
    return new CliError(`harness run refused the read floor, which the dashboard should never set on this call: ${message}`, 'exit')
  if (/prompt|dash|too large|size|bytes/.test(k)) return new CliError(message, 'args')
  return new CliError(`harness run: ${message}`, 'exit')
}

/** `whereami --json`: `jail` is `none` unless the caller already runs in one. */
interface Whereami {
  sandbox?: { jail?: string }
}
/** `sandboxes ls --json`. */
interface SandboxesLs {
  sandboxes: Array<{ name: string; enabled: boolean }>
}
/** `agents ls --enabled --json`. */
interface AgentsLs {
  agents: Array<{ name: string; enabled?: boolean }>
}

// ---- the source -------------------------------------------------------------

export function liveSource(cli: Runner, timeline: Timeline): Source {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>()
  function memo<T>(key: string, fn: () => Promise<T>, ttlMs = config.cacheMs): Promise<T> {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
    const value = fn().catch((e: unknown) => {
      cache.delete(key)
      throw e
    })
    cache.set(key, { at: Date.now(), value })
    return value
  }

  /** A CLI failure on one panel must not blank the whole screen. */
  async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
    try {
      return await p
    } catch (e) {
      if (e instanceof CliError && config.logLevel === 'debug') console.warn(`[live] ${e.message}`)
      return fallback
    }
  }

  const roots = () =>
    memo('roots', async (): Promise<WikiRoot[]> => {
      const ans = await cli.run<WikisLs>('machine.wikis.ls')
      return ans.wikis.map(({ key, name, path }) => ({ key, name, path }))
    })

  async function root(key: string): Promise<WikiRoot> {
    const r = (await roots()).find((w) => w.key === key)
    if (!r) throw new NotFound(`wiki ${key}`)
    return r
  }

  const status = (wiki: string) => memo(`status:${wiki}`, () => cli.run<Status>('wiki.status', { wiki }))
  const search = (wiki: string) =>
    memo(`search:${wiki}`, () => soft(cli.run<SearchStatus>('wiki.search.status', { wiki }), {}))
  const due = (wiki: string) =>
    memo(`due:${wiki}`, () => soft(cli.run<JobsDue>('wiki.jobs.due', { wiki }), {}))
  const jobs = (wiki: string) =>
    memo(`jobs:${wiki}`, () => soft(cli.run<JobsLs>('wiki.jobs.ls', { wiki }), { jobs: [] }))
  /** Each job's folded record, for its window and its routines, which `jobs ls` does not carry. One `jobs show`
   *  per job, a few at a time and held for `RECORD_MS`: a record changes when someone edits it, not every poll. */
  const records = (wiki: string) =>
    memo(
      `records:${wiki}`,
      async () => {
        const js = await jobs(wiki)
        const recs = new Map<string, JobRecord>()
        await eachLimited(js.jobs, SHOW_AT_ONCE, async (j) => {
          const rec = (await soft(cli.run<JobsShow>('wiki.jobs.show', { wiki, slug: j.slug }), {})).job
          if (rec) recs.set(j.slug, rec)
        })
        return recs
      },
      RECORD_MS,
    )
  const runs = (wiki: string, since: Since) =>
    memo(`runs:${wiki}:${since}`, () => soft(cli.run<OpSince>('wiki.op.since', { wiki, since }), { runs: [] }))
  const changed = (wiki: string, since: Since) =>
    memo(`changed:${wiki}:${since}`, async () => {
      const r = await root(wiki)
      const ans = await soft(cli.run<GitChanged>('wiki.git.changed', { wiki, since }), { files: [] })
      return readPages(r.path, ans.files.filter(isPage))
    })

  async function summary(r: WikiRoot): Promise<WikiSummary> {
    const [st, se, d, js, rn, recs] = await Promise.all([
      soft(status(r.key), { machine: '' } as Status),
      search(r.key),
      due(r.key),
      jobs(r.key),
      runs(r.key, '1d'),
      records(r.key),
    ])
    const running = d.running?.length ?? 0
    const machines = new Set((st.peers ?? []).map((p) => p.machine))
    if (st.machine) machines.add(st.machine)
    const blocked = js.jobs.filter((j) => j.blocked).length
    const parked = d.parked?.length ?? 0
    const failedRuns = rn.runs.filter((x) => x.outcome && x.outcome !== 'ok').length
    let health: WikiSummary['health'] = 'ok'
    let healthNote: string | undefined
    if (se.realm_ready === false && se.serving !== undefined && se.serving !== 'search_server') {
      health = 'attention'
      healthNote = `search engine ${se.realm_reason ?? 'not ready'} · serving ${se.serving}`
    }
    if (blocked || parked) {
      health = 'attention'
      healthNote = `${blocked ? `${blocked} ${brand.channelNoun}${blocked > 1 ? 's' : ''} blocked` : ''}${blocked && parked ? ' · ' : ''}${parked ? `${parked} parked` : ''}`
    }
    if (failedRuns > 1) {
      health = 'failing'
      healthNote = `${failedRuns} runs failed today`
    }
    const last = rn.runs[0]
    // The next job to come due: the earliest among those not due now.
    let next: { job: string; at: string } | undefined
    for (const j of js.jobs) {
      const at = comesDue(j, recs.get(j.slug))
      if (at && (!next || at < next.at)) next = { job: j.slug, at }
    }
    return {
      key: r.key,
      name: r.name,
      path: r.path,
      pages: se.corpus_files ?? 0,
      channels: js.jobs.filter((j) => j.kind !== 'routines').length,
      jobsActive: js.jobs.filter((j) => j.state === 'active').length,
      jobsTotal: js.jobs.length,
      health,
      healthNote,
      machines: machines.size,
      running,
      lastRun: last
        ? { op: last.op, outcome: last.outcome, when: last.when, actor: last.actor ?? '', summary: last.summary ?? '' }
        : undefined,
      nextDue: next,
    }
  }

  /** Channels: every pipeline job, plus one per source the pages name; a routines job watches no source.
   *  `discover` widens where the pages came from (a month of history) without widening what is counted (today). */
  async function channelsOf(wiki: string, pages: PageMeta[], discover: PageMeta[] = pages): Promise<ChannelSummary[]> {
    const [js, d, recs] = await Promise.all([jobs(wiki), due(wiki), records(wiki)])
    const rows = new Map((d.jobs ?? []).map((r) => [r.slug, r]))
    const byId = new Map<string, ChannelSummary>()
    for (const j of js.jobs) {
      if (j.kind === 'routines') continue
      byId.set(j.slug, {
        id: j.slug,
        name: j.description || j.slug,
        kind: j.skill ?? 'watch',
        host: hostOf(j.target),
        job: j.slug,
        every: j.every,
        machine: j.machine ?? undefined,
        watched: true,
        state: stateOfJob(j, d),
        stateNote: noteOfJob(j, d) ?? waitOf(j, rows.get(j.slug), recs.get(j.slug)),
        counts: emptyCounts(),
      })
    }
    const seen = new Set(pages)
    for (const p of [...pages, ...discover.filter((x) => !seen.has(x))]) {
      const id = channelIdOf(p)
      let ch = byId.get(id)
      if (!ch) {
        ch = {
          id,
          name: channelNameOf(p),
          kind: p.groupType ?? (p.rel.startsWith('wiki/') ? 'wiki' : 'source'),
          host: p.host,
          job: p.job,
          machine: p.harvested?.machine,
          watched: false,
          state: 'idle',
          counts: emptyCounts(),
        }
        byId.set(id, ch)
      }
      if (!ch.area && p.areas[0]) ch.area = p.areas[0]
      if (!ch.machine && p.harvested?.machine) ch.machine = p.harvested.machine
      if (seen.has(p)) add(ch.counts, kindOf(p))
    }
    return [...byId.values()].sort((a, b) => total(b.counts) - total(a.counts))
  }

  function areasOf(channels: ChannelSummary[], pages: PageMeta[]): AreaSummary[] {
    const byArea = new Map<string, AreaSummary>()
    const areaOfChannel = new Map<string, string>()
    // A channel belongs to the area most of its pages name.
    for (const ch of channels) {
      const tally = new Map<string, number>()
      for (const p of pages) if (channelIdOf(p) === ch.id) for (const a of p.areas.slice(0, 1)) tally.set(a, (tally.get(a) ?? 0) + 1)
      const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ch.area ?? 'Unsorted'
      areaOfChannel.set(ch.id, best)
    }
    for (const ch of channels) {
      const name = areaOfChannel.get(ch.id) ?? 'Unsorted'
      let area = byArea.get(name)
      if (!area) {
        area = { name, count: 0, counts: emptyCounts(), channels: [] }
        byArea.set(name, area)
      }
      area.channels.push({ ...ch, area: name })
      for (const k of Object.keys(area.counts) as ItemKind[]) area.counts[k] += ch.counts[k]
      area.count = total(area.counts)
    }
    return [...byArea.values()].sort((a, b) => b.count - a.count)
  }

  /** When a queue row's ticket was claimed or queued, from its age. */
  const ago = (s?: number) => new Date(Date.now() - (s ?? 0) * 1000).toISOString()

  /** The queues `jobs due` lists are this machine's own, so every row is on `here`. */
  function nowOf(d: JobsDue, channels: ChannelSummary[], here: string): NowItem[] {
    const name = (slug?: string) => channels.find((c) => c.id === slug)?.name ?? slug ?? 'a channel'
    const rows: NowItem[] = []
    for (const r of d.running ?? [])
      rows.push({ id: r.id ?? `${r.job}-${r.stage}`, what: `${cap(r.stage ?? 'working')} · ${name(r.job)}`, who: name(r.job), machine: here, stage: r.stage ?? '', state: 'running', since: ago(r.age_s) })
    for (const r of d.parked ?? [])
      rows.push({ id: r.id ?? `${r.job}-parked`, what: `${name(r.job)} parked`, who: name(r.job), machine: here, stage: r.stage ?? '', state: 'parked', since: ago(), note: r.reason })
    for (const r of d.pending ?? [])
      rows.push({ id: `${r.job}-${r.stage}-pending`, what: `${name(r.job)} waiting for a machine`, who: name(r.job), machine: here, stage: r.stage ?? '', state: 'pending', since: ago(r.oldest_age_s) })
    return rows
  }

  function planOf(js: JobsLs, rn: OpSince, d: JobsDue, recs: Map<string, JobRecord>, here: string): PlanItem[] {
    const today = sinceMidnight()
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString()
    const items: PlanItem[] = []
    for (const r of rn.runs) {
      if (r.when < today) continue
      items.push({ time: r.when, job: r.op, text: r.summary ? `${r.op} · ${r.summary}` : r.op, status: r.outcome === 'ok' ? 'done' : 'failed', machine: r.actor?.split('@')[1] })
    }
    for (const r of d.running ?? []) items.push({ time: ago(r.age_s), job: r.job ?? 'a job', text: `${r.job ?? 'a job'} · ${r.stage ?? 'running'}`, status: 'running', machine: here })
    // Scheduled: every active job due now and not yet running, and every one that comes due later today.
    // A chain part-way through is due; it reads as how far it has got, never as a fault.
    const running = new Set((d.running ?? []).map((r) => r.job))
    const rows = new Map((d.jobs ?? []).map((r) => [r.slug, r]))
    for (const j of js.jobs) {
      if (j.state !== 'active' || running.has(j.slug) || heldOf(j)) continue
      const rec = recs.get(j.slug)
      const at = j.due ? '' : comesDue(j, rec)
      if (at === undefined || at >= tomorrow) continue
      const text = [j.slug, skillsOf(j, rec).join(', '), waitOf(j, rows.get(j.slug), rec) ?? (j.every && `every ${j.every}`)].filter(Boolean).join(' · ')
      items.push({ time: at, job: j.slug, text, status: 'upcoming' })
    }
    return items.sort((a, b) => (a.time || '9').localeCompare(b.time || '9'))
  }

  function attentionOf(wiki: WikiSummary, channels: ChannelSummary[], se: SearchStatus): Attention[] {
    const out: Attention[] = []
    for (const c of channels) {
      if (c.state === 'blocked') out.push({ id: `blocked-${c.id}`, title: `${c.name} can't be fetched`, detail: c.stateNote ?? 'blocked on this machine', severity: 'attention', source: c.name, action: { label: 'Fleet', href: `/w/${wiki.key}/fleet` } })
      if (c.state === 'failed') out.push({ id: `failed-${c.id}`, title: `${c.name} failed`, detail: c.stateNote ?? '', severity: 'failing', source: c.name })
    }
    if (se.realm_ready === false && se.serving && se.serving !== 'search_server')
      out.push({ id: 'search', title: 'Search is running on the fallback', detail: `engine ${se.realm_reason ?? 'not ready'} · serving ${se.serving}`, severity: 'info', source: 'search' })
    return out
  }

  async function briefingList(wiki: string): Promise<Briefing[]> {
    const r = await root(wiki)
    const dir = join(r.path, 'wiki', 'reports')
    const rels: string[] = []
    async function walk(rel: string, depth: number): Promise<void> {
      if (depth > 3) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(join(r.path, rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('_') || e.name.startsWith('.')) continue
        const p = `${rel}/${e.name}`
        if (e.isDirectory()) await walk(p, depth + 1)
        else if (e.name.endsWith('.md') && e.name !== 'index.md') rels.push(p)
      }
    }
    void dir
    await walk('wiki/reports', 0)
    const pages = await readPages(r.path, rels)
    return pages
      .map<Briefing>((p) => ({
        id: Buffer.from(p.rel).toString('base64url'),
        kind: p.type ?? p.rel.split('/')[2] ?? 'report',
        title: p.title,
        when: whenOf(p),
        path: p.rel,
        summary: p.description ?? '',
      }))
      .sort((a, b) => b.when.localeCompare(a.when))
  }

  /** Every page's file stem → paths, the way an editor resolves `[[links]]`; rebuilt at most once a
   *  minute. `first` keeps one path per stem (`wiki/` is walked first, so a distilled page outranks
   *  its source); `all` keeps every path, for the stems many pages share, like `_index`. */
  const stems = (wiki: string) =>
    memo(`stems:${wiki}`, async () => {
      const r = await root(wiki)
      const index = new Map<string, string>()
      const all = new Map<string, string[]>()
      async function walk(rel: string, depth: number): Promise<void> {
        if (depth > 8) return
        let entries: import('node:fs').Dirent[]
        try {
          entries = await readdir(join(r.path, rel), { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          const p = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) {
            if (!/^[._]/.test(e.name) && !['node_modules', 'assets'].includes(e.name)) await walk(p, depth + 1)
          } else if (isPage(p)) {
            const key = stemKey(e.name.replace(/\.md$/, ''))
            // The first hit wins, and `wiki/` is walked first: a distilled page outranks its source.
            if (!index.has(key)) index.set(key, p)
            all.set(key, [...(all.get(key) ?? []), p])
          }
        }
      }
      for (const top of ['wiki', 'research', 'sources']) await walk(top, 0)
      return { first: index, all }
    })

  /** Every page's frontmatter, for the filter values; rebuilt at most once a minute (memo) and cheap
   *  for a few thousand pages. A wiki past that wants the engine's own facet answer. */
  const allPages = (wiki: string) =>
    memo(`allpages:${wiki}`, async () => {
      const r = await root(wiki)
      const index = await stems(wiki)
      return readPages(r.path, [...index.first.values()])
    })

  const replay = replayViews({
    timeline,
    root,
    summary,
    status,
    channelsOf,
    areasOf,
    briefings: (key) => briefingList(key),
    head: async (key, rel) => readHead((await root(key)).path, rel),
  })

  /** Today's briefing and what its page says, when one was written since midnight. */
  async function todaysReport(key: string) {
    const r = await root(key)
    const found = (await soft(briefingList(key), [])).find((b) => b.when >= sinceMidnight())
    return found ? { briefing: found, read: await readReport(r.path, found.path) } : undefined
  }

  /** document_id → page, and document_id → the wiki pages that list it among their sources. */
  const provIndex = (wiki: string) =>
    memo(`prov:${wiki}`, async () => {
      const byDoc = new Map<string, PageMeta>()
      const into = new Map<string, PageMeta[]>()
      for (const p of await allPages(wiki)) {
        if (p.documentId) byDoc.set(p.documentId, p)
        for (const s of p.sources ?? []) if (s.id) into.set(s.id, [...(into.get(s.id) ?? []), p])
      }
      return { byDoc, into }
    })

  async function provenanceOf(wiki: string, m: PageMeta): Promise<Provenance> {
    const { byDoc, into } = await soft(provIndex(wiki), { byDoc: new Map<string, PageMeta>(), into: new Map<string, PageMeta[]>() })
    const sourced = m.rel.startsWith('sources/') || Boolean(m.harvested || m.resource)
    return {
      channel: sourced ? { id: channelIdOf(m), name: channelNameOf(m) } : undefined,
      host: m.host,
      captured: m.harvested,
      generated: m.generated,
      from: (m.sources ?? []).map((s) => {
        const hit = s.id ? byDoc.get(s.id) : undefined
        return { title: s.title ?? hit?.title ?? s.resource ?? s.id ?? 'a source', path: hit?.rel, resource: s.resource }
      }),
      into: (m.documentId ? into.get(m.documentId) ?? [] : []).map((p) => ({ title: p.title, path: p.rel })),
    }
  }

  return {
    kind: 'live',
    replayDays: async (key) => {
      await root(key)
      return replay.days(key)
    },
    replayDay: async (key, date) => {
      await root(key)
      return replay.day(key, date)
    },
    opsVersion: () =>
      memo('opsVersion', () =>
        soft(cli.run<{ version?: string; distribution?: string }>('machine.version').then((v) => v.version ?? v.distribution ?? null), null),
      ),
    roots,
    wikis: async () => Promise.all((await roots()).map(summary)),
    today: async (key, at): Promise<TodayView> => {
      if (at) return replay.today(key, at)
      const r = await root(key)
      const since = hoursSinceMidnight()
      const [w, pages, d, js, rn, se, recs, st] = await Promise.all([
        summary(r),
        changed(key, since),
        due(key),
        jobs(key),
        runs(key, since),
        search(key),
        records(key),
        soft(status(key), { machine: '' } as Status),
      ])
      const channels = await channelsOf(key, pages)
      const areas = areasOf(channels, pages)
      const counts = emptyCounts()
      for (const a of areas) for (const k of Object.keys(counts) as ItemKind[]) counts[k] += a.counts[k]
      const n = total(counts)
      const report = await todaysReport(key)
      const attention = mergeAttention(report?.read.attention ?? [], attentionOf(w, channels, se), (a) => a.source ?? '')
      const todays = report ? { ...report.briefing, head: report.read.head } : undefined
      const lede =
        n === 0
          ? `Nothing new since midnight. ${w.running ? `${w.running} agent${w.running > 1 ? 's are' : ' is'} working now.` : 'The next run is in the plan below.'}`
          : `Since midnight your ${brand.wikiNoun} gained ${n} page${n === 1 ? '' : 's'} across ${areas.length} area${areas.length === 1 ? '' : 's'}.${attention.length ? ` ${attention.length} thing${attention.length > 1 ? 's need' : ' needs'} a look.` : ''}`
      return {
        wiki: w,
        since: sinceMidnight(),
        totals: { pages: n, areas: areas.length, counts },
        lede,
        areas,
        now: nowOf(d, channels, st.machine),
        plan: planOf(js, rn, d, recs, st.machine),
        attention,
        briefing: todays,
      }
    },
    whatsNew: async (key, since, at): Promise<NewView> => {
      if (at) return replay.whatsNew(key, at)
      const r = await root(key)
      const [w, pages] = await Promise.all([summary(r), changed(key, since)])
      const channels = await channelsOf(key, pages)
      const areas = areasOf(channels, pages)
      const counts = emptyCounts()
      for (const a of areas) for (const k of Object.keys(counts) as ItemKind[]) counts[k] += a.counts[k]
      const areaOfChannel = new Map(areas.flatMap((a) => a.channels.map((c) => [c.id, a.name] as const)))
      const items: NewItem[] = pages
        .map((p) => ({
          path: p.rel,
          title: p.title,
          kind: kindOf(p),
          when: whenOf(p),
          channel: channelIdOf(p),
          area: areaOfChannel.get(channelIdOf(p)),
          sub: p.description,
          resource: p.resource,
        }))
        .sort((a, b) => b.when.localeCompare(a.when))
      return { wiki: w, since: since === hoursSinceMidnight() ? sinceMidnight() : since, totals: { pages: total(counts), counts }, areas, items }
    },
    fleet: async (key, at): Promise<FleetView> => {
      if (at) return replay.fleet(key, at)
      const r = await root(key)
      const since = hoursSinceMidnight()
      const [w, st, d, js, rn, pages, se, recs] = await Promise.all([
        summary(r),
        soft(status(key), { machine: '' } as Status),
        due(key),
        jobs(key),
        runs(key, since),
        changed(key, since),
        search(key),
        records(key),
      ])
      // A wiki with no jobs and a quiet day still has a history worth drawing.
      const discover = js.jobs.length || pages.length ? pages : await changed(key, '30d')
      const channels = await channelsOf(key, pages, discover)
      // Who is running what: the live leases `jobs ls` names, on any machine.
      const runningBy = new Map<string, number>()
      for (const j of js.jobs)
        for (const x of j.stages ?? []) if (x.holder && !x.stalled) runningBy.set(x.holder, (runningBy.get(x.holder) ?? 0) + 1)
      const machines = machinesOf(st, runningBy)
      const todayRuns = rn.runs.filter((x) => x.when >= sinceMidnight())
      return {
        wiki: w,
        machines,
        channels,
        health: {
          machinesSeen: machines.filter((m) => m.state !== 'stale' && m.state !== 'unknown').length,
          machinesTotal: machines.length,
          runsOk: todayRuns.filter((x) => x.outcome === 'ok').length,
          runsTotal: todayRuns.length,
          attention: channels.filter((c) => c.state === 'blocked' || c.state === 'failed').length,
        },
        attention: mergeAttention((await todaysReport(key))?.read.attention ?? [], attentionOf(w, channels, se), (a) => a.source ?? ''),
        plan: planOf(js, rn, d, recs, st.machine),
        jobs: jobsOf(js, d, recs),
      }
    },
    briefings: async (key): Promise<BriefingsView> => {
      const r = await root(key)
      const [w, reports, js, recs] = await Promise.all([summary(r), briefingList(key), jobs(key), records(key)])
      // The job that writes reports: the one whose routines include the wiki report, an active one first.
      // A fresh wiki ships it paused, which is a state to say, not a fault.
      const writes = js.jobs.filter((j) => j.kind === 'routines' && skillsOf(j, recs.get(j.slug)).includes(REPORT_SKILL))
      const j = writes.find((x) => x.state === 'active') ?? writes[0]
      if (!j) return { wiki: w, reports }
      if (j.state !== 'active') return { wiki: w, reports, next: { job: j.slug, every: j.every, paused: true } }
      return { wiki: w, reports, next: { job: j.slug, at: comesDue(j, recs.get(j.slug)), every: j.every } }
    },
    job: async (key, slug): Promise<JobView | null> => {
      await root(key)
      const js = await jobs(key)
      const j = js.jobs.find((x) => x.slug === slug)
      if (!j) return null
      // Read fresh, not from the held records: opening a job is where someone looks after editing it.
      const [d, shown] = await Promise.all([due(key), cli.run<JobsShow>('wiki.jobs.show', { wiki: key, slug })])
      const rec = shown.job ?? undefined
      const [summary] = jobsOf({ jobs: [j] }, d, new Map(rec ? [[slug, rec]] : []))
      return {
        ...summary!,
        details: rec?.details ?? [],
        routines: routinesOf(rec),
        holder: shown.claim?.holder?.text,
        machines: shown.claim?.machines?.map((m) => ({ machine: m.machine, lastRun: m.last_run ?? undefined, outcome: m.outcome })),
      }
    },
    briefing: async (key, id) => {
      const r = await root(key)
      let rel: string
      try {
        rel = Buffer.from(id, 'base64url').toString('utf8')
      } catch {
        return null
      }
      if (!rel.startsWith('wiki/reports/') || !isPage(rel)) return null
      const page = await readBody(r.path, rel)
      if (!page) return null
      return {
        id,
        kind: page.meta.type ?? 'report',
        title: page.meta.title,
        when: whenOf(page.meta),
        path: rel,
        summary: page.meta.description ?? '',
        body: page.body,
      }
    },
    page: async (key, rel): Promise<PageView | null> => {
      const r = await root(key)
      if (!isPage(rel)) return null
      const page = await readBody(r.path, rel)
      if (!page) return null
      return {
        path: rel,
        title: page.meta.title,
        kind: page.meta.type ?? 'page',
        when: whenOf(page.meta),
        areas: page.meta.areas,
        resource: page.meta.resource,
        body: page.body,
        provenance: await provenanceOf(key, page.meta),
      }
    },
    resolve: async (key, link): Promise<Resolved | null> => {
      const index = await stems(key)
      const stem = linkStem(link)
      if (!stem) return null
      const k = stemKey(stem)
      const paths = index.all.get(k) ?? []
      // Many pages can share a stem (`_index`). The citation's title, after the `|`, says which one.
      const title = titleKey(link.split('|')[1])
      if (paths.length > 1 && title) {
        const r = await root(key)
        const match = (await readPages(r.path, paths)).find((p) => titleKey(p.title) === title)
        if (match) return { link, path: match.rel }
      }
      const path = index.first.get(k)
      return path ? { link, path } : null
    },
    search: async (key, params): Promise<SearchView> => {
      await root(key)
      const filters: Record<string, string> = {}
      for (const [kind, value] of Object.entries(params.filters ?? {})) if (value) filters[kind] = value
      if (params.capturedFrom) filters.captured_from = params.capturedFrom
      if (params.capturedTo) filters.captured_to = params.capturedTo
      const ans = await cli.run<SearchAnswer>('wiki.search.query', { wiki: key, text: params.q, k: params.k, filters })
      const hits: SearchHit[] = (ans.hits ?? []).map((h) => ({
        rank: h.rank,
        score: h.score,
        path: h.source_path ?? h.locator ?? '',
        title: h.title ?? h.source_path ?? '',
        snippet: cleanSnippet(h.snippet ?? ''),
        documentId: h.document_id,
        curation: h.curation,
      }))
      return {
        q: params.q,
        backend: ans.backend ?? 'unknown',
        degraded: Boolean(ans.degraded),
        count: ans.count ?? hits.length,
        hits,
        emulated: ans.emulated_filters ?? [],
        degradations: ans.degradations ?? [],
      }
    },
    learned: async (key, days): Promise<LearnedView> => {
      const r = await root(key)
      const [w, recent, all] = await Promise.all([summary(r), changed(key, `${days}d` as Since), soft(allPages(key), [])])
      const dates = dayList(days)
      const index = new Map(dates.map((d, i) => [d, i]))
      const byArea = new Map<string, number[]>()
      for (const p of recent) {
        const kind = kindOf(p)
        if (kind !== 'new' && kind !== 'distilled') continue
        const i = index.get(localDay(whenOf(p)))
        if (i === undefined) continue
        const area = p.areas[0] ?? 'Unsorted'
        const row = byArea.get(area) ?? dates.map(() => 0)
        row[i] = (row[i] ?? 0) + 1
        byArea.set(area, row)
      }
      // A page counts from the day it was captured or written; one with neither was always there.
      const born = all.map((p) => (p.harvested?.at ?? p.generated?.at ? localDay((p.harvested?.at ?? p.generated?.at) as string) : ''))
      const size = dates.map((d) => born.filter((b) => b <= d).length)
      const channels = await channelsOf(key, recent)
      const lastOf = new Map<string, string>()
      for (const p of recent) {
        const id = channelIdOf(p)
        const t = whenOf(p)
        if ((lastOf.get(id) ?? '') < t) lastOf.set(id, t)
      }
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const quiet = channels
        .filter((c) => (lastOf.get(c.id) ?? '') < weekAgo)
        .map((c) => ({ id: c.id, name: c.name, last: lastOf.get(c.id) ?? '' }))
      return {
        wiki: w,
        days: dates,
        areas: [...byArea].map(([name, perDay]) => ({ name, perDay, total: perDay.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total),
        size,
        quiet,
      }
    },
    // Checked before a session is spawned, with verbs every CLI has, so the
    // page can say why Ask is off before anyone types.
    askStatus: (key) =>
      memo(
        `ask:${key}`,
        async (): Promise<AskStatus> => {
          await root(key)
          const [where, boxes, agents] = await Promise.all([
            cli.run<Whereami>('wiki.whereami', { wiki: key }),
            cli.run<SandboxesLs>('wiki.sandboxes.ls', { wiki: key }),
            soft(cli.run<AgentsLs>('wiki.agents.ls', { wiki: key }), { agents: [] }),
          ])
          const names = agents.agents.filter((a) => a.enabled !== false).map((a) => a.name)
          const off = (u: Unsupported): AskStatus => ({ available: false, reason: u.message, fix: u.fix, agents: names })
          if ((where.sandbox?.jail ?? 'none') !== 'none') return off(askOff.jailed())
          const box = boxes.sandboxes.find((b) => b.name === ASK_SANDBOX)
          if (!box) return off(askOff.noTemplate(key))
          if (!box.enabled) return off(askOff.notEnabled(key))
          return { available: true, agents: names }
        },
        config.ask.statusMs,
      ),
    ask: async function* (key, req, signal): AsyncGenerator<AskEvent> {
      const st = await this.askStatus(key)
      if (!st.available) throw new Unsupported(st.reason ?? 'Ask is off here', st.fix)
      const started = Date.now()
      let begun = false
      const lines = cli.stream(
        'wiki.harness.run',
        { wiki: key, skill: req.skill, agent: req.agent, model: req.model, effort: req.effort, text: req.q },
        { timeoutMs: config.ask.timeoutMs, signal },
      )
      for await (const l of lines) {
        const f = l as Record<string, unknown>
        const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : undefined)
        const num = (k: string) => (typeof f[k] === 'number' ? (f[k] as number) : undefined)
        if (l.type === '_exit') {
          const x = l as Extract<typeof l, { type: '_exit' }>
          if (!begun && /no such command/i.test(x.stderr))
            throw new Unsupported('The command line on this machine cannot run a harness on request yet (it has no harness run): update the llm-wiki plugins')
          if (!begun && x.spawnError) throw new CliError(`harness run: ${x.spawnError}`, 'spawn')
          if (!begun) throw new CliError(x.timedOut ? 'harness run: timed out before it started' : `harness run: rc ${x.rc}`, 'exit', x.rc ?? undefined, x.stderr)
          if (signal.aborted) return
          yield {
            type: 'error',
            message: x.timedOut
              ? `The answer took longer than ${Math.round(config.ask.timeoutMs / 1000)}s and was stopped`
              : `The session ended without an answer (rc ${x.rc})`,
            detail: x.stderr || undefined,
          }
          return
        }
        if (l.type === 'error') {
          const message = str('message') ?? str('error') ?? str('detail') ?? 'the session failed'
          // Before the spawn, a refusal is exactly one error line: `error` names it.
          if (!begun) throw refusal(str('error') ?? '', message, key)
          yield { type: 'error', message, detail: str('detail') }
          return
        }
        begun = true
        if (l.type === 'start') yield { type: 'start' }
        else if (l.type === 'text') {
          const text = str('text')
          if (text) yield { type: 'text', text }
        } else if (l.type === 'tool') yield { type: 'tool', name: str('name') ?? 'Working', detail: str('detail') }
        else if (l.type === 'result') {
          const outcome = str('outcome')
          const answer = str('answer') ?? ''
          if (!answer.trim()) {
            yield { type: 'error', message: `The session ended with no answer${outcome ? ` (${outcome})` : ''}` }
            return
          }
          yield {
            type: 'result',
            q: req.q,
            answer,
            skill: req.skill,
            model: str('model') ?? req.model,
            effort: str('effort') ?? req.effort,
            elapsedS: Math.round(num('elapsed_s') ?? (Date.now() - started) / 1000),
            session: str('session'),
            outcome,
          }
          return
        }
      }
    },
    facets: async (key): Promise<Facets> => {
      const pages = await allPages(key)
      const tally = (pick: (p: PageMeta) => string[] | string | undefined) => {
        const counts = new Map<string, number>()
        for (const p of pages) {
          const v = pick(p)
          for (const x of Array.isArray(v) ? v : v ? [v] : []) counts.set(x, (counts.get(x) ?? 0) + 1)
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v).slice(0, 200)
      }
      return {
        areas: tally((p) => p.areas),
        tags: tally((p) => p.tags),
        types: tally((p) => p.type),
        groups: tally((p) => p.group),
        groupTypes: tally((p) => p.groupType),
        hosts: tally((p) => p.host),
        authors: tally((p) => p.author ?? p.channel),
        curations: tally((p) => p.status),
        unders: tally((p) => p.rel.split('/')[0]),
      }
    },
  }
}

/** A page title the way a citation writes it: case, dashes and spacing do not tell two titles apart. */
export function titleKey(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[\s\u2010-\u2015_-]+/g, ' ').trim()
}

/** A local calendar date, YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The last `n` local dates, oldest first, ending today. */
export function dayList(n: number): string[] {
  return Array.from({ length: n }, (_, i) => localDay(new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString()))
}

/** The wiki's machines as the status verb sees them, with what each is running. */
export function machinesOf(st: Status, runningBy: Map<string, number>): Machine[] {
  const machines: Machine[] = (st.peers ?? []).map((p) => {
    const seen = p.last_seen ?? null
    const ageH = seen ? (Date.now() - new Date(seen).getTime()) / 3_600_000 : Infinity
    const running = runningBy.get(p.machine) ?? 0
    return {
      name: p.machine,
      thisMachine: p.machine === st.machine,
      capabilities: p.capabilities ?? [],
      lastSeen: seen,
      state: running ? 'live' : ageH < 48 ? 'idle' : seen ? 'stale' : 'unknown',
      running,
      leases: 0,
    }
  })
  if (st.machine && !machines.some((m) => m.thisMachine))
    machines.unshift({ name: st.machine, thisMachine: true, capabilities: [], lastSeen: new Date().toISOString(), state: runningBy.get(st.machine) ? 'live' : 'idle', running: runningBy.get(st.machine) ?? 0, leases: 0 })
  return machines
}

/** A snippet reads as prose: markdown markers, callout tags and speaker labels dropped. */
function cleanSnippet(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[!\w+\]/g, ' ')
    .replace(/^\s*>+\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*Speaker \d+:\*\*/g, ' ')
    .replace(/[*_`]{1,3}/g, '')
    .replace(/\[(\d\d:\d\d)\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
