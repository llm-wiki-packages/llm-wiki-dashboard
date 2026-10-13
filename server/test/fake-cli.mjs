#!/usr/bin/env node
// A stand-in for llm-wiki-cli: echoes its argv and env back as JSON so tests
// can assert what the server would have run, without a wiki on the box.
//
// - `FAKE_CLI_FAIL=1` answers the way the real CLI does on an unknown verb:
//   nothing on stdout, click's usage and error on stderr, rc 2.
//   `FAKE_CLI_FAIL=<verb>` does that for one verb only, like `harness`.
// - `machine wikis ls`, `status`, `whereami`, `sandboxes ls` and `agents ls` answer in
//   the real shapes. `FAKE_CLI_JAIL` names the jail (default `none`),
//   `FAKE_CLI_SANDBOXES` the enabled sandboxes (default `no-network,read-search`),
//   `FAKE_CLI_TEMPLATES` the wiki's templates (default `harvest,no-network,read-search`),
//   `FAKE_CLI_AGENTS` the enabled agents (default none), `FAKE_CLI_WIKI_PATH` the wiki's directory.
// - `jobs ls [--verbose]`, `jobs due` and `jobs show <slug>` answer the jobs below,
//   echoing the argv and the read floor beside them; `FAKE_CLI_PAUSED` names jobs to
//   answer paused, `FAKE_CLI_FAILING` jobs braked past the attempt cap. `op since`
//   and `git changed` answer empty.
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

