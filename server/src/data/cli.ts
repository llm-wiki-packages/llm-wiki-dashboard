// The CLI seam. Every argv the server ever runs is spelled here, keyed by a
// verb name, and built from validated arguments. Routes never hand a string
// from the browser to this file: they pick a verb and pass typed values, and
// the wiki key must already be one the registry answered.
//
// Every verb runs under the read floor (`wiki --read-only` and
// LLM_WIKI_PERMISSIONS=read) except one: `harness run`, which the CLI counts
// as writing because it spends model budget. It runs jailed in a sandbox that
// writes nothing, and the only thing from the browser on its line is the
// question, after `--` (owner ruling 2026-09-28, simple10/llm-wiki-plugins#2680).

import { spawn, type ChildProcess } from 'node:child_process'
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
  /** A job's slug, for `jobs show`. */
  slug?: string
  /** A skill name for `harness run skill=`, like `llm-wiki:search`. */
  skill?: string
  /** An enabled agent's name, for `harness run agent=`. */
  agent?: string
  model?: string
  effort?: string
}

export interface RunOptions {
  /** Overrides the configured per-call timeout. */
  timeoutMs?: number
  /** Kills the child when it aborts; `stream` only. */
  signal?: AbortSignal
}

/** The sandbox a question runs in: reads the wiki, reaches the models and the search port. */
export const ASK_SANDBOX = 'read-search'

const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SINCE = /^\d{1,3}[hd]$/
const DIR = /^[a-z][a-z0-9_-]{0,63}$/
const SHA = /^[0-9a-f]{7,40}$/
const TARGET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/
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

const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SKILL = /^[a-z0-9][a-z0-9-]{0,63}(:[a-z0-9][a-z0-9-]{0,63})?$/

function word(v: string | undefined, what: string): string {
  if (!v || !WORD.test(v)) throw new CliError(`bad ${what}: ${String(v)}`, 'args')
  return v
}

/** A question is one argv element: at most 8 KiB, and never dash-led, which the harness would read as a flag. */
export function question(v: string | undefined): string {
  const t = (v ?? '').trim()
  if (!t || /[\x00-\x08\x0b-\x1f]/.test(t) || Buffer.byteLength(t) > 8192)
    throw new CliError('a question is 1 to 8192 bytes of text', 'args')
  if (t.startsWith('-')) throw new CliError('a question cannot start with a dash', 'args')
  return t
}

function jobSlug(v: string | undefined): string {
  if (!v || !SLUG.test(v)) throw new CliError(`bad job slug: ${String(v)}`, 'args')
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
  'wiki.jobs.due': (a: Args) => wiki(a, 'jobs', 'due'),
  'wiki.jobs.ls': (a: Args) => wiki(a, 'jobs', 'ls'),
  'wiki.jobs.show': (a: Args) => wiki(a, 'jobs', 'show', jobSlug(a.slug)),
  'wiki.tickets.ls': (a: Args) => wiki(a, 'tickets', 'ls'),
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
  'wiki.whereami': (a: Args) => wiki(a, 'whereami'),
  'wiki.sandboxes.ls': (a: Args) => wiki(a, 'sandboxes', 'ls'),
  'wiki.agents.ls': (a: Args) => wiki(a, 'agents', 'ls', '--enabled'),
  // One question in a jailed harness session, streamed as JSON lines. The one
  // verb without the read floor (see the top of this file). Values are
  // `key=value`; model and effort are passed only when chosen, so the harness
  // otherwise uses the person's own default.
  'wiki.harness.run': (a: Args) => {
    if (!a.skill || !SKILL.test(a.skill)) throw new CliError(`bad skill: ${String(a.skill)}`, 'args')
    return [
      'wiki', key(a.wiki), 'harness', 'run', `sandbox=${ASK_SANDBOX}`, `skill=${a.skill}`,
      ...(a.agent !== undefined ? [`agent=${word(a.agent, 'agent')}`] : []),
      ...(a.model !== undefined ? [`model=${word(a.model, 'model')}`] : []),
      ...(a.effort !== undefined ? [`effort=${word(a.effort, 'effort')}`] : []),
      '--stream', '--', question(a.text),
    ]
  },
} as const

export type Verb = keyof typeof VERBS

/** The verbs that run without the read floor. */
const WRITES: ReadonlySet<Verb> = new Set<Verb>(['wiki.harness.run'])

