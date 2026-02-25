const DASHBOARD_URL = 'http://localhost:3000'

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

function findModalScrollable(preClickLinks: Set<string>): Element | null {
  const allLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']")
  )
  const newLinks = allLinks.filter(a => {
    const href = a.href || a.getAttribute('href') || ''
    return href && !preClickLinks.has(href)
  })
  if (newLinks.length === 0) return null

  // Walk up from a guest link to find its scrollable ancestor
  let el: Element | null = newLinks[0].parentElement
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if ((s.overflow === 'auto' || s.overflow === 'scroll' ||
         s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 10) {
      return el
    }
    el = el.parentElement
  }
  return null
}

async function scrapeLuma(): Promise<{
  eventName: string
  eventLocation: string
  hostProfileUrls: string[]
  guestProfileUrls: string[]
}> {
  const eventName = document.querySelector('h1')?.textContent?.trim() ?? document.title

  // Snapshot /u/ links before opening modal
  const preClickLinks = new Set(parseGuestLinksFromDoc(document))
  // Open guest modal — Luma shows attendee button as "Name, Name and N others"
  const labelPatterns = [/\band \d+ others\b/i, /\bGuests\b/, /\bGoing\b/, /\bAttendees\b/, /\bSee all\b/]
  let clickedLabel = ''
  const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
  for (const pattern of labelPatterns) {
    const btn = allBtns.find(b => pattern.test(b.textContent ?? ''))
    if (btn) { btn.click(); clickedLabel = btn.textContent?.trim() ?? 'matched'; break }
  }
  await new Promise(r => setTimeout(r, 2500))

  const modal = findModalScrollable(preClickLinks)
  await scrollToLoadAll(modal ?? document.scrollingElement)

  const hostProfileUrls = extractHostProfileUrlsFromDoc(document)
  const allLinks = parseGuestLinksFromDoc(document)
  const hostSet = new Set(hostProfileUrls)
  const guestProfileUrls = allLinks.filter(u => !hostSet.has(u))

  const locationEl = document.querySelector('[class*="location"], [class*="venue"], [class*="address"]')
  const eventLocation = locationEl?.textContent?.trim().split('\n')[0].trim() ?? ''
  return { eventName, eventLocation, hostProfileUrls, guestProfileUrls }
}

// ── Inline Luma profile parsers (run in content script = has cookies, no 403) ─

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

function extractDisplayNameFromHtml(html: string): string {
  const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/)
  const raw = titleMatch ? titleMatch[1].trim()
            : (html.match(/property="og:title"\s+content="([^"]+)"/) ?? [])[1]?.trim() ?? ''
  return raw.replace(/\s*·\s*Luma\s*$/i, '').trim()
}

// ── State ─────────────────────────────────────────────────────────────────────

type EnrichedContact = { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string; twitterUrl: string }

type PanelState =
  | { type: 'idle' }
  | { type: 'scanning'; current: string; done: number; total: number; startTime: number }
  | { type: 'results'; found: number; total: number; eventId: string; linkedInReady: boolean; eventName: string; eventLocation: string }
  | { type: 'launched'; queued: number; eventId: string }
  | { type: 'contacts'; queued: number; eventId: string }
  | { type: 'progress' }

let state: PanelState = { type: 'idle' }
let enrichedContacts: EnrichedContact[] = []
let panelEl: HTMLDivElement | null = null
let noteValue = ''
let contactStatuses: Map<string, string> = new Map()
let authMode: 'signup' | 'signin' = 'signup'
let progressData: { chartData: {date:string,cumulative:number}[], events: any[] } | null = null
let expandedEvents = new Set<string>()
const DEFAULT_NOTE = "Hi [first name], I was also at the event. I'd love to stay connected!"
const MAX_NOTE = 300

// ── LinkedIn login check ──────────────────────────────────────────────────────

async function checkLinkedInLogin(): Promise<boolean> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'CHECK_LINKEDIN_LOGIN' }, (resp) => {
      resolve(resp?.loggedIn ?? false)
    })
  })
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

