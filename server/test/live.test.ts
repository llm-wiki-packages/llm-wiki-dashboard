// What the live source makes of `jobs ls --verbose`, `jobs due` and `jobs show`,
// with test/fake-cli.mjs standing in for llm-wiki-cli: the next job to come due,
// the counts, the day plan's scheduled rows, the briefings' next run, and the
// jobs grouped by kind with their states. The fake prints the shapes the CLI
// prints, the verdict among them, and the dashboard derives no dueness of its
// own. The clock is held at noon, so the windows the fake names fall either side.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Source } from '../src/data/source.js'

const here = dirname(fileURLToPath(import.meta.url))
process.env.DASHBOARD_CLI = `${process.execPath} ${resolve(here, 'fake-cli.mjs')}`
process.env.DASHBOARD_SOURCE = 'live'
process.env.DASHBOARD_TOKEN_REQUIRED = '0'
process.env.DASHBOARD_OPEN = '0'
process.env.DASHBOARD_STATE_DIR = ':memory:'

const todayAt = (h: number) => {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

/** A fresh source each time, so one test's cached answers never reach another. */
async function mk(): Promise<Source> {
  const { spawnRunner } = await import('../src/data/cli.js')
  const { liveSource } = await import('../src/data/live.js')
  const { Timeline, openStore } = await import('../src/data/timeline.js')
  return liveSource(spawnRunner(), new Timeline(spawnRunner(), openStore()))
}

let source: Source
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(todayAt(12)))
  source = await mk()
})
afterEach(() => {
  delete process.env.FAKE_CLI_PAUSED
  delete process.env.FAKE_CLI_FAILING
  delete process.env.FAKE_CLI_STEP
})
afterAll(() => {
  vi.useRealTimers()
})

describe('jobs and their dueness', () => {
  it("counts the active jobs and names the next to come due: the earliest verdict's next_at among those neither due nor running", async () => {
    const [w] = await source.wikis()
    expect(w).toMatchObject({ jobsActive: 6, jobsTotal: 9, channels: 2 })
    // rss-news comes due at 15:00; ops-nightly at 22:00 and ops-nightly-host at 02:00 tomorrow.
    expect(w?.nextDue).toEqual({ job: 'rss-news', at: todayAt(15).replace('.000Z', 'Z') })
  })

  it('plans the jobs due now and those coming due later today, and no paused or running job twice', async () => {
    const v = await source.fleet('kb')
    const rows = v.plan.map((p) => [p.job, p.status, p.time])
    // A running ticket starts when it was claimed.
    expect(rows).toContainEqual(['arxiv-cs', 'running', new Date(Date.parse(todayAt(12)) - 600_000).toISOString().replace('.000Z', 'Z')])
    expect(rows).toContainEqual(['ops-hourly-host', 'upcoming', ''])
    expect(rows).toContainEqual(['rss-news', 'upcoming', todayAt(15).replace('.000Z', 'Z')])
    expect(rows).toContainEqual(['ops-nightly', 'upcoming', todayAt(22).replace('.000Z', 'Z')])
    expect(v.plan.filter((p) => p.job === 'arxiv-cs')).toHaveLength(1)
    // 02:00 tomorrow is past the plan's day; a requirement not yet met has no time to promise.
    expect(v.plan.map((p) => p.job)).not.toContain('ops-nightly-host')
    expect(v.plan.map((p) => p.job)).not.toContain('ops-morning')
    expect(v.plan.map((p) => p.job)).not.toContain('ops-denials')
    // A chain part-way through says how far it has got; its steps are the record's, an op by its name.
    expect(v.plan.find((p) => p.job === 'ops-hourly-host')?.text).toBe('ops-hourly-host · index, transcribe · chain in progress (1 of 2)')
  })

  it('gives the briefings the job whose routines include the wiki report, though jobs ls names only its first step, and when its window opens', async () => {
    const v = await source.briefings('kb')
    expect(v.next).toEqual({ job: 'ops-nightly', at: todayAt(22).replace('.000Z', 'Z'), every: '1d' })
  })

  it('says so when the job that writes the briefings is paused, as a fresh wiki ships it', async () => {
    process.env.FAKE_CLI_PAUSED = 'ops-nightly'
    const v = await (await mk()).briefings('kb')
    expect(v.next).toEqual({ job: 'ops-nightly', every: '1d', paused: true })
  })
})

