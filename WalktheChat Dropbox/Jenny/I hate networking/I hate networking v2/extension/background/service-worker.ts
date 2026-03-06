import { getSupabase, getAuthedSupabase } from '../lib/supabase'
import { checkDailyLimit, getSentTodayCount } from '../lib/rate-limiter'

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  console.log('I Hate Networking extension installed')
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkQueue') {
    await processNextQueueItem()
    updateBadge()
  }
})

// ── Badge (reads chrome.storage only — zero network cost) ─────────────────────

async function updateBadge(): Promise<void> {
  const data = await chrome.storage.local.get(['queuePending', 'campaignPaused'])
  const pending: number = data.queuePending ?? 0
  if (pending === 0) {
    chrome.action.setBadgeText({ text: '' })
  } else if (data.campaignPaused) {
    chrome.action.setBadgeText({ text: '⏸' })
    chrome.action.setBadgeBackgroundColor({ color: '#9ca3af' })
  } else {
    chrome.action.setBadgeText({ text: '●' })
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' })
  }
}

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

  if (msg.type === 'GET_PENDING_COUNT') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ pending: 0 }); return }
      const supabase = getAuthedSupabase(session.access_token)
      const { count } = await supabase
        .from('connection_queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('status', 'pending')
      sendResponse({ pending: count ?? 0 })
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
        .select('luma_profile_url, linkedin_url, name, instagram_url, twitter_url, website_url, is_host')
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
      const { data: events } = await supabase
        .from('events')
        .select('id, name, contacts(id, name, linkedin_url)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(5)
      const { data: allQueue } = await supabase
        .from('connection_queue')
        .select('contact_id, status')
        .eq('user_id', session.user.id)
      const queueByContact = new Map<string, string>()
      for (const q of allQueue ?? []) {
        if (!queueByContact.has(q.contact_id)) queueByContact.set(q.contact_id, q.status)
      }
      const eventsWithQueue = (events ?? []).map((e: any) => ({
        ...e,
        contacts: (e.contacts ?? []).map((c: any) => ({
          ...c,
          connection_queue: queueByContact.has(c.id) ? [{ status: queueByContact.get(c.id) }] : [],
        })),
      }))
      sendResponse({ events: eventsWithQueue })
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

      // Events + contacts (no nested connection_queue — fetched separately to avoid PostgREST auth issues)
      const { data: events } = await supabase
        .from('events')
        .select('id, name, contacts(id, name, linkedin_url, instagram_url, twitter_url, website_url)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })

      // All queue statuses for this user — explicit user_id filter bypasses nested select auth issues
      const { data: allQueue } = await supabase
        .from('connection_queue')
        .select('contact_id, status, error')
        .eq('user_id', session.user.id)

      // Build lookup: contact_id → queue entry
      const queueByContact = new Map<string, { status: string; error: string }>()
      for (const q of allQueue ?? []) {
        if (!queueByContact.has(q.contact_id)) queueByContact.set(q.contact_id, q)
      }

      // Attach queue data to contacts
      const eventsWithQueue = (events ?? []).map((e: any) => ({
        ...e,
        contacts: (e.contacts ?? []).map((c: any) => ({
          ...c,
          connection_queue: queueByContact.has(c.id) ? [queueByContact.get(c.id)] : [],
        })),
      }))

      sendResponse({ chartData, events: eventsWithQueue })
    })
    return true
  }

  if (msg.type === 'GET_QUEUE_STATUS') {
    chrome.storage.local.get(['queuePending', 'lastSentAt', 'lastSentName', 'nextScheduledAt', 'campaignPaused']).then(data => {
      sendResponse(data)
    })
    return true
  }

  if (msg.type === 'PAUSE_CAMPAIGN') {
    chrome.storage.local.set({ campaignPaused: true }).then(() => updateBadge())
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'RESUME_CAMPAIGN') {
    chrome.storage.local.set({ campaignPaused: false }).then(() => updateBadge())
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'GET_CAMPAIGN_PAUSED') {
    chrome.storage.local.get('campaignPaused').then(({ campaignPaused }) => {
      sendResponse({ paused: !!campaignPaused })
    })
    return true
  }

  if (msg.type === 'PAUSE_EVENT') {
    chrome.storage.local.get('pausedEvents').then(({ pausedEvents }) => {
      const arr: string[] = pausedEvents ?? []
      if (!arr.includes(msg.eventId)) arr.push(msg.eventId)
      chrome.storage.local.set({ pausedEvents: arr }).then(() => updateBadge())
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === 'RESUME_EVENT') {
    chrome.storage.local.get('pausedEvents').then(({ pausedEvents }) => {
      const arr: string[] = (pausedEvents ?? []).filter((id: string) => id !== msg.eventId)
      chrome.storage.local.set({ pausedEvents: arr }).then(() => updateBadge())
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === 'GET_PAUSED_EVENTS') {
    chrome.storage.local.get('pausedEvents').then(({ pausedEvents }) => {
      sendResponse({ pausedEvents: pausedEvents ?? [] })
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

  if (msg.type === 'GET_DRAFT_DATA') {
    getSession().then(async (session) => {
      if (!session) { sendResponse(null); return }
      const supabase = getAuthedSupabase(session.access_token)
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, linkedin_url, linkedin_name, is_host')
        .eq('event_id', msg.eventId)
        .eq('user_id', session.user.id)
      if (!contacts) { sendResponse(null); return }
      const hosts = contacts.filter((c: any) => c.is_host)
      const guests = contacts.filter((c: any) => !c.is_host && c.linkedin_url)
      // Random sample of up to 15 guests
      const shuffled = [...guests].sort(() => Math.random() - 0.5)
      const sample = shuffled.slice(0, 15)
      sendResponse({ hosts, guests: sample, totalGuests: guests.length })
    })
    return true
  }

  if (msg.type === 'GET_LINKEDIN_NAMES') {
    getSession().then(async (session) => {
      if (!session) { sendResponse([]); return }
      const supabase = getAuthedSupabase(session.access_token)
      const contacts: { id: string; linkedin_url: string }[] = msg.contacts

      // Try to find an existing LinkedIn profile tab — can relay fetches from there (same-origin, no new tabs)
      const linkedinTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/in/*' })
      let relayTabId: number | null = linkedinTabs[0]?.id ?? null
      let openedTabId: number | null = null

      if (!relayTabId) {
        // Open one background tab for the first contact's profile and use it as relay for all
        const existingWindows = await chrome.windows.getAll({ windowTypes: ['normal'] })
        if (existingWindows.length > 0 && contacts.length > 0) {
          const windowId = existingWindows.find(w => w.focused)?.id ?? existingWindows[0].id
          const firstUrl = contacts[0].linkedin_url.replace('https://linkedin.com/', 'https://www.linkedin.com/')
          const tab = await chrome.tabs.create({ url: firstUrl, active: false, windowId })
          openedTabId = tab.id!
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 15000)
            chrome.tabs.onUpdated.addListener(function listener(tid, info) {
              if (tid === openedTabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener)
                clearTimeout(timeout)
                setTimeout(resolve, 2000)
              }
            })
          })
          relayTabId = openedTabId
        }
      }

      let results: { id: string; linkedin_name: string }[] = []

      if (relayTabId !== null) {
        // Delegate all fetches to the content script in that tab — completely silent
        results = await new Promise<{ id: string; linkedin_name: string }[]>((resolve) => {
          const timeout = setTimeout(() => resolve([]), 120000)
          chrome.tabs.sendMessage(relayTabId!, { type: 'FETCH_LINKEDIN_PROFILES', contacts }, (response) => {
            clearTimeout(timeout)
            resolve(response ?? [])
          })
        })
      }

      if (openedTabId) chrome.tabs.remove(openedTabId).catch(() => {})

      // Persist names to Supabase
      for (const r of results) {
        if (r.linkedin_name) {
          await supabase.from('contacts').update({ linkedin_name: r.linkedin_name }).eq('id', r.id)
        }
      }

      sendResponse(results)
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
    .map((c: any) => ({ user_id: session.user.id, contact_id: c.id, status: 'pending', scheduled_at: new Date().toISOString() }))

  if (toQueue.length > 0) {
    await supabase.from('connection_queue').upsert(toQueue, { onConflict: 'contact_id' })
  }

  return saved.length
}

async function saveEnrichedContacts(data: {
  tabId: number
  lumaUrl: string
  eventName: string
  contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string; twitterUrl: string; websiteUrl: string }[]
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
    const { url, isHost, name, linkedInUrl, instagramUrl, twitterUrl, websiteUrl } = contact

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
          website_url: websiteUrl || '',
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
  contacts?: { url: string; name: string; linkedInUrl: string; isHost: boolean; instagramUrl: string; twitterUrl: string; websiteUrl: string }[]
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

  // Don't re-queue contacts already sent or accepted
  const { data: existing } = await supabase
    .from('connection_queue')
    .select('contact_id, status')
    .in('contact_id', contacts.map((c: any) => c.id))

  const alreadyDone = new Set(
    (existing ?? [])
      .filter((q: any) => q.status === 'sent' || q.status === 'accepted')
      .map((q: any) => q.contact_id)
  )

  // Stagger initial scheduled_at so items don't all fire at once.
  // Item 0 = now, item 1 = now+20min, item 2 = now+40min, etc.
  const STAGGER_MINUTES = 20
  const queueItems = contacts
    .filter((c: any) => !alreadyDone.has(c.id))
    .map((c: any, i: number) => ({
      user_id: session.user.id,
      contact_id: c.id,
      status: 'pending',
      note: data.note || '',
      scheduled_at: new Date(Date.now() + i * STAGGER_MINUTES * 60000).toISOString(),
    }))

  if (queueItems.length > 0) {
    await supabase.from('connection_queue').upsert(queueItems, { onConflict: 'contact_id' })
  }

  // Mark event as running
  await supabase
    .from('events')
    .update({ campaign_status: 'running' })
    .eq('id', eventId)

  // Store pending count so badge + popup can read without extra queries
  const totalPending = queueItems.length
  await chrome.storage.local.set({ queuePending: totalPending, nextScheduledAt: now })
  updateBadge()

  return { queued: contacts.length, eventId }
}

async function processNextQueueItem(): Promise<void> {
  // Only send during daytime hours (6am–11pm local) to look natural
  const hour = new Date().getHours()
  if (hour < 6 || hour >= 23) return

  const { campaignPaused } = await chrome.storage.local.get('campaignPaused')
  if (campaignPaused) return

  const session = await getSession()
  if (!session) { console.log('[IHN] processNextQueueItem: no session'); return }

  const supabase = getAuthedSupabase(session.access_token)

  const sentToday = await getSentTodayCount(supabase, session.user.id)
  const { canSend } = checkDailyLimit(sentToday)
  if (!canSend) return

  const { data: item } = await supabase
    .from('connection_queue')
    .select('*, contacts(linkedin_url, name, event_id)')
    .eq('user_id', session.user.id)
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .single()

  if (!item) { console.log('[IHN] No pending items'); return }

  // Skip if this event is paused
  const eventId = (item.contacts as any)?.event_id
  if (eventId) {
    const { pausedEvents } = await chrome.storage.local.get('pausedEvents')
    if ((pausedEvents ?? []).includes(eventId)) {
      console.log('[IHN] Event paused, skipping')
      return
    }
  }

  console.log('[IHN] Processing queue item for:', (item.contacts as any)?.name)
  const linkedinUrl = (item.contacts as any)?.linkedin_url
  if (!linkedinUrl) {
    await supabase.from('connection_queue').update({ status: 'failed', error: 'no_linkedin_url' }).eq('id', item.id)
    return
  }

  // Validate the LinkedIn URL before opening a tab — catch corrupted data early
  const vanityFromUrl = (() => {
    try { return new URL(linkedinUrl.replace('https://linkedin.com/', 'https://www.linkedin.com/')).pathname.split('/').filter(Boolean)[1] ?? '' }
    catch { return '' }
  })()
  const invalidVanity = !vanityFromUrl || vanityFromUrl.toLowerCase() === 'none' || vanityFromUrl.includes(' ')
  if (invalidVanity) {
    await supabase.from('connection_queue').update({ status: 'failed', error: 'invalid_linkedin_url' }).eq('id', item.id)
    return
  }

  const firstName = (item.contacts as any)?.name?.split(' ')[0] || ''
  const resolvedNote = (item.note || '').replace(/\[first name\]/gi, firstName)

  // chrome.cookies.get CAN read HttpOnly cookies — document.cookie in content scripts cannot.
  // JSESSIONID is HttpOnly, so getCsrfToken() in the content script returns '' and every
  // Voyager API call fails CSRF validation. Read it here and pass it explicitly.
  const jsessionCookie = await new Promise<chrome.cookies.Cookie | null>(resolve =>
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, c => resolve(c ?? null))
  )
  // LinkedIn stores JSESSIONID as "ajax:..." with literal surrounding double-quotes.
  // The csrf-token header must be the value WITHOUT those quotes.
  const csrfToken = jsessionCookie ? decodeURIComponent(jsessionCookie.value).replace(/^"|"$/g, '') : ''
  if (!csrfToken) {
    await supabase.from('connection_queue').update({
      scheduled_at: new Date(Date.now() + 10 * 60000).toISOString(),
    }).eq('id', item.id)
    console.log('[IHN] No JSESSIONID cookie — not logged into LinkedIn, deferring')
    return
  }

  const result = await sendViaLinkedInRelay(vanityFromUrl, resolvedNote, csrfToken)
  console.log('[IHN] Result:', result)

  if (result.success) {
    const sentAt = new Date().toISOString()
    await supabase.from('connection_queue').update({
      status: 'sent',
      sent_at: sentAt,
    }).eq('id', item.id)

    await supabase.from('usage_logs').insert({
      user_id: session.user.id,
      action: 'connection_sent',
    })

    // Schedule next item with 15–30 min random delay (only on success)
    const delayMinutes = 15 + Math.random() * 15
    const nextScheduledAt = new Date(Date.now() + delayMinutes * 60000).toISOString()
    // SELECT the specific next item first, then update by ID — .order().limit() on UPDATE
    // in PostgREST updates ALL matching rows, not just the first one
    const { data: nextItem } = await supabase
      .from('connection_queue').select('id').eq('user_id', session.user.id)
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(1).single()
    if (nextItem) {
      await supabase.from('connection_queue').update({ scheduled_at: nextScheduledAt }).eq('id', nextItem.id)
    }

    // Update storage so badge + popup reflect new state
    const { queuePending: storedPending } = await chrome.storage.local.get('queuePending')
    await chrome.storage.local.set({
      queuePending: Math.max(0, (storedPending ?? 1) - 1),
      lastSentAt: sentAt,
      lastSentName: (item.contacts as any)?.name ?? '',
      nextScheduledAt,
    })
  } else if (result.error === 'no_linkedin_session' || result.error === 'no_csrf_token') {
    // Not logged into LinkedIn — defer, don't fail permanently
    await supabase.from('connection_queue').update({
      scheduled_at: new Date(Date.now() + 10 * 60000).toISOString(),
    }).eq('id', item.id)
  } else {
    await supabase.from('connection_queue').update({
      status: 'failed',
      error: result.error ?? 'unknown',
    }).eq('id', item.id)
    // Schedule next item with human-like delay even after failures
    const failDelayMinutes = 8 + Math.random() * 12 // 8–20 min
    const nextFailAt = new Date(Date.now() + failDelayMinutes * 60000).toISOString()
    const { data: nextFailItem } = await supabase
      .from('connection_queue').select('id').eq('user_id', session.user.id)
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(1).single()
    if (nextFailItem) {
      await supabase.from('connection_queue').update({ scheduled_at: nextFailAt }).eq('id', nextFailItem.id)
    }
    const { queuePending: storedPending } = await chrome.storage.local.get('queuePending')
    await chrome.storage.local.set({ queuePending: Math.max(0, (storedPending ?? 1) - 1) })
  }

}

// ── LinkedIn relay approach ───────────────────────────────────────────────────
//
// Prefer an existing LinkedIn tab as relay (already loaded, content script ready).
// If none exists, open linkedin.com/feed silently as a background tab.
// The content script fetches target profile HTML (same-origin) + calls Voyager API.
// No DOM clicking needed — single HTTP call.

async function waitForContentScript(tabId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await new Promise<any>(resolve => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_LINKEDIN_NAME' }, r => {
        void chrome.runtime.lastError // suppress "no receiving end" warning
        resolve(r ?? null)
      })
    })
    if (response != null) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

async function sendViaLinkedInRelay(
  vanityName: string,
  note: string,
  csrfToken: string
): Promise<{ success: boolean; error?: string }> {
  // Always open a fresh feed tab as relay — guarantees a live content script context.
  // Existing tabs may have invalidated content script contexts after extension reloads.
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  if (windows.length === 0) return { success: false, error: 'no_chrome_window' }
  const windowId = windows.find(w => w.focused)?.id ?? windows[0].id

  const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: false, windowId })
  const tabId = tab.id!

  const ready = await waitForContentScript(tabId, 12000)
  if (!ready) {
    await chrome.tabs.remove(tabId).catch(() => {})
    return { success: false, error: 'no_linkedin_session' }
  }

  // 30s timeout — content script calls memberIdentity API for URN + Voyager invite POST
  const result: { success: boolean; error?: string } = await new Promise(resolve => {
    const timeout = setTimeout(() => resolve({ success: false, error: 'no_response' }), 30000)
    chrome.tabs.sendMessage(tabId, { type: 'CONNECT', vanityName, note, csrfToken }, response => {
      void chrome.runtime.lastError
      clearTimeout(timeout)
      resolve(response ?? { success: false, error: 'no_response' })
    })
  })

  await chrome.tabs.remove(tabId).catch(() => {})
  return result
}
