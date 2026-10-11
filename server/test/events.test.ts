// Which screens a traced run refreshes, read off the verb's first token.

import { describe, expect, it } from 'vitest'
import { viewsTouched } from '../src/routes/events.js'

describe('viewsTouched', () => {
  it('refreshes the work screens for a jobs, tickets or denylist verb', () => {
    for (const group of ['jobs', 'tickets', 'denylist']) expect(viewsTouched([group, 'run'])).toEqual(['today', 'new', 'fleet'])
  })
  it('refreshes the schedule screens for a tick or an op', () => {
    expect(viewsTouched(['tick'])).toEqual(['today', 'fleet', 'briefings'])
    expect(viewsTouched(['op', 'close'])).toEqual(['today', 'fleet', 'briefings'])
  })
  it('refreshes nothing for the retired groups', () => {
    expect(viewsTouched(['pipeline', 'jobs', 'ls'])).toEqual([])
    expect(viewsTouched(['schedule', 'tick'])).toEqual([])
  })
})
