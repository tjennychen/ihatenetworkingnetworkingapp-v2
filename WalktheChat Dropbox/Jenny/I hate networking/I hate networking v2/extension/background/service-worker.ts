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
  if (msg.type === 'CHECK_LINKEDIN_LOGIN') {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' }, cookie => {
      sendResponse({ loggedIn: !!(cookie && cookie.value) })
    })
    return true
  }

  if (msg.type === 'SAVE_CONTACTS') {
    saveContacts(msg.data).then(count => sendResponse({ saved: count }))
    return true
  }

  if (msg.type === 'START_ENRICHMENT') {
    const tabId = sender.tab?.id ?? 0
    const { lumaUrl, eventName, contacts } = msg.data
    saveEnrichedContacts({ tabId, lumaUrl, eventName, contacts })
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[IHN] saveEnrichedContacts failed:', err)
        sendResponse({ eventId: '', found: 0, total: contacts.length })
      })
    return true
  }

  if (msg.type === 'SIGN_IN') {
    const { email, password } = msg.data
    const supabase = getSupabase()
    supabase.auth.signInWithPassword({ email, password }).then(async ({ data, error }) => {
      if (error || !data.session) {
        sendResponse({ success: false, error: error?.message ?? 'Login failed' })
        return
      }
      await chrome.storage.local.set({ session: data.session })
      sendResponse({ success: true })
    })
    return true
  }

  if (msg.type === 'SIGN_UP') {
    const { email, password } = msg.data
    const supabase = getSupabase()
    supabase.auth.signUp({ email, password }).then(async ({ data, error }) => {
      if (error) {
        sendResponse({ success: false, error: error.message })
        return
      }
      if (data.session) {
        await chrome.storage.local.set({ session: data.session })
        sendResponse({ success: true, sessionReady: true })
      } else {
        sendResponse({ success: true, sessionReady: false })
      }
    })
    return true
  }

  if (msg.type === 'LAUNCH_CAMPAIGN') {
    const { eventId, note, lumaUrl, eventName, contacts } = msg.data
    launchCampaign({ eventId, note, lumaUrl, eventName, contacts }).then(result => sendResponse(result))
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
  contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string }[]
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
    const { url, isHost, name, linkedInUrl, instagramUrl } = contact
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
          instagram_url: instagramUrl || null,
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

async function launchCampaign(data: {
  eventId: string; note: string
  lumaUrl?: string; eventName?: string
  contacts?: { url: string; name: string; linkedInUrl: string; isHost: boolean; instagramUrl: string }[]
}): Promise<{ queued: number; eventId: string }> {
  const session = await getSession()
  if (!session) return { queued: 0, eventId: '' }

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  let eventId = data.eventId

  // Fallback: if save failed earlier (eventId is empty), retry with contacts
  if (!eventId && data.contacts?.length && data.lumaUrl) {
    const saved = await saveEnrichedContacts({
      tabId: 0, lumaUrl: data.lumaUrl, eventName: data.eventName ?? '',
      contacts: data.contacts.map(c => ({
        url: c.url, name: c.name, linkedInUrl: c.linkedInUrl,
        isHost: c.isHost, instagramUrl: c.instagramUrl,
      })),
    })
    eventId = saved.eventId
  }
  if (!eventId) return { queued: 0, eventId: '' }

  // Get all contacts for this event that have linkedin_url
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, linkedin_url')
    .eq('event_id', eventId)
    .eq('user_id', session.user.id)
    .not('linkedin_url', 'eq', '')

  if (!contacts?.length) return { queued: 0, eventId }

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
    .eq('id', eventId)

  return { queued: contacts.length, eventId }
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
