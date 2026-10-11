// What the live source makes of `jobs ls` and `jobs due`, with
// test/fake-cli.mjs standing in for llm-wiki-cli: the next job to come due,
// the counts, the day plan's scheduled rows and the briefings' next run.
// The clock is held at noon, so the windows the fake names fall either side.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

let source: Source
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(todayAt(12)))
  const { spawnRunner } = await import('../src/data/cli.js')
  const { liveSource } = await import('../src/data/live.js')
  const { Timeline, openStore } = await import('../src/data/timeline.js')
  source = liveSource(spawnRunner(), new Timeline(spawnRunner(), openStore()))
})
afterAll(() => {
  vi.useRealTimers()
})

describe('jobs and their dueness', () => {
  it('counts the active jobs and names the next to come due: the earliest window among those not due now', async () => {
    const [w] = await source.wikis()
    expect(w).toMatchObject({ bundlesEnabled: 4, bundlesTotal: 8 })
    // ops-nightly-host's 02:00 window has passed today, so ops-nightly's 22:00 comes first.
    expect(w?.nextDue).toEqual({ bundle: 'ops-nightly', at: todayAt(22) })
  })

  it('plans the jobs due now and the windows still to open today, and no paused or running job twice', async () => {
    const v = await source.fleet('kb')
    const rows = v.plan.map((p) => [p.bundle, p.status, p.time])
    expect(rows).toContainEqual(['arxiv-cs', 'running', '2026-10-11T09:00:00Z'])
    expect(rows).toContainEqual(['ops-hourly-host', 'upcoming', ''])
    expect(rows).toContainEqual(['ops-nightly', 'upcoming', todayAt(22)])
    expect(v.plan.filter((p) => p.bundle === 'arxiv-cs')).toHaveLength(1)
    expect(v.plan.map((p) => p.bundle)).not.toContain('ops-nightly-host')
    expect(v.plan.map((p) => p.bundle)).not.toContain('ops-denials')
  })

  it('reads a job with no target as one with no host', async () => {
    const v = await source.fleet('kb')
    expect(v.channels.find((c) => c.id === 'arxiv-cs')?.host).toBe('arxiv.org')
    expect(v.channels.find((c) => c.id === 'ops-hourly-host')?.host).toBeUndefined()
  })

  it('gives the briefings the job that runs the wiki report, and when its window opens', async () => {
    const v = await source.briefings('kb')
    expect(v.next).toEqual({ bundle: 'ops-nightly', at: todayAt(22), every: '1d' })
  })
})
