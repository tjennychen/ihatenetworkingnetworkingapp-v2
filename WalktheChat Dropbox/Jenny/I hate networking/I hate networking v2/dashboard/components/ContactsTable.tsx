'use client'
import { useState } from 'react'
import { filterContacts } from '@/lib/contacts'
import type { Contact } from '@/lib/types'

const STATUS_BADGE: Record<string, string> = {
  pending:  'bg-yellow-50 text-yellow-700',
  sent:     'bg-blue-50 text-blue-700',
  accepted: 'bg-green-50 text-green-700',
  failed:   'bg-red-50 text-red-700',
}

type Props = {
  contacts: (Contact & { status?: string; events?: { name: string; city: string } })[]
}

export default function ContactsTable({ contacts }: Props) {
  const [query, setQuery] = useState('')
  const filtered = filterContacts(contacts, query)

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, company, city…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Headline</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Company</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">City</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Event</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Instagram</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No contacts yet. Use the extension on a Luma event page to import.
                </td>
              </tr>
            )}
            {filtered.map(contact => (
              <tr key={contact.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {contact.linkedin_url ? (
                    <a href={contact.linkedin_url} target="_blank" rel="noopener"
                       className="hover:text-indigo-600">{contact.name}</a>
                  ) : contact.name}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{contact.headline}</td>
                <td className="px-4 py-3 text-gray-600">{contact.company}</td>
                <td className="px-4 py-3 text-gray-600">{contact.city}</td>
                <td className="px-4 py-3 text-gray-600">{contact.events?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  {contact.status && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[contact.status] ?? ''}`}>
                      {contact.status}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {contact.instagram_url
                    ? <a href={contact.instagram_url} target="_blank" rel="noopener"
                         className="hover:text-indigo-600">@{contact.instagram_url.split('/').filter(Boolean).pop()}</a>
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">{filtered.length} contacts</p>
    </div>
  )
}
