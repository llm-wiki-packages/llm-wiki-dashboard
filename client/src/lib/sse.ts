// Server-sent events over a fetch body. EventSource cannot POST, and an
// answer starts a session, so the Ask stream is read by hand: blocks split on
// a blank line, `event:` and `data:` fields, `:` comments skipped.

export interface SseMessage {
  event: string
  data: string
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n?/g, '\n')
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const msg = parseBlock(buf.slice(0, i))
        buf = buf.slice(i + 2)
        if (msg) yield msg
      }
    }
    const last = parseBlock(buf)
    if (last) yield last
  } finally {
    reader.releaseLock()
  }
}

export function parseBlock(block: string): SseMessage | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const at = line.indexOf(':')
    const field = at < 0 ? line : line.slice(0, at)
    const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length ? { event, data: data.join('\n') } : null
}

/** A streamed answer's tail may end inside a `[[link`; hold that part back until it closes. */
export function settledMarkdown(text: string): string {
  return text.replace(/\[\[[^\]\n]*\]?$/, '')
}
