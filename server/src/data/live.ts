// The live source: the machine's registered wikis, read through the CLI's
// `--json` answers and each wiki's page frontmatter. Every CLI shape this
// file relies on is named where it is read, so a CLI change is one edit here.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AskAnswer,
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
  Machine,
  NewItem,
  NewView,
  NowItem,
  PageView,
  PlanItem,
  Resolved,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'
import { brand } from '@dashboard/shared/brand'
import { config } from '../config/index.js'
import { CliError, type Runner, type Since } from './cli.js'
import { isPage, readBody, readPages, type PageMeta } from './pages.js'
import { NotFound, Unsupported, emptyCounts, linkStem, stemKey, type Source, type WikiRoot } from './source.js'
import { replayViews } from './replay.js'
import { readHead } from './briefs.js'
import type { Timeline } from './timeline.js'

// ---- CLI answer shapes (only the keys read here) ----------------------------

interface WikisLs {
  wikis: Array<{ key: string; name: string; path: string }>
}
export interface Status {
  machine: string
  schedules?: { total: number; enabled: string[] }
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
interface ScheduleLs {
  bundles: Array<{ name: string; enabled: boolean; every?: string; window?: string | null; stages?: string[]; error?: string | null }>
}
interface DueRow {
  job?: string
  ticket?: string
  id?: string
  stage?: string
  machine?: string
  since?: string
  started?: string
  at?: string
  reason?: string
  blocked?: { reason?: string } | string
  not_before?: string
}
interface PipelineDue {
  running?: DueRow[]
  pending?: DueRow[]
  review?: DueRow[]
  parked?: DueRow[]
  jobs?: DueRow[]
  caps?: Record<string, { cap: number; active: number }>
}
interface JobsLs {
  jobs: Array<{
    slug: string
    target?: string
    dest?: string
    every?: string
    skill?: string
    unit?: string
    description?: string
    paused?: boolean
    state?: string
    blocked?: { reason?: string } | null
    holders?: Record<string, string>
  }>
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

function hostOf(target?: string): string | undefined {
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

export function channelIdOf(p: PageMeta): string {
  if (p.job) return p.job
  if (p.group) return p.group.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  if (p.channel) return p.channel.toLowerCase().replace(/[^a-z0-9]+/g, '-')
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

function stateOfJob(j: JobsLs['jobs'][number], due: PipelineDue): ChannelSummary['state'] {
  if (j.paused || j.state === 'paused') return 'paused'
  if (j.blocked && (typeof j.blocked === 'string' || j.blocked.reason)) return 'blocked'
  const slug = j.slug
  if (due.running?.some((r) => r.job === slug)) return 'running'
  if (due.parked?.some((r) => r.job === slug)) return 'parked'
  return 'idle'
}

function noteOfJob(j: JobsLs['jobs'][number], due: PipelineDue): string | undefined {
  if (j.blocked) return typeof j.blocked === 'string' ? j.blocked : j.blocked.reason
  const parked = due.parked?.find((r) => r.job === j.slug)
  if (parked) return parked.reason ?? (parked.not_before ? `retry after ${parked.not_before}` : 'parked')
  const running = due.running?.find((r) => r.job === j.slug)
  if (running) return running.stage ? `${running.stage} on ${running.machine ?? 'a machine'}` : 'running'
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

// ---- the source -------------------------------------------------------------

export function liveSource(cli: Runner, timeline: Timeline): Source {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>()
  function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < config.cacheMs) return hit.value as Promise<T>
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
  const schedule = (wiki: string) =>
    memo(`schedule:${wiki}`, () => soft(cli.run<ScheduleLs>('wiki.schedule.ls', { wiki }), { bundles: [] }))
  const due = (wiki: string) =>
    memo(`due:${wiki}`, () => soft(cli.run<PipelineDue>('wiki.pipeline.due', { wiki }), {}))
  const jobs = (wiki: string) =>
    memo(`jobs:${wiki}`, () => soft(cli.run<JobsLs>('wiki.pipeline.jobs.ls', { wiki }), { jobs: [] }))
  const runs = (wiki: string, since: Since) =>
    memo(`runs:${wiki}:${since}`, () => soft(cli.run<OpSince>('wiki.op.since', { wiki, since }), { runs: [] }))
  const changed = (wiki: string, since: Since) =>
    memo(`changed:${wiki}:${since}`, async () => {
      const r = await root(wiki)
      const ans = await soft(cli.run<GitChanged>('wiki.git.changed', { wiki, since }), { files: [] })
      return readPages(r.path, ans.files.filter(isPage))
    })

  async function summary(r: WikiRoot): Promise<WikiSummary> {
    const [st, se, sc, d, js, rn] = await Promise.all([
      soft(status(r.key), { machine: '' } as Status),
      search(r.key),
      schedule(r.key),
      due(r.key),
      jobs(r.key),
      runs(r.key, '1d'),
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
    const next = sc.bundles.find((b) => b.enabled && b.window && (windowStart(b.window) ?? '') > new Date().toISOString())
    return {
      key: r.key,
      name: r.name,
      path: r.path,
      pages: se.corpus_files ?? 0,
      channels: js.jobs.length,
      bundlesEnabled: st.schedules?.enabled.length ?? sc.bundles.filter((b) => b.enabled).length,
      bundlesTotal: st.schedules?.total ?? sc.bundles.length,
      health,
      healthNote,
      machines: machines.size,
      running,
      lastRun: last
        ? { op: last.op, outcome: last.outcome, when: last.when, actor: last.actor ?? '', summary: last.summary ?? '' }
        : undefined,
      nextDue: next ? { bundle: next.name, at: windowStart(next.window) ?? '' } : undefined,
    }
  }

  /** Channels: every job, plus one per source the pages name. `discover` widens where the
   *  pages came from (a month of history) without widening what is counted (today). */
  async function channelsOf(wiki: string, pages: PageMeta[], discover: PageMeta[] = pages): Promise<ChannelSummary[]> {
    const [js, d] = await Promise.all([jobs(wiki), due(wiki)])
    const byId = new Map<string, ChannelSummary>()
    for (const j of js.jobs) {
      byId.set(j.slug, {
        id: j.slug,
        name: j.description || j.slug,
        kind: j.unit ?? j.skill ?? 'watch',
        host: hostOf(j.target),
        job: j.slug,
        every: j.every,
        machine: j.holders ? Object.values(j.holders)[0] : undefined,
        watched: true,
        state: stateOfJob(j, d),
        stateNote: noteOfJob(j, d),
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

  function nowOf(d: PipelineDue, channels: ChannelSummary[]): NowItem[] {
    const name = (slug?: string) => channels.find((c) => c.id === slug)?.name ?? slug ?? 'a channel'
    const rows: NowItem[] = []
    for (const r of d.running ?? [])
      rows.push({ id: r.ticket ?? r.id ?? `${r.job}-${r.stage}`, what: `${cap(r.stage ?? 'working')} · ${name(r.job)}`, who: name(r.job), machine: r.machine ?? '', stage: r.stage ?? '', state: 'running', since: r.since ?? r.started ?? r.at ?? new Date().toISOString() })
    for (const r of d.parked ?? [])
      rows.push({ id: r.ticket ?? r.id ?? `${r.job}-parked`, what: `${name(r.job)} parked`, who: name(r.job), machine: r.machine ?? '', stage: r.stage ?? '', state: 'parked', since: r.since ?? r.at ?? new Date().toISOString(), note: r.reason ?? (r.not_before ? `retry after ${r.not_before}` : undefined) })
    for (const r of d.pending ?? [])
      rows.push({ id: r.ticket ?? r.id ?? `${r.job}-pending`, what: `${name(r.job)} waiting for a machine`, who: name(r.job), machine: r.machine ?? '', stage: r.stage ?? '', state: 'pending', since: r.since ?? r.at ?? new Date().toISOString() })
    return rows
  }

  function planOf(sc: ScheduleLs, rn: OpSince, d: PipelineDue): PlanItem[] {
    const today = sinceMidnight()
    const items: PlanItem[] = []
    const ranToday = new Set<string>()
    for (const r of rn.runs) {
      if (r.when < today) continue
      ranToday.add(r.op)
      items.push({ time: r.when, bundle: r.op, text: r.summary ? `${r.op} · ${r.summary}` : r.op, status: r.outcome === 'ok' ? 'done' : 'failed', machine: r.actor?.split('@')[1] })
    }
    for (const r of d.running ?? []) items.push({ time: r.since ?? r.started ?? new Date().toISOString(), bundle: r.job ?? 'pipeline', text: `${r.job ?? 'pipeline'} · ${r.stage ?? 'running'}`, status: 'running', machine: r.machine })
    for (const b of sc.bundles) {
      if (!b.enabled) continue
      const start = windowStart(b.window)
      const upcoming = start && start > new Date().toISOString()
      if (upcoming || (!ranToday.has(b.name) && !start)) {
        items.push({ time: start ?? '', bundle: b.name, text: `${b.name} · ${(b.stages ?? []).join(', ')}${b.every ? ` · every ${b.every}` : ''}`, status: 'upcoming' })
      }
    }
    return items.sort((a, b) => (a.time || '9').localeCompare(b.time || '9'))
  }

  function attentionOf(wiki: WikiSummary, channels: ChannelSummary[], se: SearchStatus): Attention[] {
    const out: Attention[] = []
    for (const c of channels) {
      if (c.state === 'blocked') out.push({ id: `blocked-${c.id}`, title: `${c.name} can't be fetched`, detail: c.stateNote ?? 'blocked on this machine', severity: 'attention', action: { label: 'Fleet', href: `/w/${wiki.key}/fleet` } })
      if (c.state === 'failed') out.push({ id: `failed-${c.id}`, title: `${c.name} failed`, detail: c.stateNote ?? '', severity: 'failing' })
    }
    if (se.realm_ready === false && se.serving && se.serving !== 'search_server')
      out.push({ id: 'search', title: 'Search is running on the fallback', detail: `engine ${se.realm_reason ?? 'not ready'} · serving ${se.serving}`, severity: 'info' })
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

  /** Every page's file stem → path, the way an editor resolves `[[links]]`; rebuilt at most once a minute. */
  const stems = (wiki: string) =>
    memo(`stems:${wiki}`, async () => {
      const r = await root(wiki)
      const index = new Map<string, string>()
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
          }
        }
      }
      for (const top of ['wiki', 'research', 'sources']) await walk(top, 0)
      return index
    })

  /** Every page's frontmatter, for the filter values; rebuilt at most once a minute (memo) and cheap
   *  for a few thousand pages. A wiki past that wants the engine's own facet answer. */
  const allPages = (wiki: string) =>
    memo(`allpages:${wiki}`, async () => {
      const r = await root(wiki)
      const index = await stems(wiki)
      return readPages(r.path, [...index.values()])
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
      const [w, pages, d, sc, rn, se] = await Promise.all([summary(r), changed(key, since), due(key), schedule(key), runs(key, since), search(key)])
      const channels = await channelsOf(key, pages)
      const areas = areasOf(channels, pages)
      const counts = emptyCounts()
      for (const a of areas) for (const k of Object.keys(counts) as ItemKind[]) counts[k] += a.counts[k]
      const n = total(counts)
      const attention = attentionOf(w, channels, se)
      const briefings = await soft(briefingList(key), [])
      const found = briefings.find((b) => b.when >= sinceMidnight())
      const todays = found ? { ...found, head: await readHead(r.path, found.path) } : undefined
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
        now: nowOf(d, channels),
        plan: planOf(sc, rn, d),
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
      const [w, st, d, sc, rn, pages, se] = await Promise.all([summary(r), soft(status(key), { machine: '' } as Status), due(key), schedule(key), runs(key, since), changed(key, since), search(key)])
      // A wiki with no jobs and a quiet day still has a history worth drawing.
      const discover = (await jobs(key)).jobs.length || pages.length ? pages : await changed(key, '30d')
      const channels = await channelsOf(key, pages, discover)
      const runningBy = new Map<string, number>()
      for (const x of d.running ?? []) if (x.machine) runningBy.set(x.machine, (runningBy.get(x.machine) ?? 0) + 1)
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
        attention: attentionOf(w, channels, se),
        plan: planOf(sc, rn, d),
      }
    },
    briefings: async (key): Promise<BriefingsView> => {
      const r = await root(key)
      const [w, reports] = await Promise.all([summary(r), briefingList(key)])
      return { wiki: w, reports }
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
      }
    },
    resolve: async (key, link): Promise<Resolved | null> => {
      const index = await stems(key)
      const stem = linkStem(link)
      if (!stem) return null
      const path = index.get(stemKey(stem))
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
    ask: async (key, req): Promise<AskAnswer> => {
      await root(key)
      const skill = req.prefix.slice(1)
      const started = Date.now()
      let ans: { answer?: string; session?: string; model?: string; effort?: string; elapsed_s?: number }
      try {
        ans = await cli.run('wiki.skills.run', { wiki: key, skill, model: req.model, effort: req.effort, text: req.q }, { timeoutMs: config.ask.timeoutMs })
      } catch (e) {
        if (e instanceof CliError && /no such command/i.test(`${e.message} ${e.stderr ?? ''}`)) throw new Unsupported('The command line on this machine cannot run a skill on request yet')
        throw e
      }
      return {
        q: req.q,
        answer: ans.answer ?? '',
        skill,
        model: ans.model ?? req.model,
        effort: ans.effort ?? req.effort,
        elapsedS: ans.elapsed_s ?? Math.round((Date.now() - started) / 1000),
        session: ans.session,
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
