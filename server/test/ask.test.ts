// Ask over the live source, with test/fake-cli.mjs standing in for
// llm-wiki-cli: the refusals answer as JSON before any event, an answer
// streams as server-sent events, and a browser that leaves kills the session.

import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'

const here = dirname(fileURLToPath(import.meta.url))
process.env.DASHBOARD_CLI = `${process.execPath} ${resolve(here, 'fake-cli.mjs')}`
process.env.DASHBOARD_SOURCE = 'live'
process.env.DASHBOARD_TOKEN_REQUIRED = '0'
process.env.DASHBOARD_OPEN = '0'
process.env.DASHBOARD_STATE_DIR = ':memory:'

const FAKE = ['FAKE_CLI_FAIL', 'FAKE_CLI_JAIL', 'FAKE_CLI_SANDBOXES', 'FAKE_CLI_TEMPLATES', 'FAKE_CLI_AGENTS', 'FAKE_CLI_STREAM', 'FAKE_CLI_PIDFILE']
afterEach(() => {
  for (const k of FAKE) delete process.env[k]
})

/** A fresh app each time, so the cached ask status never leaks between tests. */
async function mk(): Promise<Hono> {
  const { createApp } = await import('../src/app.js')
  const { spawnRunner } = await import('../src/data/cli.js')
  const { liveSource } = await import('../src/data/live.js')
  const { Timeline, openStore } = await import('../src/data/timeline.js')
  const { EventHub } = await import('../src/routes/events.js')
  const source = liveSource(spawnRunner(), new Timeline(spawnRunner(), openStore()))
  return createApp(source, new EventHub(source))
}

const headers = { host: '127.0.0.1:4180', 'content-type': 'application/json' }
const body = { q: 'where do renewals stand?', model: 'sonnet', effort: 'medium', skill: 'llm-wiki:ask' }
const post = (app: Hono, b: object = body) => app.request('/api/wikis/kb/ask', { method: 'POST', headers, body: JSON.stringify(b) })

function events(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  return text
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1]
      const data = /^data: (.*)$/m.exec(block)?.[1]
      return event && data ? { event, data: JSON.parse(data) as Record<string, unknown> } : null
    })
    .filter((x) => x !== null)
}

describe('ask status', () => {
  it('is available with the enabled agents when not jailed and read-search is on', async () => {
    process.env.FAKE_CLI_AGENTS = 'researcher,analyst'
    const res = await (await mk()).request('/api/wikis/kb/ask', { headers })
    expect(await res.json()).toEqual({ available: true, agents: ['researcher', 'analyst'] })
  })
})

describe('ask stream', () => {
  it('relays the CLI lines as server-sent events, ending with the result', async () => {
    const res = await post(await mk())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const evs = events(await res.text())
    expect(evs.map((e) => e.event)).toEqual(['start', 'tool', 'text', 'text', 'result'])
    expect(evs.filter((e) => e.event === 'text').map((e) => e.data.text).join('')).toBe('The answer cites [[Some page]].')
    expect(evs[4]!.data).toMatchObject({ answer: 'The answer cites [[Some page]].', skill: 'llm-wiki:ask', outcome: 'ok', session: 'fake-session' })
  })

  it('kills the session when the browser goes away', async () => {
    const pidfile = resolve(tmpdir(), `dash-ask-${process.pid}-${Date.now()}.pid`)
    process.env.FAKE_CLI_STREAM = 'hang'
    process.env.FAKE_CLI_PIDFILE = pidfile
    try {
      const res = await post(await mk())
      const reader = res.body!.getReader()
      await reader.read()
      const pid = Number(readFileSync(pidfile, 'utf8'))
      expect(() => process.kill(pid, 0)).not.toThrow()
      await reader.cancel()
      await expect.poll(() => { try { process.kill(pid, 0); return true } catch { return false } }, { timeout: 3000 }).toBe(false)
    } finally {
      rmSync(pidfile, { force: true })
    }
  })

  it('answers one question at a time per wiki', async () => {
    process.env.FAKE_CLI_STREAM = 'hang'
    const app = await mk()
    const first = await post(app)
    expect(first.status).toBe(200)
    expect((await post(app)).status).toBe(429)
    await first.body!.cancel()
  })
})

describe('ask refusals', () => {
  it('501 when the dashboard runs in a jail', async () => {
    process.env.FAKE_CLI_JAIL = 'nono'
    const res = await post(await mk())
    expect(res.status).toBe(501)
    expect(((await res.json()) as { error: string }).error).toMatch(/outside a jail/)
  })

  it('501 naming the command when read-search is not enabled', async () => {
    process.env.FAKE_CLI_SANDBOXES = 'no-network'
    const res = await post(await mk())
    expect(res.status).toBe(501)
    const j = (await res.json()) as { kind: string; fix: string }
    expect(j.kind).toBe('unsupported')
    expect(j.fix).toMatch(/ wiki kb sandboxes enable read-search$/)
  })

  it('501 without a command to run when the wiki has no read-search template yet', async () => {
    process.env.FAKE_CLI_TEMPLATES = 'harvest,no-network'
    process.env.FAKE_CLI_SANDBOXES = 'no-network'
    const res = await post(await mk())
    expect(res.status).toBe(501)
    const j = (await res.json()) as { error: string; fix?: string }
    expect(j.error).toMatch(/no read-search sandbox yet/)
    expect(j.fix).toBeUndefined()
  })

  it('501 when the CLI has no run-harness', async () => {
    process.env.FAKE_CLI_FAIL = 'run-harness'
    const res = await post(await mk())
    expect(res.status).toBe(501)
    expect(((await res.json()) as { error: string }).error).toMatch(/no run-harness/)
  })

  it('400 for a skill off the list or an agent the wiki has not enabled', async () => {
    process.env.FAKE_CLI_AGENTS = 'researcher'
    const app = await mk()
    expect((await post(app, { ...body, skill: 'ask' })).status).toBe(400)
    expect((await post(app, { ...body, agent: 'intruder' })).status).toBe(400)
    expect((await post(app, { ...body, agent: '--dangerously-skip-permissions' })).status).toBe(400)
  })
})
