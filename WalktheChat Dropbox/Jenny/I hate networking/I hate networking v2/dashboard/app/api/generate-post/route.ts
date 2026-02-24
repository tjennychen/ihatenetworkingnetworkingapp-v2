import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { buildPostPrompt } from '@/lib/postGenerator'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: Request) {
  // Verify auth
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: max 10 per day
  const today = new Date().toISOString().split('T')[0]
  const { count } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('action', 'post_generated')
    .gte('created_at', `${today}T00:00:00Z`)

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Daily limit reached (10 posts/day)' }, { status: 429 })
  }

  const { hostNames, guestNames, eventName } = await req.json()

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: buildPostPrompt({ hostNames, guestNames, eventName }) }],
  })

  const postText = (message.content[0] as { type: string; text: string }).text

  // Log usage
  await supabase.from('usage_logs').insert({ user_id: user.id, action: 'post_generated' })

  return NextResponse.json({ post: postText })
}
