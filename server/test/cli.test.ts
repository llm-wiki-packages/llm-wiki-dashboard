// The CLI seam: argv spellings are fixed, arguments are validated, and every
// child runs under the read floor. The runner tests use test/fake-cli.mjs in
// place of llm-wiki-cli, wired through the config's DASHBOARD_CLI.

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
    const out = await cli.spawnRunner().run<{ argv: string[]; permissions: string | null }>('wiki.pipeline.due', {
      wiki: 'kb',
    })
    expect(out.argv).toEqual(['wiki', '--read-only', 'kb', 'pipeline', 'due', '--json'])
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
