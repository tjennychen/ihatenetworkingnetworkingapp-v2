import { checkDailyLimit } from '../lib/rate-limiter'

describe('checkDailyLimit', () => {
  it('returns canSend=true when count is below 25', () => {
    expect(checkDailyLimit(24)).toEqual({ canSend: true, remaining: 1 })
  })
  it('returns canSend=false when count is 25', () => {
    expect(checkDailyLimit(25)).toEqual({ canSend: false, remaining: 0 })
  })
  it('returns canSend=false when count exceeds 25', () => {
    expect(checkDailyLimit(26)).toEqual({ canSend: false, remaining: 0 })
  })
  it('returns full remaining when count is 0', () => {
    expect(checkDailyLimit(0)).toEqual({ canSend: true, remaining: 25 })
  })
})
