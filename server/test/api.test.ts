// The routes over the fixtures source: the shapes the client depends on, the
// token gate, and the input validation. No CLI on the box is needed.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import type { FleetView, JobView, TodayView } from '@dashboard/shared/types'

process.env.DASHBOARD_SOURCE = 'fixtures'
process.env.DASHBOARD_TOKEN = 'test-token-test-token-test'
process.env.DASHBOARD_TOKEN_REQUIRED = '1'
process.env.DASHBOARD_OPEN = '0'

let app: Hono
beforeAll(async () => {
  const { createApp } = await import('../src/app.js')
  const { fixturesSource } = await import('../src/data/fixtures.js')
  const { EventHub } = await import('../src/routes/events.js')
  const source = fixturesSource()
  app = createApp(source, new EventHub(source))
})

const headers = { host: '127.0.0.1:4180', 'x-dashboard-token': 'test-token-test-token-test' }

describe('token gate', () => {
  it('refuses /api without the token', async () => {
    const res = await app.request('/api/wikis', { headers: { host: '127.0.0.1:4180' } })
    expect(res.status).toBe(401)
  })
  it('refuses a foreign Host header', async () => {
    const res = await app.request('/api/wikis', { headers: { ...headers, host: 'evil.example' } })
    expect(res.status).toBe(421)
  })
  it('accepts the token as a header', async () => {
    const res = await app.request('/api/wikis', { headers })
    expect(res.status).toBe(200)
  })
})

describe('views', () => {
  it('today: area counts sum to the totals', async () => {
    const res = await app.request('/api/wikis/acme-sales/today', { headers })
    const view = (await res.json()) as TodayView
    const fromAreas = view.areas.reduce((n, a) => n + a.count, 0)
    expect(view.totals.pages).toBe(fromAreas)
    expect(view.areas.every((a) => a.channels.length > 0)).toBe(true)
    expect(view.briefing?.title).toBe('Morning briefing')
  })
  it('new: rejects a since outside the grammar', async () => {
    const res = await app.request('/api/wikis/acme-sales/new?since=7w', { headers })
    expect(res.status).toBe(400)
  })
  it('404s an unknown wiki', async () => {
    const res = await app.request('/api/wikis/nope/today', { headers })
    expect(res.status).toBe(404)
  })
  it('config names the product from brand.ts only', async () => {
    const res = await app.request('/api/config', { headers })
    const cfg = (await res.json()) as { productName: string; mode: string; source: string }
    expect(cfg.productName).toBe('Mission Control')
    expect((cfg as unknown as { cli: string }).cli).toBe('llm-wiki-cli')
    expect(cfg.mode).toBe('read')
    expect(cfg.source).toBe('fixtures')
  })
})

describe('jobs', () => {
  it("fleet lists the seven ops- jobs as routines beside the watches, the demo's paused and part-run ones as states", async () => {
    const view = (await (await app.request('/api/wikis/acme-sales/fleet', { headers })).json()) as FleetView
    const ops = view.jobs.filter((j) => j.slug.startsWith('ops-'))
    expect(ops.map((j) => j.slug)).toEqual(['ops-denials', 'ops-hourly', 'ops-hourly-host', 'ops-morning', 'ops-nightly', 'ops-nightly-host', 'ops-synthesize'])
    expect(ops.every((j) => j.kind === 'routines')).toBe(true)
    expect(view.jobs.filter((j) => j.kind === 'pipeline')).toHaveLength(8)
    expect(ops.find((j) => j.slug === 'ops-synthesize')?.state).toBe('paused')
    expect(view.attention.some((a) => /ops-/.test(`${a.title} ${a.source ?? ''}`))).toBe(false)
  })
  it("opens a job's details and routines, 404s an unknown one and refuses a slug that is not one", async () => {
    const res = await app.request('/api/wikis/acme-sales/jobs/ops-nightly', { headers })
    const job = (await res.json()) as JobView
    expect(job.details).toHaveLength(3)
    expect(job.routines.map((r) => r.skill)).toEqual(['llm-wiki:dream', 'llm-wiki:improve', 'llm-wiki:wiki-report'])
    expect((await app.request('/api/wikis/acme-sales/jobs/nope', { headers })).status).toBe(404)
    expect((await app.request('/api/wikis/acme-sales/jobs/--all', { headers })).status).toBe(400)
  })
})

describe('reader', () => {
  it('resolves a wikilink by the page part and serves the page', async () => {
    const res = await app.request('/api/wikis/acme-sales/resolve?link=' + encodeURIComponent('Security › Questionnaires'), { headers })
    expect(res.status).toBe(200)
    const { path } = (await res.json()) as { path: string }
    const page = await app.request(`/api/wikis/acme-sales/page?path=${encodeURIComponent(path)}`, { headers })
    expect(page.status).toBe(200)
    expect(((await page.json()) as { title: string }).title).toBe('Security questionnaires')
  })
  it('404s an unknown link and refuses a path that escapes the wiki', async () => {
    expect((await app.request('/api/wikis/acme-sales/resolve?link=Nope', { headers })).status).toBe(404)
    expect((await app.request('/api/wikis/acme-sales/page?path=../etc/passwd.md', { headers })).status).toBe(400)
    expect((await app.request('/api/wikis/acme-sales/page?path=/etc/x.md', { headers })).status).toBe(400)
  })
})