/** The child's environment: the read floor unless the verb writes, and never the dashboard's own settings or token. */
export function childEnv(verb: Verb): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('DASHBOARD_')) env[k] = v
  Object.assign(env, config.cliEnv)
  if (WRITES.has(verb)) delete env.LLM_WIKI_PERMISSIONS
  else env.LLM_WIKI_PERMISSIONS = 'read'
  return env
}

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

/** One JSON line a streaming verb printed. The runner ends every stream with its own `_exit` line. */
export type StreamLine =
  | { type: '_exit'; rc: number | null; stderr: string; timedOut: boolean; spawnError?: string }
  | { type: string; [k: string]: unknown }

export interface Runner {
  run<T = unknown>(verb: Verb, args?: Args, opts?: RunOptions): Promise<T>
  /** Runs a verb that prints JSON lines, yielding each as it lands. Leaving the loop early kills the child. */
  stream(verb: Verb, args?: Args, opts?: RunOptions): AsyncGenerator<StreamLine>
}

/** Streaming children still running, so a shutdown can take them down too. */
const live = new Set<ChildProcess>()

/** SIGTERM to the child's whole process group (the CLI, the jail and the harness), then SIGKILL. */
function killGroup(child: ChildProcess): void {
  const sig = (s: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, s)
    } catch {
      // already gone
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  sig('SIGTERM')
  setTimeout(() => sig('SIGKILL'), 5000).unref()
}

/** Kills every streaming child; the server calls this on shutdown. */
export function killStreams(): void {
  for (const c of live) killGroup(c)
}

/** Spawns the CLI with no shell, the read floor set, and a timeout. */
export function spawnRunner(): Runner {
  const [bin, ...pre] = config.cli
  if (!bin) throw new CliError('DASHBOARD_CLI is empty', 'args')
  return {
    run<T>(verb: Verb, args: Args = {}, opts: RunOptions = {}): Promise<T> {
      const timeoutMs = opts.timeoutMs ?? config.cliTimeoutMs
      const argv = [...pre, ...VERBS[verb](args)]
      return new Promise<T>((resolve, reject) => {
        const child = spawn(bin, argv, {
          env: childEnv(verb),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        let err = ''
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          reject(new CliError(`${verb}: timed out after ${timeoutMs}ms`, 'timeout'))
        }, timeoutMs)
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

    async *stream(verb: Verb, args: Args = {}, opts: RunOptions = {}): AsyncGenerator<StreamLine> {
      const timeoutMs = opts.timeoutMs ?? config.cliTimeoutMs
      const argv = [...pre, ...VERBS[verb](args)]
      // Its own process group, so one signal reaches everything it started.
      const child = spawn(bin, argv, {
        env: childEnv(verb),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      live.add(child)
      const queue: StreamLine[] = []
      let wake: (() => void) | null = null
      const push = (l: StreamLine) => {
        queue.push(l)
        wake?.()
        wake = null
      }
      let buf = ''
      let err = ''
      let ended = false
      let timedOut = false
      const line = (raw: string) => {
        const t = raw.trim()
        if (!t) return
        try {
          const j = JSON.parse(t) as { type?: unknown }
          if (j && typeof j.type === 'string' && j.type !== '_exit') push(j as StreamLine)
        } catch {
          if (config.logLevel === 'debug') console.warn(`[cli] ${verb}: not a JSON line: ${t.slice(0, 200)}`)
        }
      }
      const end = (rc: number | null, spawnError?: string) => {
        if (ended) return
        ended = true
        live.delete(child)
        clearTimeout(timer)
        line(buf)
        buf = ''
        push({ type: '_exit', rc, stderr: tail(err), timedOut, ...(spawnError ? { spawnError } : {}) })
      }
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString()
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          line(buf.slice(0, i))
          buf = buf.slice(i + 1)
        }
      })
      child.stderr.on('data', (d: Buffer) => (err = tail(err + d.toString(), 4000)))
      child.on('error', (e) => end(null, e.message))
      child.on('close', (rc) => end(rc))
      const timer = setTimeout(() => {
        timedOut = true
        killGroup(child)
      }, timeoutMs)
      const onAbort = () => killGroup(child)
      if (opts.signal?.aborted) onAbort()
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        for (;;) {
          const next = queue.shift()
          if (next) {
            yield next
            if (next.type === '_exit') return
            continue
          }
          await new Promise<void>((r) => (wake = r))
        }
      } finally {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        if (!ended) killGroup(child)
      }
    },
  }
}

function tail(s: string, n = 600): string {
  return s.length > n ? s.slice(-n) : s
}
