#!/usr/bin/env node
// A stand-in for llm-wiki-cli: echoes its argv and env back as JSON so tests
// can assert what the server would have run, without a wiki on the box.
//
// - `FAKE_CLI_FAIL=1` answers the way the real CLI does on an unknown verb:
//   nothing on stdout, click's usage and error on stderr, rc 2.
//   `FAKE_CLI_FAIL=<verb>` does that for one verb only, like `harness`.
// - `machine wikis ls`, `whereami`, `sandboxes ls` and `agents ls` answer in
//   the real shapes. `FAKE_CLI_JAIL` names the jail (default `none`),
//   `FAKE_CLI_SANDBOXES` the enabled sandboxes (default `no-network,read-search`),
//   `FAKE_CLI_TEMPLATES` the wiki's templates (default `harvest,no-network,read-search`),
//   `FAKE_CLI_AGENTS` the enabled agents (default none).
// - `harness run … --stream` prints the normalized JSON lines, one every
//   `FAKE_CLI_STREAM_MS` (default 20ms). `FAKE_CLI_PIDFILE` gets its pid, and
//   `FAKE_CLI_STREAM=hang` keeps it printing until it is killed.
//   `FAKE_CLI_REFUSE=<key>:<message>` refuses before the spawn the way the
//   real verb does: exactly one `error` line and rc 1.
//   `FAKE_CLI_ARGVFILE` gets its argv as JSON. The result echoes the argv, the read floor, and any DASHBOARD_* variable
//   that leaked into the child's environment.
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const env = process.env
const out = (o) => process.stdout.write(JSON.stringify({ ...o, _cmd_: { elapsed_ms: 0, wiki: null, head: null } }))
const verb = argv.filter((a) => !a.startsWith('-')).slice(argv[0] === 'wiki' ? 2 : 0)
const is = (...words) => words.every((w, i) => verb[i] === w)

if (env.FAKE_CLI_FAIL === '1' || env.FAKE_CLI_FAIL === verb[0]) {
  process.stderr.write(`Usage: llm-wiki-ops [OPTIONS] COMMAND [ARGS]...\nTry 'llm-wiki-ops --help' for help.\n\nError: No such command '${verb[0]}'.\n`)
  process.exit(2)
}

if (is('machine', 'wikis', 'ls')) {
  out({ wikis: [{ key: 'kb', name: 'KB', path: '/tmp/fake-kb' }] })
} else if (is('whereami')) {
  out({ wiki: '/tmp/fake-kb', sandbox: { jail: env.FAKE_CLI_JAIL ?? 'none' } })
} else if (is('sandboxes', 'ls')) {
  const on = (env.FAKE_CLI_SANDBOXES ?? 'no-network,read-search').split(',').filter(Boolean)
  const all = (env.FAKE_CLI_TEMPLATES ?? 'harvest,no-network,read-search').split(',')
  out({ sandboxes: all.map((name) => ({ name, enabled: on.includes(name) })) })
} else if (is('agents', 'ls')) {
  out({ agents: (env.FAKE_CLI_AGENTS ?? '').split(',').filter(Boolean).map((name) => ({ name, enabled: true })) })
} else if (argv.includes('--stream') && env.FAKE_CLI_REFUSE) {
  const [error, ...rest] = env.FAKE_CLI_REFUSE.split(':')
  process.stdout.write(JSON.stringify({ type: 'error', error, message: rest.join(':') }) + '\n')
  process.exit(1)
} else if (argv.includes('--stream')) {
  if (env.FAKE_CLI_PIDFILE) writeFileSync(env.FAKE_CLI_PIDFILE, String(process.pid))
  if (env.FAKE_CLI_ARGVFILE) writeFileSync(env.FAKE_CLI_ARGVFILE, JSON.stringify(argv))
  const q = argv[argv.indexOf('--') + 1] ?? ''
  const lines = [
    { type: 'start', session: 'fake-session' },
    { type: 'tool', name: 'Searching', detail: q },
    { type: 'text', text: 'The answer ' },
    'not json, ignored',
    { type: 'text', text: 'cites [[Some page]].' },
    { type: 'result', answer: 'The answer cites [[Some page]].', session: 'fake-session', harness: 'claude', model: 'sonnet', effort: 'medium', sandbox: 'read-search', elapsed_s: 1.4, outcome: 'ok', argv, permissions: env.LLM_WIKI_PERMISSIONS ?? null, leaked: Object.keys(env).filter((k) => k.startsWith('DASHBOARD_')) },
  ]
  let i = 0
  const tick = setInterval(() => {
    if (env.FAKE_CLI_STREAM === 'hang') return void process.stdout.write(JSON.stringify({ type: 'tool', name: 'Thinking' }) + '\n')
    const l = lines[i++]
    if (l === undefined) {
      clearInterval(tick)
      return
    }
    process.stdout.write((typeof l === 'string' ? l : JSON.stringify(l)) + '\n')
  }, Number(env.FAKE_CLI_STREAM_MS ?? 20))
} else {
  out({ argv, permissions: env.LLM_WIKI_PERMISSIONS ?? null })
}
