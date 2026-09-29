import { describe, expect, it } from 'vitest'
import { wikilinkTarget, withWikilinks } from './wikilinks'

describe('withWikilinks', () => {
  it('carries the cited title with the target, so a stem many pages share can be told apart', () => {
    const md = withWikilinks('See [[_index|Offers — Course Index]] and [[Sales playbook › Packaging]].')
    const hrefs = [...md.matchAll(/\]\((wikilink:[^)]+)\)/g)].map((m) => wikilinkTarget(m[1]))
    expect(hrefs).toEqual(['_index|Offers — Course Index', 'Sales playbook › Packaging'])
  })
})
