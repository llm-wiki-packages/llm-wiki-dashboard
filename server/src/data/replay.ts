// Replay: the Today, What's new and Fleet views as they stood at an instant
// of a recorded day. The day comes from the timeline (commits, their paths,
// the runs they close); pages are read off the tree as they are now, and the
// channel and area grouping is the live source's own, so a replayed screen
// is the live screen fed older inputs.

import type {
  AreaSummary,
  Attention,
  Briefing,
  ChannelSummary,
  FleetView,
  ItemKind,
  NewItem,
  NewView,
  NowItem,
  PlanItem,
  ReplayDay,
  ReplayDays,
  ReplayEvent,
  TodayView,
  WikiSummary,
} from '@dashboard/shared/types'
import { brand } from '@dashboard/shared/brand'
import { channelIdOf, channelNameOf, kindOf, machinesOf, type Status } from './live.js'
import { isPage, readPages, type PageMeta } from './pages.js'
import { emptyCounts, type WikiRoot } from './source.js'
import { localDate, type DayRecord, type RunRow, type Timeline } from './timeline.js'

/** A channel counts as working while a page of its landed this recently. */
const RECENT_MS = 15 * 60_000

export interface ReplayDeps {
  timeline: Timeline
  root(key: string): Promise<WikiRoot>
  summary(r: WikiRoot): Promise<WikiSummary>
  status(key: string): Promise<Status>
  channelsOf(key: string, pages: PageMeta[], discover?: PageMeta[]): Promise<ChannelSummary[]>
  areasOf(channels: ChannelSummary[], pages: PageMeta[]): AreaSummary[]
  briefings(key: string): Promise<Briefing[]>
}

interface Loaded {
  rec: DayRecord
  /** Page path → when it first landed that day. */
  landed: Map<string, string>
  metas: Map<string, PageMeta>
}

const total = (c: Record<ItemKind, number>) => Object.values(c).reduce((a, b) => a + b, 0)

