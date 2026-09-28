// The routes over the fixtures source: the shapes the client depends on, the
// token gate, and the input validation. No CLI on the box is needed.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import type { TodayView } from '@dashboard/shared/types'

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
    expect(cfg.mode).toBe('read')
    expect(cfg.source).toBe('fixtures')
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

  it('answers with wikilink citations and echoes what ran', async () => {
    const res = await post({ q: 'where do the renewals stand?', model: 'sonnet', effort: 'medium', prefix: '/ask' })
    expect(res.status).toBe(200)
    const a = (await res.json()) as { answer: string; skill: string; model: string }
    expect(a.answer).toMatch(/\[\[Security › Questionnaires/)
    expect(a.skill).toBe('ask')
    expect(a.model).toBe('sonnet')
  })

  it('refuses a model or effort outside the closed lists, a prefix that is not a slash command, and an empty question', async () => {
    expect((await post({ q: 'x', model: '--dangerously-skip-permissions' })).status).toBe(400)
    expect((await post({ q: 'x', effort: 'max' })).status).toBe(400)
    expect((await post({ q: 'x', prefix: '/ask; rm -rf ~' })).status).toBe(400)
    expect((await post({ q: '   ' })).status).toBe(400)
  })

  it('is POST only', async () => {
    expect((await app.request('/api/wikis/acme-sales/ask?q=x', { headers })).status).toBe(404)
  })
})
