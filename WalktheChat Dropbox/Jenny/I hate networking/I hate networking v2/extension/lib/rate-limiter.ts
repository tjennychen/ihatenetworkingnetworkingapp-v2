const DAILY_LIMIT = 40

export function checkDailyLimit(sentToday: number): { canSend: boolean; remaining: number } {
  const remaining = Math.max(0, DAILY_LIMIT - sentToday)
  return { canSend: sentToday < DAILY_LIMIT, remaining }
}

export async function getSentTodayCount(supabase: any, userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const { count } = await supabase
    .from('connection_queue')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', `${today}T00:00:00Z`)
  return count ?? 0
}
