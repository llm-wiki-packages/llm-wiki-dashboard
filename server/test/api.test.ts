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
