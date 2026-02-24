// ── Inline scraping helpers (avoids importing luma.ts and its message listener) ─

function parseGuestLinksFromDoc(doc: Document): string[] {
  const selectors = ["a[href*='/u/']", "a[href*='/user/']"]
  const seen = new Set<string>()
  const links: string[] = []
  for (const sel of selectors) {
    doc.querySelectorAll<HTMLAnchorElement>(sel).forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) { seen.add(href); links.push(href) }
    })
  }
  return links
}

function extractHostProfileUrlsFromDoc(doc: Document): string[] {
  const hostSections = doc.querySelectorAll('[class*="organizer"], [class*="host"]')
  const seen = new Set<string>()
  const urls: string[] = []
  hostSections.forEach(section => {
    section.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']").forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) { seen.add(href); urls.push(href) }
    })
  })
  return urls
}

function shortEventName(name: string): string {
  return name.replace(/\s*·\s*[^·]+$/, '').replace(/\s*·\s*[^·]+$/, '').trim()
}

async function scrollToLoadAll(container: Element | null, maxIter = 15): Promise<void> {
  if (!container) return
  let prevHeight = 0
  for (let i = 0; i < maxIter; i++) {
    (container as HTMLElement).scrollTop += 600
    await new Promise(r => setTimeout(r, 500))
    if (container.scrollHeight === prevHeight) break
    prevHeight = container.scrollHeight
  }
}

async function scrapeLuma(): Promise<{
  eventName: string
  hostProfileUrls: string[]
  guestProfileUrls: string[]
}> {
  const eventName = document.querySelector('h1')?.textContent?.trim() ?? document.title

  // Open guest modal
  const labels = ['Guests', 'Going', 'Attendees', 'See all']
  for (const label of labels) {
    const btn = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find(b => b.textContent?.includes(label)) as HTMLElement | undefined
    if (btn) { btn.click(); break }
  }
  await new Promise(r => setTimeout(r, 1000))

  const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="guest-list"]')
  await scrollToLoadAll(modal ?? document.scrollingElement)

  const hostProfileUrls = extractHostProfileUrlsFromDoc(document)
  const allLinks = parseGuestLinksFromDoc(document)
  const hostSet = new Set(hostProfileUrls)
  const guestProfileUrls = allLinks.filter(u => !hostSet.has(u))

  return { eventName, hostProfileUrls, guestProfileUrls }
}

// ── Inline Luma profile parsers (run in content script = has cookies, no 403) ─

function extractLinkedInUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^"?#]+)[^"]*"/)
  return match ? match[1] : ''
}

function extractDisplayNameFromHtml(html: string): string {
  const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/)
  if (titleMatch) return titleMatch[1].trim()
  const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/)
  if (ogMatch) return ogMatch[1].trim()
  return ''
}

// ── State ─────────────────────────────────────────────────────────────────────

type PanelState =
  | { type: 'idle' }
  | { type: 'scanning'; current: string; done: number; total: number; startTime: number }
  | { type: 'results'; found: number; total: number; eventId: string; linkedInReady: boolean }
  | { type: 'launched'; queued: number; eventId: string }

let state: PanelState = { type: 'idle' }
let panelEl: HTMLDivElement | null = null
let noteValue = ''
const DEFAULT_NOTE = "Hi [first name], I was also at the event. I'd love to stay connected!"
const MAX_NOTE = 300

// ── LinkedIn login check ──────────────────────────────────────────────────────

