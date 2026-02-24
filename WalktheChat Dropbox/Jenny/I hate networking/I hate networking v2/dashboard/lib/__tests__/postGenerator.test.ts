import { buildPostPrompt } from '../postGenerator'

describe('buildPostPrompt', () => {
  it('includes host names', () => {
    const prompt = buildPostPrompt({ hostNames: ['Jenny Lee'], guestNames: [], eventName: 'Test Event' })
    expect(prompt).toContain('Jenny Lee')
  })
  it('includes event name', () => {
    const prompt = buildPostPrompt({ hostNames: ['Jenny'], guestNames: [], eventName: 'Founder Summit' })
    expect(prompt).toContain('Founder Summit')
  })
  it('includes guest names', () => {
    const prompt = buildPostPrompt({ hostNames: ['Jenny'], guestNames: ['Alice', 'Bob'], eventName: 'Test' })
    expect(prompt).toContain('Alice')
    expect(prompt).toContain('Bob')
  })
})
