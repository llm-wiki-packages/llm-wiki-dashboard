// Page frontmatter, read straight off the wiki tree. The CLI answers which
// files changed; this reads only those, so a wiki of ten thousand pages costs
// what today's changes cost. Read-only by construction: nothing here opens a
// file for writing.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface PageMeta {
  rel: string
  title: string
  type?: string
  status?: string
  description?: string
  resource?: string
  host?: string
  author?: string
  channel?: string
  group?: string
  groupType?: string
  areas: string[]
  tags: string[]
  job?: string
  generated?: { by?: string; at?: string; stage?: string }
  harvested?: { at?: string; by?: string; machine?: string }
  extracted?: string
  media?: string
  documentId?: string
  documentRevision?: number
  sources?: Array<{ resource?: string; id?: string; title?: string }>
}

export const FM = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function parseFrontmatter(text: string): Record<string, unknown> | null {
  const m = FM.exec(text)
  if (!m) return null
  try {
    const doc = parseYaml(m[1] ?? '')
    return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `[[Sales & Offers]]` and `Sales & Offers` are the same area. */
export function bareName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().replace(/^\[\[/, '').replace(/\]\]$/, '')
  return s || undefined
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(bareName).filter((s): s is string => Boolean(s))
  const one = bareName(v)
  return one ? [one] : []
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function hostOf(resource?: string): string | undefined {
  if (!resource) return undefined
  try {
    return new URL(resource).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function toMeta(rel: string, fm: Record<string, unknown>): PageMeta {
  const resource = str(fm.resource)
  const gen = fm.generated as Record<string, unknown> | undefined
  const harv = fm.harvested as Record<string, unknown> | undefined
  const hosts = fm.source_host
  return {
    rel,
    title: str(fm.title) ?? rel.split('/').pop()?.replace(/\.md$/, '') ?? rel,
    type: str(fm.type),
    status: str(fm.status),
    description: str(fm.description),
    resource,
    host: (Array.isArray(hosts) ? str(hosts[0]) : str(hosts)) ?? hostOf(resource),
    author: str(fm.author),
    channel: str(fm.channel),
    group: str(fm.group),
    groupType: str(fm.group_type),
    areas: list(fm.areas),
    tags: list(fm.tags),
    job: str(fm.job),
    generated: gen ? { by: str(gen.by), at: str(gen.at), stage: str(gen.stage) } : undefined,
    harvested: harv ? { at: str(harv.at), by: str(harv.by), machine: str(harv.machine) } : undefined,
    extracted: typeof fm.extracted === 'boolean' ? String(fm.extracted) : str(fm.extracted),
    media: str(fm.media),
    documentId: str(fm.document_id),
    documentRevision: typeof fm.document_revision === 'number' ? fm.document_revision : undefined,
    sources: Array.isArray(fm.sources)
      ? (fm.sources as Array<Record<string, unknown>>).map((s) => ({
          resource: str(s?.resource),
          id: str(s?.id),
          title: str(s?.title),
        }))
      : undefined,
  }
}

const SKIP = /(^|\/)(_versions|_archive|_raw|assets|node_modules|\.llm-wiki\.local|\.git)(\/|$)/

const RESERVED = /(^|\/)(index|log)\.md$/

/** A content page: markdown, outside the machinery dirs, and not a reserved index or log. */
export function isPage(rel: string): boolean {
  return rel.endsWith('.md') && !SKIP.test(rel) && !RESERVED.test(rel)
}

/** Reads the frontmatter of each named page; pages that fail to read are skipped, not fatal. */
export async function readPages(root: string, rels: string[]): Promise<PageMeta[]> {
  const out: PageMeta[] = []
  await Promise.all(
    rels.filter(isPage).map(async (rel) => {
      try {
        const text = await readFile(join(root, rel), 'utf8')
        const fm = parseFrontmatter(text)
        if (fm) out.push(toMeta(rel, fm))
      } catch {
        // A page deleted between `git changed` and here is not news.
      }
    }),
  )
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** The body after the frontmatter, for the briefing route. */
export async function readBody(root: string, rel: string): Promise<{ meta: PageMeta; body: string } | null> {
  if (!isPage(rel)) return null
  try {
    const text = await readFile(join(root, rel), 'utf8')
    const fm = parseFrontmatter(text) ?? {}
    return { meta: toMeta(rel, fm), body: text.replace(FM, '') }
  } catch {
    return null
  }
}
