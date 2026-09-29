import { describe, expect, it } from 'vitest'
import { startingLabel, toolDetail } from './askStream'

describe('startingLabel', () => {
  it('is brief at first and says so plainly once the start has gone quiet', () => {
    expect(startingLabel(3)).toBe('Starting a session…')
    expect(startingLabel(19)).toBe('Starting a session…')
    expect(startingLabel(20)).toMatch(/^Still starting…/)
    expect(startingLabel(95)).toMatch(/95s/)
  })
})

describe('toolDetail', () => {
  it('shows the step description, then the command, and falls back to the raw text', () => {
    expect(toolDetail('{"command": "llm-wiki-ops search query x", "description": "Search wiki for offers"}')).toBe('Search wiki for offers')
    expect(toolDetail('{"command": "llm-wiki-ops policy get search"}')).toBe('llm-wiki-ops policy get search')
    expect(toolDetail('{"command": "llm-wiki-ops whereami skill=llm-wiki:sea')).toBe('llm-wiki-ops whereami skill=llm-wiki:sea')
    expect(toolDetail('{"command": "echo \\"hi\\" && ls')).toBe('echo "hi" && ls')
    expect(toolDetail('{"broken')).toBe('{"broken')
    expect(toolDetail('where do renewals stand?')).toBe('where do renewals stand?')
    expect(toolDetail(undefined)).toBeUndefined()
  })
})
