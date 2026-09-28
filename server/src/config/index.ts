// The one config system. Every environment variable the server reads is read
// here, once, with its default beside it. Nothing else in server/ touches
// process.env. The client gets what it needs from /api/config.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { DataSource, Mode } from '@dashboard/shared/types'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

// A .env at the repo root is read here and nowhere else; the process
// environment wins over it. `.env.example` lists every key.
try {
  process.loadEnvFile(resolve(repoRoot, '.env'))
} catch {
  // no .env: defaults and the process environment apply
}

const Env = z.object({
  /** Where the built client lives; the server serves it when present. */
  DASHBOARD_CLIENT_DIST: z.string().default(resolve(repoRoot, 'client/dist')),
  /** Interface to bind. Loopback unless you know why not. */
  DASHBOARD_BIND: z.string().default('127.0.0.1'),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(4180),
  /** `live` reads the machine's wikis through the CLI; `fixtures` serves the bundled demo dataset. */
  DASHBOARD_SOURCE: z.enum(['live', 'fixtures']).default('live'),
  /** `read` is the only mode v0 ships; `write` is plumbed so the UI can show it. */
  DASHBOARD_MODE: z.enum(['read', 'write']).default('read'),
  /** The machine CLI. A command line, not a path: it is split on spaces. */
  DASHBOARD_CLI: z.string().default('llm-wiki-cli'),
  /** Per-call timeout for the CLI, in milliseconds. */
  DASHBOARD_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** How long a view answer is reused before the CLI is asked again. */
  DASHBOARD_CACHE_MS: z.coerce.number().int().nonnegative().default(5_000),
  /** The token the opened URL carries. Generated per start when unset. */
  DASHBOARD_TOKEN: z.string().min(16).optional(),
  /** Set to `0` to serve without a token, for local hacking only. */
  DASHBOARD_TOKEN_REQUIRED: z.string().default('1'),
  /** Open the browser on start. The launcher verb does this itself, so it passes `0`. */
  DASHBOARD_OPEN: z.string().default('1'),
  /** The registry the machine CLI reads; only used to name it on /api/health. */
  LLM_WIKI_MACHINE_CONFIG: z
    .string()
    .default(resolve(homedir(), '.config/llm-wiki/config.toml')),
  /** Where the replay timeline's SQLite file lives. `:memory:` keeps it in the process only. */
  DASHBOARD_STATE_DIR: z
    .string()
    .default(resolve(process.env.XDG_STATE_HOME || resolve(homedir(), '.local/state'), 'llm-wiki-dashboard')),
  /** How many days of history replay offers. */
  DASHBOARD_REPLAY_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DASHBOARD_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const env = Env.parse(process.env)

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const truthy = (v: string) => !['0', 'false', 'no', ''].includes(v.toLowerCase())

export const config = {
  version: readVersion(),
  bind: env.DASHBOARD_BIND,
  port: env.DASHBOARD_PORT,
  source: env.DASHBOARD_SOURCE as DataSource,
  mode: env.DASHBOARD_MODE as Mode,
  cli: env.DASHBOARD_CLI.split(' ').filter(Boolean),
  cliTimeoutMs: env.DASHBOARD_CLI_TIMEOUT_MS,
  cacheMs: env.DASHBOARD_CACHE_MS,
  token: env.DASHBOARD_TOKEN ?? randomBytes(24).toString('base64url'),
  tokenRequired: truthy(env.DASHBOARD_TOKEN_REQUIRED),
  openBrowser: truthy(env.DASHBOARD_OPEN),
  clientDist: env.DASHBOARD_CLIENT_DIST,
  clientDistPresent: existsSync(resolve(env.DASHBOARD_CLIENT_DIST, 'index.html')),
  machineConfigPath: env.LLM_WIKI_MACHINE_CONFIG,
  logLevel: env.DASHBOARD_LOG_LEVEL,
  stateDir: env.DASHBOARD_STATE_DIR,
  replayDays: env.DASHBOARD_REPLAY_DAYS,
  /** Every CLI child runs under the read floor, whatever mode the server is in.
   *  Write mode, when it exists, lifts this per route, never globally. */
  cliEnv: {
    LLM_WIKI_PERMISSIONS: 'read',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  } as Record<string, string>,
} as const

export type Config = typeof config

export function url(): string {
  const base = `http://${config.bind === '0.0.0.0' ? '127.0.0.1' : config.bind}:${config.port}/`
  return config.tokenRequired ? `${base}?token=${config.token}` : base
}
