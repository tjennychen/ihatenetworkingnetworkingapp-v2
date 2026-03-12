// ── Exported pure helpers (testable with jsdom) ─────────────────────────────

export function parseGuestLinks(doc: Document): string[] {
  const selectors = ["a[href*='/u/']", "a[href*='/user/']"]
  const seen = new Set<string>()
  const links: string[] = []

  for (const sel of selectors) {
    doc.querySelectorAll<HTMLAnchorElement>(sel).forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) {
        seen.add(href)
        links.push(href)
      }
    })
  }

  // Fallback: if no /u/ or /user/ links found, search broader inside modal/dialog
  if (links.length === 0) {
    const modalEl = doc.querySelector('[role="dialog"], [class*="modal"], [class*="guest"], [class*="attendee"]')
    if (modalEl) {
      modalEl.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
        const href = a.href || a.getAttribute('href') || ''
        if (!href || seen.has(href)) return
        try {
          const u = new URL(href, location.origin)
          const isLuma = u.hostname.includes('lu.ma') || u.hostname.includes('luma.com') || u.hostname === location.hostname
          if (!isLuma) return
          const parts = u.pathname.split('/').filter(Boolean)
          // Accept /u/x, /user/x, or any 2-segment luma path that looks like a profile
          if (parts.length >= 2 && (parts[0] === 'u' || parts[0] === 'user' || parts[0] === 'p')) {
            seen.add(href); links.push(href)
          }
        } catch {}
      })
    }
  }

  return links
}

export function extractLinkedInUrl(doc: Document): string {
  const selectors = [
    "a[href*='linkedin.com/in/']",
    "a[href*='linkedin.com/pub/']",
  ]
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLAnchorElement>(sel)
    if (el) return el.href || el.getAttribute('href') || ''
  }
  return ''
}

export function extractInstagramUrl(doc: Document): string {
  const el = doc.querySelector<HTMLAnchorElement>("a[href*='instagram.com/']")
  return el ? (el.href || el.getAttribute('href') || '') : ''
}

export function extractEventName(doc: Document): string {
  const selectors = ['h1', '[class*="event-title"]', '[class*="title"] h1']
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  return ''
}

export function extractHostName(doc: Document): string {
  const selectors = [
    '[class*="organizer"] [class*="name"]',
    '[class*="host"] [class*="name"]',
    '[data-testid*="organizer"]',
  ]
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  return ''
}

export function extractHostProfileUrls(doc: Document): string[] {
  const hostSections = doc.querySelectorAll('[class*="organizer"], [class*="host"]')
  const seen = new Set<string>()
  const urls: string[] = []

  hostSections.forEach(section => {
    section.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']").forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) {
        seen.add(href)
        urls.push(href)
      }
    })
  })
  return urls
}

export function extractDisplayName(doc: Document): string {
  // Used when visiting individual Luma profile pages
  const h1 = doc.querySelector('h1')
  if (h1?.textContent?.trim()) return h1.textContent.trim()

  const titleEl = doc.querySelector('title')
  if (titleEl?.textContent) {
    const match = titleEl.textContent.match(/^([^|<\n]+?)\s*(?:\||$)/)
    if (match) return match[1].trim()
  }
  return ''
}

// ── Short event name helper ───────────────────────────────────────────────────

export function shortEventName(name: string): string {
  // Strip trailing "· City · Date" patterns
  return name.replace(/\s*·\s*[^·]+$/, '').replace(/\s*·\s*[^·]+$/, '').trim()
}

// ── Scroll helper ────────────────────────────────────────────────────────────

async function scrollToLoadAll(container: Element | null, maxIter = 15): Promise<void> {
  if (!container) return
  let prevHeight = 0
  for (let i = 0; i < maxIter; i++) {
    (container as HTMLElement).scrollTop += 600
    await new Promise(r => setTimeout(r, 500))
    const newHeight = container.scrollHeight
    if (newHeight === prevHeight) break
    prevHeight = newHeight
  }
}

// ── Guest modal opener ───────────────────────────────────────────────────────

function findAndOpenGuestButton(): boolean {
  const labels = ['Guests', 'Going', 'Attendees', 'See all', 'Went']
  for (const label of labels) {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
    const btn = btns.find(b => b.textContent?.includes(label)) as HTMLElement | undefined
    if (btn) { btn.click(); return true }
  }
  return false
}

// ── Main scrape function ─────────────────────────────────────────────────────

