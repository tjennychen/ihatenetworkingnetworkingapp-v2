import { getSupabase, getAuthedSupabase } from '../lib/supabase'
import { checkDailyLimit, getSentTodayCount } from '../lib/rate-limiter'


chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 2 })
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  console.log('I Hate Networking extension installed')
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 2 })
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkQueue') {
    await processNextQueueItem()
    await refreshNextScheduledAt()
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
  // Session forwarded from login-bridge content script
  if (msg.type === 'SET_AUTH' && msg.session) {
    chrome.storage.local.set({ session: msg.session }).then(() => {
      console.log('Session stored from login bridge')
      sendResponse({ ok: true })
    })
    return true
  }
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

  if (msg.type === 'GET_CONFIG') {
    ;(async () => {
      const CONFIG_TTL_MS = 60 * 60 * 1000 // 1 hour
      const stored = await chrome.storage.local.get(['extension_config', 'config_fetched_at'])
      const cachedConfig = stored.extension_config ?? null
      const fetchedAt: number = stored.config_fetched_at ?? 0
      const isFresh = fetchedAt > 0 && (Date.now() - fetchedAt) < CONFIG_TTL_MS

      if (isFresh && cachedConfig) {
        sendResponse({ config: cachedConfig })
        return
      }

      try {
        const supabase = getSupabase()
        const { data, error } = await supabase.from('extension_config').select('key, value')
        if (error || !data) throw error ?? new Error('no data')
        const config: Record<string, any> = {}
        for (const row of data) {
          config[row.key] = row.value
        }
        await chrome.storage.local.set({ extension_config: config, config_fetched_at: Date.now() })
        sendResponse({ config })
      } catch {
        // Supabase fetch failed — return cached value if available, otherwise null
        sendResponse({ config: cachedConfig })
      }
    })()
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

  if (msg.type === 'SIGN_OUT') {
    chrome.storage.local.remove(['session', 'queuePending', 'campaignPaused', 'nextScheduledAt'], () => sendResponse({ success: true }))
    return true
  }

  if (msg.type === 'LOG_SCAN') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ ok: false }); return }
      const supabase = getAuthedSupabase(session.access_token)
      const d = msg.data
      await supabase.from('scan_log').insert({
        user_id: session.user.id,
        event_url: d.eventUrl || '',
        event_name: d.eventName || '',
        button_found: !!d.buttonClicked,
        modal_found: !!d.modalFound,
        api_guests: d.apiGuestsCount ?? 0,
        dom_guests: d.domGuestsCount ?? 0,
        total_contacts: d.totalContacts ?? 0,
        linkedin_count: d.linkedInCount ?? 0,
        error_type: d.errorType || '',
        debug_details: {
          buttonTexts: d.buttonTexts || [],
          preClickLinks: d.preClickLinks ?? 0,
          apiHadSocial: !!d.apiHadSocial,
        },
      })
      sendResponse({ ok: true })
    })
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
        .select('contact_id, status, error, sent_at')
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

      sendResponse({ chartData, dailyCounts: dayCounts, events: eventsWithQueue })
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
    chrome.storage.local.set({ campaignPaused: false, pauseReason: '', consecutiveFailures: 0 }).then(() => updateBadge())
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
        .select('id, name, linkedin_url, linkedin_name, instagram_url, twitter_url, is_host')
        .eq('event_id', msg.eventId)
        .eq('user_id', session.user.id)
      if (!contacts) { sendResponse(null); return }
      const hosts = contacts.filter((c: any) => c.is_host)
      const guests = contacts.filter((c: any) => !c.is_host)
      // Shuffle within tiers: both ig+x first, then one, then neither
      const rand = () => Math.random() - 0.5
      const withBoth = [...guests.filter((g: any) => g.instagram_url && g.twitter_url)].sort(rand)
      const withOne = [...guests.filter((g: any) => (g.instagram_url || g.twitter_url) && !(g.instagram_url && g.twitter_url))].sort(rand)
      const withNone = [...guests.filter((g: any) => !g.instagram_url && !g.twitter_url)].sort(rand)
      const sample = [...withBoth, ...withOne, ...withNone].slice(0, 15)
      sendResponse({ hosts, guests: sample, totalGuests: guests.length })
    })
    return true
  }

  if (msg.type === 'GET_LINKEDIN_NAMES') {
    getSession().then(async (session) => {
      if (!session) { sendResponse([]); return }
      const supabase = getAuthedSupabase(session.access_token)
      const contacts: { id: string; linkedin_url: string }[] = msg.contacts

      // Find ANY existing LinkedIn tab (not just profile pages)
      const linkedinTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' })
      let relayTabId: number | null = linkedinTabs[0]?.id ?? null
      let openedTabId: number | null = null

      if (!relayTabId && contacts.length > 0) {
        // Open a background tab (NOT a minimized window — per FIXES.md)
        const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: false })
        openedTabId = tab.id!
        // Wait for the tab to load so the content script is injected
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

      let results: { id: string; linkedin_name: string }[] = []

      if (relayTabId !== null) {
        // Verify content script is alive before delegating
        const ready = await waitForContentScript(relayTabId, 8000)
        if (ready) {
          results = await new Promise<{ id: string; linkedin_name: string }[]>((resolve) => {
            const timeout = setTimeout(() => resolve([]), 60000)
            chrome.tabs.sendMessage(relayTabId!, { type: 'FETCH_LINKEDIN_PROFILES', contacts }, (response) => {
              void chrome.runtime.lastError
              clearTimeout(timeout)
              resolve(response ?? [])
            })
          })
        }
      }

      if (openedTabId) chrome.tabs.remove(openedTabId).catch(() => {})

      // Persist names to Supabase (skip generic/invalid names) — fire in parallel, don't block response
      const validResults = results.filter(r => r.linkedin_name && !/^(LinkedIn|Log In|Sign In|Sign Up)$/i.test(r.linkedin_name.trim()))
      Promise.all(validResults.map(r => supabase.from('contacts').update({ linkedin_name: r.linkedin_name }).eq('id', r.id))).catch(() => {})

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
  // Default: 15-25 min random gap. If < 2h until 11pm cutoff, compress to fit.
  const newItems = contacts.filter((c: any) => !alreadyDone.has(c.id))
  const hour = new Date().getHours()
  const hoursUntil11 = Math.max(0, 23 - hour)
  const baseGapMin = hoursUntil11 < 2 && newItems.length > 1
    ? Math.max(5, (hoursUntil11 * 60) / newItems.length)
    : 15
  let cumulativeMs = 0
  const queueItems = newItems.map((c: any, i: number) => {
    if (i > 0) cumulativeMs += (baseGapMin + Math.random() * 10) * 60000 // +0-10 min jitter
    return {
      user_id: session.user.id,
      contact_id: c.id,
      status: 'pending',
      note: data.note || '',
      scheduled_at: new Date(Date.now() + cumulativeMs).toISOString(),
    }
  })

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
  await chrome.storage.local.set({ queuePending: totalPending, nextScheduledAt: new Date().toISOString() })
  updateBadge()

  return { queued: contacts.length, eventId }
}

async function refreshNextScheduledAt(): Promise<void> {
  const session = await getSession()
  if (!session) return
  const supabase = getAuthedSupabase(session.access_token)
  const { data } = await supabase
    .from('connection_queue')
    .select('scheduled_at')
    .eq('user_id', session.user.id)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .single()
  if (data?.scheduled_at) {
    await chrome.storage.local.set({ nextScheduledAt: data.scheduled_at })
  }
}

async function processNextQueueItem(): Promise<void> {
  // Only send during daytime hours (6am–11pm local) to look natural
  const hour = new Date().getHours()
  if (hour < 6 || hour >= 23) return

  const { campaignPaused, consecutiveFailures: prevFailures } = await chrome.storage.local.get(['campaignPaused', 'consecutiveFailures'])
  if (campaignPaused) return
  let consecutiveFailures: number = prevFailures ?? 0

  const session = await getSession()
  if (!session) { console.log('[IHN] processNextQueueItem: no session'); return }

  const supabase = getAuthedSupabase(session.access_token)

  const sentToday = await getSentTodayCount(supabase, session.user.id)
  const { canSend } = checkDailyLimit(sentToday)
  if (!canSend) return

  // Read CSRF token once per tick (shared across all items in this loop)
  const jsessionCookie = await new Promise<chrome.cookies.Cookie | null>(resolve =>
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, c => resolve(c ?? null))
  )
  const csrfToken = jsessionCookie ? decodeURIComponent(jsessionCookie.value).replace(/^"|"$/g, '') : ''

  // Loop: skip failed/already-connected items immediately, only pause after a successful send.
  // After a skip, ignore scheduled_at so we grab the next item even if it's future-scheduled.
  let skipMode = false
  while (true) {
    let query = supabase
      .from('connection_queue')
      .select('*, contacts(linkedin_url, name, event_id)')
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
    if (!skipMode) {
      query = query.lte('scheduled_at', new Date().toISOString())
    }
    const { data: item } = await query
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

    // No LinkedIn URL → mark failed, try next immediately
    if (!linkedinUrl) {
      await supabase.from('connection_queue').update({ status: 'failed', error: 'no_linkedin_url' }).eq('id', item.id)
      console.log('[IHN] No LinkedIn URL, skipping to next')
      skipMode = true
      continue
    }

    // Validate the LinkedIn URL — catch corrupted data early
    const vanityFromUrl = (() => {
      try { return new URL(linkedinUrl.replace('https://linkedin.com/', 'https://www.linkedin.com/')).pathname.split('/').filter(Boolean)[1] ?? '' }
      catch { return '' }
    })()
    const invalidVanity = !vanityFromUrl || vanityFromUrl.toLowerCase() === 'none' || vanityFromUrl.includes(' ')
    if (invalidVanity) {
      await supabase.from('connection_queue').update({ status: 'failed', error: 'invalid_linkedin_url' }).eq('id', item.id)
      console.log('[IHN] Invalid LinkedIn URL, skipping to next')
      skipMode = true
      continue
    }

    // No CSRF token → not logged into LinkedIn, defer this item and stop
    if (!csrfToken) {
      await supabase.from('connection_queue').update({
        scheduled_at: new Date(Date.now() + 10 * 60000).toISOString(),
      }).eq('id', item.id)
      console.log('[IHN] No JSESSIONID cookie — not logged into LinkedIn, deferring')
      return
    }

    const firstName = (item.contacts as any)?.name?.split(' ')[0] || ''
    const resolvedNote = (item.note || '').replace(/\[first name\]/gi, firstName)

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

      // Schedule next item: 15-30 min normally, compressed if < 2h until 11pm cutoff
      const nowHour = new Date().getHours()
      const hrsLeft = Math.max(0, 23 - nowHour)
      const minGap = hrsLeft < 2 ? 8 : 15
      const maxGap = hrsLeft < 2 ? 15 : 30
      const delayMinutes = minGap + Math.random() * (maxGap - minGap)
      const nextScheduledAt = new Date(Date.now() + delayMinutes * 60000).toISOString()
      // Push ALL past-due pending items to the future in one query.
      await supabase.from('connection_queue')
        .update({ scheduled_at: nextScheduledAt })
        .eq('user_id', session.user.id)
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())

      const { queuePending: storedPending } = await chrome.storage.local.get('queuePending')
      await chrome.storage.local.set({
        queuePending: Math.max(0, (storedPending ?? 1) - 1),
        lastSentAt: sentAt,
        lastSentName: (item.contacts as any)?.name ?? '',
        nextScheduledAt,
        consecutiveFailures: 0,
      })
      return // ← only wait after a successful send

    } else if (result.error === 'no_linkedin_session' || result.error === 'no_csrf_token') {
      // Couldn't reach LinkedIn (tab not ready / not logged in) — don't defer, just stop.
      // The alarm fires every 2 min so it will retry naturally without pushing the item further out.
      console.log('[IHN] LinkedIn unreachable, will retry on next tick')
      return

    } else if (result.error === 'weekly_limit_reached') {
      // LinkedIn weekly invite cap — defer all pending items 6 hours and stop
      await supabase.from('connection_queue').update({
        status: 'failed',
        error: 'weekly_limit_reached',
      }).eq('id', item.id)
      await chrome.storage.local.set({
        campaignPaused: true,
        pauseReason: 'Auto-paused: LinkedIn weekly invite limit reached. Try again in a few days.',
      })
      updateBadge()
      return

    } else if (result.error?.startsWith('not_logged_in')) {
      // LinkedIn session expired — defer and stop
      await supabase.from('connection_queue').update({
        scheduled_at: new Date(Date.now() + 10 * 60000).toISOString(),
      }).eq('id', item.id)
      return

    } else {
      // Profile-specific failure (already_connected, already_pending, no_profile_urn, api_error, etc.)
      // → mark failed and immediately try the next item
      await supabase.from('connection_queue').update({
        status: 'failed',
        error: result.error ?? 'unknown',
      }).eq('id', item.id)

      // Only count real failures toward auto-pause, not expected skips.
      // api_error_400 = profile has connection restrictions — treat as a skip.
      const isExpectedSkip = result.error === 'already_connected' || result.error === 'already_pending'
        || (result.error?.startsWith('api_error_400:') ?? false)
      if (!isExpectedSkip) {
        consecutiveFailures++
        const { queuePending: sp } = await chrome.storage.local.get('queuePending')
        await chrome.storage.local.set({ queuePending: Math.max(0, (sp ?? 1) - 1), consecutiveFailures })

        if (consecutiveFailures >= 5) {
          await chrome.storage.local.set({
            campaignPaused: true,
            pauseReason: `Auto-paused: ${consecutiveFailures} unexpected errors in a row. Check your LinkedIn session and resume when ready.`,
          })
          updateBadge()
          return
        }
      } else {
        // Expected skip — just decrement pending count, reset consecutive failures
        const { queuePending: sp } = await chrome.storage.local.get('queuePending')
        await chrome.storage.local.set({ queuePending: Math.max(0, (sp ?? 1) - 1), consecutiveFailures: 0 })
      }

      console.log('[IHN] Skipped, trying next immediately')
      skipMode = true
      continue // ← no delay for skips
    }
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
  // Prefer an existing LinkedIn tab — avoids opening a visible new tab.
  // But after an extension reload, content scripts aren't re-injected into existing tabs,
  // so if the existing tab doesn't respond, fall back to opening a fresh tab.
  const existingTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' })
  const existingTabId = existingTabs[0]?.id ?? null

  let tabId: number
  let openedTabId: number | null = null

  async function openFreshTab(): Promise<void> {
    const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: false })
    openedTabId = tab.id!
    tabId = openedTabId
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 15000)
      chrome.tabs.onUpdated.addListener(function listener(tid, info) {
        if (tid === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          clearTimeout(timeout)
          setTimeout(resolve, 1000)
        }
      })
    })
  }

  if (existingTabId) {
    tabId = existingTabId
    console.log('[IHN] Using existing LinkedIn tab', existingTabId, existingTabs[0]?.url)
  } else {
    console.log('[IHN] No existing LinkedIn tab, opening fresh one')
    await openFreshTab()
    console.log('[IHN] Fresh tab loaded, id=', tabId)
  }

  let ready = await waitForContentScript(tabId, 8000)
  console.log('[IHN] waitForContentScript (first):', ready, 'tabId=', tabId)
  if (!ready && existingTabId) {
    // Existing tab's content script not responding (e.g. extension just reloaded).
    // Fall back to a fresh tab which will get the content script injected on load.
    console.log('[IHN] Existing LinkedIn tab unresponsive, opening fresh tab')
    await openFreshTab()
    console.log('[IHN] Fresh tab loaded (fallback), id=', tabId)
    ready = await waitForContentScript(tabId, 8000)
    console.log('[IHN] waitForContentScript (fallback):', ready)
  }
  if (!ready) {
    if (openedTabId) await chrome.tabs.remove(openedTabId).catch(() => {})
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

  // Only close the tab if we opened it
  if (openedTabId) await chrome.tabs.remove(openedTabId).catch(() => {})
  return result
}