describe('search', () => {
  it('answers hits for a question and honors an area filter', async () => {
    const res = await app.request('/api/wikis/acme-sales/search?q=anchoring&area=Product%20learning', { headers })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { hits: Array<{ path: string }>; count: number }
    expect(view.count).toBeGreaterThan(0)
    expect(view.hits.every((h) => h.path.length > 0)).toBe(true)
  })
  it('requires q and bounds k', async () => {
    expect((await app.request('/api/wikis/acme-sales/search', { headers })).status).toBe(400)
    expect((await app.request('/api/wikis/acme-sales/search?q=x&k=999', { headers })).status).toBe(400)
  })
  it('lists facets', async () => {
    const res = await app.request('/api/wikis/acme-sales/facets', { headers })
    const f = (await res.json()) as { areas: string[]; unders: string[] }
    expect(f.areas).toContain('Customers')
    expect(f.unders).toContain('wiki')
  })
})

describe('replay', () => {
  const day = () => {
    const d = new Date(Date.now() - 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const todayAt = (h: number) => {
    const d = new Date()
    d.setHours(h, 0, 0, 0)
    return d.toISOString()
  }

  it('lists the canned day and its events in order', async () => {
    const days = (await (await app.request('/api/wikis/acme-sales/replay', { headers })).json()) as { days: Array<{ date: string }> }
    expect(days.days[0]?.date).toBe(day())
    const rec = (await (await app.request(`/api/wikis/acme-sales/replay/${day()}`, { headers })).json()) as { events: Array<{ at: string }> }
    const ats = rec.events.map((e) => e.at)
    expect(ats.length).toBeGreaterThan(40)
    expect([...ats].sort()).toEqual(ats)
  })

  it('today at an instant counts only what had landed by then', async () => {
    // The canned day replays as yesterday.
    const early = new Date(new Date(todayAt(9)).getTime() - 86_400_000).toISOString()
    const late = new Date(new Date(todayAt(23)).getTime() - 86_400_000).toISOString()
    const a = (await (await app.request(`/api/wikis/acme-sales/today?at=${encodeURIComponent(early)}`, { headers })).json()) as TodayView
    const b = (await (await app.request(`/api/wikis/acme-sales/today?at=${encodeURIComponent(late)}`, { headers })).json()) as TodayView
    expect(a.totals.pages).toBeGreaterThan(0)
    expect(a.totals.pages).toBeLessThan(b.totals.pages)
    expect(b.totals.pages).toBe(51)
    expect(a.plan.every((p) => p.time <= early || p.status === 'upcoming')).toBe(true)
  })

  it('refuses an at in the future or outside the window, and a malformed date', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    expect((await app.request(`/api/wikis/acme-sales/today?at=${encodeURIComponent(future)}`, { headers })).status).toBe(400)
    expect((await app.request('/api/wikis/acme-sales/fleet?at=2020-01-01T00:00:00Z', { headers })).status).toBe(400)
    expect((await app.request('/api/wikis/acme-sales/today?at=yesterday', { headers })).status).toBe(400)
    expect((await app.request('/api/wikis/acme-sales/replay/26-09-2026', { headers })).status).toBe(400)
  })
})

describe('ask', () => {
  const post = (body: unknown) =>
    app.request('/api/wikis/acme-sales/ask', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('streams the demo answer: start, then the steps the agent takes', async () => {
    const res = await post({ q: 'where do the renewals stand?', model: 'sonnet', effort: 'medium', skill: 'llm-wiki:search' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = res.body!.getReader()
    let text = ''
    while (!/event: tool[\s\S]*event: tool/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
    await reader.cancel()
    expect(text).toMatch(/^event: start/)
    expect(text).toMatch(/"name":"Searching","detail":"where do the renewals stand\?"/)
  })

  it('says the demo can answer, and offers its agent', async () => {
    const res = await app.request('/api/wikis/acme-sales/ask', { headers })
    expect(await res.json()).toEqual({ available: true, agents: ['researcher'] })
  })

  it('refuses a model, effort or skill outside the closed lists, an unknown agent, and an empty question', async () => {
    expect((await post({ q: 'x', model: '--dangerously-skip-permissions' })).status).toBe(400)
    expect((await post({ q: 'x', effort: 'ultra' })).status).toBe(400)
    expect((await post({ q: 'x', skill: '/ask; rm -rf ~' })).status).toBe(400)
    expect((await post({ q: 'x', agent: 'nobody' })).status).toBe(400)
    expect((await post({ q: '   ' })).status).toBe(400)
  })

  it('starts a session only on POST', async () => {
    const res = await app.request('/api/wikis/acme-sales/ask?q=x', { headers })
    expect(await res.json()).not.toHaveProperty('answer')
  })
})

describe('provenance', () => {
  it('a source page names its channel, machine and the wiki page it went into', async () => {
    const res = await app.request(`/api/wikis/acme-sales/page?path=${encodeURIComponent('sources/scrapes/somecourse/lesson-4-anchoring.md')}`, { headers })
    const page = (await res.json()) as { provenance: { channel: { id: string }; captured: { machine: string }; into: Array<{ path: string }> } }
    expect(page.provenance.channel.id).toBe('somecourse')
    expect(page.provenance.captured.machine).toBe('hetzner-01')
    expect(page.provenance.into.map((p) => p.path)).toEqual(['wiki/playbook/packaging.md'])
  })
})

describe('learned', () => {
  it('answers a day per column, per area, and a size that grows by what was learned', async () => {
    const v = (await (await app.request('/api/wikis/acme-sales/learned?days=7', { headers })).json()) as {
      days: string[]
      areas: Array<{ perDay: number[]; total: number }>
      size: number[]
    }
    expect(v.days).toHaveLength(7)
    expect(v.size).toHaveLength(7)
    for (const a of v.areas) expect(a.perDay).toHaveLength(7)
    const last = v.areas.reduce((n, a) => n + (a.perDay[6] ?? 0), 0)
    expect((v.size[6] ?? 0) - (v.size[5] ?? 0)).toBe(last)
  })
})
