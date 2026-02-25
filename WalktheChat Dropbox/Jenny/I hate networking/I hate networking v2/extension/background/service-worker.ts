import { getSupabase, getAuthedSupabase } from '../lib/supabase'
import { checkDailyLimit, getSentTodayCount } from '../lib/rate-limiter'

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
  console.log('I Hate Networking extension installed')
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
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
    supabase.auth.signInWithPassword({ email, password })
      .then(async ({ data, error }) => {
        if (error || !data.session) {
          sendResponse({ success: false, error: error?.message ?? 'Login failed' })
          return
        }
        await chrome.storage.local.set({ session: data.session })
        sendResponse({ success: true })
      })
      .catch(err => sendResponse({ success: false, error: err?.message ?? 'Login failed' }))
    return true
  }

  if (msg.type === 'SIGN_UP') {
    const { email, password } = msg.data
    const supabase = getSupabase()
    supabase.auth.signUp({ email, password })
      .then(async ({ data, error }) => {
        if (error) { sendResponse({ success: false, error: error.message }); return }
        if (data.session) {
          await chrome.storage.local.set({ session: data.session })
          sendResponse({ success: true, sessionReady: true })
        } else {
          sendResponse({ success: true, sessionReady: false })
        }
      })
      .catch(err => sendResponse({ success: false, error: err?.message ?? 'Sign up failed' }))
    return true
  }

  if (msg.type === 'LAUNCH_CAMPAIGN') {
    const { eventId, note, lumaUrl, eventName, contacts } = msg.data
    launchCampaign({ eventId, note, lumaUrl, eventName, contacts }).then(result => sendResponse(result))
    return true
  }

  if (msg.type === 'GET_EVENT_BY_URL') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ eventId: '', existingUrls: [], linkedInCount: 0 }); return }
      const supabase = getAuthedSupabase(session.access_token)
      const { data: event } = await supabase
        .from('events')
        .select('id')
        .eq('luma_url', msg.lumaUrl)
        .eq('user_id', session.user.id)
        .single()
      if (!event) { sendResponse({ eventId: '', existingUrls: [], linkedInCount: 0 }); return }
      const { data: contacts } = await supabase
        .from('contacts')
        .select('luma_profile_url, linkedin_url, name, instagram_url, is_host')
        .eq('event_id', event.id)
      const existingUrls = (contacts ?? []).map((c: any) => c.luma_profile_url)
      const linkedInCount = (contacts ?? []).filter((c: any) => c.linkedin_url).length
      sendResponse({ eventId: event.id, existingUrls, linkedInCount, contacts: contacts ?? [] })
    })
    return true
  }

  if (msg.type === 'GET_RECENT_CONTACTS') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ events: [] }); return }
      const supabase = getAuthedSupabase(session.access_token)
      const { data } = await supabase
        .from('events')
        .select('id, name, contacts(id, name, headline, linkedin_url, connection_queue(status))')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(5)
      sendResponse({ events: data ?? [] })
    })
    return true
  }

  if (msg.type === 'GET_PROGRESS_DATA') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ chartData: [], events: [] }); return }
      const supabase = getAuthedSupabase(session.access_token)

      // Graph: all sent_at timestamps (non-null), sorted ascending
      const { data: queueRows } = await supabase
        .from('connection_queue')
        .select('sent_at')
        .eq('user_id', session.user.id)
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: true })

      // Compute cumulative by day
      const dayCounts: Record<string, number> = {}
      for (const row of queueRows ?? []) {
        const day = (row.sent_at as string).slice(0, 10)
        dayCounts[day] = (dayCounts[day] ?? 0) + 1
      }
      let cum = 0
      const chartData = Object.keys(dayCounts).sort().map(d => {
        cum += dayCounts[d]
        return { date: d, cumulative: cum }
      })

      // Event list: all events with contacts + statuses
      const { data: events } = await supabase
        .from('events')
        .select('id, name, contacts(id, name, linkedin_url, instagram_url, connection_queue(status, error))')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })

      sendResponse({ chartData, events: events ?? [] })
    })
    return true
  }

  if (msg.type === 'GET_CONTACT_STATUSES') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ statuses: [] }); return }
      const supabase = getAuthedSupabase(session.access_token)
      const { data } = await supabase
        .from('contacts')
        .select('linkedin_url, connection_queue(status)')
        .eq('event_id', msg.eventId)
        .eq('user_id', session.user.id)
      const statuses = (data ?? [])
        .filter((c: any) => c.linkedin_url && c.connection_queue?.[0]?.status)
        .map((c: any) => ({ linkedInUrl: c.linkedin_url, status: c.connection_queue[0].status }))
      sendResponse({ statuses })
    })
    return true
  }
})

