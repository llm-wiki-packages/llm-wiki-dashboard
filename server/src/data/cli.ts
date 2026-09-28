// The CLI seam. Every argv the server ever runs is spelled here, keyed by a
// verb name, and built from validated arguments. Routes never hand a string
// from the browser to this file: they pick a verb and pass typed values, and
// the wiki key must already be one the registry answered.

import { spawn } from 'node:child_process'
import { config } from '../config/index.js'

export type Since = `${number}${'h' | 'd'}`

export interface Args {
  wiki?: string
  since?: Since
  limit?: number
  dirs?: string[]
  path?: string
}

const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SINCE = /^\d{1,3}[hd]$/
const DIR = /^[a-z][a-z0-9_-]{0,63}$/
const REL = /^(?!\.)(?!.*\.\.)(?!\/)[A-Za-z0-9._\-/ ()&$'!,+]{1,400}\.md$/

function key(v: string | undefined): string {
  if (!v || !KEY.test(v)) throw new CliError(`bad wiki key: ${String(v)}`, 'args')
  return v
}
function since(v: Since | undefined, fallback: Since): string {
  const s = v ?? fallback
  if (!SINCE.test(s)) throw new CliError(`bad since: ${String(v)}`, 'args')
  return `filter=since:${s}`
}
function limit(v: number | undefined, fallback: number): string {
  const n = Number.isInteger(v) ? (v as number) : fallback
  if (n < 1 || n > 1000) throw new CliError(`bad limit: ${String(v)}`, 'args')
  return `filter=limit:${n}`
}
function dirs(v: string[] | undefined, fallback: string[]): string[] {
  const list = v ?? fallback
  for (const d of list) if (!DIR.test(d)) throw new CliError(`bad dir: ${d}`, 'args')
  return list
}
function rel(v: string | undefined): string {
  if (!v || !REL.test(v)) throw new CliError(`bad page path: ${String(v)}`, 'args')
  return v
}

/** The wiki-scoped prefix. `--read-only` sits before the selector, per the CLI grammar. */
const wiki = (a: Args, ...rest: string[]) => ['wiki', '--read-only', key(a.wiki), ...rest, '--json']

export const VERBS = {
  'machine.version': () => ['machine', 'version', '--json'],
  'machine.wikis.ls': () => ['machine', 'wikis', 'ls', '--json'],
  'machine.runner.ls': () => ['machine', 'runner', 'ls', '--json'],
  'wiki.status': (a: Args) => wiki(a, 'status', '--peers'),
  'wiki.search.status': (a: Args) => wiki(a, 'search', 'status'),
  'wiki.schedule.ls': (a: Args) => wiki(a, 'schedule', 'ls'),
  'wiki.pipeline.due': (a: Args) => wiki(a, 'pipeline', 'due'),
  'wiki.pipeline.jobs.ls': (a: Args) => wiki(a, 'pipeline', 'jobs', 'ls'),
  'wiki.pipeline.tickets.ls': (a: Args) => wiki(a, 'pipeline', 'tickets', 'ls'),
  'wiki.op.since': (a: Args) => wiki(a, 'op', 'since', since(a.since, '1d')),
  'wiki.op.logs': (a: Args) => wiki(a, 'op', 'logs', limit(a.limit, 50)),
  'wiki.git.changed': (a: Args) =>
    wiki(a, 'git', 'changed', ...dirs(a.dirs, ['sources', 'wiki', 'research']), since(a.since, '1d')),
  'wiki.page.read': (a: Args) => wiki(a, 'page', 'read', rel(a.path)),
} as const

export type Verb = keyof typeof VERBS

export class CliError extends Error {
  constructor(
    message: string,
    public readonly kind: 'args' | 'spawn' | 'timeout' | 'exit' | 'parse',
    public readonly rc?: number,
    public readonly stderr?: string,
  ) {
    super(message)
  }
}

export interface Runner {
  run<T = unknown>(verb: Verb, args?: Args): Promise<T>
}

/** Spawns the CLI with no shell, the read floor set, and a timeout. */
export function spawnRunner(): Runner {
  const [bin, ...pre] = config.cli
  if (!bin) throw new CliError('DASHBOARD_CLI is empty', 'args')
  return {
    run<T>(verb: Verb, args: Args = {}): Promise<T> {
      const argv = [...pre, ...VERBS[verb](args)]
      return new Promise<T>((resolve, reject) => {
        const child = spawn(bin, argv, {
          env: { ...process.env, ...config.cliEnv },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        let err = ''
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          reject(new CliError(`${verb}: timed out after ${config.cliTimeoutMs}ms`, 'timeout'))
        }, config.cliTimeoutMs)
        child.stdout.on('data', (d: Buffer) => (out += d.toString()))
        child.stderr.on('data', (d: Buffer) => (err += d.toString()))
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(new CliError(`${verb}: ${e.message}`, 'spawn'))
        })
        child.on('close', (rc) => {
          clearTimeout(timer)
          let parsed: unknown
          try {
            parsed = out.trim() ? JSON.parse(out) : undefined
          } catch {
            reject(new CliError(`${verb}: not JSON (rc ${rc})`, 'parse', rc ?? undefined, tail(err)))
            return
          }
          const errorKey = (parsed as { error?: string } | undefined)?.error
          if (rc !== 0 || errorKey) {
            reject(new CliError(`${verb}: ${errorKey ?? `rc ${rc}`}`, 'exit', rc ?? undefined, tail(err)))
            return
          }
          resolve(parsed as T)
        })
      })
    },
  }
}

function tail(s: string, n = 600): string {
  return s.length > n ? s.slice(-n) : s
}
