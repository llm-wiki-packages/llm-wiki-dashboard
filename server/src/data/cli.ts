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
  text?: string
  k?: number
  /** `kind` → value, already validated against SEARCH_KINDS; a leading `-` on the kind negates. */
  filters?: Record<string, string>
  /** A commit sha, for `git log` since a point. */
  sha?: string
  /** A session id or op name, for `op show`. */
  target?: string
}

const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SINCE = /^\d{1,3}[hd]$/
const DIR = /^[a-z][a-z0-9_-]{0,63}$/
const SHA = /^[0-9a-f]{7,40}$/
const TARGET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
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
export const SEARCH_KINDS = new Set([
  'author', 'group', 'group_type', 'type', 'source_host', 'area', 'tag', 'bundle_id', 'under', 'curation', 'captured_from', 'captured_to',
])
const DATE = /^\d{4}-\d{2}-\d{2}$/
// A filter value is one line of ordinary text; the engine splits OR on commas itself.
const FILTER_VALUE = /^[^\x00-\x1f]{1,200}$/

function searchFilters(a: Args): string[] {
  const out: string[] = []
  const k = a.k ?? 10
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new CliError(`bad k: ${String(a.k)}`, 'args')
  out.push(`filter=k:${k}`)
  for (const [rawKind, value] of Object.entries(a.filters ?? {})) {
    const kind = rawKind.replace(/^-/, '')
    if (!SEARCH_KINDS.has(kind)) throw new CliError(`unknown filter: ${rawKind}`, 'args')
    if (!FILTER_VALUE.test(value)) throw new CliError(`bad value for ${kind}`, 'args')
    if ((kind === 'captured_from' || kind === 'captured_to') && !DATE.test(value)) throw new CliError(`${kind} must be YYYY-MM-DD`, 'args')
    out.push(`filter=${rawKind}:${value}`)
  }
  return out
}

function text(v: string | undefined): string {
  const t = (v ?? '').trim()
  if (!t || t.length > 500 || /[\x00-\x1f]/.test(t)) throw new CliError('search text must be one line of 1–500 characters', 'args')
  return t
}

/** `git log` bounded by a sha when one is given, else by an age. */
function logSince(a: Args): string {
  if (a.sha !== undefined) {
    if (!SHA.test(a.sha)) throw new CliError(`bad sha: ${a.sha}`, 'args')
    return `filter=since:${a.sha}`
  }
  return since(a.since, '30d')
}

function target(v: string | undefined): string {
  if (!v || !TARGET.test(v)) throw new CliError(`bad op show target: ${String(v)}`, 'args')
  return v
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
  'wiki.git.log': (a: Args) => wiki(a, 'git', 'log', logSince(a)),
  'wiki.op.show': (a: Args) => wiki(a, 'op', 'show', target(a.target)),
  'wiki.page.read': (a: Args) => wiki(a, 'page', 'read', rel(a.path)),
  // The question goes after `--`, so a question starting with a dash is never read as a flag.
  'wiki.search.query': (a: Args) => [
    'wiki', '--read-only', key(a.wiki), 'search', 'query', ...searchFilters(a), '--json', '--', text(a.text),
  ],
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
