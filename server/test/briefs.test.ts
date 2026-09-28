// A briefing's head comes from frontmatter when the report states it, and
// otherwise from its first heading and its "worth your attention" list.

import { describe, expect, it } from 'vitest'
import { briefingHead, mergeAttention, reportAttention } from '../src/data/briefs.js'

const body = `# Renewals are the theme this week.

## Worth your attention

1. **Two clients asked about renewal terms.** Northwind and Contoso, a day apart. *(Gmail · clients)*
2. **Rival raised its Team tier 12%.** One paragraph changed. *(Site watch · rival.com)*
3. A plain item with no bold. It still counts.
4. **A fourth item.** Past the cap.

## Customers

- not an attention item
`

describe('briefingHead', () => {
  it('reads the lede and up to three items, each with its source', () => {
    const head = briefingHead(null, body)
    expect(head?.lede).toBe('Renewals are the theme this week.')
    expect(head?.items).toEqual([
      { title: 'Two clients asked about renewal terms', detail: 'Northwind and Contoso, a day apart.', source: 'Gmail · clients' },
      { title: 'Rival raised its Team tier 12%', detail: 'One paragraph changed.', source: 'Site watch · rival.com' },
      { title: 'A plain item with no bold', detail: 'It still counts.', source: undefined },
    ])
  })

  it('prefers what the frontmatter states', () => {
    const head = briefingHead({ lede: 'Stated lede', attention: [{ title: 'One', detail: 'why', source: 'x' }, { detail: 'no title' }] }, body)
    expect(head).toEqual({ lede: 'Stated lede', items: [{ title: 'One', detail: 'why', source: 'x' }] })
  })

  it('has no head for a page with neither', () => {
    expect(briefingHead(null, 'just text')).toBeUndefined()
  })
})

describe('report attention', () => {
  const fm = {
    attention: [
      { title: "Northwind's questionnaire is due 10 Oct", detail: '8 of 22 changed', severity: 'attention', source: 'Gmail · clients', page: 'wiki/security/q.md', action: 'Send the 14 today' },
      { title: 'Odd severity', severity: 'urgent', page: '../etc/passwd.md' },
      { detail: 'no title' },
    ],
  }

  it('reads each titled item, clamps severity, and keeps only a wiki page path', () => {
    const items = reportAttention(fm)
    expect(items.map((a) => a.title)).toEqual(["Northwind's questionnaire is due 10 Oct", 'Odd severity'])
    expect(items[0]).toMatchObject({ fromReport: true, next: 'Send the 14 today', page: 'wiki/security/q.md' })
    expect(items[1]).toMatchObject({ severity: 'attention', page: undefined })
  })

  it('puts the report first and drops what it already named', () => {
    const found = [
      { id: 'blocked-gmail', title: "Gmail can't be fetched", detail: '', severity: 'attention' as const, source: 'Gmail · clients' },
      { id: 'blocked-hubspot', title: "HubSpot can't be fetched", detail: '', severity: 'attention' as const, source: 'HubSpot · pages' },
    ]
    const merged = mergeAttention(reportAttention(fm), found, (a) => a.source ?? '')
    expect(merged.map((a) => a.id)).toEqual(['report-0', 'report-1', 'blocked-hubspot'])
  })
})
