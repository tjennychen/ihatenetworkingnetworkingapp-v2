import { icons } from '../lib/icons'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabContext =
  | { kind: 'luma-event'; tabId: number; eventName: string }
  | { kind: 'luma-other'; tabId: number }
  | { kind: 'other' }

type AppState =
  | { type: 'loading' }
  | { type: 'landing'; ctx: TabContext }
  | { type: 'campaign'; pending: number; paused: boolean; ctx: TabContext }

type ScanState =
  | { type: 'idle' }
  | { type: 'already_scanned'; count: number; linkedInCount: number; eventId: string; eventName: string }
  | { type: 'scanning'; phase: string; done: number; total: number; currentName: string; startTime: number }
  | { type: 'results'; found: number; total: number; eventId: string; eventName: string; contacts: any[] }
  | { type: 'launched'; queued: number; eventId: string }

let scanState: ScanState = { type: 'idle' }
let noteValue = ''
let authMode: 'signup' | 'signin' = 'signup'
const MAX_NOTE = 300

let expandedEvents = new Set<string>()
type DraftState =
  | 'closed'
  | { stage: 'pick' }
  | { stage: 'loading'; eventId: string; eventName: string; fetching: number }
  | { stage: 'ready'; eventId: string; eventName: string; postText: string; guestNames: string[]; totalGuests: number }
let draftState: DraftState = 'closed'
let draftViewOpen = false
let draftNamesStartTime = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

const nonEventPaths = ['', '/', '/home', '/calendar', '/events', '/discover', '/explore', '/settings', '/dashboard']

function isLumaEventPath(pathname: string): boolean {
  return !nonEventPaths.includes(pathname) && pathname.split('/').length === 2
}

function defaultNote(eventName: string): string {
  const label = eventName.split('·')[0].trim()
  return label ? `I saw you at the ${label} event, I'd like to stay in touch!`
               : "I saw you at the event, I'd like to stay in touch!"
}

function etaString(done: number, total: number, startTime: number): string {
  if (done === 0) return ''
  const elapsed = (Date.now() - startTime) / 1000
  const perItem = elapsed / done
  const remaining = Math.ceil((total - done) * perItem)
  if (remaining < 60) return `~${remaining}s remaining`
  return `~${Math.ceil(remaining / 60)} min remaining`
}

// ── State resolution ──────────────────────────────────────────────────────────

async function resolveTabContext(): Promise<TabContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url || !tab.id) return { kind: 'other' }
  const tabId = tab.id
  const url = tab.url
  const isLuma = url.includes('lu.ma') || url.includes('luma.com')
  if (!isLuma) return { kind: 'other' }
  const pathname = (() => { try { return new URL(url).pathname } catch { return '' } })()
  if (!isLumaEventPath(pathname)) return { kind: 'luma-other', tabId }
  const eventName = tab.title?.replace(/\s*[·|–-].*$/, '').trim() ?? ''
  return { kind: 'luma-event', tabId, eventName }
}

