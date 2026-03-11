// Minimal chrome mock
;(global as any).chrome = {
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  runtime: { onMessage: { addListener: jest.fn() } }
}

import { buildTrace } from '../content/linkedin'

describe('buildTrace', () => {
  it('records a single field', () => {
    const t = buildTrace()
    t.set('connectBtn', 'null')
    expect(t.toString()).toBe('connectBtn=null')
  })

  it('records multiple fields in order', () => {
    const t = buildTrace()
    t.set('connectBtn', 'aria')
    t.set('modal', 'yes')
    t.set('shadowBtn', 'null')
    expect(t.toString()).toBe('connectBtn=aria|modal=yes|shadowBtn=null')
  })

  it('returns empty string for empty trace', () => {
    const t = buildTrace()
    expect(t.toString()).toBe('')
  })
})
