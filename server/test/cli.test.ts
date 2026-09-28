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
