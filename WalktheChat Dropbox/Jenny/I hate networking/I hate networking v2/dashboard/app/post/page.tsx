import { createClient } from '@/lib/supabase-server'
import PostGenerator from '@/components/PostGenerator'

export default async function PostPage() {
  const supabase = await createClient()
  const { data: contacts } = await supabase.from('contacts').select('*')
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Post Generator</h1>
      <p className="text-sm text-gray-500 mb-6">Generate a LinkedIn post thanking your host and tagging guests.</p>
      <PostGenerator contacts={contacts ?? []} />
    </div>
  )
}
