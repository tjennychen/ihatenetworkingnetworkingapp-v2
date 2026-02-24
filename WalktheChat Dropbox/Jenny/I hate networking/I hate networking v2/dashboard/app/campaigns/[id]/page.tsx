import { createClient } from '@/lib/supabase-server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch event
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single()

  if (!event) notFound()

  // Fetch queue items with contact info
  const { data: queueItems } = await supabase
    .from('connection_queue')
    .select('*, contacts(id, name, linkedin_url)')
    .eq('user_id', event.user_id)
    .order('created_at', { ascending: true })

  // Filter to contacts belonging to this event
  const { data: eventContactIds } = await supabase
    .from('contacts')
    .select('id')
    .eq('event_id', id)

  const contactIdSet = new Set((eventContactIds ?? []).map((c: any) => c.id))
  const items = (queueItems ?? []).filter((q: any) => contactIdSet.has(q.contact_id))

  const sent = items.filter((i: any) => i.status === 'sent' || i.status === 'accepted').length
  const pending = items.filter((i: any) => i.status === 'pending').length
  const failed = items.filter((i: any) => i.status === 'failed').length

  // ETA: avg 11.5 min between sends (midpoint of 8-15 range)
  const avgMinutes = 11.5
  const etaMs = pending * avgMinutes * 60 * 1000
  const etaDate = new Date(Date.now() + etaMs)
  const etaStr = pending > 0
    ? etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  function statusDot(status: string) {
    if (status === 'sent' || status === 'accepted') return '● Sent'
    if (status === 'pending') return '○ Pending'
    if (status === 'failed') return '✕ Failed'
    return status
  }

  function statusColor(status: string) {
    if (status === 'sent' || status === 'accepted') return 'text-green-600'
    if (status === 'pending') return 'text-gray-400'
    if (status === 'failed') return 'text-red-500'
    return 'text-gray-400'
  }

  function formatTime(ts: string | null) {
    if (!ts) return ''
    return new Date(ts).toLocaleString('en-US', {
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-1">
        <Link href="/contacts" className="text-xs text-gray-400 hover:text-gray-600">← Contacts</Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        {event.name || 'Campaign'}
      </h1>

      <div className="flex items-center gap-2 mb-6">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          event.campaign_status === 'running' ? 'bg-green-100 text-green-700' :
          event.campaign_status === 'completed' ? 'bg-gray-100 text-gray-600' :
          'bg-yellow-100 text-yellow-700'
        }`}>
          {event.campaign_status === 'running' ? '▶ Running' :
           event.campaign_status === 'completed' ? '✓ Completed' : '● Draft'}
        </span>
        <span className="text-sm text-gray-500">
          {sent} sent · {pending} pending · {failed} failed
        </span>
        {etaStr && (
          <span className="text-sm text-gray-400 group relative cursor-default">
            Est. complete: {etaStr}
            <span className="absolute bottom-full left-0 mb-1 hidden group-hover:block w-64 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 z-10 shadow-lg">
              For healthy LinkedIn activity, we recommend fewer than 40 connections/day
            </span>
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No connections queued yet.</p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item: any) => {
                const contact = item.contacts
                const ts = item.sent_at ?? item.scheduled_at
                const timeLabel = item.status === 'pending'
                  ? `scheduled ${formatTime(item.scheduled_at)}`
                  : formatTime(ts)

                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {contact?.linkedin_url ? (
                        <a href={contact.linkedin_url} target="_blank" rel="noreferrer"
                           className="text-indigo-600 hover:underline">
                          {contact?.name ?? '—'}
                        </a>
                      ) : (
                        <span className="text-gray-700">{contact?.name ?? '—'}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 font-medium ${statusColor(item.status)}`}>
                      {statusDot(item.status)}
                      {item.status === 'failed' && item.error && (
                        <span className="ml-1 text-xs text-red-400 font-normal">{item.error}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{timeLabel}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
