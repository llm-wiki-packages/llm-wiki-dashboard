// The replay timeline: commits fill from `git log` since the last head, a
// session's paths are asked for once, and a run spans marker to outcome.

import { describe, expect, it } from 'vitest'
import type { Args, Runner, Verb } from '../src/data/cli.js'

process.env.DASHBOARD_TOKEN_REQUIRED = '0'
process.env.DASHBOARD_OPEN = '0'
process.env.DASHBOARD_STATE_DIR = ':memory:'
process.env.DASHBOARD_CACHE_MS = '0'

// Config reads the environment once, on first import: everything below loads after the lines above.
const { Timeline, TimelineStore, dayBounds, localDate } = await import('../src/data/timeline.js')
const { CliError } = await import('../src/data/cli.js')

const local = (h: number, m: number) => {
  const d = new Date(2026, 8, 26, h, m)
  return d.toISOString()
}

function stub(answers: Record<string, (a: Args) => unknown>) {
  const calls: Array<{ verb: Verb; args: Args }> = []
  const runner: Runner = {
    async run<T>(verb: Verb, args: Args = {}): Promise<T> {
      calls.push({ verb, args })
      const fn = answers[verb]
      if (!fn) throw new Error(`unexpected verb ${verb}`)
      return fn(args) as T
    },
    stream() {
      throw new Error('the timeline never streams')
    },
  }
  return { runner, calls }
}

const commits = [
  { sha: 'c3', at: local(9, 30), subject: 'curate: 2 accepted', op: 'hourly', outcome: 'ok', actor: 'agent@box-a', session: 's1', marker: 'c1' },
  { sha: 'c2', at: local(9, 10), subject: 'capture: 2 pages', op: 'none', outcome: '', actor: 'agent@box-a', session: 's1', marker: '' },
  { sha: 'c1', at: local(9, 0), subject: 'op: hourly', op: 'hourly', outcome: '', actor: 'agent@box-a', session: 's1', marker: '' },
]

describe('Timeline', () => {
  it('fills a day: runs open at their marker, paths come from one op show per session', async () => {
    const { runner, calls } = stub({
      'wiki.git.log': () => ({ commits, _cmd_: { head: 'c3' } }),
      'wiki.op.show': () => ({ commits: [{ commit: 'c2', paths: ['sources/a.md', 'sources/b.md'] }, { commit: 'c3', paths: ['wiki/a.md'] }] }),
    })
    const tl = new Timeline(runner, new TimelineStore(':memory:'), 30)
    const day = await tl.day('kb', '2026-09-26')
    expect(day.runs).toEqual([{ op: 'hourly', outcome: 'ok', summary: 'curate: 2 accepted', start: local(9, 0), end: local(9, 30), machine: 'box-a' }])
    expect(day.paths.map((p) => p.path)).toEqual(['sources/a.md', 'sources/b.md', 'wiki/a.md'])
    expect(calls.map((c) => c.verb)).toEqual(['wiki.git.log', 'wiki.op.show'])
    expect(calls[0]?.args).toMatchObject({ since: '30d' })

    await tl.day('kb', '2026-09-26')
    // The second look asks git log since the head and never re-shows the session.
    expect(calls.slice(2)).toEqual([{ verb: 'wiki.git.log', args: { wiki: 'kb', sha: 'c3' } }])
  })

  it('starts the window over when the remembered head is gone', async () => {
    const store = new TimelineStore(':memory:')
    store.setCursor('kb', 'deadbee')
    const { runner, calls } = stub({
      'wiki.git.log': (a) => {
        if (a.sha) throw new CliError('names no commit', 'exit', 2)
        return { commits: [], _cmd_: { head: 'c9' } }
      },
    })
    await new Timeline(runner, store, 7).sync('kb')
    expect(calls.map((c) => c.args)).toEqual([{ wiki: 'kb', sha: 'deadbee' }, { wiki: 'kb', since: '7d' }])
    expect(store.cursor('kb')).toBe('c9')
  })

  it('bounds a local day', () => {
    const { start, end } = dayBounds('2026-09-26')
    expect(localDate(start)).toBe('2026-09-26')
    expect(new Date(end).getTime() - new Date(start).getTime()).toBeGreaterThanOrEqual(23 * 3_600_000)
  })
})
