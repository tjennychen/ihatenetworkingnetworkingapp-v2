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
  const labels = ['Guests', 'Going', 'Attendees', 'See all']
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
  const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']"))
  const newLinks = allLinks.filter(a => {
    const href = a.href || a.getAttribute('href') || ''
    return href && !preClickLinks.has(href)
  })
  if (newLinks.length === 0) return null
  let el: Element | null = newLinks[0].parentElement
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if ((s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el
    el = el.parentElement
  }
  return null
}

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

// ── Scan runner ──────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  const eventName = document.querySelector('h1')?.textContent?.trim() ?? document.title
  const lumaUrl = location.href

  const preClickLinks = new Set(parseGuestLinks(document))
  const labelPatterns = [/\band \d+ others\b/i, /\bGuests\b/, /\bGoing\b/, /\bAttendees\b/, /\bSee all\b/]
  const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
  for (const pattern of labelPatterns) {
    const btn = allBtns.find(b => pattern.test(b.textContent ?? ''))
    if (btn) { btn.click(); break }
  }
  await new Promise(r => setTimeout(r, 2500))

  const modal = findModalScrollable(preClickLinks)
  await scrollToLoadAll(modal ?? document.scrollingElement)

  const hostProfileUrls = extractHostProfileUrls(document)
  const allLinks = parseGuestLinks(document)
  const hostSet = new Set(hostProfileUrls)
  const guestProfileUrls = allLinks.filter(u => !hostSet.has(u))
  const allProfileUrls = [...hostProfileUrls, ...guestProfileUrls]

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'scraping_done', total: allProfileUrls.length, eventName, lumaUrl })

  let done = 0
  const contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string; twitterUrl: string; websiteUrl: string }[] = []

  for (const url of allProfileUrls) {
    const isHost = hostSet.has(url)
    try {
      const resp = await fetch(url, { credentials: 'include' })
      const html = await resp.text()
      contacts.push({
        url,
        isHost,
        name: extractDisplayNameFromHtml(html),
        linkedInUrl: extractLinkedInUrlFromHtml(html),
        instagramUrl: extractInstagramUrlFromHtml(html),
        twitterUrl: extractTwitterUrlFromHtml(html),
        websiteUrl: extractWebsiteUrlFromHtml(html),
      })
    } catch {
      contacts.push({ url, isHost, name: url.split('/').pop()?.replace(/-/g, ' ') ?? '', linkedInUrl: '', instagramUrl: '', twitterUrl: '', websiteUrl: '' })
    }
    done++
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'enriching', done, total: allProfileUrls.length, currentName: contacts[contacts.length - 1].name })
  }

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'saving', done, total: allProfileUrls.length })

  const saveResult: { eventId: string; found: number; total: number } = await new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'START_ENRICHMENT',
      data: { tabId: 0, lumaUrl, eventName, contacts }
    }, resolve)
  })

  chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', ...saveResult, contacts })
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
