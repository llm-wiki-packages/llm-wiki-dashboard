import { describe, expect, it } from 'vitest'
import { readSse, settledMarkdown } from './sse'

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

describe('readSse', () => {
  it('reassembles events split across chunks and skips comments', async () => {
    const got = []
    for await (const m of readSse(body(['event: start\ndata: {"type":"st', 'art"}\n\n: keep-alive\n\nevent: text\r\ndata: {"type":"text","text":"hi"}\r\n\r\n'])))
      got.push(m)
    expect(got).toEqual([
      { event: 'start', data: '{"type":"start"}' },
      { event: 'text', data: '{"type":"text","text":"hi"}' },
    ])
  })
})

describe('settledMarkdown', () => {
  it('holds back a link that has not closed yet', () => {
    expect(settledMarkdown('See [[Security › Quest')).toBe('See ')
    expect(settledMarkdown('See [[Security]')).toBe('See ')
    expect(settledMarkdown('See [[Security]] and more')).toBe('See [[Security]] and more')
  })
})