async function resolveAppState(): Promise<AppState> {
  const [ctx, storage] = await Promise.all([
    resolveTabContext(),
    chrome.storage.local.get(['queuePending', 'campaignPaused']),
  ])
  const storagePending: number = storage.queuePending ?? 0
  const paused: boolean = storage.campaignPaused ?? false
  if (storagePending > 0 || paused) {
    return { type: 'campaign', pending: storagePending, paused, ctx }
  }
  // Storage may be out of sync (e.g. after extension reload). Check DB as fallback.
  const dbResp: { pending: number } | null = await new Promise(r =>
    chrome.runtime.sendMessage({ type: 'GET_PENDING_COUNT' }, r)
  )
  const dbPending = dbResp?.pending ?? 0
  if (dbPending > 0) {
    await chrome.storage.local.set({ queuePending: dbPending })
    return { type: 'campaign', pending: dbPending, paused: false, ctx }
  }
  return { type: 'landing', ctx }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const root = document.getElementById('root')!

function renderLoading(): void {
  root.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#9ca3af;font-size:13px;">Loading…</div>`
}

function renderLanding(ctx: TabContext): void {
  const ctaLabel = ctx.kind === 'luma-other'
    ? 'Browse Luma events →'
    : 'Open Luma.com →'
  const ctaHref = ctx.kind === 'luma-other'
    ? 'https://lu.ma/events'
    : 'https://lu.ma'
  const step1desc = ctx.kind === 'luma-other'
    ? 'Open a specific event page on Luma'
    : 'Open any event you attended on lu.ma'

  root.innerHTML = `
    <div class="hero">
      <img src="../icons/icon128.png" class="hero-logo" alt="">
      <div class="hero-name">I Hate Networking</div>
      <div class="hero-sub">networking, automated</div>
    </div>

    <p class="tagline">Event follow-up shouldn't be your second job.</p>

    <div class="divider" style="margin-top:16px;"></div>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">
          <div class="step-title">Go to a Luma event page</div>
          <div class="step-desc">${step1desc}</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">
          <div class="step-title">Scan the guest list</div>
          <div class="step-desc">We find everyone's LinkedIn profile</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">
          <div class="step-title">LinkedIn connections send automatically</div>
          <div class="step-desc">35/day max · business hours only · keeps your account safe</div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="btn-wrap">
      <button class="btn btn-primary" id="btnCta">${ctaLabel}</button>
    </div>

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `

  document.getElementById('btnCta')!.addEventListener('click', () => {
    chrome.tabs.create({ url: ctaHref })
  })
}

// ── Campaign state ────────────────────────────────────────────────────────────

async function startDraftFetch(eventId: string, eventName: string, state: Extract<AppState, { type: 'campaign' }>): Promise<void> {
  draftState = { stage: 'loading', eventId, eventName, fetching: 0 }
  await renderDraftView(state)

  const resp: { hosts: any[]; guests: any[]; totalGuests: number } | null = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'GET_DRAFT_DATA', eventId }, resolve)
  )
  if (!resp) { draftState = 'closed'; draftViewOpen = false; render(); return }

  const { hosts, guests, totalGuests } = resp

  const needFetch = [
    ...hosts.filter((h: any) => !h.linkedin_name && h.linkedin_url),
    ...guests.filter((g: any) => !g.linkedin_name && g.linkedin_url),
  ]

  if (needFetch.length > 0) {
    draftNamesStartTime = Date.now()
    draftState = { stage: 'loading', eventId, eventName, fetching: needFetch.length }
    await renderDraftView(state)
  }

  const fetchedNames: { id: string; linkedin_name: string }[] = needFetch.length > 0
    ? (await new Promise<any>(resolve =>
        chrome.runtime.sendMessage({ type: 'GET_LINKEDIN_NAMES', contacts: needFetch.map((c: any) => ({ id: c.id, linkedin_url: c.linkedin_url })) }, resolve)
      )) ?? []
    : []

  const badNames = new Set(['linkedin', 'sign in', 'log in', 'login', 'join linkedin'])
  const fetchedMap = new Map(
    fetchedNames
      .filter(f => f.linkedin_name && !badNames.has(f.linkedin_name.toLowerCase()))
      .map(f => [f.id, f.linkedin_name])
  )
  const nameMap = new Map<string, string>()
  for (const g of [...guests, ...hosts]) nameMap.set(g.id, g.linkedin_name || g.name || '')
  for (const [id, name] of fetchedMap) nameMap.set(id, name)

  const hostMentions = hosts
    .map((h: any) => fetchedMap.get(h.id) || h.linkedin_name || h.name || '')
    .filter(Boolean)
    .map(n => `@${n}`)
    .join(' ')

  const shortName = eventName.replace(/\s*·\s*[^·]+$/, '').replace(/\s*·\s*[^·]+$/, '').trim()
  const postText = hostMentions
    ? `Thanks ${hostMentions} for organizing the ${shortName} event!`
    : `Thanks everyone for organizing the ${shortName} event!`

  const confirmedLinkedinIds = new Set([
    ...guests.filter((g: any) => g.linkedin_name).map((g: any) => g.id),
    ...fetchedMap.keys(),
  ])
  const guestNames = guests
    .filter((g: any) => confirmedLinkedinIds.has(g.id))
    .map((g: any) => nameMap.get(g.id)!)
    .filter(Boolean)
  draftState = { stage: 'ready', eventId, eventName, postText, guestNames, totalGuests }
  await renderDraftView(state)
}