// A wiki's seven `ops-` jobs with the host jobs, `ops-nightly` and `ops-morning` resumed, and two watches, one of
// them running now on box-a, whose queue the fake's `jobs due` is. The shapes are the CLI's: a bare `jobs ls` row
// names a routines job's first step alone, and `--verbose` adds the verdict, the tickets running here, the window
// and the routines, which `jobs show` carries too. A routines job's target is empty. `FAKE_CLI_FAILING` names jobs
// whose verdict is braked past the attempt cap, `FAKE_CLI_STEP` a routines job running its second step here.
const paused = (env.FAKE_CLI_PAUSED ?? '').split(',')
const failing = (env.FAKE_CLI_FAILING ?? '').split(',')
const stepping = env.FAKE_CLI_STEP
const localAt = (h, m = 0, days = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
const HERE = 'box-a'
const STAGES = ['harvest', 'transcribe', 'enrich', 'process', 'routine']
const stages = (clock, { holder = null, ok = null } = {}) =>
  STAGES.map((stage) => ({ stage, machine: null, budget: '1h', skipped: stage !== clock && (clock === 'routine' || stage === 'routine'), holder: stage === clock ? holder : null, refreshed_at: null, stalled: false, stolen: null, leftover: [], ok_started: stage === clock ? ok : null, ran_on: stage === clock && ok ? [HERE] : [], failing: [], attempts: 0 }))
const subject = (e) => e.skill ?? e.run ?? `llm-wiki:${e.op}`
// `dueness.row`: `kind` is the first rung that said no, null when due.
const verdict = (v) => ({ due: false, kind: null, reasons: [], blocked_by: [], next_at: null, due_since: null, last_ok: null, anchor: v.last_ok ?? null, chain: null, ...v })
const entries = (j) => (j.kind === 'routines' ? j.steps.map(({ skill, op, run, args = [] }) => (skill ? { verb: 'skill', name: skill, args } : op ? { verb: 'op', name: op, args } : { verb: 'run', name: run, args })) : [])
const PAUSED = verdict({ kind: 'paused', reasons: ['paused'] })
const routines = (slug, steps, state, claim, more = {}) => ({ slug, description: '', kind: 'routines', claim, machine: null, every: '1d', window: null, steps, state, verdict: PAUSED, ...more })
const JOBS = [
  {
    slug: 'arxiv-cs', description: 'arXiv cs.AI listing, every six hours', kind: 'pipeline', claim: 'any', machine: null, target: 'https://arxiv.org/list/cs.AI/recent', dest: 'sources/papers', every: '6h', window: null, skill: 'arxiv', state: 'active', holder: HERE, ok: localAt(6),
    verdict: verdict({ due: true, reasons: [`interval elapsed (last ok ${localAt(6)})`], due_since: localAt(12), last_ok: localAt(6) }),
    running: [{ id: 'arxiv-cs-0001', stage: 'harvest', machine: HERE, since: localAt(11, 50), step: null }],
  },
  {
    slug: 'rss-news', description: 'the industry feed', kind: 'pipeline', claim: 'any', machine: null, target: 'https://example.com/feed.xml', dest: 'sources/news', every: '6h', window: null, skill: 'channel-rss', state: 'active', ok: localAt(9),
    verdict: verdict({ kind: 'period', reasons: [`ran recently (last ok ${localAt(9)}, every 6h)`], next_at: localAt(15), last_ok: localAt(9) }),
  },
  routines('ops-hourly-host', [{ op: 'index' }, { op: 'transcribe' }], 'active', 'none', {
    every: '1h', ok: localAt(11),
    verdict: verdict({ due: true, reasons: ['chain in progress (1 of 2)'], due_since: localAt(11), last_ok: localAt(11), chain: { done: 1, of: 2 } }),
  }),
  routines('ops-nightly-host', [{ op: 'reindex' }, { op: 'doctor' }], 'active', 'none', {
    window: '02:00-06:00',
    verdict: verdict({ kind: 'window', reasons: ['never run', 'never run — waits for the 02:00-06:00 window'], next_at: localAt(2, 0, 1) }),
  }),
  routines('ops-denials', [{ skill: 'llm-wiki:denials' }], 'paused', 'none'),
  routines('ops-hourly', [{ skill: 'llm-wiki:curate' }], 'paused', 'any', { every: '1h' }),
  routines('ops-nightly', [{ skill: 'llm-wiki:dream' }, { skill: 'llm-wiki:improve' }, { skill: 'llm-wiki:wiki-report' }], 'active', 'any', {
    machine: HERE, window: '22:00-06:00', description: "dream, improve, report: the wiki's nightly sessions",
    verdict: verdict({ kind: 'window', reasons: ['never run', 'never run — waits for the 22:00-06:00 window'], next_at: localAt(22) }),
  }),
  routines('ops-morning', [{ skill: 'daily-report' }], 'active', 'any', {
    verdict: verdict({ kind: 'requires', reasons: ['never run'], blocked_by: ['requires dream within 24h — no dream run found; job ops-nightly runs dream', 'requires wiki-report within 24h — no wiki-report run found; job ops-nightly runs wiki-report'], due_since: localAt(8) }),
  }),
  routines('ops-synthesize', [{ skill: 'your-synthesis-skill' }], 'paused', 'any', { window: '18:00-21:00' }),
].map((j) => {
  if (paused.includes(j.slug)) return { ...j, state: 'paused', verdict: PAUSED }
  // A routine ticket carries its own copy of the entry: its index, from 0, and its value.
  if (j.slug === stepping) return { ...j, running: [{ id: `${j.slug}-0002`, stage: 'routine', machine: HERE, since: localAt(11, 55), step: { index: 1, name: entries(j)[1].name } }] }
  if (failing.includes(j.slug))
    return { ...j, verdict: { ...j.verdict, due: false, kind: 'failed-cap', due_since: null, anchor: localAt(10), next_at: localAt(16), chain: null } }
  return j
})
const lsRow = (j, verbose) => ({
  slug: j.slug, description: j.description, target: j.target ?? '', dest: j.dest ?? null, route: null, every: j.every,
  skill: j.kind === 'routines' ? subject(j.steps[0]) : j.skill,
  stages: stages(j.kind === 'routines' ? 'routine' : 'harvest', j),
  state: j.state, kind: j.kind, claim: j.claim, machine: j.machine, due: j.verdict.due, blocked: null,
  ...(verbose ? { verdict: j.verdict, running: j.running ?? [], window: j.window, routines: entries(j) } : {}),
})
const DETAILS = {
  'ops-nightly': [
    'dream drains the distill backlog, resolves contradictions and downgrades stale facts; it is the sole owner of distillation into wiki/.',
    "improve runs after dream so it reads tonight's distillation.",
    'wiki-report closes the night; it reads and never writes wiki/.',
  ],
}
// `jobs show` answers the folded record whole, its verdict and its tickets here; a `none` job lists each machine's last run instead of a holder.
const shown = (j) => ({
  slug: j.slug,
  job: { v: 1, slug: j.slug, description: j.description, details: DETAILS[j.slug] ?? [], dest: j.dest ?? null, state: j.state, claim: j.claim, machine: j.machine, every: j.every, window: j.window, ...(j.kind === 'routines' ? { routines: j.steps.map((e) => ({ budget: '1h', ...e })) } : {}) },
  due: j.verdict.due,
  stages: lsRow(j).stages,
  claim: j.claim === 'none'
    ? { kind: 'none', machines: j.slug === 'ops-hourly-host' ? [{ machine: HERE, last_run: localAt(11), outcome: 'ok' }] : [] }
    : { kind: j.claim, holder: j.holder ? { machine: j.holder, since: '2026-10-12T11:50:00Z', kind: j.claim, text: `held by ${j.holder} since 2026-10-12T11:50:00Z (${j.claim})` } : null },
  verdict: j.verdict,
  running: j.running ?? [],
})
// The queue rows are this machine's; `jobs` lists only the stages due here now, keyed by slug.
const DUE = {
  running: JOBS.flatMap((j) => (j.running ?? []).map((t) => ({ id: t.id, job: j.slug, stage: t.stage, priority: 'normal', age_s: 600, runs: 1, runtime_s: 0, last: null, machine: t.machine, started_at: t.since, step: t.step }))),
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
} else if (is('status')) {
  out({ machine: HERE, peers: [{ machine: HERE, capabilities: [], last_seen: localAt(12), state: 'ok' }], ...echo })
} else if (is('jobs', 'ls')) {
  out({ count: JOBS.length, jobs: JOBS.map((j) => lsRow(j, argv.includes('--verbose'))), ...echo })
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
