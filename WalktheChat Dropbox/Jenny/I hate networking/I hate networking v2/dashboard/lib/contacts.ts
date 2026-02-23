import type { Contact } from './types'

export function filterContacts<T extends Contact>(contacts: T[], query: string): T[] {
  if (!query.trim()) return contacts
  const q = query.toLowerCase()
  return contacts.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.headline.toLowerCase().includes(q) ||
    c.company.toLowerCase().includes(q) ||
    c.city.toLowerCase().includes(q)
  )
}
