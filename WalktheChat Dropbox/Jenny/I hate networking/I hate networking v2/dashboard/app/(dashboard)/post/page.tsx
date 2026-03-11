import { createClient } from '@/lib/supabase-server'
import PostGenerator from '@/components/PostGenerator'

export default async function PostPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>
}) {
  const { event: eventName } = await searchParams
  const supabase = await createClient()

  // Fetch all contacts, ordered so hosts come first
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .order('is_host', { ascending: false })
    .order('name', { ascending: true })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Post Generator</h1>
      <p className="text-sm text-gray-500 mb-6">
        Generate a LinkedIn post and get your photo-tagging list — one copy, paste into LinkedIn.
      </p>
      <PostGenerator contacts={contacts ?? []} eventName={eventName} />
    </div>
  )
}
