import { icons } from '../lib/icons'

const brandHtml = `
  <div class="brand">
    <img src="../icons/icon48.png" class="brand-logo" alt="">
    <div class="brand-text">
      <div class="brand-name">I hate networking</div>
      <div class="brand-sub">networking app</div>
    </div>
  </div>
`

async function init() {
  const root = document.getElementById('root')!
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const isLuma = (tab.url ?? '').includes('lu.ma') || (tab.url ?? '').includes('luma.com')

  // Fetch data in parallel
  const [progressResp, pausedResp, statusResp] = await Promise.all([
    new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_PROGRESS_DATA' }, r)),
    new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_CAMPAIGN_PAUSED' }, r)),
    new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATUS' }, r)),
  ])

  const events: any[] = progressResp?.events ?? []
  const paused: boolean = pausedResp?.paused ?? false
  const lastSentAt: string | undefined = statusResp?.lastSentAt
  const lastSentName: string | undefined = statusResp?.lastSentName
  const nextScheduledAt: string | undefined = statusResp?.nextScheduledAt

  // Tally stats across all queue items
  let sent = 0, pending = 0, failed = 0
  const recentSent: string[] = []

  for (const event of events) {
    for (const contact of event.contacts ?? []) {
      const status = contact.connection_queue?.[0]?.status
      if (status === 'sent' || status === 'accepted') {
        sent++
        if (recentSent.length < 4) recentSent.push(contact.name ?? '')
      } else if (status === 'pending') {
        pending++
      } else if (status === 'failed') {
        failed++
      }
    }
  }

  const hasQueue = sent + pending + failed > 0

  // ── No campaign yet ──────────────────────────────────────────────────────
  if (!hasQueue) {
    root.innerHTML = `
      <div class="header">
        ${brandHtml}
        <span class="status-pill status-idle"><span class="dot"></span>Idle</span>
      </div>
      <div class="idle-wrap">
        <div class="idle-emoji">🤝</div>
        <div class="idle-title">No active campaign</div>
        <div class="idle-sub">${isLuma ? 'Find attendees and connect on LinkedIn.' : 'Start from any Luma event page.'}</div>
        ${isLuma
          ? `<button class="btn-primary" id="btnScan">Scan this event →</button>`
          : `<button class="btn-secondary" id="btnLuma">Open Luma.com →</button>`
        }
      </div>
    `
    if (isLuma) {
      root.querySelector('#btnScan')!.addEventListener('click', () => {
        chrome.tabs.sendMessage(tab.id!, { type: 'OPEN_PANEL' })
        window.close()
      })
    } else {
      root.querySelector('#btnLuma')!.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://lu.ma' })
        window.close()
      })
    }
    return
  }

  // ── Active campaign ──────────────────────────────────────────────────────
  const isRunning = pending > 0 && !paused
  const isDone = pending === 0

  const statusHtml = isDone
    ? `<span class="status-pill status-idle"><span class="dot"></span>Done</span>`
    : paused
    ? `<span class="status-pill status-paused"><span class="dot"></span>Paused</span>`
    : `<span class="status-pill status-running"><span class="dot"></span>Running</span>`

  const instructionHtml = isDone
    ? `All connections have been sent or processed.`
    : paused
    ? `Campaign is paused. <strong>Resume</strong> to continue sending.`
    : `Sending requests automatically. <strong>Keep Chrome open</strong> while it runs.`

  const pauseBtnHtml = isDone ? '' : paused
    ? `<button class="btn-resume" id="btnPause">${icons.play} Resume campaign</button>`
    : `<button class="btn-pause" id="btnPause">${icons.pause} Pause campaign</button>`

  const recentHtml = recentSent.length > 0 ? `
    <div class="section">
      <div class="recent-title">Recently sent</div>
      ${recentSent.map(n => `
        <div class="recent-row">
          <span class="recent-check">${icons.check}</span>
          <span class="recent-name">${escHtml(n)}</span>
        </div>
      `).join('')}
    </div>
  ` : ''

  const scanBtnHtml = isLuma
    ? `<div class="section"><button class="btn-secondary" id="btnScan">Scan another event →</button></div>`
    : ''

  root.innerHTML = `
    <div class="header">
      ${brandHtml}
      ${statusHtml}
    </div>
    <div class="section">
      <div class="instruction">${instructionHtml}</div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-num green">${sent}</div>
        <div class="stat-label">Sent</div>
      </div>
      <div class="stat">
        <div class="stat-num">${pending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${failed > 0 ? `
      <div class="stat">
        <div class="stat-num red">${failed}</div>
        <div class="stat-label">Skipped</div>
      </div>` : ''}
    </div>
    ${pauseBtnHtml ? `<div class="section">${pauseBtnHtml}</div>` : ''}
    ${recentHtml}
    ${scanBtnHtml}
    ${isRunning ? `<div class="rate-note">${timingLine(lastSentName, lastSentAt, nextScheduledAt)}</div>` : ''}
  `

  root.querySelector('#btnPause')?.addEventListener('click', async () => {
    const msg = paused ? 'RESUME_CAMPAIGN' : 'PAUSE_CAMPAIGN'
    await new Promise<void>(r => chrome.runtime.sendMessage({ type: msg }, () => r()))
    init() // re-render with new state
  })

  if (isLuma) {
    root.querySelector('#btnScan')?.addEventListener('click', () => {
      chrome.tabs.sendMessage(tab.id!, { type: 'OPEN_PANEL' })
      window.close()
    })
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function timingLine(lastSentName?: string, lastSentAt?: string, nextScheduledAt?: string): string {
  const parts: string[] = []
  if (lastSentName && lastSentAt) {
    const mins = Math.round((Date.now() - new Date(lastSentAt).getTime()) / 60000)
    parts.push(`Last: ${escHtml(lastSentName)} · ${mins}m ago`)
  }
  if (nextScheduledAt) {
    const mins = Math.max(0, Math.round((new Date(nextScheduledAt).getTime() - Date.now()) / 60000))
    parts.push(mins === 0 ? 'Next: soon' : `Next in ~${mins}m`)
  } else if (parts.length === 0) {
    return 'First send starting soon — keep Chrome open'
  }
  return parts.join(' · ')
}

init()
