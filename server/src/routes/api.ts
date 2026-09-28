// The JSON routes. Each one picks a view off the source; the wiki key is
// checked against the registry before anything else runs, and the only
// free-text inputs (`since`, a briefing id) are validated here.

import { Hono } from 'hono'
import { brand } from '@dashboard/shared/brand'
import type { AppConfig, HealthReport } from '@dashboard/shared/types'
import { config } from '../config/index.js'
import { CliError, type Since } from '../data/cli.js'
import { NotFound, type Source } from '../data/source.js'

const SINCE = /^\d{1,3}[hd]$/
const ID = /^[A-Za-z0-9_-]{1,512}$/

export function apiRoutes(source: Source): Hono {
  const api = new Hono()

  api.onError((err, c) => {
    if (err instanceof NotFound) return c.json({ error: err.message }, 404)
    if (err instanceof CliError) {
      const status = err.kind === 'args' ? 400 : err.kind === 'spawn' ? 503 : 502
      return c.json({ error: err.message, kind: err.kind, stderr: err.stderr }, status)
    }
    console.error(err)
    return c.json({ error: 'internal error' }, 500)
  })

  api.get('/health', async (c) => {
    let opsVersion: string | null = null
    let cliFound = true
    try {
      opsVersion = await source.opsVersion()
    } catch (e) {
      cliFound = !(e instanceof CliError && e.kind === 'spawn')
    }
    const body: HealthReport = {
      ok: true,
      version: config.version,
      mode: config.mode,
      source: source.kind,
      opsVersion,
      cliFound,
      now: new Date().toISOString(),
    }
    return c.json(body)
  })

  api.get('/config', async (c) => {
    const body: AppConfig = {
      productName: brand.productName,
      tagline: brand.tagline,
      nouns: {
        wiki: [brand.wikiNoun, brand.wikiNounPlural],
        channel: [brand.channelNoun, brand.channelNounPlural],
        machine: [brand.machineNoun, brand.machineNounPlural],
        briefing: [brand.briefingNoun, brand.briefingNounPlural],
      },
      mode: config.mode,
      source: source.kind,
      version: config.version,
      opsVersion: await source.opsVersion().catch(() => null),
      machine: (await source.wikis().catch(() => []))[0]?.path ? '' : '',
      now: new Date().toISOString(),
    }
    return c.json(body)
  })

  api.get('/wikis', async (c) => c.json(await source.wikis()))

  api.get('/wikis/:key/today', async (c) => c.json(await source.today(c.req.param('key'))))

  api.get('/wikis/:key/new', async (c) => {
    const raw = c.req.query('since') ?? '1d'
    if (!SINCE.test(raw)) return c.json({ error: 'since must look like 6h or 7d' }, 400)
    return c.json(await source.whatsNew(c.req.param('key'), raw as Since))
  })

  api.get('/wikis/:key/fleet', async (c) => c.json(await source.fleet(c.req.param('key'))))

  api.get('/wikis/:key/briefings', async (c) => c.json(await source.briefings(c.req.param('key'))))

  api.get('/wikis/:key/briefings/:id', async (c) => {
    const id = c.req.param('id')
    if (!ID.test(id)) return c.json({ error: 'bad id' }, 400)
    const b = await source.briefing(c.req.param('key'), id)
    if (!b) return c.json({ error: 'briefing not found' }, 404)
    return c.json(b)
  })

  return api
}