function renderChart(chartData: {date:string,cumulative:number}[]): string {
  if (chartData.length < 2) return '<p class="ihn-chart-empty">No connections sent yet</p>'
  const W = 312, H = 100
  const pad = { t: 8, r: 8, b: 20, l: 32 }
  const maxVal = chartData[chartData.length - 1].cumulative
  const xS = (i: number) => pad.l + (i / (chartData.length - 1)) * (W - pad.l - pad.r)
  const yS = (v: number) => pad.t + (1 - v / maxVal) * (H - pad.t - pad.b)
  const pts = chartData.map((d, i) => `${xS(i)},${yS(d.cumulative)}`).join(' ')
  const area = `${xS(0)},${H - pad.b} ${pts} ${xS(chartData.length - 1)},${H - pad.b}`
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="ihn-cg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.03"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#ihn-cg)"/>
    <polyline points="${pts}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="${pad.l}" y="${H}" font-size="9" fill="#9ca3af">${chartData[0].date.slice(5)}</text>
    <text x="${W - pad.r}" y="${H}" font-size="9" fill="#9ca3af" text-anchor="end">${chartData[chartData.length-1].date.slice(5)}</text>
    <text x="${pad.l - 4}" y="${pad.t + 6}" font-size="9" fill="#9ca3af" text-anchor="end">${maxVal}</text>
  </svg>`
}

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
    const allContacts = enrichedContacts
    const leadsHtml = allContacts.map(c => {
      const parts = c.name.trim().split(/\s+/)
      const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
      const hasLI = !!c.linkedInUrl
      const hasIG = !!c.instagramUrl
      const hasX = !!c.twitterUrl
      return `
        <div class="ihn-lead-row">
          <div class="ihn-lead-initials">${escHtml(initials)}</div>
          <div class="ihn-lead-name">${escHtml(c.name)}</div>
          <div class="ihn-lead-badges">
            ${hasLI ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="ihn-badge ihn-badge-li">in</a>` : ''}
            ${hasIG ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="ihn-badge ihn-badge-ig">ig</a>` : ''}
            ${hasX ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="ihn-badge ihn-badge-x">x</a>` : ''}
            ${!hasLI && !hasIG && !hasX ? '<span class="ihn-lead-none">–</span>' : ''}
          </div>
        </div>
      `
    }).join('')
    body.innerHTML = `
      <div class="ihn-results-header">
        <div class="ihn-found-count">&#10003; Found LinkedIn for ${state.found}/${state.total}</div>
        <button id="ihn-export-csv" title="Export CSV" class="ihn-export-btn">&#8681; CSV</button>
      </div>
      <div class="ihn-found-label">Connections will be sent over ~${Math.ceil(state.found / 40)} day(s) at 40/day.</div>

      ${allContacts.length > 0 ? `<div class="ihn-leads-list">${leadsHtml}</div>` : ''}

      <div class="ihn-label">
        Message <span class="ihn-char-count" id="ihn-char-count">(optional) ${charCount}/${MAX_NOTE}</span>
      </div>
      <textarea id="ihn-note-textarea" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>

      ${!state.eventId ? `
      <div class="ihn-login-gate">
        <div class="ihn-login-label">Log in to auto-connect with contacts on LinkedIn</div>
        <input id="ihn-login-email" type="email" placeholder="Email" class="ihn-login-input" autocomplete="email" />
        <input id="ihn-login-password" type="password" placeholder="Password" class="ihn-login-input" autocomplete="current-password" />
        <div class="ihn-login-error" id="ihn-login-error"></div>
        <button id="ihn-login-submit" class="ihn-cta-btn ihn-cta-btn-primary">
          ${authMode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <div class="ihn-auth-toggle">
          ${authMode === 'signup'
            ? 'Already have an account? <button class="ihn-auth-toggle-btn" id="ihn-toggle-mode">Sign in</button>'
            : 'New here? <button class="ihn-auth-toggle-btn" id="ihn-toggle-mode">Create account</button>'}
        </div>
      </div>
      ` : `
      <div class="ihn-linkedin-status ${state.linkedInReady ? 'ihn-ok' : 'ihn-warn'}">
        ${state.linkedInReady
          ? '&#10003; LinkedIn ready'
          : '&#9888;&#65039; Not logged into LinkedIn \u00a0<a class="ihn-open-linkedin" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn &#8599;</a>'}
      </div>

      <button id="ihn-connect-btn" ${state.linkedInReady ? '' : 'disabled'}>
        Connect on LinkedIn &rarr;
      </button>
      `}
    `
    panelEl.querySelector('#ihn-note-textarea')?.addEventListener('input', (e) => {
      noteValue = (e.target as HTMLTextAreaElement).value
      const cc = panelEl?.querySelector('#ihn-char-count')
      if (cc) cc.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`
    })
    panelEl.querySelector('#ihn-connect-btn')?.addEventListener('click', handleLaunch)
    if (!state.eventId) {
      panelEl.querySelector('#ihn-login-submit')?.addEventListener('click', handleInlineLogin)
      panelEl.querySelector<HTMLInputElement>('#ihn-login-password')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleInlineLogin()
      })
      panelEl.querySelector('#ihn-toggle-mode')?.addEventListener('click', () => {
        authMode = authMode === 'signup' ? 'signin' : 'signup'
        renderPanel()
      })
    }
    panelEl.querySelector('#ihn-export-csv')?.addEventListener('click', () => {
      if (state.type !== 'results') return
      const rawSlug = state.eventName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase()
      const slug = rawSlug.length > 30 ? rawSlug.slice(0, 31).replace(/_[^_]*$/, '') : rawSlug
      const rows: string[][] = [
        [state.eventName + ' Contact List'],
        [state.eventLocation],
        [],
        ['Name', 'LinkedIn', 'X', 'Instagram', 'Luma', 'Type'],
      ]
      enrichedContacts.forEach(c =>
        rows.push([c.name, c.linkedInUrl, c.twitterUrl, c.instagramUrl, c.url, c.isHost ? 'host' : 'guest'])
      )
      const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      a.download = `luma_${slug}_contacts.csv`
      a.click()
    })
    if (!state.linkedInReady) {
      const poll = setInterval(async () => {
        const ready = await checkLinkedInLogin()
        if (ready && state.type === 'results') {
          clearInterval(poll)
          state = { ...state, linkedInReady: true }
          renderPanel()
        }
      }, 3000)
    }

  } else if (state.type === 'launched') {
    titleEl.textContent = shortEventName(document.querySelector('h1')?.textContent?.trim() ?? document.title)
    subtitleEl.textContent = ''
    body.innerHTML = `
      <div class="ihn-launched-icon">&#10003;</div>
      <div class="ihn-launched-title">Running in background</div>
      <div class="ihn-launched-sub">
        ${state.queued} connections queued${state.queued > 0 ? ` &middot; ~${Math.ceil(state.queued / 40)} day(s) at 40/day` : ''}
      </div>
      <div class="ihn-launched-note">Chrome connects people automatically. You don't need to stay on this page.</div>
      <button id="ihn-view-contacts" class="ihn-cta-btn ihn-cta-btn-primary" style="margin-top:12px">
        View contacts &rarr;
      </button>
      <button id="ihn-scan-another" class="ihn-cta-btn ihn-cta-btn-secondary" style="margin-top:8px">Scan another event</button>
    `
    panelEl?.querySelector('#ihn-view-contacts')?.addEventListener('click', () => {
      state = { type: 'progress' }
      renderPanel()
      chrome.runtime.sendMessage({ type: 'GET_PROGRESS_DATA' }, (resp) => {
        progressData = resp
        if (state.type === 'progress') renderPanel()
      })
    })
    panelEl?.querySelector('#ihn-scan-another')?.addEventListener('click', () => {
      state = { type: 'idle' }
      enrichedContacts = []
      noteValue = ''
      closePanel()
    })
  } else if (state.type === 'progress') {
    titleEl.textContent = 'Progress'
    subtitleEl.textContent = ''
    const data = progressData
    const totalSent = data ? data.chartData[data.chartData.length - 1]?.cumulative ?? 0 : 0
    body.innerHTML = `
      <div class="ihn-chart-wrap">
        ${data ? renderChart(data.chartData) : '<p class="ihn-chart-empty">Loading…</p>'}
      </div>
      <div class="ihn-results-header">
        <p class="ihn-total-sent">${totalSent} sent total</p>
        <button id="ihn-progress-export-csv" title="Export CSV" class="ihn-export-btn">&#8681; CSV</button>
      </div>
      <div class="ihn-events-list">
        ${(data?.events ?? []).map((event: any) => {
          const contacts = event.contacts ?? []
          const sentCount = contacts.filter((c: any) =>
            ['sent','accepted'].includes(c.connection_queue?.[0]?.status)
          ).length
          const expanded = expandedEvents.has(event.id)
          return `<div class="ihn-event-row" data-event-id="${escHtml(event.id)}">
            <div class="ihn-event-header">
              <span class="ihn-event-chevron">${expanded ? '▼' : '▶'}</span>
              <span class="ihn-event-name">${escHtml(event.name ?? 'Untitled event')}</span>
              <span class="ihn-event-badge">${sentCount} sent</span>
            </div>
            ${expanded ? `<div class="ihn-event-contacts">${contacts.map((c: any) => {
              const status = c.connection_queue?.[0]?.status ?? 'pending'
              return `<div class="ihn-contact-row">
                <span class="ihn-contact-name">${escHtml(c.name ?? '—')}</span>
                <span class="ihn-status-badge ihn-status-${escHtml(status)}">${escHtml(status)}</span>
              </div>`
            }).join('')}</div>` : ''}
          </div>`
        }).join('')}
        ${!data || data.events.length === 0 ? '<p class="ihn-empty">No events yet.</p>' : ''}
      </div>
    `
    panelEl.querySelectorAll('.ihn-event-header').forEach(header => {
      header.addEventListener('click', () => {
        const row = (header as HTMLElement).closest('[data-event-id]') as HTMLElement
        const id = row?.dataset.eventId
        if (!id) return
        if (expandedEvents.has(id)) expandedEvents.delete(id)
        else expandedEvents.add(id)
        renderPanel()
      })
    })
    panelEl.querySelector('#ihn-progress-export-csv')?.addEventListener('click', () => {
      if (!progressData) return
      const rows: string[][] = [['Event', 'Name', 'LinkedIn', 'Instagram', 'Status']]
      for (const event of progressData.events) {
        for (const c of event.contacts ?? []) {
          const status = c.connection_queue?.[0]?.status ?? 'pending'
          rows.push([event.name ?? '', c.name ?? '', c.linkedin_url ?? '', c.instagram_url ?? '', status])
        }
      }
      const csv = rows.map(r => r.map(v => `"${(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      a.download = 'ihn_progress_contacts.csv'
      a.click()
    })
    return
  } else if (state.type === 'contacts') {
    titleEl.textContent = 'Contacts'
    subtitleEl.textContent = ''
    const leadsHtml = enrichedContacts.map(c => {
      const parts = c.name.trim().split(/\s+/)
      const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
      const hasLI = !!c.linkedInUrl
      const hasIG = !!c.instagramUrl
      const hasX = !!c.twitterUrl
      const status = c.linkedInUrl ? (contactStatuses.get(c.linkedInUrl) ?? null) : null
      const statusDot = status === 'sent' || status === 'accepted'
        ? '<span class="ihn-status-dot ihn-status-sent">●</span>'
        : status === 'failed'
        ? '<span class="ihn-status-dot ihn-status-failed">●</span>'
        : status === 'pending'
        ? '<span class="ihn-status-dot ihn-status-pending">●</span>'
        : ''
      return `
        <div class="ihn-lead-row">
          <div class="ihn-lead-initials">${escHtml(initials)}</div>
          <div class="ihn-lead-name">${escHtml(c.name)}</div>
          <div class="ihn-lead-badges">
            ${statusDot}
            ${hasLI ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="ihn-badge ihn-badge-li">in</a>` : ''}
            ${hasIG ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="ihn-badge ihn-badge-ig">ig</a>` : ''}
            ${hasX ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="ihn-badge ihn-badge-x">x</a>` : ''}
            ${!hasLI && !hasIG && !hasX ? '<span class="ihn-lead-none">–</span>' : ''}
          </div>
        </div>
      `
    }).join('')
    body.innerHTML = `
      <div class="ihn-leads-list" style="max-height:none">${leadsHtml || '<div style="padding:16px;color:#888">No contacts found.</div>'}</div>
      <button id="ihn-back-btn" class="ihn-cta-btn ihn-cta-btn-secondary" style="margin-top:8px">&#8592; Back</button>
    `
    panelEl?.querySelector('#ihn-back-btn')?.addEventListener('click', () => {
      if (state.type !== 'contacts') return
      state = { type: 'launched', queued: state.queued, eventId: state.eventId }
      renderPanel()
    })
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handleInlineLogin() {
  const emailEl = panelEl?.querySelector<HTMLInputElement>('#ihn-login-email')
  const passEl  = panelEl?.querySelector<HTMLInputElement>('#ihn-login-password')
  const btn     = panelEl?.querySelector<HTMLButtonElement>('#ihn-login-submit')
  const errEl   = panelEl?.querySelector<HTMLElement>('#ihn-login-error')
  if (!emailEl || !passEl || !btn || !errEl) return

  btn.disabled = true
  errEl.textContent = ''
  const isSignup = authMode === 'signup'
  btn.textContent = isSignup ? 'Creating account…' : 'Signing in…'

  const msgType = isSignup ? 'SIGN_UP' : 'SIGN_IN'
  chrome.runtime.sendMessage(
    { type: msgType, data: { email: emailEl.value, password: passEl.value } },
    (result: { success: boolean; error?: string; sessionReady?: boolean }) => {
      if (chrome.runtime.lastError || !result?.success) {
        btn.disabled = false
        btn.textContent = isSignup ? 'Create account' : 'Sign in'
        errEl.textContent = result?.error ?? chrome.runtime.lastError?.message ?? (isSignup ? 'Sign up failed' : 'Sign in failed')
        return
      }
      if (isSignup && result.sessionReady === false) {
        errEl.style.color = '#059669'
        errEl.textContent = 'Check your email to confirm, then sign in here'
        btn.disabled = false
        btn.textContent = 'Create account'
        authMode = 'signin'
        renderPanel()
        return
      }
      btn.textContent = 'Saving contacts…'
      const eventName = state.type === 'results' ? state.eventName : ''
      chrome.runtime.sendMessage(
        { type: 'START_ENRICHMENT', data: { lumaUrl: location.href, eventName, contacts: enrichedContacts } },
        (saveResult: { eventId: string; found: number; total: number } | undefined) => {
          if (chrome.runtime.lastError || !saveResult?.eventId) {
            btn.disabled = false
            btn.textContent = isSignup ? 'Create account' : 'Sign in'
            errEl.style.color = '#dc2626'
            errEl.textContent = "Saved session but couldn't save contacts — try again"
            return
          }
          if (state.type === 'results') {
            state = { ...state, eventId: saveResult.eventId }
            renderPanel()
          }
        }
      )
    }
  )
}

function handleLaunch() {
  if (state.type !== 'results') return
  const contactsWithLI = enrichedContacts.filter(c => c.linkedInUrl)
  const connectBtn = panelEl?.querySelector<HTMLButtonElement>('#ihn-connect-btn')
  if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = 'Launching…' }

  chrome.runtime.sendMessage(
    {
      type: 'LAUNCH_CAMPAIGN',
      data: {
        eventId: state.eventId,
        note: noteValue,
        lumaUrl: location.href,
        eventName: state.eventName,
        contacts: contactsWithLI.map(c => ({
          url: c.url, name: c.name, linkedInUrl: c.linkedInUrl,
          isHost: c.isHost, instagramUrl: c.instagramUrl,
        })),
      },
    },
    (result: { queued: number; eventId?: string }) => {
      if (!result?.queued) {
        if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Connect on LinkedIn →' }
        const errEl = panelEl?.querySelector('.ihn-linkedin-status')
        if (errEl) errEl.innerHTML = '&#9888; Couldn\'t save — check you\'re logged into the dashboard'
        return
      }
      if (state.type !== 'results') return
      state = { type: 'launched', queued: result.queued, eventId: result.eventId || state.eventId }
      renderPanel()
    }
  )
}

async function handleImportClick() {
  authMode = 'signup'
  openPanel()
  state = { type: 'scanning', current: 'Gathering attendees…', done: 0, total: 0, startTime: Date.now() }
  renderPanel()

  const { eventName, eventLocation, hostProfileUrls, guestProfileUrls } = await scrapeLuma()
  const allUrls = [
    ...hostProfileUrls.map(u => ({ url: u, isHost: true })),
    ...guestProfileUrls.map(u => ({ url: u, isHost: false })),
  ]

  // Check if already scanned — only enrich new attendees
  const { eventId: cachedEventId, existingUrls, linkedInCount, contacts: existingContacts } = await new Promise<any>(resolve =>
    chrome.runtime.sendMessage({ type: 'GET_EVENT_BY_URL', lumaUrl: location.href }, resolve)
  )

  const existingSet = new Set(existingUrls as string[])
  const toEnrich = existingUrls.length > 0
    ? allUrls.filter(u => !existingSet.has(u.url))
    : allUrls

  if (toEnrich.length === 0) {
    // Already up to date — skip enrichment, jump straight to results
    enrichedContacts = (existingContacts as any[]).map((c: any) => ({
      url: c.luma_profile_url ?? '',
      isHost: c.is_host ?? false,
      name: c.name ?? '',
      linkedInUrl: c.linkedin_url ?? '',
      instagramUrl: c.instagram_url ?? '',
      twitterUrl: '',
    }))
    noteValue = DEFAULT_NOTE
    state = {
      type: 'results',
      found: linkedInCount,
      total: existingUrls.length,
      eventId: cachedEventId,
      linkedInReady: false,
      eventName,
      eventLocation,
    }
    renderPanel()
    checkLinkedInLogin().then(ready => {
      if (state.type === 'results' && ready) {
        state = { ...state, linkedInReady: true }
        renderPanel()
      }
    })
    return
  }

  const total = toEnrich.length
  const startTime = Date.now()

  // Fetch each profile in content script — runs in Luma tab, cookies included, no 403
  const enriched: EnrichedContact[] = []

  for (let i = 0; i < toEnrich.length; i++) {
    const { url, isHost } = toEnrich[i]
    let displayName = ''
    let linkedInUrl = ''
    let instagramUrl = ''
    let twitterUrl = ''

    try {
      const resp = await fetch(url, { credentials: 'include' })
      if (resp.ok) {
        const html = await resp.text()
        displayName = extractDisplayNameFromHtml(html)
        linkedInUrl = extractLinkedInUrlFromHtml(html)
        instagramUrl = extractInstagramUrlFromHtml(html)
        twitterUrl = extractTwitterUrlFromHtml(html)
      }
    } catch {
      // network error — skip
    }

    const fallbackName = url.split('/').pop()?.replace(/-/g, ' ') ?? 'Unknown'
    const name = displayName || fallbackName

    enriched.push({ url, isHost, name, linkedInUrl, instagramUrl, twitterUrl })

    state = { type: 'scanning', current: name, done: i + 1, total, startTime }
    renderPanel()
  }

  enrichedContacts = enriched

  // Hand off pre-enriched contacts to service worker for DB persistence
  // Use sendMessage callback — don't wait for separate ENRICH_COMPLETE message
  chrome.runtime.sendMessage(
    { type: 'START_ENRICHMENT', data: { lumaUrl: location.href, eventName, contacts: enriched } },
    (result: { eventId: string; found: number; total: number } | undefined) => {
      if (chrome.runtime.lastError) console.warn('[IHN] START_ENRICHMENT:', chrome.runtime.lastError.message)
      checkLinkedInLogin().then(linkedInReady => {
        noteValue = DEFAULT_NOTE
        state = {
          type: 'results',
          found: enriched.filter(c => c.linkedInUrl).length + linkedInCount,
          total: enriched.length + existingUrls.length,
          eventId: result?.eventId ?? cachedEventId ?? '',
          linkedInReady,
          eventName,
          eventLocation,
        }
        renderPanel()
      })
    }
  )
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

  })
}
