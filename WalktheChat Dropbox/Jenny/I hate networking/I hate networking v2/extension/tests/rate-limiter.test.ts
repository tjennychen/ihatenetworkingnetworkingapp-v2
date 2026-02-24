import { checkDailyLimit } from '../lib/rate-limiter'

describe('checkDailyLimit', () => {
  it('returns canSend=true when count is below 40', () => {
    expect(checkDailyLimit(39)).toEqual({ canSend: true, remaining: 1 })
  })
  it('returns canSend=false when count is 40', () => {
    expect(checkDailyLimit(40)).toEqual({ canSend: false, remaining: 0 })
  })
  it('returns canSend=false when count exceeds 40', () => {
    expect(checkDailyLimit(41)).toEqual({ canSend: false, remaining: 0 })
  })
  it('returns full remaining when count is 0', () => {
    expect(checkDailyLimit(0)).toEqual({ canSend: true, remaining: 40 })
  })
})