// ── Draft full-page view (matches image 4: tip + plain name list) ─────────────

async function renderDraftView(state: Extract<AppState, { type: 'campaign' }>): Promise<void> {
  const backBtn = `
    <div class="compact-header">
      <button class="btn-back" id="btnBackDraft">← Back</button>
      <span class="compact-name" style="flex:1;text-align:center;">Draft LinkedIn post</span>
      <span style="width:48px;"></span>
    </div>
  `

  const wireBack = () => {
    document.getElementById('btnBackDraft')?.addEventListener('click', () => { draftViewOpen = false; draftState = 'closed'; render() })
  }

  if (typeof draftState === 'object' && draftState.stage === 'pick') {
    root.innerHTML = backBtn + `<div style="padding:20px;text-align:center;color:#9ca3af;font-size:13px;">Loading events…</div>`
    wireBack()
    const progressResp = await new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_PROGRESS_DATA' }, r))
    const events: any[] = progressResp?.events ?? []
    root.innerHTML = backBtn + `
      <div style="padding:20px;">
        <div style="font-size:13px;color:#374151;font-weight:600;margin-bottom:12px;">Which event?</div>
        ${events.map(ev => `
          <button class="btn btn-secondary event-pick-btn" data-event-id="${escHtml(ev.id ?? '')}" data-event-name="${escHtml(ev.name ?? '')}" style="margin-bottom:8px;text-align:left;">
            ${escHtml(ev.name ?? 'Event')}
          </button>
        `).join('')}
      </div>
    `
    wireBack()
    document.querySelectorAll<HTMLElement>('.event-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const evId = btn.getAttribute('data-event-id') ?? ''
        const evName = btn.getAttribute('data-event-name') ?? ''
        startDraftFetch(evId, evName, state)
      })
    })
    return
  }

  if (typeof draftState === 'object' && draftState.stage === 'loading') {
    const n = draftState.fetching
    const estSecs = n > 0 ? Math.ceil(n * 2) : 0
    const hint = n > 0 ? ` · ~${estSecs}s` : ''
    root.innerHTML = backBtn + `
      <div style="text-align:center;padding:60px 20px;">
        <div style="color:#9ca3af;font-size:13px;" id="draftNamesProgress">
          ${n > 0 ? `Fetching ${n} LinkedIn names${hint}` : 'Building your post draft…'}
        </div>
      </div>
    `
    wireBack()
    return
  }

  if (typeof draftState === 'object' && draftState.stage === 'ready') {
    const s = draftState
    const hasGuests = s.guestNames.length > 0
    root.innerHTML = backBtn + `
      <div style="padding:20px;">
        <div style="font-size:11px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Post draft</div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;color:#374151;line-height:1.5;margin-bottom:8px;white-space:pre-wrap;">${escHtml(s.postText)}</div>
        <button class="btn btn-secondary" id="btnCopyPost" style="margin-bottom:20px;width:auto;padding:6px 16px;">Copy</button>

        ${hasGuests ? `
        <div style="font-size:11px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Guest names</div>
        <div style="margin-bottom:8px;">
          ${s.guestNames.map(n => `<div class="draft-name-row">${escHtml(n)}</div>`).join('')}
        </div>
        ${s.totalGuests > 15 ? `<button class="btn btn-secondary" id="btnDraftShuffle" style="margin-bottom:16px;">Shuffle (${s.totalGuests} total)</button>` : ''}
        <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;">
          <div style="font-size:11px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Tip: Tag attendees for more reach</div>
          <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0;">In the LinkedIn app: tap your photo → Tag people → search each name above</p>
        </div>
        ` : ''}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> &nbsp;·&nbsp; <button class="auth-toggle-btn" id="btnSignOut">Sign out</button></div>
    `
    wireBack()
    document.getElementById('btnCopyPost')?.addEventListener('click', () => {
      navigator.clipboard.writeText(s.postText).then(() => {
        const btn = document.getElementById('btnCopyPost')
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { if (btn) btn.textContent = 'Copy' }, 1500) }
      }).catch(() => {})
    })
    document.getElementById('btnDraftShuffle')?.addEventListener('click', () => {
      if (typeof draftState === 'object' && draftState.stage === 'ready') {
        startDraftFetch(s.eventId, s.eventName, state)
      }
    })
    return
  }
}

