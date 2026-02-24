import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'

export default async function CampaignsPage() {
  const supabase = await createClient()

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Campaigns</h1>
      <p className="text-sm text-gray-500 mb-6">Each Luma event becomes a campaign when you import contacts.</p>

      {(!events || events.length === 0) ? (
        <p className="text-sm text-gray-400">No campaigns yet. Import contacts from a Luma event to start one.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event: any) => (
            <Link
              key={event.id}
              href={`/campaigns/${event.id}`}
              className="flex items-center justify-between px-4 py-3 bg-white border border-gray-100 rounded-xl hover:border-indigo-200 transition-colors group"
            >
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700">{event.name || 'Untitled event'}</p>
                {event.city && <p className="text-xs text-gray-400">{event.city}</p>}
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                event.campaign_status === 'running' ? 'bg-green-100 text-green-700' :
                event.campaign_status === 'completed' ? 'bg-gray-100 text-gray-600' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {event.campaign_status === 'running' ? '▶ Running' :
                 event.campaign_status === 'completed' ? '✓ Completed' : '● Draft'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