async function scrapeLumaPage(): Promise<{
  eventName: string
  hostName: string
  hostProfileUrls: string[]
  guestProfileUrls: string[]
}> {
  const eventName = extractEventName(document)
  const hostName  = extractHostName(document)
  const hostProfileUrls = extractHostProfileUrls(document)

  findAndOpenGuestButton()
  await new Promise(r => setTimeout(r, 1000))

  const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="guest-list"]')
  await scrollToLoadAll(modal ?? document.scrollingElement)

  const allLinks = parseGuestLinks(document)
  const hostSet = new Set(hostProfileUrls)
  const guestProfileUrls = allLinks.filter(u => !hostSet.has(u))

  return { eventName, hostName, hostProfileUrls, guestProfileUrls }
}

// ── HTML-based extractors (for fetched profile pages) ────────────────────────

function findModalScrollable(preClickLinks: Set<string>): Element | null {
  // Try /u/ and /user/ links first
  const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']"))
  const newLinks = allLinks.filter(a => {
    const href = a.href || a.getAttribute('href') || ''
    return href && !preClickLinks.has(href)
  })
  if (newLinks.length > 0) {
    let el: Element | null = newLinks[0].parentElement
    while (el && el !== document.documentElement) {
      const s = getComputedStyle(el)
      if ((s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el
      el = el.parentElement
    }
  }
  // Fallback: find any scrollable element inside a dialog/modal
  const dialogEl = document.querySelector('[role="dialog"], [class*="modal"]')
  if (dialogEl) {
    const scrollables = dialogEl.querySelectorAll('*')
    for (const candidate of scrollables) {
      const s = getComputedStyle(candidate)
      if ((s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll') && candidate.scrollHeight > candidate.clientHeight + 10) return candidate
    }
    // If the dialog itself is scrollable
    const ds = getComputedStyle(dialogEl)
    if ((ds.overflow === 'auto' || ds.overflow === 'scroll' || ds.overflowY === 'auto' || ds.overflowY === 'scroll') && dialogEl.scrollHeight > dialogEl.clientHeight + 10) return dialogEl
  }
  return null
}

// ── Parse __NEXT_DATA__ for rich profile info ────────────────────────────────

interface LumaProfileData {
  name: string
  linkedInUrl: string
  instagramUrl: string
  twitterUrl: string
  websiteUrl: string
}

function extractProfileFromNextData(html: string): LumaProfileData | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    const data = JSON.parse(match[1])
    const user = data?.props?.pageProps?.initialData?.user
    if (!user?.name) return null
    return {
      name: user.name,
      linkedInUrl: user.linkedin_handle ? `https://www.linkedin.com${user.linkedin_handle.startsWith('/') ? '' : '/in/'}${user.linkedin_handle}` : '',
      instagramUrl: user.instagram_handle ? `https://www.instagram.com/${user.instagram_handle}` : '',
      twitterUrl: user.twitter_handle ? `https://x.com/${user.twitter_handle}` : '',
      websiteUrl: user.website || '',
    }
  } catch { return null }
}

// ── Fallback HTML-based extractors ───────────────────────────────────────────

function extractLinkedInUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^"?#]+)[^"]*"/)
  return match ? match[1] : ''
}

function extractInstagramUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?instagram\.com\/[^"?#/][^"?#]*)[^"]*"/)
  return match ? match[1] : ''
}

function extractTwitterUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^"?#/][^"?#]*)[^"]*"/)
  return match ? match[1] : ''
}

function extractWebsiteUrlFromHtml(html: string): string {
  const skip = /linkedin\.com|instagram\.com|twitter\.com|x\.com|lu\.ma|luma\.co/
  const matches = html.matchAll(/href="(https?:\/\/[^"]+)"[^>]*target="_blank"/g)
  for (const m of matches) { if (!skip.test(m[1])) return m[1] }
  return ''
}

function extractDisplayNameFromHtml(html: string): string {
  const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/)
  const raw = titleMatch ? titleMatch[1].trim()
            : (html.match(/property="og:title"\s+content="([^"]+)"/) ?? [])[1]?.trim() ?? ''
  return raw.replace(/\s*·\s*Luma\s*$/i, '').trim()
}

// ── Fetch interceptor: capture Luma's guest API response ─────────────────────

interface LumaGuestEntry {
  username: string
  name: string
  profileUrl: string
  linkedInUrl: string
  instagramUrl: string
  twitterUrl: string
  websiteUrl: string
}

