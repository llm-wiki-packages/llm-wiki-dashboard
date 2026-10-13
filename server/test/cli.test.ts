// The CLI seam: argv spellings are fixed, arguments are validated, and every
// child runs under the read floor. The runner tests use test/fake-cli.mjs in
// place of llm-wiki-cli, wired through the config's DASHBOARD_CLI.

import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
process.env.DASHBOARD_CLI = `${process.execPath} ${resolve(here, 'fake-cli.mjs')}`
process.env.DASHBOARD_TOKEN_REQUIRED = '0'
process.env.DASHBOARD_OPEN = '0'

let cli: typeof import('../src/data/cli.js')
beforeAll(async () => {
  cli = await import('../src/data/cli.js')
})

describe('VERBS', () => {
  it('spells the wiki prefix with --read-only before the key and --json last', () => {
    expect(cli.VERBS['wiki.status']({ wiki: 'kb' })).toEqual([
      'wiki', '--read-only', 'kb', 'status', '--peers', '--json',
    ])
  })

  it('spells jobs and tickets as groups of their own, under the read floor', () => {
    expect(cli.VERBS['wiki.jobs.due']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'jobs', 'due', '--json'])
    expect(cli.VERBS['wiki.jobs.ls']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'jobs', 'ls', '--verbose', '--json'])
    expect(cli.VERBS['wiki.tickets.ls']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'tickets', 'ls', '--json'])
  })

  it('shows one job by a slug-shaped slug, and refuses anything else', () => {
    expect(cli.VERBS['wiki.jobs.show']({ wiki: 'kb', slug: 'ops-nightly' })).toEqual(['wiki', '--read-only', 'kb', 'jobs', 'show', 'ops-nightly', '--json'])
    expect(() => cli.VERBS['wiki.jobs.show']({ wiki: 'kb', slug: '--all' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.jobs.show']({ wiki: 'kb', slug: '../x' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.jobs.show']({ wiki: 'kb' })).toThrow(cli.CliError)
  })

  it('uses filter=since: for op since and git changed', () => {
    expect(cli.VERBS['wiki.op.since']({ wiki: 'kb', since: '7d' })).toContain('filter=since:7d')
    expect(cli.VERBS['wiki.git.changed']({ wiki: 'kb', since: '6h' })).toEqual([
      'wiki', '--read-only', 'kb', 'git', 'changed', 'sources', 'wiki', 'research', 'filter=since:6h', '--json',
    ])
  })

  it('refuses a wiki key that is not a registry-shaped key', () => {
    expect(() => cli.VERBS['wiki.status']({ wiki: '../etc' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.status']({ wiki: 'kb; rm -rf' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.status']({})).toThrow(cli.CliError)
  })

  it('refuses a since or limit outside the grammar', () => {
    expect(() => cli.VERBS['wiki.op.since']({ wiki: 'kb', since: '7w' as never })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.op.logs']({ wiki: 'kb', limit: 0 })).toThrow(cli.CliError)
  })

  it('refuses a page path that escapes the wiki or is not a page', () => {
    expect(() => cli.VERBS['wiki.page.read']({ wiki: 'kb', path: '../secret.md' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.page.read']({ wiki: 'kb', path: '/etc/passwd' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.page.read']({ wiki: 'kb', path: 'wiki/x.txt' })).toThrow(cli.CliError)
    expect(cli.VERBS['wiki.page.read']({ wiki: 'kb', path: 'wiki/reports/morning/2026-09-27.md' })).toContain(
      'wiki/reports/morning/2026-09-27.md',
    )
  })
})

describe('timeline argv', () => {
  it('bounds git log by a sha or an age, and names an op show target', () => {
    expect(cli.VERBS['wiki.git.log']({ wiki: 'kb', sha: 'abc1234' })).toEqual(['wiki', '--read-only', 'kb', 'git', 'log', 'filter=since:abc1234', '--json'])
    expect(cli.VERBS['wiki.git.log']({ wiki: 'kb' })).toContain('filter=since:30d')
    expect(cli.VERBS['wiki.op.show']({ wiki: 'kb', target: 'ccc0abd3-1f61' })).toEqual(['wiki', '--read-only', 'kb', 'op', 'show', 'ccc0abd3-1f61', '--json'])
  })
  it('refuses a sha that is not hex and a target that could read as a flag', () => {
    expect(() => cli.VERBS['wiki.git.log']({ wiki: 'kb', sha: 'HEAD~1' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.op.show']({ wiki: 'kb', target: '--all' })).toThrow(cli.CliError)
  })
})

describe('harness run argv', () => {
  const base = { wiki: 'kb', skill: 'llm-wiki:search' }
  it('spells values as key=value, omits model and effort unless chosen, and puts the question after --', () => {
    expect(cli.VERBS['wiki.harness.run']({ ...base, text: 'why?' })).toEqual([
      'wiki', 'kb', 'harness', 'run', 'sandbox=read-search', 'skill=llm-wiki:search', '--stream', '--', 'why?',
    ])
    expect(cli.VERBS['wiki.harness.run']({ ...base, agent: 'researcher', model: 'opus', effort: 'high', text: 'q' })).toEqual([
      'wiki', 'kb', 'harness', 'run', 'sandbox=read-search', 'skill=llm-wiki:search', 'agent=researcher', 'model=opus', 'effort=high', '--stream', '--', 'q',
    ])
  })
  it('is the one verb without --read-only, and never adds --json', () => {
    const argv = cli.VERBS['wiki.harness.run']({ ...base, text: 'q' })
    expect(argv).not.toContain('--read-only')
    expect(argv).not.toContain('--json')
  })
  it('refuses a flag-shaped model or agent, a skill that is not a unit name, and a dash-led or oversized question', () => {
    expect(() => cli.VERBS['wiki.harness.run']({ ...base, model: '--x', text: 'q' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.harness.run']({ ...base, agent: '--dangerously-skip-permissions', text: 'q' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.harness.run']({ ...base, skill: '../ask', text: 'q' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.harness.run']({ ...base, skill: 'a:b:c', text: 'q' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.harness.run']({ ...base, text: '--version' })).toThrow(/dash/)
    expect(() => cli.VERBS['wiki.harness.run']({ ...base, text: 'é'.repeat(4097) })).toThrow(/8192 bytes/)
    expect(cli.VERBS['wiki.harness.run']({ ...base, text: 'x'.repeat(8192) }).at(-1)).toHaveLength(8192)
  })
})

describe('stream runner', () => {
  const ask = { wiki: 'kb', skill: 'llm-wiki:search', text: 'renewals?' }
  const collect = async (gen: AsyncGenerator<import('../src/data/cli.js').StreamLine>) => {
    const out = []
    for await (const l of gen) out.push(l)
    return out
  }

  it('yields each JSON line in order, skips the rest, and ends with _exit; the child has no read floor and no DASHBOARD_ settings', async () => {
    process.env.DASHBOARD_TOKEN = 'secret-token-secret-token'
    const lines = await collect(cli.spawnRunner().stream('wiki.harness.run', ask))
    delete process.env.DASHBOARD_TOKEN
    expect(lines.map((l) => l.type)).toEqual(['start', 'tool', 'text', 'text', 'result', '_exit'])
    const result = lines[4] as unknown as { argv: string[]; permissions: string | null; leaked: string[] }
    expect(result.permissions).toBeNull()
    expect(result.leaked).toEqual([])
    expect(result.argv.slice(0, 4)).toEqual(['wiki', 'kb', 'harness', 'run'])
    expect(lines[5]).toMatchObject({ rc: 0, timedOut: false })
  })

  it('kills the child when the signal aborts', async () => {
    const pidfile = resolve(tmpdir(), `dash-fake-${process.pid}-${Date.now()}.pid`)
    process.env.FAKE_CLI_STREAM = 'hang'
    process.env.FAKE_CLI_PIDFILE = pidfile
    try {
      const stop = new AbortController()
      const seen: string[] = []
      for await (const l of cli.spawnRunner().stream('wiki.harness.run', ask, { signal: stop.signal })) {
        seen.push(l.type)
        if (seen.length === 3) stop.abort()
      }
      expect(seen.at(-1)).toBe('_exit')
      const pid = Number(readFileSync(pidfile, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      delete process.env.FAKE_CLI_STREAM
      delete process.env.FAKE_CLI_PIDFILE
      rmSync(pidfile, { force: true })
    }
  })

  it('kills the child when the reader stops early', async () => {
    const pidfile = resolve(tmpdir(), `dash-fake-${process.pid}-${Date.now()}-b.pid`)
    process.env.FAKE_CLI_STREAM = 'hang'
    process.env.FAKE_CLI_PIDFILE = pidfile
    try {
      for await (const l of cli.spawnRunner().stream('wiki.harness.run', ask)) if (l.type === 'tool') break
      const pid = Number(readFileSync(pidfile, 'utf8'))
      await expect.poll(() => { try { process.kill(pid, 0); return true } catch { return false } }).toBe(false)
    } finally {
      delete process.env.FAKE_CLI_STREAM
      delete process.env.FAKE_CLI_PIDFILE
      rmSync(pidfile, { force: true })
    }
  })

  it('reports a timeout on the _exit line', async () => {
    process.env.FAKE_CLI_STREAM = 'hang'
    try {
      const lines = await collect(cli.spawnRunner().stream('wiki.harness.run', ask, { timeoutMs: 150 }))
      expect(lines.at(-1)).toMatchObject({ type: '_exit', timedOut: true })
    } finally {
      delete process.env.FAKE_CLI_STREAM
    }
  })
})

describe('search argv', () => {
  it('puts the question after -- and each filter as filter=kind:value', () => {
    expect(cli.VERBS['wiki.search.query']({ wiki: 'kb', text: '-what about renewals?', k: 25, filters: { area: 'Customers', '-tag': 'draft', captured_from: '2026-09-01' } })).toEqual([
      'wiki', '--read-only', 'kb', 'search', 'query', 'filter=k:25', 'filter=area:Customers', 'filter=-tag:draft', 'filter=captured_from:2026-09-01', '--json', '--', '-what about renewals?',
    ])
  })
  it('refuses an unknown filter, a bad date, a multi-line value, and empty text', () => {
    expect(() => cli.VERBS['wiki.search.query']({ wiki: 'kb', text: 'x', filters: { nope: '1' } })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.search.query']({ wiki: 'kb', text: 'x', filters: { captured_to: 'yesterday' } })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.search.query']({ wiki: 'kb', text: 'x', filters: { area: 'a\nb' } })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.search.query']({ wiki: 'kb', text: '   ' })).toThrow(cli.CliError)
    expect(() => cli.VERBS['wiki.search.query']({ wiki: 'kb', text: 'x', k: 500 })).toThrow(cli.CliError)
  })
})

describe('spawnRunner', () => {
  it('runs the verb with the read floor in the environment and parses the JSON answer', async () => {
    const out = await cli.spawnRunner().run<{ argv: string[]; permissions: string | null }>('wiki.jobs.due', {
      wiki: 'kb',
    })
    expect(out.argv).toEqual(['wiki', '--read-only', 'kb', 'jobs', 'due', '--json'])
    expect(out.permissions).toBe('read')
  })

  it('turns a CLI error object into a CliError with the exit code', async () => {
    process.env.FAKE_CLI_FAIL = '1'
    try {
      await expect(cli.spawnRunner().run('machine.version')).rejects.toMatchObject({ kind: 'exit', rc: 2 })
    } finally {
      delete process.env.FAKE_CLI_FAIL
    }
  })
})
