import { createClient } from '@/lib/supabase-server'
import StatsCards from '@/components/StatsCards'
import StatsChart from '@/components/StatsChart'
import { format, subDays } from 'date-fns'

export default async function StatsPage() {
  const supabase = await createClient()

  const { data: queue } = await supabase
    .from('connection_queue')
    .select('status, sent_at, accepted_at')

  const rows = queue ?? []
  const sent     = rows.filter(r => r.status === 'sent' || r.status === 'accepted').length
  const accepted = rows.filter(r => r.status === 'accepted').length

  // Build last-30-days chart data
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = format(subDays(new Date(), 29 - i), 'MMM d')
    const isoDate = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
    const daySent     = rows.filter(r => r.sent_at?.startsWith(isoDate)).length
    const dayAccepted = rows.filter(r => r.accepted_at?.startsWith(isoDate)).length
    return { date, sent: daySent, accepted: dayAccepted }
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Stats</h1>
      <StatsCards sent={sent} accepted={accepted} />
      <StatsChart data={days} />
    </div>
  )
}
