// The JSON routes. Each one picks a view off the source; the wiki key is
// checked against the registry before anything else runs, and the only
// free-text inputs (`since`, a replay `at` or date, a briefing id) are validated here.

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { brand } from '@dashboard/shared/brand'
import { SEARCH_FILTER_KINDS } from '@dashboard/shared/types'
import type { AppConfig, AskEvent, AskRequest, HealthReport, SearchParams } from '@dashboard/shared/types'
import { config } from '../config/index.js'
import { CliError, type Since } from '../data/cli.js'
import { NotFound, Unsupported, type Source } from '../data/source.js'

const SINCE = /^\d{1,3}[hd]$/
const ID = /^[A-Za-z0-9_-]{1,512}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A replay instant: an ISO time inside the replay window, never in the future. */
function atOf(raw: string | undefined): string | undefined | null {
  if (raw === undefined || raw === '') return undefined
  const t = Date.parse(raw)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(t)) return null
  if (t > Date.now() + 60_000 || t < Date.now() - (config.replayDays + 1) * 86_400_000) return null
  return new Date(t).toISOString()
}
const BAD_AT = { error: `at must be an ISO time within the last ${config.replayDays} days` }

const REL = /^(?!\.)(?!.*\.\.)(?!\/)[A-Za-z0-9._\-/ ()&$'!,+—–]{1,400}\.md$/

export function apiRoutes(source: Source): Hono {
  const api = new Hono()

  api.onError((err, c) => {
    if (err instanceof NotFound) return c.json({ error: err.message }, 404)
    if (err instanceof Unsupported) return c.json({ error: err.message, kind: 'unsupported', fix: err.fix }, 501)
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
      cli: config.cliName,
      ask: {
        models: config.ask.models,
        efforts: config.ask.efforts,
        defaultModel: config.ask.models[0] ?? '',
        defaultEffort: config.ask.efforts[0] ?? '',
        skills: config.ask.skills,
        defaultSkill: config.ask.skills[0] ?? '',
      },
    }
    return c.json(body)
  })

  api.get('/wikis', async (c) => c.json(await source.wikis()))

  api.get('/wikis/:key/today', async (c) => {
    const at = atOf(c.req.query('at'))
    if (at === null) return c.json(BAD_AT, 400)
    return c.json(await source.today(c.req.param('key'), at))
  })

  api.get('/wikis/:key/new', async (c) => {
    const raw = c.req.query('since') ?? '1d'
    if (!SINCE.test(raw)) return c.json({ error: 'since must look like 6h or 7d' }, 400)
    const at = atOf(c.req.query('at'))
    if (at === null) return c.json(BAD_AT, 400)
    return c.json(await source.whatsNew(c.req.param('key'), raw as Since, at))
  })

  api.get('/wikis/:key/fleet', async (c) => {
    const at = atOf(c.req.query('at'))
    if (at === null) return c.json(BAD_AT, 400)
    return c.json(await source.fleet(c.req.param('key'), at))
  })

  api.get('/wikis/:key/learned', async (c) => {
    const days = c.req.query('days') === '30' ? 30 : 7
    return c.json(await source.learned(c.req.param('key'), days))
  })

  api.get('/wikis/:key/replay', async (c) => c.json(await source.replayDays(c.req.param('key'))))

  api.get('/wikis/:key/replay/:date', async (c) => {
    const date = c.req.param('date')
    if (!DATE.test(date) || Number.isNaN(Date.parse(date))) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
    return c.json(await source.replayDay(c.req.param('key'), date))
  })

  api.get('/wikis/:key/briefings', async (c) => c.json(await source.briefings(c.req.param('key'))))

  api.get('/wikis/:key/briefings/:id', async (c) => {
    const id = c.req.param('id')
    if (!ID.test(id)) return c.json({ error: 'bad id' }, 400)
    const b = await source.briefing(c.req.param('key'), id)
    if (!b) return c.json({ error: 'briefing not found' }, 404)
    return c.json(b)
  })

  api.get('/wikis/:key/page', async (c) => {
    const rel = c.req.query('path') ?? ''
    if (!REL.test(rel)) return c.json({ error: 'path must be a wiki-relative .md path' }, 400)
    const page = await source.page(c.req.param('key'), rel)
    if (!page) return c.json({ error: 'page not found' }, 404)
    return c.json(page)
  })

  api.get('/wikis/:key/resolve', async (c) => {
    const link = (c.req.query('link') ?? '').trim()
    if (!link || link.length > 300) return c.json({ error: 'link required' }, 400)
    const found = await source.resolve(c.req.param('key'), link)
    if (!found) return c.json({ error: `no page for [[${link}]]` }, 404)
    return c.json(found)
  })

  api.get('/wikis/:key/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (!q) return c.json({ error: 'q required' }, 400)
    const kRaw = c.req.query('k')
    const k = kRaw ? Number(kRaw) : undefined
    if (k !== undefined && (!Number.isInteger(k) || k < 1 || k > 100)) return c.json({ error: 'k must be 1–100' }, 400)
    const params: SearchParams = { q, k, filters: {} }
    for (const kind of SEARCH_FILTER_KINDS) {
      const v = c.req.query(kind)?.trim()
      if (v) params.filters![kind] = v
    }
    const from = c.req.query('captured_from')?.trim()
    const to = c.req.query('captured_to')?.trim()
    if (from) params.capturedFrom = from
    if (to) params.capturedTo = to
    return c.json(await source.search(c.req.param('key'), params))
  })

  api.get('/wikis/:key/ask', async (c) => c.json(await source.askStatus(c.req.param('key'))))

  // Runs an agent session, so it is a POST: a prefetch or a crawler never starts one.
  // A refusal answers as JSON before any event; once the session has started,
  // its events stream as server-sent events and a failure is an `error` event.
  const asking = new Set<string>()
  api.post('/wikis/:key/ask', async (c) => {
    const key = c.req.param('key')
    let raw: Partial<AskRequest>
    try {
      raw = (await c.req.json()) as Partial<AskRequest>
    } catch {
      return c.json({ error: 'a JSON body is required' }, 400)
    }
    const q = typeof raw.q === 'string' ? raw.q.trim() : ''
    if (!q || q.length > 2000) return c.json({ error: 'q must be 1–2000 characters' }, 400)
    const model = raw.model ?? config.ask.models[0]
    const effort = raw.effort ?? config.ask.efforts[0]
    const skill = raw.skill ?? config.ask.skills[0]
    if (!model || !config.ask.models.includes(model)) return c.json({ error: `model must be one of ${config.ask.models.join(', ')}` }, 400)
    if (!effort || !config.ask.efforts.includes(effort)) return c.json({ error: `effort must be one of ${config.ask.efforts.join(', ')}` }, 400)
    if (!skill || !config.ask.skills.includes(skill)) return c.json({ error: `skill must be one of ${config.ask.skills.join(', ')}` }, 400)
    const req: AskRequest = { q, model, effort, skill }
    if (raw.agent !== undefined && raw.agent !== '') {
      const { agents } = await source.askStatus(key)
      if (typeof raw.agent !== 'string' || !agents.includes(raw.agent))
        return c.json({ error: agents.length ? `agent must be one of ${agents.join(', ')}` : 'this wiki has no enabled agents' }, 400)
      req.agent = raw.agent
    }
    // Each answer is a paid agent session: one at a time per wiki.
    if (asking.has(key)) return c.json({ error: 'this wiki is already answering a question; wait for it or stop it' }, 429)
    asking.add(key)
    const stop = new AbortController()
    const abort = () => stop.abort()
    c.req.raw.signal.addEventListener('abort', abort, { once: true })
    const events = source.ask(key, req, stop.signal)
    let first: IteratorResult<AskEvent>
    try {
      first = await events.next()
    } catch (e) {
      asking.delete(key)
      throw e
    }
    return streamSSE(c, async (stream) => {
      stream.onAbort(abort)
      const send = (ev: AskEvent) => stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) })
      // A comment line every 15s keeps proxies from closing a quiet stream during a long tool call.
      const beat = setInterval(() => void stream.write(': keep-alive\n\n'), 15_000)
      try {
        for (let r = first; !r.done && !stop.signal.aborted; r = await events.next()) await send(r.value)
      } catch (e) {
        await send({ type: 'error', message: e instanceof Error ? e.message : 'the session failed' })
      } finally {
        clearInterval(beat)
        c.req.raw.signal.removeEventListener('abort', abort)
        await events.return(undefined)
        asking.delete(key)
      }
    })
  })

  api.get('/wikis/:key/facets', async (c) => c.json(await source.facets(c.req.param('key'))))

  return api
}
