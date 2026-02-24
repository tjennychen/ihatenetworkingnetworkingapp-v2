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

// ── Message listener ─────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
})
