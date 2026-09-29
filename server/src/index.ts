import { serve } from '@hono/node-server'
import { spawn } from 'node:child_process'
import { brand } from '@dashboard/shared/brand'
import { createApp } from './app.js'
import { config, url } from './config/index.js'
import { killStreams, spawnRunner } from './data/cli.js'
import { fixturesSource } from './data/fixtures.js'
import { liveSource } from './data/live.js'
import { Timeline, openStore } from './data/timeline.js'
import { EventHub } from './routes/events.js'

const source = config.source === 'fixtures' ? fixturesSource() : liveSource(spawnRunner(), new Timeline(spawnRunner(), openStore()))
const hub = new EventHub(source)
const app = createApp(source, hub)

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bind }, async (info) => {
  const link = url()
  console.log(`${brand.productName} · ${config.source} data · ${config.mode} mode`)
  console.log(`listening on ${info.address}:${info.port}`)
  console.log(link)
  if (!config.clientDistPresent) console.log('client not built: API only (npm run build, or npm run dev)')
  await hub.start().catch((e: unknown) => console.warn('[events] trace tail did not start:', e))
  if (config.openBrowser) openBrowser(link)
})

function openBrowser(link: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(cmd, [link], { stdio: 'ignore', detached: true }).unref()
  } catch {
    // No opener on this box; the link is on stdout.
  }
}

function shutdown(): void {
  hub.stop()
  killStreams()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
