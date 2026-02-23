import { createClient } from '@/lib/supabase-server'
import ContactsTable from '@/components/ContactsTable'

export default async function ContactsPage() {
  const supabase = await createClient()

  const { data: contacts } = await supabase
    .from('contacts')
    .select('*, events(name, city)')
    .order('created_at', { ascending: false })

  // Get connection status for each contact
  const { data: queue } = await supabase
    .from('connection_queue')
    .select('contact_id, status')

  const statusMap = Object.fromEntries(
    (queue ?? []).map(q => [q.contact_id, q.status])
  )

  const enriched = (contacts ?? []).map(c => ({
    ...c,
    status: statusMap[c.id],
  }))

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Contacts</h1>
      <ContactsTable contacts={enriched} />
    </div>
  )
}