function nextConnectionLabel(nextAt: string | null): string {
  if (!nextAt) return ''
  const diff = new Date(nextAt).getTime() - Date.now()
  if (diff <= 0) return 'Next connection starting soon'
  const mins = Math.ceil(diff / 60000)
  return `Next connection in ~${mins} min`
}

async function renderCampaign(state: Extract<AppState, { type: 'campaign' }>): Promise<void> {
  // Fetch full progress data
  const [progressResp, storageData] = await Promise.all([
    new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_PROGRESS_DATA' }, r)),
    chrome.storage.local.get(['nextScheduledAt']),
  ])

  const events: any[] = progressResp?.events ?? []
  const nextAt: string | null = storageData.nextScheduledAt ?? null

  // Tally stats
  let sent = 0, dbPending = 0, failed = 0
  for (const event of events) {
    for (const contact of event.contacts ?? []) {
      const status = contact.connection_queue?.[0]?.status
      if (status === 'sent' || status === 'accepted') sent++
      else if (status === 'pending') dbPending++
      else if (status === 'failed') failed++
    }
  }

  const total = sent + dbPending + failed
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0
  const isRunning = state.pending > 0 && !state.paused

  const statusHtml = isRunning
    ? `<span class="status-pill pill-running"><span class="dot"></span>Running</span>`
    : state.paused
    ? `<span class="status-pill pill-paused"><span class="dot"></span>Paused</span>`
    : `<span class="status-pill pill-done"><span class="dot"></span>Done</span>`

  const statsHtml = `
    <div class="stats-row" style="margin:0 16px;">
      <div class="stat-card">
        <div class="stat-num green">${sent}</div>
        <div class="stat-label">Connected</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${dbPending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${failed > 0 ? `
      <div class="stat-card">
        <div class="stat-num" style="color:#9ca3af;">${failed}</div>
        <div class="stat-label">Skipped</div>
        <div style="font-size:9px;color:#d1d5db;margin-top:2px;line-height:1.3;">already connected<br>or unavailable</div>
      </div>` : ''}
    </div>
  `

  const progressHtml = total > 0 ? `
    <div style="padding:0 16px;">
      <div class="progress-wrap">
        <div class="progress-bg">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="progress-meta">
          <span>${pct}% complete</span>
          <span>${nextConnectionLabel(isRunning ? nextAt : null)}</span>
        </div>
      </div>
    </div>
  ` : ''

  const pauseBtnLabel = isRunning ? '⏸ Pause campaign' : '▶ Resume campaign'
  const pauseBtnId = isRunning ? 'btnPause' : 'btnResume'

  // ── Expandable events list ─────────────────────────────────────────────────
  const eventsListHtml = events.length === 0 ? '' : `
    <div class="section">
      <div class="feed-header">
        <span class="feed-title">Events</span>
      </div>
      <div class="events-list">
        ${events.map(ev => {
          const evId: string = ev.id ?? ''
          const contacts: any[] = ev.contacts ?? []
          const evSent = contacts.filter(c => ['sent', 'accepted'].includes(c.connection_queue?.[0]?.status ?? '')).length
          const evPending = contacts.filter(c => c.connection_queue?.[0]?.status === 'pending').length
          const isExpanded = expandedEvents.has(evId)
          const badgeText = evPending > 0 ? `${evPending} queued` : evSent > 0 ? `${evSent} sent` : `${contacts.length} scanned`
          const badgeClass = evPending > 0 ? 'queued' : ''
          const contactsHtml = isExpanded ? `
            <div class="event-contacts">
              ${contacts.map(c => {
                const status = c.connection_queue?.[0]?.status ?? ''
                const statusBadge = status ? `<span class="status-badge ${status}">${status}</span>` : ''
                const liUrl = c.linkedin_url ?? ''
                return `
                  <div class="contact-row">
                    <span class="contact-name">${escHtml(c.name ?? '')}</span>
                    <div style="display:flex;align-items:center;gap:4px;">
                      ${liUrl ? `<a href="${escHtml(liUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
                      ${statusBadge}
                    </div>
                  </div>
                `
              }).join('')}
            </div>
          ` : ''
          return `
            <div class="event-row">
              <div class="event-row-header" data-event-id="${escHtml(evId)}">
                <span class="event-row-name">${escHtml(ev.name ?? 'Event')}</span>
                <span class="event-row-badge ${badgeClass}">${escHtml(badgeText)}</span>
                <span class="chevron" data-chevron>${isExpanded ? '▲' : '▼'}</span>
              </div>
              ${contactsHtml}
            </div>
          `
        }).join('')}
      </div>
    </div>
  `

  // ── Draft button (navigates to full-page draft view) ──────────────────────
  const draftSectionHtml = `
    <div class="section">
      <button class="btn btn-secondary" id="btnDraftPost">✍ Draft a LinkedIn post</button>
    </div>
  `

  // ── Scan CTA ───────────────────────────────────────────────────────────────
  const scanCta = `
    <div class="section">
      <button class="btn btn-secondary" id="btnScanAnother">+ Scan another event</button>
    </div>
  `

  root.innerHTML = `
    <div class="compact-header">
      <div class="compact-brand">
        <img src="../icons/icon48.png" class="compact-logo" alt="">
        <span class="compact-name">I Hate Networking</span>
      </div>
      ${statusHtml}
    </div>

    <div class="section">
      ${statsHtml}
      ${progressHtml}
      ${state.pending > 0 ? `<div class="pause-row"><button class="btn btn-secondary" id="${pauseBtnId}">${pauseBtnLabel}</button></div>` : ''}
    </div>

    ${eventsListHtml}
    ${draftSectionHtml}
    ${scanCta}

    <p style="text-align:center;font-size:11px;color:#9ca3af;margin:8px 16px 0;">Closing this panel won't stop your campaign.</p>

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `

  // ── Wire pause / resume ────────────────────────────────────────────────────
  document.getElementById('btnPause')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_CAMPAIGN' }, () => render())
  })
  document.getElementById('btnResume')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESUME_CAMPAIGN' }, () => render())
  })

  // ── Wire scan CTA ──────────────────────────────────────────────────────────
  document.getElementById('btnScanAnother')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url: 'https://lu.ma' })
    } else {
      chrome.tabs.create({ url: 'https://lu.ma' })
    }
  })

  // ── Wire event row expansion (direct DOM — instant, no re-fetch) ───────────
  document.querySelectorAll<HTMLElement>('.event-row-header').forEach(header => {
    header.addEventListener('click', () => {
      const evId = header.getAttribute('data-event-id') ?? ''
      const eventRow = header.parentElement!
      const chevron = header.querySelector('[data-chevron]')
      if (expandedEvents.has(evId)) {
        expandedEvents.delete(evId)
        eventRow.querySelector('.event-contacts')?.remove()
        if (chevron) chevron.textContent = '▼'
      } else {
        expandedEvents.add(evId)
        const ev = events.find(e => e.id === evId)
        if (ev) {
          if (chevron) chevron.textContent = '▲'
          const contactsDiv = document.createElement('div')
          contactsDiv.className = 'event-contacts'
          contactsDiv.innerHTML = (ev.contacts ?? []).map((c: any) => {
            const status = c.connection_queue?.[0]?.status ?? ''
            const statusBadge = status ? `<span class="status-badge ${status}">${status}</span>` : ''
            const liUrl = c.linkedin_url ?? ''
            return `
              <div class="contact-row">
                <span class="contact-name">${escHtml(c.name ?? '')}</span>
                <div style="display:flex;align-items:center;gap:4px;">
                  ${liUrl ? `<a href="${escHtml(liUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
                  ${statusBadge}
                </div>
              </div>
            `
          }).join('')
          eventRow.appendChild(contactsDiv)
        }
      }
    })
  })

  // ── Wire draft button → navigate to full-page draft view ──────────────────
  document.getElementById('btnDraftPost')?.addEventListener('click', () => {
    if (events.length === 0) return
    draftViewOpen = true
    draftState = 'closed'
    if (events.length === 1) {
      startDraftFetch(events[0].id, events[0].name ?? '', state)
    } else {
      draftState = { stage: 'pick' }
      renderDraftView(state)
    }
  })
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

