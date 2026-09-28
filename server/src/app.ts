// Assembles the HTTP app: token gate, /api, the SSE stream, and the built
// client with an SPA fallback. Creating the app does not start listening, so
// tests can drive it through `app.request`.

import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { config } from './config/index.js'
import type { Source } from './data/source.js'
import { apiRoutes } from './routes/api.js'
import { EventHub, eventRoutes } from './routes/events.js'

const COOKIE = 'dashboard_token'

export function createApp(source: Source, hub: EventHub): Hono {
  const app = new Hono()

  // The token gate. A first visit carries ?token= in the URL the launcher
  // opened; it becomes a cookie so the client's fetches pass without knowing it.
  app.use('*', async (c, next) => {
    if (!config.tokenRequired) return next()
    const q = c.req.query('token')
    if (q && q === config.token) {
      setCookie(c, COOKIE, q, { httpOnly: true, sameSite: 'Strict', path: '/' })
      return next()
    }
    const given = getCookie(c, COOKIE) ?? c.req.header('x-dashboard-token')
    if (given === config.token) return next()
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'token required' }, 401)
    return c.text('This dashboard needs the link the launcher printed.', 401)
  })

  // The Host header must name loopback: a page on another origin cannot
  // rebind DNS to reach a server that refuses foreign hosts.
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost', '[::1]', config.bind].includes(host))
      return c.text('bad host', 421)
    return next()
  })

  app.route('/api', apiRoutes(source))
  app.route('/api', eventRoutes(hub))

  if (config.clientDistPresent) {
    const root = relative(process.cwd(), config.clientDist) || '.'
    app.use('/assets/*', serveStatic({ root }))
    app.get('/favicon.svg', serveStatic({ root, path: 'favicon.svg' }))
    app.get('*', async (c) => c.html(await readFile(join(config.clientDist, 'index.html'), 'utf8')))
  } else {
    app.get('/', (c) =>
      c.text(
        `API is up. The client is not built; run \`npm run build\` or use \`npm run dev\` for the Vite server on :5173.\n`,
      ),
    )
  }

  return app
}