async function getSession() {
  const { session } = await chrome.storage.local.get('session')
  if (!session) return null

  // Refresh if token expires within 60 seconds
  const expiresAt = session.expires_at ?? 0
  if (Date.now() / 1000 >= expiresAt - 60) {
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: session.refresh_token })
    if (error || !data.session) return null
    await chrome.storage.local.set({ session: data.session })
    return data.session
  }

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

  const supabase = getAuthedSupabase(session.access_token)

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
  contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string; twitterUrl: string }[]
}): Promise<{ eventId: string; found: number; total: number }> {
  const session = await getSession()
  if (!session) return { eventId: '', found: 0, total: 0 }

  const supabase = getAuthedSupabase(session.access_token)

  // Upsert the event
  const { data: event, error: eventError } = await supabase
    .from('events')
    .upsert(
      { user_id: session.user.id, luma_url: data.lumaUrl, name: data.eventName, campaign_status: 'draft' },
      { onConflict: 'luma_url,user_id' }
    )
    .select()
    .single()

  if (!event) {
    console.error('[IHN] event upsert failed:', eventError)
    return { eventId: '', found: 0, total: 0 }
  }

  const total = data.contacts.length
  let found = 0

  for (const contact of data.contacts) {
    const { url, isHost, name, linkedInUrl, instagramUrl, twitterUrl } = contact

    const { data: saved } = await supabase
      .from('contacts')
      .upsert(
        {
          user_id: session.user.id,
          event_id: event.id,
          luma_profile_url: url,
          name,
          linkedin_url: linkedInUrl,
          instagram_url: instagramUrl || null,
          twitter_url: twitterUrl || '',
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
  contacts?: { url: string; name: string; linkedInUrl: string; isHost: boolean; instagramUrl: string; twitterUrl: string }[]
}): Promise<{ queued: number; eventId: string }> {
  const session = await getSession()
  if (!session) return { queued: 0, eventId: '' }

  const supabase = getAuthedSupabase(session.access_token)

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
  if (!session) { console.log('[IHN] processNextQueueItem: no session'); return }

  const supabase = getAuthedSupabase(session.access_token)

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

  if (!item) { console.log('[IHN] No pending items'); return }
  console.log('[IHN] Processing queue item for:', (item.contacts as any)?.name)
  const linkedinUrl = (item.contacts as any)?.linkedin_url
  if (!linkedinUrl) {
    await supabase.from('connection_queue').update({ status: 'failed', error: 'no_linkedin_url' }).eq('id', item.id)
    return
  }

  const win = await chrome.windows.create({
    url: linkedinUrl, type: 'popup',
    left: -2000, top: -2000, width: 100, height: 100, focused: false,
  })
  const tabId = win.tabs![0].id!
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 15000) // hard fallback
    chrome.tabs.onUpdated.addListener(function listener(tid, info) {
      if (tid === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        clearTimeout(timeout)
        setTimeout(resolve, 1500) // small buffer after load
      }
    })
  })

  const result: { success: boolean; error?: string } = await new Promise(resolve => {
    const firstName = (item.contacts as any)?.name?.split(' ')[0] || ''
    const resolvedNote = (item.note || '').replace(/\[first name\]/gi, firstName)
    chrome.tabs.sendMessage(tabId, { type: 'CONNECT', note: resolvedNote }, response => {
      resolve(response ?? { success: false, error: 'no_response' })
    })
  })

  console.log('[IHN] Result:', result)

  if (result.success) {
    await supabase.from('connection_queue').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', item.id)

    await supabase.from('usage_logs').insert({
      user_id: session.user.id,
      action: 'connection_sent',
    })

    // Schedule next item with 8–15 min random delay (only on success)
    const delayMinutes = 8 + Math.random() * 7
    await supabase.from('connection_queue')
      .update({ scheduled_at: new Date(Date.now() + delayMinutes * 60000).toISOString() })
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
  } else if (result.error === 'no_response') {
    // Content script not ready — requeue with 5min delay
    await supabase.from('connection_queue').update({
      scheduled_at: new Date(Date.now() + 5 * 60000).toISOString(),
    }).eq('id', item.id)
  } else {
    await supabase.from('connection_queue').update({
      status: 'failed',
      error: result.error ?? 'unknown',
    }).eq('id', item.id)
    // No delay — next item processes on next alarm tick (~30s)
  }

  await chrome.windows.remove(win.id!)
}