function renderAuthGate(): string {
  return `
    <div class="auth-gate" id="authGate">
      <div class="auth-label">${authMode === 'signup' ? 'Create an account' : 'Sign in'} to launch</div>
      <input id="authEmail" type="email" placeholder="Email" autocomplete="email">
      <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password">
      <div class="auth-error" id="authError"></div>
      <button class="btn btn-primary" id="btnAuthSubmit" style="margin-top:4px;">
        ${authMode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      <div class="auth-toggle">
        ${authMode === 'signup'
          ? 'Already have an account? <button class="auth-toggle-btn" id="btnToggleAuth">Sign in</button>'
          : 'New here? <button class="auth-toggle-btn" id="btnToggleAuth">Create account</button>'}
      </div>
    </div>
  `
}

function wireAuthGate(): void {
  document.getElementById('btnToggleAuth')?.addEventListener('click', () => {
    authMode = authMode === 'signup' ? 'signin' : 'signup'
    render()
  })
  document.getElementById('btnAuthSubmit')?.addEventListener('click', async () => {
    const email = (document.getElementById('authEmail') as HTMLInputElement)?.value ?? ''
    const password = (document.getElementById('authPassword') as HTMLInputElement)?.value ?? ''
    const errEl = document.getElementById('authError')
    if (errEl) errEl.textContent = ''
    const type = authMode === 'signup' ? 'SIGN_UP' : 'SIGN_IN'
    const result: { success: boolean; error?: string } = await new Promise(r => chrome.runtime.sendMessage({ type, data: { email, password } }, r))
    if (!result.success) {
      if (errEl) errEl.textContent = result.error ?? 'Error'
    } else {
      render()
    }
  })
}

