import { getSupabase } from '../lib/supabase'
import { checkDailyLimit, getSentTodayCount } from '../lib/rate-limiter'

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
  console.log('I Hate Networking extension installed')
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkQueue') await processNextQueueItem()
})

chrome.runtime.onMessageExternal.addListener(async (msg) => {
  if (msg.type === 'SET_AUTH' && msg.session) {
    await chrome.storage.local.set({ session: msg.session })
    console.log('Session stored from dashboard')
  }
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_CONTACTS') {
    saveContacts(msg.data).then(count => sendResponse({ saved: count }))
    return true
  }

  if (msg.type === 'START_ENRICHMENT') {
    const tabId = sender.tab?.id ?? 0
    const { lumaUrl, eventName, contacts } = msg.data
    saveEnrichedContacts({ tabId, lumaUrl, eventName, contacts })
      .then(result => sendResponse(result))
    return true
  }

  if (msg.type === 'LAUNCH_CAMPAIGN') {
    const { eventId, note } = msg.data
    launchCampaign({ eventId, note }).then(result => sendResponse(result))
    return true
  }
})

async function getSession() {
  const { session } = await chrome.storage.local.get('session')
  return session
}

async function saveContacts(data: {
  eventName: string
  lumaUrl: string
  hostName: string
  guestProfileUrls: string[]
}): Promise<number> {
  const session = await getSession()
  if (!session) return 0

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  const { data: event } = await supabase
    .from('events')
    .upsert({ user_id: session.user.id, luma_url: data.lumaUrl, name: data.eventName },
             { onConflict: 'luma_url,user_id' })
    .select()
    .single()

  if (!event) return 0

  const contacts = data.guestProfileUrls.map(url => ({
    user_id: session.user.id,
    event_id: event.id,
    luma_profile_url: url,
    name: url.split('/').pop()?.replace(/-/g, ' ') ?? 'Unknown',
  }))

  const { data: saved } = await supabase
    .from('contacts')
    .upsert(contacts, { onConflict: 'event_id,luma_profile_url' })
    .select('id, linkedin_url')

  if (!saved) return 0

  const toQueue = saved
    .filter((c: any) => c.linkedin_url)
    .map((c: any) => ({ user_id: session.user.id, contact_id: c.id, status: 'pending' }))

  if (toQueue.length > 0) {
    await supabase.from('connection_queue').upsert(toQueue, { onConflict: 'contact_id' })
  }

  return saved.length
}

async function saveEnrichedContacts(data: {
  tabId: number
  lumaUrl: string
  eventName: string
  contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string }[]
}): Promise<{ eventId: string; found: number; total: number }> {
  const session = await getSession()
  if (!session) return { eventId: '', found: 0, total: 0 }

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  // Upsert the event
  const { data: event } = await supabase
    .from('events')
    .upsert(
      { user_id: session.user.id, luma_url: data.lumaUrl, name: data.eventName, campaign_status: 'draft' },
      { onConflict: 'luma_url,user_id' }
    )
    .select()
    .single()

  if (!event) return { eventId: '', found: 0, total: 0 }

  const total = data.contacts.length
  let found = 0

  for (const contact of data.contacts) {
    const { url, isHost, name, linkedInUrl } = contact
    const firstName = name.split(' ')[0]

    const { data: saved } = await supabase
      .from('contacts')
      .upsert(
        {
          user_id: session.user.id,
          event_id: event.id,
          luma_profile_url: url,
          name,
          first_name: firstName,
          last_name: name.split(' ').slice(1).join(' '),
          linkedin_url: linkedInUrl,
          is_host: isHost,
        },
        { onConflict: 'event_id,luma_profile_url' }
      )
      .select('id, linkedin_url')
      .single()

    if (saved?.linkedin_url) found++
  }

  // Send completion to panel
  try {
    chrome.tabs.sendMessage(data.tabId, {
      type: 'ENRICH_COMPLETE',
      found,
      total,
      eventId: event.id,
    })
  } catch { /* tab may have been closed */ }

  return { eventId: event.id, found, total }
}

async function launchCampaign(data: { eventId: string; note: string }): Promise<{ queued: number }> {
  const session = await getSession()
  if (!session) return { queued: 0 }

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  // Get all contacts for this event that have linkedin_url
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, linkedin_url')
    .eq('event_id', data.eventId)
    .eq('user_id', session.user.id)
    .not('linkedin_url', 'eq', '')

  if (!contacts?.length) return { queued: 0 }

  const queueItems = contacts.map((c: any) => ({
    user_id: session.user.id,
    contact_id: c.id,
    status: 'pending',
    note: data.note || '',
  }))

  await supabase.from('connection_queue').upsert(queueItems, { onConflict: 'contact_id' })

  // Mark event as running
  await supabase
    .from('events')
    .update({ campaign_status: 'running' })
    .eq('id', data.eventId)

  return { queued: contacts.length }
}

async function processNextQueueItem(): Promise<void> {
  const session = await getSession()
  if (!session) return

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  const sentToday = await getSentTodayCount(supabase, session.user.id)
  const { canSend } = checkDailyLimit(sentToday)
  if (!canSend) return

  const { data: item } = await supabase
    .from('connection_queue')
    .select('*, contacts(linkedin_url, name)')
    .eq('user_id', session.user.id)
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .single()

  if (!item) return
  const linkedinUrl = (item.contacts as any)?.linkedin_url
  if (!linkedinUrl) {
    await supabase.from('connection_queue').update({ status: 'failed', error: 'no_linkedin_url' }).eq('id', item.id)
    return
  }

  const tab = await chrome.tabs.create({ url: linkedinUrl, active: false })
  await new Promise(r => setTimeout(r, 3000))

  const result: { success: boolean; error?: string } = await new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id!, { type: 'CONNECT', note: item.note || '' }, response => {
      resolve(response ?? { success: false, error: 'no_response' })
    })
  })

  if (result.success) {
    await supabase.from('connection_queue').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', item.id)

    await supabase.from('usage_logs').insert({
      user_id: session.user.id,
      action: 'connection_sent',
    })
  } else {
    await supabase.from('connection_queue').update({
      status: 'failed',
      error: result.error ?? 'unknown',
    }).eq('id', item.id)
  }

  chrome.tabs.remove(tab.id!)

  // Schedule next item with 8–15 min random delay
  const delayMinutes = 8 + Math.random() * 7
  await supabase.from('connection_queue')
    .update({ scheduled_at: new Date(Date.now() + delayMinutes * 60000).toISOString() })
    .eq('user_id', session.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
}
