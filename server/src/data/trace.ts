// Tails each wiki's per-day trace log so the UI learns about a run the moment
// it dispatches, without polling the CLI. The file is machine-local and
// disposable (the diagnostic tier), so reading it needs no permission the
// server does not already have.

import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TraceRow } from '@dashboard/shared/types'

export type TraceListener = (wiki: string, row: TraceRow) => void

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function tracePath(root: string, day = today()): string {
  return join(root, '.llm-wiki.local', 'runtime', 'logs', `ops-${day}.jsonl`)
}

/** Reads rows appended since `from`; returns the new offset. */
async function readFrom(path: string, from: number): Promise<{ rows: TraceRow[]; offset: number }> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return { rows: [], offset: 0 }
  }
  if (size < from) from = 0 // rotated or truncated
  if (size === from) return { rows: [], offset: from }
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(size - from)
    await fh.read(buf, 0, buf.length, from)
    const text = buf.toString('utf8')
    const lastNl = text.lastIndexOf('\n')
    const complete = lastNl === -1 ? '' : text.slice(0, lastNl + 1)
    const rows: TraceRow[] = []
    for (const line of complete.split('\n')) {
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line) as TraceRow)
      } catch {
        // a torn line; the next read gets it whole
      }
    }
    return { rows, offset: from + Buffer.byteLength(complete) }
  } finally {
    await fh.close()
  }
}

export class TraceTail {
  private watchers = new Map<string, FSWatcher>()
  private offsets = new Map<string, number>()
  private days = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly listener: TraceListener) {}

  /** Starts tailing; existing rows are skipped so a reconnect does not replay the day. */
  async add(wiki: string, root: string): Promise<void> {
    const path = tracePath(root)
    this.days.set(wiki, today())
    try {
      this.offsets.set(wiki, (await stat(path)).size)
    } catch {
      this.offsets.set(wiki, 0)
    }
    this.arm(wiki, root)
    if (!this.timer) this.timer = setInterval(() => void this.sweep(), 2000)
  }

  private arm(wiki: string, root: string): void {
    this.watchers.get(wiki)?.close()
    try {
      const w = watch(join(root, '.llm-wiki.local', 'runtime', 'logs'), () => void this.pump(wiki, root))
      w.on('error', () => undefined)
      this.watchers.set(wiki, w)
    } catch {
      // No logs dir yet; the sweep timer will pick it up when it appears.
    }
    this.roots.set(wiki, root)
  }

  private roots = new Map<string, string>()

  private async pump(wiki: string, root: string): Promise<void> {
    const day = today()
    if (this.days.get(wiki) !== day) {
      this.days.set(wiki, day)
      this.offsets.set(wiki, 0)
    }
    const { rows, offset } = await readFrom(tracePath(root, day), this.offsets.get(wiki) ?? 0)
    this.offsets.set(wiki, offset)
    for (const row of rows) this.listener(wiki, row)
  }

  private async sweep(): Promise<void> {
    for (const [wiki, root] of this.roots) {
      if (!this.watchers.has(wiki)) this.arm(wiki, root)
      await this.pump(wiki, root)
    }
  }

  close(): void {
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