function installGuestApiInterceptor(apiPatternOverride?: RegExp): { getGuests: () => LumaGuestEntry[], cleanup: () => void } {
  const capturedMap = new Map<string, LumaGuestEntry>()
  const originalFetch = window.fetch
  const originalXhrOpen = XMLHttpRequest.prototype.open
  const originalXhrSend = XMLHttpRequest.prototype.send
  const profileBase = location.origin.replace(/\/$/, '')

  const GUEST_API_PATTERN = apiPatternOverride ?? /(guest|guests|ticket|tickets|attendee|attendees|rsvp|participant|participants)/i

  const addGuest = (usernameRaw: string, nameRaw: string, social: { linkedin?: string; instagram?: string; twitter?: string; website?: string }): void => {
    const username = String(usernameRaw || '').trim().replace(/^\/+/, '').replace(/^u\//, '')
    if (!username) return
    if (capturedMap.has(username)) return
    capturedMap.set(username, {
      username,
      name: String(nameRaw || '').trim(),
      profileUrl: `${profileBase}/u/${username}`,
      linkedInUrl: social.linkedin ? (social.linkedin.startsWith('http') ? social.linkedin : `https://www.linkedin.com/in/${social.linkedin}`) : '',
      instagramUrl: social.instagram ? (social.instagram.startsWith('http') ? social.instagram : `https://www.instagram.com/${social.instagram}`) : '',
      twitterUrl: social.twitter ? (social.twitter.startsWith('http') ? social.twitter : `https://x.com/${social.twitter}`) : '',
      websiteUrl: social.website || '',
    })
  }

  const visitNodes = (node: any, visitor: (obj: Record<string, any>) => void): void => {
    if (!node) return
    if (Array.isArray(node)) {
      node.forEach(child => visitNodes(child, visitor))
      return
    }
    if (typeof node !== 'object') return
    visitor(node)
    Object.values(node).forEach(child => visitNodes(child, visitor))
  }

  const captureFromPayload = (payload: any, sourceUrl: string): void => {
    let before = capturedMap.size
    visitNodes(payload, (obj) => {
      const user = obj.user && typeof obj.user === 'object' ? obj.user : obj
      const username = user.username ?? user.slug ?? user.handle ?? user.user_handle
      if (!username) return
      const name = user.name ?? user.display_name ?? user.full_name ?? ''
      addGuest(username, name, {
        linkedin: user.linkedin_handle ?? user.linkedin ?? '',
        instagram: user.instagram_handle ?? user.instagram ?? '',
        twitter: user.twitter_handle ?? user.twitter ?? '',
        website: user.website ?? user.website_url ?? '',
      })
    })
    const added = capturedMap.size - before
    if (added > 0) {
      console.log('[IHN] Intercepted API guests from', sourceUrl, 'added:', added, 'total:', capturedMap.size)
    }
  }

  window.fetch = async function (this: WindowOrWorkerGlobalScope, ...args: Parameters<typeof fetch>) {
    const response = await originalFetch.apply(this, args)
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? ''
    if (GUEST_API_PATTERN.test(url)) {
      try {
        const clone = response.clone()
        const data = await clone.json()
        captureFromPayload(data, url)
      } catch {}
    }
    return response
  } as typeof fetch

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    ;(this as any).__ihnUrl = String(url ?? '')
    return originalXhrOpen.call(this, method, url, async ?? true, username ?? null, password ?? null)
  }

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', function () {
      const url = (this as any).__ihnUrl || this.responseURL || ''
      if (!GUEST_API_PATTERN.test(url)) return
      const contentType = this.getResponseHeader('content-type') ?? ''
      if (!/json/i.test(contentType) && typeof this.responseText !== 'string') return
      try {
        const text = typeof this.responseText === 'string' ? this.responseText : ''
        if (!text) return
        const data = JSON.parse(text)
        captureFromPayload(data, url)
      } catch {}
    })
    return originalXhrSend.call(this, body as any)
  }

  return {
    getGuests: () => Array.from(capturedMap.values()),
    cleanup: () => {
      window.fetch = originalFetch
      XMLHttpRequest.prototype.open = originalXhrOpen
      XMLHttpRequest.prototype.send = originalXhrSend
    },
  }
}

// ── DOM-based guest extraction (fallback) ────────────────────────────────────

function extractGuestProfileUrlsFromPage(): string[] {
  // Collect all /u/ and /user/ links on the entire page
  const seen = new Set<string>()
  const urls: string[] = []
  document.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']").forEach(a => {
    const href = a.href || a.getAttribute('href') || ''
    if (href && !seen.has(href)) { seen.add(href); urls.push(href) }
  })
  return urls
}

