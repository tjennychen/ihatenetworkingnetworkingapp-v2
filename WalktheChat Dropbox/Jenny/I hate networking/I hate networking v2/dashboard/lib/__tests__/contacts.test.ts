import { filterContacts } from '../contacts'
import type { Contact } from '../types'

const mockContacts: Contact[] = [
  { id: '1', name: 'Alice Chen', headline: 'CEO', company: 'Startup', city: 'SF',
    linkedin_url: '', linkedin_urn: '', first_name: 'Alice', last_name: 'Chen',
    instagram_url: '', photo_url: '', luma_profile_url: '', is_host: false,
    user_id: 'u1', event_id: 'e1', created_at: '2026-01-01' },
  { id: '2', name: 'Bob Smith', headline: 'Engineer', company: 'BigCo', city: 'NYC',
    linkedin_url: '', linkedin_urn: '', first_name: 'Bob', last_name: 'Smith',
    instagram_url: '', photo_url: '', luma_profile_url: '', is_host: false,
    user_id: 'u1', event_id: 'e1', created_at: '2026-01-01' },
]

describe('filterContacts', () => {
  it('returns all contacts when query is empty', () => {
    expect(filterContacts(mockContacts, '')).toHaveLength(2)
  })
  it('filters by name case-insensitively', () => {
    expect(filterContacts(mockContacts, 'alice')).toHaveLength(1)
    expect(filterContacts(mockContacts, 'alice')[0].name).toBe('Alice Chen')
  })
  it('filters by company', () => {
    expect(filterContacts(mockContacts, 'bigco')).toHaveLength(1)
  })
  it('returns empty array when no match', () => {
    expect(filterContacts(mockContacts, 'zzz')).toHaveLength(0)
  })
})
