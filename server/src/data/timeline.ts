// The replay timeline: every commit a wiki made, with the paths each touched,
// kept in SQLite so a day can be replayed without asking git again. Commits
// never change, so the cache only grows: `git log` since the last head fills
// new commits, and `op show <session>` fills a session's paths the first time
// a replayed day needs them. Everything here reads through the CLI seam.

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config/index.js'
import { CliError, type Runner, type Since } from './cli.js'

export interface CommitRow {
  sha: string
  /** UTC ISO, so string order is time order. */
  at: string
  subject: string
  op: string
  outcome: string
  actor: string
  session: string
  marker: string
}

/** One op run: it opens at its marker commit and closes at the commit that records the outcome. */
export interface RunRow {
  op: string
  outcome: string
  summary: string
  start: string
  end: string
  machine?: string
}

export interface DayRecord {
  date: string
  start: string
  end: string
  commits: CommitRow[]
  runs: RunRow[]
  /** Each path a commit that day touched, at that commit's time, oldest first. */
  paths: Array<{ at: string; path: string; sha: string }>
}

interface GitLogAnswer {
  commits: Array<Partial<Omit<CommitRow, 'at'>> & { sha: string; at: string }>
  _cmd_?: { head?: string | null }
}
interface OpShowAnswer {
  commits: Array<{ commit: string; paths?: string[] }>
}

const SCHEMA = 1

export class TimelineStore {
  readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    const v = (this.db.prepare('pragma user_version').get() as { user_version: number }).user_version
    if (v !== SCHEMA) {
      this.db.exec(`
        drop table if exists commits; drop table if exists paths; drop table if exists cursor;
        create table commits (
          wiki text not null, sha text not null, at text not null, subject text not null,
          op text not null, outcome text not null, actor text not null, session text not null,
          marker text not null, paths_known integer not null default 0,
          primary key (wiki, sha)
        );
        create index commits_at on commits (wiki, at);
        create table paths (wiki text not null, sha text not null, path text not null, primary key (wiki, sha, path));
        create table cursor (wiki text primary key, head text not null);
        pragma user_version = ${SCHEMA};
      `)
    }
  }

  cursor(wiki: string): string | null {
    const row = this.db.prepare('select head from cursor where wiki = ?').get(wiki) as { head: string } | undefined
    return row?.head ?? null
  }

  setCursor(wiki: string, head: string): void {
    this.db.prepare('insert into cursor (wiki, head) values (?, ?) on conflict (wiki) do update set head = excluded.head').run(wiki, head)
  }

  forget(wiki: string): void {
    for (const t of ['commits', 'paths', 'cursor']) this.db.prepare(`delete from ${t} where wiki = ?`).run(wiki)
  }

  addCommits(wiki: string, rows: CommitRow[]): void {
    const ins = this.db.prepare(
      'insert or ignore into commits (wiki, sha, at, subject, op, outcome, actor, session, marker) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    this.db.exec('begin')
    try {
      for (const r of rows) ins.run(wiki, r.sha, r.at, r.subject, r.op, r.outcome, r.actor, r.session, r.marker)
      this.db.exec('commit')
    } catch (e) {
      this.db.exec('rollback')
      throw e
    }
  }

  commitsBetween(wiki: string, start: string, end: string): CommitRow[] {
    return this.db
      .prepare('select sha, at, subject, op, outcome, actor, session, marker from commits where wiki = ? and at >= ? and at < ? order by at, sha')
      .all(wiki, start, end) as unknown as CommitRow[]
  }

  commitAt(wiki: string, sha: string): string | null {
    const row = this.db.prepare('select at from commits where wiki = ? and sha = ?').get(wiki, sha) as { at: string } | undefined
    return row?.at ?? null
  }

  sessionsNeedingPaths(wiki: string, start: string, end: string): string[] {
    const rows = this.db
      .prepare("select distinct session from commits where wiki = ? and at >= ? and at < ? and session != '' and paths_known = 0")
      .all(wiki, start, end) as Array<{ session: string }>
    return rows.map((r) => r.session)
  }

  addPaths(wiki: string, session: string, commits: Array<{ sha: string; paths: string[] }>): void {
    const ins = this.db.prepare('insert or ignore into paths (wiki, sha, path) values (?, ?, ?)')
    this.db.exec('begin')
    try {
      for (const c of commits) for (const p of c.paths) ins.run(wiki, c.sha, p)
      this.db.prepare('update commits set paths_known = 1 where wiki = ? and session = ?').run(wiki, session)
      this.db.exec('commit')
    } catch (e) {
      this.db.exec('rollback')
      throw e
    }
  }

  pathsBetween(wiki: string, start: string, end: string): DayRecord['paths'] {
    return this.db
      .prepare(
        'select c.at as at, p.path as path, c.sha as sha from paths p join commits c on c.wiki = p.wiki and c.sha = p.sha where p.wiki = ? and c.at >= ? and c.at < ? order by c.at, p.path',
      )
      .all(wiki, start, end) as unknown as DayRecord['paths']
  }

  /** Commit counts per local day, for the day picker. */
  commitTimes(wiki: string, since: string): string[] {
    const rows = this.db.prepare('select at from commits where wiki = ? and at >= ? order by at desc').all(wiki, since) as Array<{ at: string }>
    return rows.map((r) => r.at)
  }
}