// ── Scan runner ──────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  const eventName = document.querySelector('h1')?.textContent?.trim() ?? document.title
  const lumaUrl = location.href

  // Fetch remote config (falls back to hardcoded defaults if unavailable)
  let remoteConfig: any = null
  try {
    remoteConfig = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (resp) => {
        resolve(resp?.config || null)
      })
    })
  } catch {}

  // Build API pattern from remote config if available
  const apiPatternOverride: RegExp | undefined = remoteConfig?.luma_api_pattern
    ? new RegExp(remoteConfig.luma_api_pattern, 'i')
    : undefined

  // Install fetch interceptor BEFORE clicking the guest button
  const interceptor = installGuestApiInterceptor(apiPatternOverride)

  // Collect links already on page (hosts etc.)
  const preClickLinks = new Set(extractGuestProfileUrlsFromPage())
  console.log('[IHN] Pre-click /u/ links on page:', preClickLinks.size)

  const buttonLabels: string[] = remoteConfig?.luma_button_labels ||
    ["Guests", "Going", "Attendees", "See all", "Went", "Registered"]
  const labelPatterns = [
    /\band \d+ others\b/i,
    ...buttonLabels.map(label => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))
  ]
  const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
  const allBtnTexts = allBtns.map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20)
  let buttonClicked = false
  for (const pattern of labelPatterns) {
    const btn = allBtns.find(b => pattern.test(b.textContent ?? ''))
    if (btn) { btn.click(); buttonClicked = true; break }
  }
  console.log('[IHN] Guest button clicked:', buttonClicked)

  // Wait for modal + API response
  await new Promise(r => setTimeout(r, 3000))

  // Try scrolling the modal to load all guests
  const modal = findModalScrollable(new Set())
  if (modal) {
    console.log('[IHN] Scrollable modal found, scrolling to load all')
    await scrollToLoadAll(modal, 20)
    // Wait for any additional API calls after scroll
    await new Promise(r => setTimeout(r, 1500))
  }

  interceptor.cleanup()

  // Strategy 1: Use intercepted API data (best)
  let apiGuests = interceptor.getGuests()
  console.log('[IHN] Intercepted API guests:', apiGuests.length)

  // Strategy 2: If API interception got nothing, use DOM links
  if (apiGuests.length === 0) {
    const postClickLinks = extractGuestProfileUrlsFromPage()
    console.log('[IHN] Post-click /u/ links on page:', postClickLinks.length)
    apiGuests = postClickLinks.map(url => ({
      username: url.split('/').pop() ?? '',
      name: '',
      profileUrl: url,
      linkedInUrl: '', instagramUrl: '', twitterUrl: '', websiteUrl: '',
    }))
  }

  // Separate hosts from guests
  const hostProfileUrls = extractHostProfileUrls(document)
  const hostSet = new Set(hostProfileUrls)

  // Normalize profile URLs to current page origin to avoid cross-origin CORS blocks.
  const normalizeProfileUrl = (url: string): string => {
    try {
      const u = new URL(url, location.origin)
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length >= 2 && (parts[0] === 'user' || parts[0] === 'u')) {
        return `${location.origin.replace(/\/$/, '')}/u/${parts[1]}`
      }
    } catch {}
    return url
  }

  // Build contacts from API data (social handles already captured from API response)
  const seen = new Set<string>()
  const contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string; twitterUrl: string; websiteUrl: string }[] = []

  // Add hosts first
  for (const h of hostProfileUrls) {
    const norm = normalizeProfileUrl(h)
    if (seen.has(norm)) continue
    seen.add(norm)
    const apiEntry = apiGuests.find(g => normalizeProfileUrl(g.profileUrl) === norm)
    contacts.push({
      url: norm, isHost: true,
      name: apiEntry?.name || norm.split('/').pop()?.replace(/-/g, ' ') || '',
      linkedInUrl: apiEntry?.linkedInUrl || '',
      instagramUrl: apiEntry?.instagramUrl || '',
      twitterUrl: apiEntry?.twitterUrl || '',
      websiteUrl: apiEntry?.websiteUrl || '',
    })
  }

  // Add guests
  for (const g of apiGuests) {
    const norm = normalizeProfileUrl(g.profileUrl)
    if (seen.has(norm)) continue
    seen.add(norm)
    const isHost = hostSet.has(g.profileUrl) || hostProfileUrls.some(h => normalizeProfileUrl(h) === norm)
    contacts.push({
      url: norm, isHost,
      name: g.name || norm.split('/').pop()?.replace(/-/g, ' ') || '',
      linkedInUrl: g.linkedInUrl,
      instagramUrl: g.instagramUrl,
      twitterUrl: g.twitterUrl,
      websiteUrl: g.websiteUrl,
    })
  }

  const apiHadSocial = contacts.some(c => c.linkedInUrl)
  console.log('[IHN] Contacts from API:', contacts.length, 'with LinkedIn from API:', contacts.filter(c => c.linkedInUrl).length)

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'scraping_done', total: contacts.length, eventName, lumaUrl })

  // Only fetch individual profile pages if the API didn't return social handles
  if (!apiHadSocial && contacts.length > 0) {
    console.log('[IHN] API had no social data, fetching profile pages as fallback')
    let done = 0
    for (const contact of contacts) {
      try {
        const resp = await fetch(contact.url, { credentials: 'include' })
        const html = await resp.text()
        const profile = extractProfileFromNextData(html)
        if (profile) {
          contact.name = profile.name || contact.name
          contact.linkedInUrl = profile.linkedInUrl
          contact.instagramUrl = profile.instagramUrl
          contact.twitterUrl = profile.twitterUrl
          contact.websiteUrl = profile.websiteUrl
        } else {
          contact.name = extractDisplayNameFromHtml(html) || contact.name
          contact.linkedInUrl = extractLinkedInUrlFromHtml(html)
          contact.instagramUrl = extractInstagramUrlFromHtml(html)
          contact.twitterUrl = extractTwitterUrlFromHtml(html)
          contact.websiteUrl = extractWebsiteUrlFromHtml(html)
        }
      } catch (err) {
        console.error('[IHN] Fetch failed for', contact.url, err)
      }
      done++
      chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'enriching', done, total: contacts.length, currentName: contact.name })
    }
  }

  console.log('[IHN] Enrichment done. Contacts:', contacts.length, 'with LinkedIn:', contacts.filter(c => c.linkedInUrl).length)

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'saving', done: contacts.length, total: contacts.length })

  const saveResult: { eventId: string; found: number; total: number } = await Promise.race([
    new Promise<any>(resolve => {
      chrome.runtime.sendMessage({ type: 'START_ENRICHMENT', data: { tabId: 0, lumaUrl, eventName, contacts } }, resolve)
    }),
    new Promise<any>(resolve => setTimeout(() => resolve({ eventId: '', found: 0, total: contacts.length }), 15000)),
  ])

  // Use actual content-script counts — saveResult may return 0s if session/save failed
  const actualTotal = contacts.length
  const actualFound = contacts.filter(c => c.linkedInUrl).length
  console.log('[IHN] SCAN_COMPLETE sending. total:', actualTotal, 'found:', actualFound, 'eventId:', saveResult.eventId || '(save failed)')

  // Always send diagnostics — not just on zero contacts
  const scanDebug = {
    eventUrl: lumaUrl,
    buttonClicked,
    buttonTexts: allBtnTexts.slice(0, 10),
    preClickLinks: preClickLinks.size,
    apiGuestsCount: apiGuests.length,
    domGuestsCount: extractGuestProfileUrlsFromPage().length,
    modalFound: !!modal,
    apiHadSocial,
  }

  chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', eventId: saveResult.eventId, total: actualTotal, found: actualFound, contacts, scanDebug })
}