async function checkLinkedInLogin(): Promise<boolean> {
  try {
    const resp = await fetch('https://www.linkedin.com/feed/', {
      credentials: 'include',
      redirect: 'manual',
    })
    return resp.type !== 'opaqueredirect' && resp.status === 200
  } catch {
    return false
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function etaString(done: number, total: number, startTime: number): string {
  if (done === 0) return ''
  const elapsed = (Date.now() - startTime) / 1000
  const perItem = elapsed / done
  const remaining = Math.ceil((total - done) * perItem)
  if (remaining < 60) return `~${remaining}s remaining`
  return `~${Math.ceil(remaining / 60)} min remaining`
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderPanel() {
  if (!panelEl) return
  const body = panelEl.querySelector('#ihn-panel-body')!
  const titleEl = panelEl.querySelector('#ihn-panel-title')!
  const subtitleEl = panelEl.querySelector('#ihn-panel-subtitle')!
  const eventShort = shortEventName(document.querySelector('h1')?.textContent?.trim() ?? document.title)

  if (state.type === 'scanning') {
    const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0
    const eta = state.total > 0 ? etaString(state.done, state.total, state.startTime) : ''
    titleEl.textContent = eventShort || 'Scanning attendees…'
    subtitleEl.textContent = ''
    body.innerHTML = `
      <div class="ihn-scanning-name">Scanning <strong>${escHtml(state.current || '...')}</strong></div>
      <div class="ihn-progress-bar-bg">
        <div class="ihn-progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="ihn-progress-meta">
        <span>${state.done}/${state.total}</span>
        <span>${eta}</span>
      </div>
    `
  } else if (state.type === 'results') {
    titleEl.textContent = 'Ready to connect'
    subtitleEl.textContent = eventShort
    const charCount = noteValue.length
    body.innerHTML = `
      <div class="ihn-found-count">&#10003; Found LinkedIn for ${state.found}/${state.total}</div>
      <div class="ihn-found-label">Connections will be sent over ~${Math.ceil(state.found / 40)} day(s) at 40/day.</div>

      <div class="ihn-label">
        Message <span class="ihn-char-count" id="ihn-char-count">(optional) ${charCount}/${MAX_NOTE}</span>
      </div>
      <textarea id="ihn-note-textarea" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>

      <div class="ihn-linkedin-status ${state.linkedInReady ? 'ihn-ok' : 'ihn-warn'}">
        ${state.linkedInReady
          ? '&#10003; LinkedIn ready'
          : '&#9888;&#65039; Not logged into LinkedIn \u00a0<a class="ihn-open-linkedin" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn &#8599;</a>'}
      </div>

      <button id="ihn-connect-btn" ${state.linkedInReady ? '' : 'disabled'}>
        Connect on LinkedIn &rarr;
      </button>
    `
    panelEl.querySelector('#ihn-note-textarea')?.addEventListener('input', (e) => {
      noteValue = (e.target as HTMLTextAreaElement).value
      const cc = panelEl?.querySelector('#ihn-char-count')
      if (cc) cc.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`
    })
    panelEl.querySelector('#ihn-connect-btn')?.addEventListener('click', handleLaunch)

  } else if (state.type === 'launched') {
    const dashUrl = `http://localhost:3000/campaigns/${state.eventId}`
    const postUrl = `http://localhost:3000/post`
    titleEl.textContent = 'Campaign launched!'
    subtitleEl.textContent = ''
    body.innerHTML = `
      <div class="ihn-launched-icon">&#9989;</div>
      <div class="ihn-launched-title">Campaign launched!</div>
      <div class="ihn-launched-sub">${state.queued} connections queued &middot; done in ~${Math.ceil(Math.max(state.queued, 1) / 40)} day(s)</div>
      <a class="ihn-cta-btn ihn-cta-btn-secondary" href="${dashUrl}" target="_blank">View Campaign &rarr;</a>
      <a class="ihn-cta-btn ihn-cta-btn-primary" href="${postUrl}" target="_blank">Draft your event post &rarr;</a>
    `
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handleLaunch() {
  if (state.type !== 'results') return
  const connectBtn = panelEl?.querySelector<HTMLButtonElement>('#ihn-connect-btn')
  if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = 'Launching…' }

  const eventId = state.eventId
  chrome.runtime.sendMessage(
    { type: 'LAUNCH_CAMPAIGN', data: { eventId, note: noteValue } },
    (result: { queued: number }) => {
      state = { type: 'launched', queued: result?.queued ?? 0, eventId }
      renderPanel()
    }
  )
}

async function handleImportClick() {
  openPanel()
  state = { type: 'scanning', current: 'Gathering attendees…', done: 0, total: 0, startTime: Date.now() }
  renderPanel()

  const { eventName, hostProfileUrls, guestProfileUrls } = await scrapeLuma()
  const allUrls = [
    ...hostProfileUrls.map(u => ({ url: u, isHost: true })),
    ...guestProfileUrls.map(u => ({ url: u, isHost: false })),
  ]
  const total = allUrls.length
  const startTime = Date.now()

  // Fetch each profile in content script — runs in Luma tab, cookies included, no 403
  const enriched: { url: string; isHost: boolean; name: string; linkedInUrl: string }[] = []

  for (let i = 0; i < allUrls.length; i++) {
    const { url, isHost } = allUrls[i]
    let displayName = ''
    let linkedInUrl = ''

    try {
      const resp = await fetch(url, { credentials: 'include' })
      if (resp.ok) {
        const html = await resp.text()
        displayName = extractDisplayNameFromHtml(html)
        linkedInUrl = extractLinkedInUrlFromHtml(html)
      }
    } catch {
      // network error — skip
    }

    const fallbackName = url.split('/').pop()?.replace(/-/g, ' ') ?? 'Unknown'
    const name = displayName || fallbackName

    enriched.push({ url, isHost, name, linkedInUrl })

    state = { type: 'scanning', current: name, done: i + 1, total, startTime }
    renderPanel()
  }

  // Hand off pre-enriched contacts to service worker for DB persistence
  chrome.runtime.sendMessage({
    type: 'START_ENRICHMENT',
    data: { lumaUrl: location.href, eventName, contacts: enriched },
  })
}

// ── Panel DOM ─────────────────────────────────────────────────────────────────

function createPanel() {
  panelEl = document.createElement('div')
  panelEl.id = 'ihn-panel'
  panelEl.innerHTML = `
    <div id="ihn-panel-header">
      <div>
        <div id="ihn-panel-title">Importing contacts…</div>
        <div id="ihn-panel-subtitle"></div>
      </div>
      <button id="ihn-close-btn" aria-label="Close">&times;</button>
    </div>
    <div id="ihn-panel-body"></div>
  `
  document.body.appendChild(panelEl)
  panelEl.querySelector('#ihn-close-btn')!.addEventListener('click', closePanel)
}

function openPanel() {
  if (!panelEl) createPanel()
  requestAnimationFrame(() => panelEl?.classList.add('ihn-open'))
}

function closePanel() {
  panelEl?.classList.remove('ihn-open')
}

// ── Message listener ──────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'OPEN_PANEL') {
      handleImportClick()
    }

    if (msg.type === 'ENRICH_COMPLETE') {
      checkLinkedInLogin().then(linkedInReady => {
        noteValue = DEFAULT_NOTE
        state = {
          type: 'results',
          found: msg.found,
          total: msg.total,
          eventId: msg.eventId,
          linkedInReady,
        }
        renderPanel()
      })
    }
  })
}
