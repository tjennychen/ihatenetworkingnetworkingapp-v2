'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

type QueueItem = { status: string; error: string | null }
type Contact = { id: string; name: string | null; headline: string | null; connection_queue: QueueItem[] }
type Event = { id: string; name: string | null; city: string | null; contacts: Contact[] }

const FAILURE_REASONS = [
  'Already connected',
  'Request already pending',
  '3rd-degree — add not available',
  "Couldn't open LinkedIn profile",
]

function StatusDot({ queue }: { queue: QueueItem[] }) {
  const latest = queue[0]
  if (!latest) return null

  if (latest.status === 'sent' || latest.status === 'accepted') {
    return <span className="text-green-500 text-xs" title="Sent">●</span>
  }

  if (latest.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-0.5">
        <span className="text-red-500 text-xs">●</span>
        <span className="relative group cursor-default">
          <span className="text-xs text-red-400 font-medium">?</span>
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-52 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 z-10 shadow-lg whitespace-nowrap">
            <span className="block font-medium mb-1 text-gray-300">Possible reasons:</span>
            {FAILURE_REASONS.map(r => (
              <span key={r} className="block">· {r}</span>
            ))}
          </span>
        </span>
      </span>
    )
  }

  return null
}

export default function CampaignsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('events')
      .select('id, name, city, contacts(id, name, headline, connection_queue(status, error))')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEvents((data as Event[]) ?? [])
        setLoading(false)
      })
  }, [])

  function toggle(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading...</p>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Contacts</h1>
      <p className="text-sm text-gray-500 mb-6">People you've met at events.</p>

      {events.length === 0 ? (
        <p className="text-sm text-gray-400">No events yet. Import contacts from a Luma event to get started.</p>
      ) : (
        <div className="space-y-2">
          {events.map(event => {
            const isOpen = expandedIds.has(event.id)
            const count = event.contacts.length

            return (
              <div key={event.id} className="border border-gray-100 rounded-xl overflow-hidden bg-white">
                {/* Header row */}
                <button
                  onClick={() => toggle(event.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{event.name || 'Untitled event'}</p>
                    {event.city && <p className="text-xs text-gray-400">{event.city}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{count} contact{count !== 1 ? 's' : ''}</span>
                    <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded contact list */}
                {isOpen && (
                  <div className="border-t border-gray-100">
                    {/* Legend */}
                    <div className="px-4 py-2 flex items-center gap-4 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <span className="text-green-500">●</span> sent
                      </span>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <span className="text-red-500">●</span> failed
                      </span>
                    </div>

                    {count === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400">No contacts yet.</p>
                    ) : (
                      <ul className="divide-y divide-gray-50">
                        {event.contacts.map(contact => {
                          const isPending = !contact.connection_queue[0] || contact.connection_queue[0].status === 'pending'
                          return (
                            <li key={contact.id} className="px-4 py-2.5 flex items-center gap-3">
                              <StatusDot queue={contact.connection_queue} />
                              <div>
                                <p className={`text-sm ${isPending ? 'text-gray-400' : 'text-gray-800'}`}>
                                  {contact.name || '—'}
                                </p>
                                {contact.headline && (
                                  <p className="text-xs text-gray-400 truncate max-w-xs">{contact.headline}</p>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
