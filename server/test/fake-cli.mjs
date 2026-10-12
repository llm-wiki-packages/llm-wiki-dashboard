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
//   `FAKE_CLI_AGENTS` the enabled agents (default none), `FAKE_CLI_WIKI_PATH` the wiki's directory.
// - `jobs ls`, `jobs due` and `jobs show <slug>` answer the jobs below, echoing
//   the argv and the read floor beside them; `FAKE_CLI_PAUSED` names jobs to
//   answer paused. `op since` and `git changed` answer empty.
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
const echo = { argv, permissions: env.LLM_WIKI_PERMISSIONS ?? null }

// A wiki's seven `ops-` jobs with the host jobs and `ops-nightly` resumed, and two watches, one of them
// running now. The shapes are the CLI's: a `jobs ls` row names a routines job's first step alone and has
// no window, both of which `jobs show` prints; a routines job's target is empty.
const paused = (env.FAKE_CLI_PAUSED ?? '').split(',')
const localAt = (h, m = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
const STAGES = ['harvest', 'transcribe', 'enrich', 'process', 'routine']
const stages = (clock, { holder = null, ok = null } = {}) =>
  STAGES.map((stage) => ({ stage, machine: null, budget: '1h', skipped: stage !== clock && (clock === 'routine' || stage === 'routine'), holder: stage === clock ? holder : null, refreshed_at: null, stalled: false, stolen: null, leftover: [], ok_started: stage === clock ? ok : null, ran_on: stage === clock && ok ? ['box-a'] : [], failing: [], attempts: 0 }))
const subject = (e) => e.skill ?? e.run ?? `llm-wiki:${e.op}`
const routines = (slug, steps, state, claim, more = {}) => ({ slug, description: '', kind: 'routines', claim, machine: null, every: '1d', window: null, steps, state: paused.includes(slug) ? 'paused' : state, due: false, ...more })
const JOBS = [
  { slug: 'arxiv-cs', description: 'arXiv cs.AI listing, every six hours', kind: 'pipeline', claim: 'any', machine: null, target: 'https://arxiv.org/list/cs.AI/recent', dest: 'sources/papers', every: '6h', window: null, skill: 'arxiv', state: 'active', due: false, holder: 'box-a' },
  { slug: 'rss-news', description: 'the industry feed', kind: 'pipeline', claim: 'any', machine: null, target: 'https://example.com/feed.xml', dest: 'sources/news', every: '6h', window: null, skill: 'channel-rss', state: 'active', due: false, ok: localAt(9) },
  routines('ops-hourly-host', [{ op: 'index' }, { op: 'transcribe' }], 'active', 'none', { every: '1h', due: true, ok: localAt(11) }),
  routines('ops-nightly-host', [{ op: 'reindex' }, { op: 'doctor' }], 'active', 'none', { window: '02:00-06:00' }),
  routines('ops-denials', [{ skill: 'llm-wiki:denials' }], 'paused', 'none'),
  routines('ops-hourly', [{ skill: 'llm-wiki:curate' }], 'paused', 'any', { every: '1h' }),
  routines('ops-nightly', [{ skill: 'llm-wiki:dream' }, { skill: 'llm-wiki:improve' }, { skill: 'llm-wiki:wiki-report' }], 'active', 'any', { machine: 'box-a', window: '22:00-06:00', description: "dream, improve, report: the wiki's nightly sessions" }),
  routines('ops-morning', [{ skill: 'daily-report' }], 'paused', 'any'),
  routines('ops-synthesize', [{ skill: 'your-synthesis-skill' }], 'paused', 'any', { window: '18:00-21:00' }),
]
const lsRow = (j) => ({
  slug: j.slug, description: j.description, target: j.target ?? '', dest: j.dest ?? null, route: null, every: j.every,
  skill: j.kind === 'routines' ? subject(j.steps[0]) : j.skill,
  stages: stages(j.kind === 'routines' ? 'routine' : 'harvest', j),
  state: j.state, kind: j.kind, claim: j.claim, machine: j.machine, due: j.state === 'active' && j.due, blocked: null,
})
const DETAILS = {
  'ops-nightly': [
    'dream drains the distill backlog, resolves contradictions and downgrades stale facts; it is the sole owner of distillation into wiki/.',
    "improve runs after dream so it reads tonight's distillation.",
    'wiki-report closes the night; it reads and never writes wiki/.',
  ],
}
// `jobs show` answers the folded record whole; a `none` job lists each machine's last run instead of a holder.
const shown = (j) => ({
  slug: j.slug,
  job: { v: 1, slug: j.slug, description: j.description, details: DETAILS[j.slug] ?? [], dest: j.dest ?? null, state: j.state, claim: j.claim, machine: j.machine, every: j.every, window: j.window, ...(j.kind === 'routines' ? { routines: j.steps.map((e) => ({ budget: '1h', ...e })) } : {}) },
  due: lsRow(j).due,
  stages: lsRow(j).stages,
  claim: j.claim === 'none'
    ? { kind: 'none', machines: j.slug === 'ops-hourly-host' ? [{ machine: 'box-a', last_run: localAt(11), outcome: 'ok' }] : [] }
    : { kind: j.claim, holder: j.holder ? { machine: j.holder, since: '2026-10-12T11:50:00Z', kind: j.claim, text: `held by ${j.holder} since 2026-10-12T11:50:00Z (${j.claim})` } : null },
})
// The queue rows are this machine's; `jobs` lists only the stages due here now, keyed by slug.
const DUE = {
  running: [{ id: 'arxiv-cs-0001', job: 'arxiv-cs', stage: 'harvest', priority: 'normal', age_s: 600, runs: 1, runtime_s: 0, last: null }],
  pending: [],
  review: [],
  parked: [],
  jobs: [{ slug: 'ops-hourly-host', stage: 'routine', due_since: localAt(11), held_by: null, reasons: ['chain in progress (1 of 2)'], blocked_by: [], last_run: localAt(11) }],
  caps: {},
  handoffs: { outgoing: [], incoming: [], shipping: [], problems: [] },
}

if (env.FAKE_CLI_FAIL === '1' || env.FAKE_CLI_FAIL === verb[0]) {
  process.stderr.write(`Usage: llm-wiki-ops [OPTIONS] COMMAND [ARGS]...\nTry 'llm-wiki-ops --help' for help.\n\nError: No such command '${verb[0]}'.\n`)
  process.exit(2)
}

if (is('machine', 'wikis', 'ls')) {
  out({ wikis: [{ key: 'kb', name: 'KB', path: env.FAKE_CLI_WIKI_PATH ?? '/tmp/fake-kb' }] })
} else if (is('whereami')) {
  out({ wiki: '/tmp/fake-kb', sandbox: { jail: env.FAKE_CLI_JAIL ?? 'none' } })
} else if (is('sandboxes', 'ls')) {
  const on = (env.FAKE_CLI_SANDBOXES ?? 'no-network,read-search').split(',').filter(Boolean)
  const all = (env.FAKE_CLI_TEMPLATES ?? 'harvest,no-network,read-search').split(',')
  out({ sandboxes: all.map((name) => ({ name, enabled: on.includes(name) })) })
} else if (is('agents', 'ls')) {
  out({ agents: (env.FAKE_CLI_AGENTS ?? '').split(',').filter(Boolean).map((name) => ({ name, enabled: true })) })
} else if (is('jobs', 'ls')) {
  out({ count: JOBS.length, jobs: JOBS.map(lsRow), ...echo })
} else if (is('jobs', 'show')) {
  const j = JOBS.find((x) => x.slug === verb[2])
  if (!j) {
    out({ error: `no job '${verb[2]}' — \`jobs ls\` names every job this wiki declares` })
    process.exit(2)
  }
  out({ ...shown(j), ...echo })
} else if (is('jobs', 'due')) {
  out({ ...DUE, ...echo })
} else if (is('op', 'since')) {
  out({ runs: [] })
} else if (is('git', 'changed')) {
  out({ files: [] })
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
  out(echo)
}