describe('the reshaped record', () => {
  it('lists every job grouped by kind, badged with its claim and pin, a routines job with its steps in order', async () => {
    const v = await source.fleet('kb')
    expect(v.jobs.map((j) => [j.kind, j.slug])).toEqual([
      ['pipeline', 'arxiv-cs'],
      ['pipeline', 'rss-news'],
      ['routines', 'ops-denials'],
      ['routines', 'ops-hourly'],
      ['routines', 'ops-hourly-host'],
      ['routines', 'ops-morning'],
      ['routines', 'ops-nightly'],
      ['routines', 'ops-nightly-host'],
      ['routines', 'ops-synthesize'],
    ])
    expect(v.jobs.find((j) => j.slug === 'ops-nightly')).toMatchObject({
      claim: 'any',
      machine: 'box-a',
      skills: ['llm-wiki:dream', 'llm-wiki:improve', 'llm-wiki:wiki-report'],
      window: '22:00-06:00',
    })
    expect(v.jobs.find((j) => j.slug === 'arxiv-cs')).toMatchObject({ claim: 'any', skills: ['arxiv'], host: 'arxiv.org', state: 'running', note: 'harvest on box-a' })
    // A routines job's target is empty: no host.
    expect(v.jobs.find((j) => j.slug === 'ops-hourly-host')?.host).toBeUndefined()
  })

  it('reads paused, a chain in progress, a first run waiting for its window and an unmet requirement off the verdict as states, never as attention', async () => {
    const v = await source.fleet('kb')
    const of = (slug: string) => v.jobs.find((j) => j.slug === slug)
    expect(of('ops-denials')).toMatchObject({ state: 'paused' })
    expect(of('ops-denials')?.nextAt).toBeUndefined()
    expect(of('ops-hourly-host')).toMatchObject({ state: 'idle', note: 'chain in progress (1 of 2)', lastOk: todayAt(11).replace('.000Z', 'Z') })
    expect(of('ops-nightly-host')).toMatchObject({ state: 'idle', note: 'never run — waits for the 02:00-06:00 window' })
    expect(of('ops-morning')).toMatchObject({ state: 'idle', note: 'requires dream within 24h — no dream run found; job ops-nightly runs dream (and 1 more)' })
    expect(of('ops-morning')?.nextAt).toBeUndefined()
    expect(of('rss-news')).toMatchObject({ state: 'idle', nextAt: todayAt(15).replace('.000Z', 'Z') })
    expect(v.health.attention).toBe(0)
    expect(v.attention).toEqual([])
    const today = await source.today('kb')
    expect(today.attention).toEqual([])
    expect((await source.wikis())[0]?.health).toBe('ok')
  })

  it('reads a job braked past the attempt cap as failed, with its next try, and a failing watch as attention', async () => {
    process.env.FAKE_CLI_FAILING = 'rss-news'
    const s = await mk()
    const v = await s.fleet('kb')
    const j = v.jobs.find((x) => x.slug === 'rss-news')
    expect(j).toMatchObject({ state: 'failed', note: 'failed past the attempt cap', nextAt: todayAt(16).replace('.000Z', 'Z') })
    expect(v.attention.map((a) => a.id)).toEqual(['failed-rss-news'])
  })

  it('reads a ticket running here off the verdict list: its step by name and place, its machine, and when it was claimed', async () => {
    process.env.FAKE_CLI_STEP = 'ops-hourly-host'
    const s = await mk()
    const v = await s.fleet('kb')
    // A `none` job takes no lease; the ticket in this machine's queue is what says it runs.
    expect(v.jobs.find((x) => x.slug === 'ops-hourly-host')).toMatchObject({ state: 'running', note: 'transcribe (2 of 2) on box-a' })
    expect(v.jobs.find((x) => x.slug === 'ops-hourly-host')?.nextAt).toBeUndefined()
    expect(v.plan.filter((p) => p.job === 'ops-hourly-host').map((p) => [p.status, p.text])).toEqual([['running', 'ops-hourly-host · transcribe']])
    // arxiv-cs's lease and ticket are one job on box-a; ops-hourly-host's ticket is another.
    expect(v.machines.find((m) => m.name === 'box-a')).toMatchObject({ running: 2 })
    const now = (await s.today('kb')).now.filter((n) => n.state === 'running')
    expect(now.map((n) => [n.what, n.machine, n.since])).toEqual([
      ['Harvest · arXiv cs.AI listing, every six hours', 'box-a', todayAt(12).replace('T12:00', 'T11:50').replace('.000Z', 'Z')],
      ['transcribe · ops-hourly-host', 'box-a', todayAt(12).replace('T12:00', 'T11:55').replace('.000Z', 'Z')],
    ])
  })

  it('draws only pipeline jobs as channels: a routines job watches no source', async () => {
    const v = await source.fleet('kb')
    expect(v.channels.filter((c) => c.watched).map((c) => c.id)).toEqual(['arxiv-cs', 'rss-news'])
  })

  it("opens a job's detail from jobs show: its details, its steps in order, who holds it and why it waits", async () => {
    const j = await source.job('kb', 'ops-nightly')
    expect(j?.why).toEqual(['never run', 'never run — waits for the 22:00-06:00 window'])
    expect(j?.nextAt).toBe(todayAt(22).replace('.000Z', 'Z'))
    // Held by a requirement, the unmet clauses are the why.
    expect((await source.job('kb', 'ops-morning'))?.why).toHaveLength(2)
    expect((await source.job('kb', 'ops-denials'))?.why).toEqual([])
    expect(j?.details).toHaveLength(3)
    expect(j?.details[0]).toMatch(/^dream drains the distill backlog/)
    expect(j?.routines).toEqual([
      { verb: 'skill', name: 'llm-wiki:dream' },
      { verb: 'skill', name: 'llm-wiki:improve' },
      { verb: 'skill', name: 'llm-wiki:wiki-report' },
    ])
    expect(j?.kind).toBe('routines')
    expect((await source.job('kb', 'arxiv-cs'))?.holder).toBe('held by box-a since 2026-10-12T11:50:00Z (any)')
    expect(await source.job('kb', 'no-such-job')).toBeNull()
  })

  it('names a host op as an op, and a job every machine runs by each machine\'s last run', async () => {
    const j = await source.job('kb', 'ops-hourly-host')
    expect(j?.routines).toEqual([{ verb: 'op', name: 'index' }, { verb: 'op', name: 'transcribe' }])
    expect(j?.holder).toBeUndefined()
    expect(j?.machines).toEqual([{ machine: 'box-a', lastRun: todayAt(11).replace('.000Z', 'Z'), outcome: 'ok' }])
  })
})
