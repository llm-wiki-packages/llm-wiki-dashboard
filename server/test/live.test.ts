// What the live source makes of `jobs ls`, `jobs due` and `jobs show`, with
// test/fake-cli.mjs standing in for llm-wiki-cli: the next job to come due,
// the counts, the day plan's scheduled rows, the briefings' next run, and the
// jobs grouped by kind with their states. The clock is held at noon, so the
// windows the fake names fall either side.

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
})
afterAll(() => {
  vi.useRealTimers()
})

describe('jobs and their dueness', () => {
  it('counts the active jobs and names the next to come due: the earliest window among those not due now', async () => {
    const [w] = await source.wikis()
    expect(w).toMatchObject({ jobsActive: 4, jobsTotal: 8, channels: 1 })
    // ops-nightly-host's 02:00 window has passed today, so ops-nightly's 22:00 comes first.
    expect(w?.nextDue).toEqual({ job: 'ops-nightly', at: todayAt(22) })
  })

  it('plans the jobs due now and the windows still to open today, and no paused or running job twice', async () => {
    const v = await source.fleet('kb')
    const rows = v.plan.map((p) => [p.job, p.status, p.time])
    expect(rows).toContainEqual(['arxiv-cs', 'running', '2026-10-11T09:00:00Z'])
    expect(rows).toContainEqual(['ops-hourly-host', 'upcoming', ''])
    expect(rows).toContainEqual(['ops-nightly', 'upcoming', todayAt(22)])
    expect(v.plan.filter((p) => p.job === 'arxiv-cs')).toHaveLength(1)
    expect(v.plan.map((p) => p.job)).not.toContain('ops-nightly-host')
    expect(v.plan.map((p) => p.job)).not.toContain('ops-denials')
    // A chain part-way through says how far it has got.
    expect(v.plan.find((p) => p.job === 'ops-hourly-host')?.text).toBe('ops-hourly-host · llm-wiki:index, llm-wiki:transcribe · chain in progress (1 of 2)')
  })

  it('gives the briefings the job whose routines include the wiki report, and when its window opens', async () => {
    const v = await source.briefings('kb')
    expect(v.next).toEqual({ job: 'ops-nightly', at: todayAt(22), every: '1d' })
  })

  it('says so when the job that writes the briefings is paused, as a fresh wiki ships it', async () => {
    process.env.FAKE_CLI_PAUSED = 'ops-nightly'
    const v = await (await mk()).briefings('kb')
    expect(v.next).toEqual({ job: 'ops-nightly', every: '1d', paused: true })
  })
})

describe('the reshaped record', () => {
  it('lists every job grouped by kind, badged with its claim and pin, a routines job with its skills in order', async () => {
    const v = await source.fleet('kb')
    expect(v.jobs.map((j) => [j.kind, j.slug])).toEqual([
      ['pipeline', 'arxiv-cs'],
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
    expect(v.jobs.find((j) => j.slug === 'arxiv-cs')).toMatchObject({ claim: 'any', skills: ['arxiv'], host: 'arxiv.org' })
    expect(v.jobs.find((j) => j.slug === 'ops-hourly-host')?.host).toBeUndefined()
  })

  it('reads paused, a chain in progress and a first run waiting for its window as states, never as attention', async () => {
    const v = await source.fleet('kb')
    const of = (slug: string) => v.jobs.find((j) => j.slug === slug)
    expect(of('ops-denials')).toMatchObject({ state: 'paused' })
    expect(of('ops-hourly-host')).toMatchObject({ state: 'idle', note: 'chain in progress (1 of 2)' })
    expect(of('ops-nightly-host')).toMatchObject({ state: 'idle', note: 'never run — waits for the 02:00-06:00 window' })
    expect(v.health.attention).toBe(0)
    expect(v.attention).toEqual([])
    const today = await source.today('kb')
    expect(today.attention).toEqual([])
    expect((await source.wikis())[0]?.health).toBe('ok')
  })

  it('draws only pipeline jobs as channels: a routines job watches no source', async () => {
    const v = await source.fleet('kb')
    expect(v.channels.filter((c) => c.watched).map((c) => c.id)).toEqual(['arxiv-cs'])
  })

  it("opens a job's detail from jobs show: its details, its routines in order and who holds it", async () => {
    const j = await source.job('kb', 'ops-nightly')
    expect(j?.details).toHaveLength(3)
    expect(j?.details[0]).toMatch(/^dream drains the distill backlog/)
    expect(j?.routines.map((r) => r.skill)).toEqual(['llm-wiki:dream', 'llm-wiki:improve', 'llm-wiki:wiki-report'])
    expect(j?.holder).toBe('held by box-a since 2026-10-11T22:00:05Z (any)')
    expect(j?.kind).toBe('routines')
    expect(await source.job('kb', 'no-such-job')).toBeNull()
  })
})
