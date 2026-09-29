// DASHBOARD_ASK_CONCURRENCY: a wiki runs that many answers at once, and the next is refused.
// Its own file, because config is read once when it is first imported.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
process.env.DASHBOARD_CLI = `${process.execPath} ${resolve(here, 'fake-cli.mjs')}`
process.env.DASHBOARD_SOURCE = 'live'
process.env.DASHBOARD_TOKEN_REQUIRED = '0'
process.env.DASHBOARD_OPEN = '0'
process.env.DASHBOARD_STATE_DIR = ':memory:'
process.env.DASHBOARD_ASK_CONCURRENCY = '2'
process.env.FAKE_CLI_STREAM = 'hang'

describe('ask concurrency', () => {
  it('runs two at once with a limit of 2, refuses the third, and frees a slot when one goes away', async () => {
    const { createApp } = await import('../src/app.js')
    const { spawnRunner } = await import('../src/data/cli.js')
    const { liveSource } = await import('../src/data/live.js')
    const { Timeline, openStore } = await import('../src/data/timeline.js')
    const { EventHub } = await import('../src/routes/events.js')
    const source = liveSource(spawnRunner(), new Timeline(spawnRunner(), openStore()))
    const app = createApp(source, new EventHub(source))
    const ask = () =>
      app.request('/api/wikis/kb/ask', {
        method: 'POST',
        headers: { host: '127.0.0.1:4180', 'content-type': 'application/json' },
        body: JSON.stringify({ q: 'renewals?', skill: 'llm-wiki:search' }),
      })
    const a = await ask()
    const b = await ask()
    expect([a.status, b.status]).toEqual([200, 200])
    const third = await ask()
    expect(third.status).toBe(429)
    expect(((await third.json()) as { error: string }).error).toMatch(/already answering 2 questions/)
    await a.body!.cancel()
    await expect.poll(async () => {
      const r = await ask()
      if (r.status === 200) await r.body!.cancel()
      return r.status
    }, { timeout: 3000 }).toBe(200)
    await b.body!.cancel()
  })
})