export function replayViews(d: ReplayDeps) {
  const loaded = new Map<string, { at: number; p: Promise<Loaded> }>()

  async function load(key: string, date: string): Promise<Loaded> {
    const rec = await d.timeline.day(key, date)
    const id = `${key}:${date}:${rec.commits.length}`
    const hit = loaded.get(id)
    if (hit && Date.now() - hit.at < 60_000) return hit.p
    const p = (async () => {
      const r = await d.root(key)
      const landed = new Map<string, string>()
      for (const x of rec.paths) if (isPage(x.path) && !landed.has(x.path)) landed.set(x.path, x.at)
      const metas = new Map((await readPages(r.path, [...landed.keys()])).map((m) => [m.rel, m]))
      return { rec, landed, metas }
    })()
    loaded.set(id, { at: Date.now(), p })
    return p
  }

  const upTo = (l: Loaded, at: string): PageMeta[] =>
    [...l.landed].filter(([rel, t]) => t <= at && l.metas.has(rel)).map(([rel]) => l.metas.get(rel) as PageMeta)

  function recentByChannel(l: Loaded, at: string): Map<string, number> {
    const from = new Date(new Date(at).getTime() - RECENT_MS).toISOString()
    const out = new Map<string, number>()
    for (const [rel, t] of l.landed) {
      const m = l.metas.get(rel)
      if (!m || t > at || t <= from) continue
      const id = channelIdOf(m)
      out.set(id, (out.get(id) ?? 0) + 1)
    }
    return out
  }

  /** Channel states as of `at`: working while its pages land, idle otherwise. Today's live states do not apply. */
  function restate(channels: ChannelSummary[], recent: Map<string, number>): ChannelSummary[] {
    return channels.map((c) => {
      const n = recent.get(c.id) ?? 0
      return { ...c, state: n ? 'running' : 'idle', stateNote: n ? `${n} captured in the last 15 minutes` : undefined }
    })
  }

  const inProgress = (rec: DayRecord, at: string) => rec.runs.filter((r) => r.start <= at && at < r.end)
  const ended = (rec: DayRecord, at: string) => rec.runs.filter((r) => r.end <= at)
  const runText = (r: RunRow) => (r.summary && r.summary !== r.op ? `${r.op} · ${r.summary}` : r.op)

  function planOf(rec: DayRecord, at: string): PlanItem[] {
    return rec.runs.map<PlanItem>((r) => {
      if (r.end <= at) return { time: r.end, bundle: r.op, text: runText(r), status: r.outcome === 'ok' ? 'done' : 'failed', machine: r.machine }
      if (r.start <= at) return { time: r.start, bundle: r.op, text: runText(r), status: 'running', machine: r.machine }
      return { time: r.start, bundle: r.op, text: runText(r), status: 'upcoming', machine: r.machine }
    }).sort((a, b) => a.time.localeCompare(b.time))
  }

  function nowOf(l: Loaded, at: string, channels: ChannelSummary[]): NowItem[] {
    const rows: NowItem[] = inProgress(l.rec, at).map((r) => ({
      id: `run-${r.op}-${r.start}`,
      what: runText(r),
      who: r.op,
      machine: r.machine ?? '',
      stage: r.op,
      state: 'running',
      since: r.start,
    }))
    for (const c of channels)
      if (c.state === 'running')
        rows.push({ id: `ch-${c.id}`, what: `Capturing · ${c.name}`, who: c.name, machine: c.machine ?? '', stage: 'harvest', state: 'running', since: at, note: c.stateNote })
    return rows
  }

  function attentionOf(l: Loaded, at: string): Attention[] {
    return ended(l.rec, at)
      .filter((r) => r.outcome !== 'ok')
      .map((r) => ({ id: `run-${r.op}-${r.end}`, title: `${r.op} ${r.outcome}`, detail: r.summary, severity: 'failing' as const }))
  }

  async function wikiAt(key: string, l: Loaded, at: string, running: number): Promise<WikiSummary> {
    const w = await d.summary(await d.root(key))
    const last = ended(l.rec, at).at(-1)
    return {
      ...w,
      running,
      lastRun: last ? { op: last.op, outcome: last.outcome, when: last.end, actor: last.machine ? `agent@${last.machine}` : '', summary: last.summary } : undefined,
      nextDue: undefined,
    }
  }

  async function grouped(key: string, l: Loaded, at: string) {
    const pages = upTo(l, at)
    const channels = restate(await d.channelsOf(key, pages, [...l.metas.values()]), recentByChannel(l, at))
    const areas = d.areasOf(channels, pages).filter((a) => a.count > 0 || a.channels.some((c) => c.state === 'running'))
    const counts = emptyCounts()
    for (const a of areas) for (const k of Object.keys(counts) as ItemKind[]) counts[k] += a.counts[k]
    return { pages, channels, areas, counts }
  }

  return {
    async days(key: string): Promise<ReplayDays> {
      return { days: await d.timeline.recordedDays(key) }
    },

    async day(key: string, date: string): Promise<ReplayDay> {
      const l = await load(key, date)
      const events: ReplayEvent[] = []
      for (const r of l.rec.runs) {
        if (r.start < r.end && r.start >= l.rec.start) events.push({ at: r.start, kind: 'run-start', title: `${r.op} started`, machine: r.machine })
        events.push({ at: r.end, kind: 'run-end', title: runText(r), detail: r.outcome, machine: r.machine })
      }
      for (const [rel, t] of l.landed) {
        const m = l.metas.get(rel)
        if (!m) continue
        events.push({ at: t, kind: 'page', title: m.title, detail: kindOf(m), path: rel, channel: channelNameOf(m), machine: m.harvested?.machine })
      }
      events.sort((a, b) => a.at.localeCompare(b.at))
      return { date, start: l.rec.start, end: l.rec.end, events }
    },

    async today(key: string, at: string): Promise<TodayView> {
      const l = await load(key, localDate(at))
      const { channels, areas, counts } = await grouped(key, l, at)
      const now = nowOf(l, at, channels)
      const w = await wikiAt(key, l, at, now.length)
      const n = total(counts)
      const clock = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      const attention = attentionOf(l, at)
      const briefing = (await d.briefings(key).catch(() => [])).find((b) => b.when >= l.rec.start && b.when <= at)
      return {
        wiki: w,
        since: l.rec.start,
        totals: { pages: n, areas: areas.filter((a) => a.count > 0).length, counts },
        lede: n
          ? `By ${clock} your ${brand.wikiNoun} had gained ${n} page${n === 1 ? '' : 's'} across ${areas.length} area${areas.length === 1 ? '' : 's'}.`
          : `Nothing new yet by ${clock}.${now.length ? ` ${now.length} thing${now.length > 1 ? 's are' : ' is'} running.` : ''}`,
        areas,
        now,
        plan: planOf(l.rec, at),
        attention,
        briefing,
      }
    },

    async whatsNew(key: string, at: string): Promise<NewView> {
      const l = await load(key, localDate(at))
      const { pages, areas, counts } = await grouped(key, l, at)
      const areaOfChannel = new Map(areas.flatMap((a) => a.channels.map((c) => [c.id, a.name] as const)))
      const items: NewItem[] = pages
        .map((p) => ({
          path: p.rel,
          title: p.title,
          kind: kindOf(p),
          when: l.landed.get(p.rel) ?? at,
          channel: channelIdOf(p),
          area: areaOfChannel.get(channelIdOf(p)),
          sub: p.description,
          resource: p.resource,
        }))
        .sort((a, b) => b.when.localeCompare(a.when))
      return { wiki: await wikiAt(key, l, at, inProgress(l.rec, at).length), since: l.rec.start, totals: { pages: total(counts), counts }, areas, items }
    },

    async fleet(key: string, at: string): Promise<FleetView> {
      const l = await load(key, localDate(at))
      const { channels } = await grouped(key, l, at)
      const runningBy = new Map<string, number>()
      const bump = (m?: string) => m && runningBy.set(m, (runningBy.get(m) ?? 0) + 1)
      for (const r of inProgress(l.rec, at)) bump(r.machine)
      for (const c of channels) if (c.state === 'running') bump(c.machine)
      const st = await d.status(key).catch(() => ({ machine: '' }) as Status)
      const machines = machinesOf(st, runningBy)
      const done = ended(l.rec, at)
      const now = nowOf(l, at, channels)
      return {
        wiki: await wikiAt(key, l, at, now.length),
        machines,
        channels,
        health: {
          machinesSeen: machines.filter((m) => m.state !== 'stale' && m.state !== 'unknown').length,
          machinesTotal: machines.length,
          runsOk: done.filter((r) => r.outcome === 'ok').length,
          runsTotal: done.length,
          attention: done.filter((r) => r.outcome !== 'ok').length,
        },
        attention: attentionOf(l, at),
        plan: planOf(l.rec, at),
      }
    },
  }
}

export type ReplayViews = ReturnType<typeof replayViews>
