// One streamed answer. A question starts only when the person presses Ask
// (never on mount, so a reload or StrictMode never starts a second session),
// leaving the page aborts the fetch and the server kills the session, and a
// finished answer is kept in the query cache so the same question shows again
// without running until "Ask again".

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AskAnswer, AskEvent, AskRequest } from '@dashboard/shared/types'
import { apiError } from './api'
import { readSse } from './sse'

export interface AskRun {
  state: 'idle' | 'streaming' | 'done' | 'error'
  req?: AskRequest
  /** The answer as it has arrived. */
  text: string
  /** The latest step the agent reported. */
  tool?: { name: string; detail?: string }
  answer?: AskAnswer
  error?: unknown
  startedAt?: number
}

/** What the status line says before the session has reported a step. A silent start (a login, a slow network route, retries) should not look hung or dead. */
export function startingLabel(elapsedS: number): string {
  if (elapsedS < 20) return 'Starting a session…'
  return `Still starting… the session has not reported a step in ${elapsedS}s. Stop it if this looks stuck`
}

/** A step's detail, as one readable line. The CLI relays a tool's input as JSON text; its own description of the step reads best, then the command, path or query. It is the agent's text, so it is only ever shown as text. */
export function toolDetail(detail: string | undefined): string | undefined {
  const raw = detail?.trim()
  if (!raw) return undefined
  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>
      for (const k of ['description', 'command', 'file_path', 'path', 'pattern', 'query', 'url']) {
        const v = j[k]
        if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200)
      }
    } catch {
      // The CLI caps a detail at 200 characters, so a long command arrives cut off mid-string:
      // take the first key that has opened, whether or not its quote has closed.
      for (const k of ['description', 'command', 'file_path', 'path', 'pattern', 'query', 'url']) {
        const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(raw)
        if (m?.[1]?.trim()) return m[1].replace(/\\(["\\/])/g, '$1').trim().slice(0, 200)
      }
    }
  }
  return raw.slice(0, 200)
}

export const askKey = (key: string, r: AskRequest) => ['wiki', key, 'ask', r.q, r.model ?? '', r.effort ?? '', r.skill, r.agent ?? '']

export function useAskStream(key: string) {
  const qc = useQueryClient()
  const [run, setRun] = useState<AskRun>({ state: 'idle', text: '' })
  const ctl = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    ctl.current?.abort()
    ctl.current = null
  }, [])
  useEffect(() => stop, [stop])

  /** A finished answer for this request, if one was kept. */
  const cached = useCallback((req: AskRequest) => qc.getQueryData<AskAnswer>(askKey(key, req)), [qc, key])

  const ask = useCallback(
    async (req: AskRequest, again = false) => {
      stop()
      const hit = again ? undefined : cached(req)
      if (hit) return setRun({ state: 'done', req, text: hit.answer, answer: hit })
      const c = new AbortController()
      ctl.current = c
      const startedAt = Date.now()
      setRun({ state: 'streaming', req, text: '', startedAt })
      // Text deltas arrive many to a second; paint them at most every 50ms.
      let text = ''
      let flush: ReturnType<typeof setTimeout> | null = null
      const paint = () => {
        flush = null
        if (!c.signal.aborted) setRun((r) => (r.req === req ? { ...r, text } : r))
      }
      try {
        const res = await fetch(`/api/wikis/${key}/ask`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
          signal: c.signal,
        })
        if (!res.ok || !res.body) throw await apiError(res)
        for await (const m of readSse(res.body)) {
          if (c.signal.aborted) return
          const ev = JSON.parse(m.data) as AskEvent
          if (ev.type === 'text') {
            text += ev.text
            flush ??= setTimeout(paint, 50)
          } else if (ev.type === 'tool') setRun((r) => ({ ...r, tool: { name: ev.name, detail: ev.detail } }))
          else if (ev.type === 'result') {
            const { type: _t, ...answer } = ev
            qc.setQueryData(askKey(key, req), answer)
            setRun((r) => ({ ...r, state: 'done', text: answer.answer, answer }))
            return
          } else if (ev.type === 'error') {
            setRun((r) => ({ ...r, state: 'error', text, error: new Error(ev.message) }))
            return
          }
        }
        if (!c.signal.aborted) setRun((r) => ({ ...r, state: 'error', text, error: new Error('The answer stopped before it finished') }))
      } catch (e) {
        if (!c.signal.aborted) setRun((r) => ({ ...r, state: 'error', text, error: e }))
      } finally {
        if (flush) clearTimeout(flush)
        if (ctl.current === c) ctl.current = null
      }
    },
    [key, qc, stop, cached],
  )

  const cancel = useCallback(() => {
    stop()
    setRun((r) => (r.state === 'streaming' ? { ...r, state: 'idle' } : r))
  }, [stop])

  return { run, ask, cancel, cached }
}
