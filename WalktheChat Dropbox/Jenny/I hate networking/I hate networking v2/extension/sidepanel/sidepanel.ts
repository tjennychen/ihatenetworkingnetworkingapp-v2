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
  const pending: number = storage.queuePending ?? 0
  const paused: boolean = storage.campaignPaused ?? false
  if (pending > 0 || paused) {
    return { type: 'campaign', pending, paused, ctx }
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
      <img src="../icons/icon48.png" class="hero-logo" alt="">
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
          <div class="step-title">Connections send automatically</div>
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

function nextConnectionLabel(nextAt: string | null): string {
  if (!nextAt) return ''
  const diff = new Date(nextAt).getTime() - Date.now()
  if (diff <= 0) return 'Next connection starting soon'
  const mins = Math.ceil(diff / 60000)
  return `Next connection in ~${mins} min`
}

async function renderCampaign(state: Extract<AppState, { type: 'campaign' }>): Promise<void> {
  // Fetch full progress data for activity feed
  const [progressResp, storageData] = await Promise.all([
    new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_PROGRESS_DATA' }, r)),
    chrome.storage.local.get(['nextScheduledAt']),
  ])

  const events: any[] = progressResp?.events ?? []
  const nextAt: string | null = storageData.nextScheduledAt ?? null

  // Tally stats + build activity list
  let sent = 0, dbPending = 0, failed = 0
  const recentActivity: { name: string; eventName: string }[] = []

  for (const event of events) {
    for (const contact of event.contacts ?? []) {
      const status = contact.connection_queue?.[0]?.status
      if (status === 'sent' || status === 'accepted') {
        sent++
        recentActivity.push({ name: contact.name ?? '', eventName: event.name ?? '' })
      } else if (status === 'pending') {
        dbPending++
      } else if (status === 'failed') {
        failed++
      }
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
        <div class="stat-num">${pending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${failed > 0 ? `
      <div class="stat-card">
        <div class="stat-num red">${failed}</div>
        <div class="stat-label">Skipped</div>
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

  const activityHtml = recentActivity.length > 0 ? `
    <div class="section">
      <div class="feed-header">
        <span class="feed-title">Recently Connected</span>
      </div>
      <div class="feed-list">
        ${recentActivity.map(a => `
          <div class="feed-row">
            <div class="feed-avatar">${escHtml(initials(a.name))}</div>
            <div class="feed-info">
              <div class="feed-name">${escHtml(a.name)}</div>
            </div>
            <span class="feed-event-tag" title="${escHtml(a.eventName)}">${escHtml(a.eventName)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''

  const scanCta = state.ctx.kind === 'luma-event' ? `
    <div class="section">
      <button class="btn btn-primary" id="btnScan">Scan this event's guest list</button>
    </div>
  ` : `
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

    ${activityHtml}
    ${scanCta}

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `

  document.getElementById('btnPause')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_CAMPAIGN' }, () => render())
  })
  document.getElementById('btnResume')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESUME_CAMPAIGN' }, () => render())
  })
  document.getElementById('btnScanAnother')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://lu.ma' })
  })
  // btnScan wired up in Task 6 when scan flow is ready
}

// ── Main render + listeners ───────────────────────────────────────────────────

async function render(): Promise<void> {
  renderLoading()
  const state = await resolveAppState()
  if (state.type === 'landing') {
    renderLanding(state.ctx)
  } else if (state.type === 'campaign') {
    await renderCampaign(state)
  }
}

// Re-render when user switches to a different tab
chrome.tabs.onActivated.addListener(() => render())

// Re-render when the active tab's URL changes
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) render()
})

// Re-render when storage changes (campaign starts/stops/pauses)
chrome.storage.onChanged.addListener(() => render())

render()
