// A briefing's head: the lede and the few items it says are worth attention,
// for Today's hero. A report that states them in frontmatter (`lede`,
// `attention: [{title, detail, source}]`) is read as written; otherwise the
// first `# ` heading is the lede and the list under a "Worth your attention"
// heading gives the items, each written `**Title.** detail *(source)*`.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Attention, BriefingHead } from '@dashboard/shared/types'
import { FM, parseFrontmatter } from './pages.js'

const MAX_ITEMS = 3
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function briefingHead(fm: Record<string, unknown> | null, body: string): BriefingHead | undefined {
  const fmItems = Array.isArray(fm?.attention)
    ? (fm.attention as unknown[])
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
        .map((x) => ({ title: str(x.title) ?? '', detail: str(x.detail) ?? '', source: str(x.source) }))
        .filter((x) => x.title)
    : []
  const lede = str(fm?.lede) ?? /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? ''
  const items = fmItems.length ? fmItems : attentionList(body)
  if (!lede && !items.length) return undefined
  return { lede, items: items.slice(0, MAX_ITEMS) }
}

function attentionList(body: string): BriefingHead['items'] {
  const lines = body.split(/\r?\n/)
  const at = lines.findIndex((l) => /^#{2,3}\s+.*worth your attention/i.test(l))
  if (at < 0) return []
  const out: BriefingHead['items'] = []
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(line)
    if (!m?.[1]) continue
    let text = m[1].trim()
    let source: string | undefined
    const src = /\s*\*?\(([^()]+)\)\*?\s*$/.exec(text)
    if (src) {
      source = src[1]?.trim()
      text = text.slice(0, src.index).trim()
    }
    const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text)
    const title = (bold?.[1] ?? text.split(/(?<=\.)\s/)[0] ?? text).replace(/[.:]\s*$/, '').trim()
    const detail = (bold ? bold[2] : text.slice(title.length).replace(/^[.:]\s*/, '')) ?? ''
    out.push({ title, detail: detail.trim(), source })
  }
  return out
}

const SEVERITY = new Set(['info', 'attention', 'failing'])

/**
 * The attention list a report states in frontmatter:
 * `attention: [{title, detail, severity, source, page, action}]`. Items with
 * no title are dropped; an unknown severity reads as `attention`.
 */
export function reportAttention(fm: Record<string, unknown> | null): Attention[] {
  if (!Array.isArray(fm?.attention)) return []
  return (fm.attention as unknown[]).flatMap((raw, i) => {
    const x = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const title = str(x.title)
    if (!title) return []
    const sev = str(x.severity) ?? 'attention'
    const page = str(x.page)
    return [
      {
        id: `report-${i}`,
        title,
        detail: str(x.detail) ?? '',
        severity: (SEVERITY.has(sev) ? sev : 'attention') as Attention['severity'],
        fromReport: true,
        next: str(x.action),
        page: page && /^(wiki|sources|research)\/.+\.md$/.test(page) && !page.includes('..') ? page : undefined,
        source: str(x.source),
      },
    ]
  })
}

/**
 * The report's items first, then what the dashboard found that the report
 * did not name: an item is named when its title or source mentions the
 * thing the found item is about.
 */
export function mergeAttention(fromReport: Attention[], found: Attention[], subjectOf: (a: Attention) => string): Attention[] {
  const said = fromReport.map((a) => `${a.title} ${a.source ?? ''} ${a.detail}`.toLowerCase())
  const rest = found.filter((a) => {
    const subject = subjectOf(a).toLowerCase()
    return !subject || !said.some((s) => s.includes(subject))
  })
  return [...fromReport, ...rest]
}

export interface ReportRead {
  head?: BriefingHead
  attention: Attention[]
}

/** A report page on disk: its head and its stated attention list. */
export async function readReport(root: string, rel: string): Promise<ReportRead> {
  try {
    const text = await readFile(join(root, rel), 'utf8')
    const fm = parseFrontmatter(text)
    return { head: briefingHead(fm, text.replace(FM, '')), attention: reportAttention(fm) }
  } catch {
    return { attention: [] }
  }
}

/** The head of a report page on disk, or undefined when it has none. */
export async function readHead(root: string, rel: string): Promise<BriefingHead | undefined> {
  return (await readReport(root, rel)).head
}