function wireSignOut(): void {
  document.getElementById('btnSignOut')?.addEventListener('click', async () => {
    await new Promise(r => chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, r))
    render()
  })
}

// ── Scan flow ─────────────────────────────────────────────────────────────────

function startScan(ctx: Extract<TabContext, { kind: 'luma-event' }>, hasCampaign = false): void {
  scanState = { type: 'scanning', phase: 'starting', done: 0, total: 0, currentName: '', startTime: Date.now() }
  renderEventPage(ctx, hasCampaign)
  chrome.tabs.sendMessage(ctx.tabId, { type: 'START_SCAN' })
}

async function launchCampaign(s: Extract<ScanState, { type: 'results' }>): Promise<void> {
  const result: { queued: number; eventId: string } = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'LAUNCH_CAMPAIGN', data: { eventId: s.eventId, note: noteValue } }, resolve)
  })
  scanState = { type: 'launched', queued: result.queued, eventId: result.eventId }
  render()
}

async function renderEventPage(ctx: Extract<TabContext, { kind: 'luma-event' }>, hasCampaign = false): Promise<void> {
  if (scanState.type === 'idle') {
    const existing: { eventId: string; existingUrls: string[]; linkedInCount: number } = await new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.runtime.sendMessage({ type: 'GET_EVENT_BY_URL', lumaUrl: tab?.url ?? '' }, resolve)
      })
    })
    if (existing?.eventId && existing.existingUrls.length > 0) {
      scanState = { type: 'already_scanned', count: existing.existingUrls.length, linkedInCount: existing.linkedInCount, eventId: existing.eventId, eventName: ctx.eventName }
    }
  }

  if (scanState.type === 'idle') {
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section event-hero">
        <div class="event-name">${escHtml(ctx.eventName || 'This event')}</div>
        <div class="event-meta">Luma event</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnScan">Scan attendees for LinkedIn profiles</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> &nbsp;·&nbsp; <button class="auth-toggle-btn" id="btnSignOut">Sign out</button></div>
    `
    document.getElementById('btnScan')!.addEventListener('click', () => startScan(ctx, hasCampaign))
    return
  }

  if (scanState.type === 'already_scanned') {
    const s = scanState
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="event-name">${escHtml(ctx.eventName || 'This event')}</div>
        <div class="already-count" style="margin-top:8px;font-size:13px;color:#6b7280;">${s.count} attendees scanned · ${s.linkedInCount} on LinkedIn</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnRescan">Scan again for new attendees</button>
        ${hasCampaign ? `<button class="btn btn-secondary" id="btnViewProgress" style="margin-top:8px;">View campaign progress</button>` : ''}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> &nbsp;·&nbsp; <button class="auth-toggle-btn" id="btnSignOut">Sign out</button></div>
    `
    document.getElementById('btnRescan')!.addEventListener('click', () => startScan(ctx, hasCampaign))
    document.getElementById('btnViewProgress')!.addEventListener('click', () => {
      scanState = { type: 'idle' }
      render()
    })
    return
  }

  if (scanState.type === 'scanning') {
    const s = scanState
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
    const eta = s.total > 0 ? etaString(s.done, s.total, s.startTime) : ''
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
        <span class="status-pill pill-running"><span class="dot"></span>Scanning</span>
      </div>
      <div class="section">
        <div class="scanning-label">Scanning <strong>${escHtml(s.currentName || '...')}</strong></div>
        <div class="progress-bg"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-meta"><span>${s.done}/${s.total || '?'}</span><span>${eta}</span></div>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> &nbsp;·&nbsp; <button class="auth-toggle-btn" id="btnSignOut">Sign out</button></div>
    `
    return
  }

  if (scanState.type === 'results') {
    const s = scanState
    if (!noteValue) noteValue = defaultNote(s.eventName)
    const linkedInReady: boolean = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'CHECK_LINKEDIN_LOGIN' }, r => resolve(r?.loggedIn ?? false)))
    const leadsHtml = s.contacts.filter(c => c.linkedInUrl).map(c => `
      <div class="lead-row">
        <div class="lead-initials">${escHtml(initials(c.name))}</div>
        <div class="lead-name">${escHtml(c.name)}</div>
        <div class="lead-badges">
          ${c.linkedInUrl ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
          ${c.instagramUrl ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ''}
          ${c.twitterUrl ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="badge badge-x">x</a>` : ''}
        </div>
      </div>`).join('')

    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="results-count">Found ${s.found} on LinkedIn</div>
        <div class="results-sub">out of ${s.total} attendees scanned</div>
        ${s.contacts.length > 0 ? `<div class="leads-list">${leadsHtml}</div>` : ''}
        <div class="field-label">Message <span class="char-count" id="charCount">(optional) ${noteValue.length}/${MAX_NOTE}</span></div>
        <textarea id="noteInput" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>
        ${s.eventId ? `
          <div class="li-status ${linkedInReady ? 'ok' : 'warn'}">
            ${linkedInReady ? '✓ LinkedIn ready' : '⚠ Not logged into LinkedIn &nbsp;<a class="li-open" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn ↗</a>'}
          </div>
          <button class="btn btn-primary" id="btnConnect" ${linkedInReady ? '' : 'disabled'} style="margin-top:8px;">
            Send connection requests to ${s.found} people
          </button>
        ` : renderAuthGate()}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> &nbsp;·&nbsp; <button class="auth-toggle-btn" id="btnSignOut">Sign out</button></div>
    `
    document.getElementById('noteInput')?.addEventListener('input', (e) => {
      noteValue = (e.target as HTMLTextAreaElement).value
      const el = document.getElementById('charCount')
      if (el) el.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`
    })
    document.getElementById('btnConnect')?.addEventListener('click', () => launchCampaign(s))
    wireAuthGate()
    return
  }

  if (scanState.type === 'launched') {
    const s = scanState
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section" style="text-align:center;padding:32px 20px;">
        <div class="launched-icon">🎉</div>
        <div class="launched-title">Campaign launched!</div>
        <div class="launched-sub">${s.queued} connection request${s.queued === 1 ? '' : 's'} queued</div>
        <div class="launched-note">We'll send them slowly during business hours — 35/day max — to keep your account safe.</div>
        <button class="btn btn-secondary" id="btnDone">Done</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> &nbsp;·&nbsp; <button class="auth-toggle-btn" id="btnSignOut">Sign out</button></div>
    `
    document.getElementById('btnDone')!.addEventListener('click', () => {
      scanState = { type: 'idle' }
      render()
    })
    return
  }
}

// ── Main render + listeners ───────────────────────────────────────────────────

async function render(): Promise<void> {
  renderLoading()
  try {
    const [state, ctx] = await Promise.all([resolveAppState(), resolveTabContext()])

    const hasCampaign = state.type === 'campaign'

    // Mid-scan: always show event page view regardless of campaign state
    if (scanState.type !== 'idle' && ctx.kind === 'luma-event') {
      await renderEventPage(ctx, hasCampaign)
      return
    }

    if (state.type === 'campaign' && draftViewOpen) {
      await renderDraftView(state)
    } else if (state.type === 'campaign') {
      await renderCampaign(state)
    } else if (ctx.kind === 'luma-event') {
      await renderEventPage(ctx, hasCampaign)
    } else {
      renderLanding(state.ctx)
    }
  } catch (err) {
    root.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#ef4444;font-size:13px;">Something went wrong. Try closing and reopening the panel.<br><br><small style="color:#9ca3af">${err}</small></div>`
  }
  wireSignOut()
}

