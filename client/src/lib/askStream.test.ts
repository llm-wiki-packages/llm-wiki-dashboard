import { describe, expect, it } from 'vitest'
import { startingLabel } from './askStream'

describe('startingLabel', () => {
  it('is brief at first and says so plainly once the start has gone quiet', () => {
    expect(startingLabel(3)).toBe('Starting a session…')
    expect(startingLabel(19)).toBe('Starting a session…')
    expect(startingLabel(20)).toMatch(/^Still starting…/)
    expect(startingLabel(95)).toMatch(/95s/)
  })
})