// ── Message listener ─────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_SCAN') {
    runScan() // fire and forget — progress sent back via runtime.sendMessage
    sendResponse({ started: true })
    return true
  }

  if (msg.type === 'SCRAPE_LUMA' || msg.type === 'SCRAPE_LUMA_FOR_POST') {
    scrapeLumaPage().then(result => {
      sendResponse({
        count: result.guestProfileUrls.length + result.hostProfileUrls.length,
        eventName: result.eventName,
        hostName: result.hostName,
        hostProfileUrls: result.hostProfileUrls,
        guestProfileUrls: result.guestProfileUrls,
      })
    })
    return true
  }
  if (msg.type === 'GET_PREVIEW_EVENT_URL') {
    const nonEventPaths = new Set(['', '/', '/home', '/calendar', '/events', '/discover', '/explore', '/settings', '/dashboard'])
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    const eventLink = links.find(a => {
      try {
        const url = new URL(a.href)
        if (!url.hostname.includes('lu.ma') && !url.hostname.includes('luma.com')) return false
        const parts = url.pathname.split('/').filter(Boolean)
        return parts.length === 1 && !nonEventPaths.has('/' + parts[0])
      } catch { return false }
    })
    const name = eventLink ? (eventLink.closest('[class*="event"], [class*="card"], [class*="item"]')?.querySelector('h1,h2,h3,[class*="title"],[class*="name"]')?.textContent?.trim() ?? null) : null
    sendResponse({ url: eventLink?.href ?? null, name })
    return false
  }
})