// Scan progress messages from luma.ts content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LINKEDIN_NAMES_PROGRESS') {
    const el = document.getElementById('draftNamesProgress')
    if (!el) return
    const done: number = msg.done
    const total: number = msg.total
    if (draftNamesStartTime > 0 && done > 0) {
      const elapsed = (Date.now() - draftNamesStartTime) / 1000
      const perItem = elapsed / done
      const remaining = Math.ceil((total - done) * perItem)
      const eta = remaining > 0 ? ` · ~${remaining}s left` : ''
      el.textContent = `Fetching names ${done} / ${total}${eta}`
    } else {
      el.textContent = `Fetching names ${done} / ${total}`
    }
    return
  }
  if (msg.type === 'SCAN_PROGRESS') {
    if (scanState.type !== 'scanning') return
    scanState = {
      ...scanState,
      phase: msg.phase,
      done: msg.done ?? (scanState as any).done,
      total: msg.total ?? (scanState as any).total,
      currentName: msg.currentName ?? (scanState as any).currentName,
    }
    resolveTabContext().then(ctx => {
      if (ctx.kind === 'luma-event') renderEventPage(ctx)
    })
  }
  if (msg.type === 'SCAN_COMPLETE') {
    scanState = {
      type: 'results',
      found: msg.found,
      total: msg.total,
      eventId: msg.eventId,
      eventName: (scanState as any).eventName ?? '',
      contacts: msg.contacts ?? [],
    }
    resolveTabContext().then(ctx => {
      if (ctx.kind === 'luma-event') renderEventPage(ctx)
    })
  }
})

// Re-render when user switches to a different tab
chrome.tabs.onActivated.addListener(() => render())

// Re-render when the active tab's URL changes
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) render()
})

// Re-render when storage changes (campaign starts/stops/pauses)
chrome.storage.onChanged.addListener(() => render())

render()