/** The store file under the state dir, or an in-process one when the dir cannot be made. */
export function openStore(): TimelineStore {
  if (config.stateDir === ':memory:') return new TimelineStore(':memory:')
  try {
    // Only when missing: a jail that grants the dir itself refuses a walk up its parents.
    if (!existsSync(config.stateDir)) mkdirSync(config.stateDir, { recursive: true })
    return new TimelineStore(join(config.stateDir, 'dashboard.db'))
  } catch (e) {
    console.warn(`[timeline] ${config.stateDir} is not writable, keeping the timeline in memory: ${(e as Error).message}`)
    return new TimelineStore(':memory:')
  }
}

/** `2026-09-26` → the local day's bounds as UTC ISO. */
export function dayBounds(date: string): { start: string; end: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** The local date an instant falls on, as YYYY-MM-DD. */
export function localDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export class Timeline {
  private synced = new Map<string, { at: number; p: Promise<void> }>()

  constructor(
    private readonly cli: Runner,
    readonly store: TimelineStore,
    private readonly days = config.replayDays,
  ) {}

  /** New commits since the last head; the whole window on first sight or when history was rewritten. */
  sync(wiki: string): Promise<void> {
    const hit = this.synced.get(wiki)
    if (hit && Date.now() - hit.at < config.cacheMs) return hit.p
    const p = this.fill(wiki).catch((e: unknown) => {
      this.synced.delete(wiki)
      throw e
    })
    this.synced.set(wiki, { at: Date.now(), p })
    return p
  }

  private async fill(wiki: string): Promise<void> {
    const head = this.store.cursor(wiki)
    let ans: GitLogAnswer
    try {
      ans = head
        ? await this.cli.run<GitLogAnswer>('wiki.git.log', { wiki, sha: head })
        : await this.cli.run<GitLogAnswer>('wiki.git.log', { wiki, since: `${this.days}d` as Since })
    } catch (e) {
      // The remembered head is gone (a rewrite): start the window over.
      if (!head || !(e instanceof CliError) || e.kind !== 'exit') throw e
      this.store.forget(wiki)
      ans = await this.cli.run<GitLogAnswer>('wiki.git.log', { wiki, since: `${this.days}d` as Since })
    }
    this.store.addCommits(
      wiki,
      ans.commits.map((c) => ({
        sha: c.sha,
        at: new Date(c.at).toISOString(),
        subject: c.subject ?? '',
        op: c.op ?? '',
        outcome: c.outcome ?? '',
        actor: c.actor ?? '',
        session: c.session ?? '',
        marker: c.marker ?? '',
      })),
    )
    const newHead = ans._cmd_?.head ?? ans.commits[0]?.sha
    if (newHead) this.store.setCursor(wiki, newHead)
  }

  async recordedDays(wiki: string): Promise<Array<{ date: string; commits: number }>> {
    await this.sync(wiki)
    const since = new Date(Date.now() - this.days * 86_400_000).toISOString()
    const byDay = new Map<string, number>()
    for (const at of this.store.commitTimes(wiki, since)) {
      const d = localDate(at)
      byDay.set(d, (byDay.get(d) ?? 0) + 1)
    }
    return [...byDay.entries()].map(([date, commits]) => ({ date, commits }))
  }

  async day(wiki: string, date: string): Promise<DayRecord> {
    await this.sync(wiki)
    const { start, end } = dayBounds(date)
    const need = this.store.sessionsNeedingPaths(wiki, start, end)
    await pool(need, 3, async (session) => {
      try {
        const ans = await this.cli.run<OpShowAnswer>('wiki.op.show', { wiki, target: session })
        this.store.addPaths(wiki, session, ans.commits.map((c) => ({ sha: c.commit, paths: c.paths ?? [] })))
      } catch (e) {
        // A session the CLI cannot show is remembered as pathless, not asked again every replay.
        if (config.logLevel === 'debug') console.warn(`[timeline] op show ${session}: ${(e as Error).message}`)
        this.store.addPaths(wiki, session, [])
      }
    })
    const commits = this.store.commitsBetween(wiki, start, end)
    const runs: RunRow[] = commits
      .filter((c) => c.outcome)
      .map((c) => {
        const opened = c.marker ? this.store.commitAt(wiki, c.marker) : null
        return {
          op: c.op,
          outcome: c.outcome,
          summary: c.subject,
          start: opened && opened <= c.at ? opened : c.at,
          end: c.at,
          machine: c.actor.split('@')[1],
        }
      })
    return { date, start, end, commits, runs, paths: this.store.pathsBetween(wiki, start, end) }
  }
}

async function pool<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async () => {
    while (i < items.length) await fn(items[i++] as T)
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
}
