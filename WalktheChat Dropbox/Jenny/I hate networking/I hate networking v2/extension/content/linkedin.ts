// LinkedIn content script — Voyager API approach
// Calls LinkedIn's internal REST API instead of clicking DOM buttons.
// Same-origin context (content script on linkedin.com) means cookies and CSRF work naturally.

const VOYAGER = 'https://www.linkedin.com/voyager/api'

// Correct invite endpoint as of 2026 (normInvitations is deprecated/dead)
const INVITE_URL =
  `${VOYAGER}/voyagerRelationshipsDashMemberRelationships` +
  `?action=verifyQuotaAndCreateV2` +
  `&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2`

// JSESSIONID doubles as the CSRF token — LinkedIn sets it without HttpOnly so JS can read it
function getCsrfToken(): string {
  const m = document.cookie.match(/JSESSIONID=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function voyagerHeaders(csrf: string): Record<string, string> {
  return {
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'content-type': 'application/json; charset=UTF-8',
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    // These mimic LinkedIn's own frontend requests — helps avoid 403 rejections
    'x-li-page-instance': 'urn:li:page:d_flagship3_profile_view_base;' + Math.random().toString(36).slice(2),
    'x-li-track': JSON.stringify({
      clientVersion: '1.13.3655',
      mpVersion: '1.13.3655',
      osName: 'web',
      timezoneOffset: new Date().getTimezoneOffset() / -60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      mpName: 'voyager-web',
      displayDensity: window.devicePixelRatio,
      displayWidth: window.screen.width,
      displayHeight: window.screen.height,
    }),
  }
}

// ── Profile URN extraction ────────────────────────────────────────────────────
//
// LinkedIn no longer injects data into <code> elements on profile pages.
// Instead, scan the page HTML near the profile's publicIdentifier (vanity name)
// to find the matching fsd_profile entityUrn.

function getProfileUrnFromPage(vanityName: string): string | null {
  const html = document.documentElement.innerHTML

  // Primary: find the URN within ~400 chars of the publicIdentifier to avoid
  // matching recommendation authors or "People Also Viewed" entries
  const pubIdx = html.indexOf(`"publicIdentifier":"${vanityName}"`)
  if (pubIdx !== -1) {
    const slice = html.slice(Math.max(0, pubIdx - 400), pubIdx + 400)
    const m = slice.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/)
    if (m) return m[1]
  }

  // Fallback: first fsd_profile URN anywhere on the page
  // (usually the profile being viewed, not a sidebar recommendation)
  const m = html.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/)
  return m ? m[1] : null
}

// API fallback: dash profiles endpoint returns fsd_profile entityUrn directly
async function fetchProfileUrn(vanityName: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const resp = await fetch(
      `${VOYAGER}/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}`,
      { headers, credentials: 'include' }
    )
    if (!resp.ok) return null
    const data = await resp.json()
    // entityUrn is in data.data or data.elements[0] depending on API version
    const urn: string =
      data?.data?.entityUrn ??
      data?.elements?.[0]?.entityUrn ??
      (data?.included ?? [])[0]?.entityUrn ??
      ''
    return urn.startsWith('urn:li:fsd_profile:') ? urn : null
  } catch {
    return null
  }
}

// ── API error parsing ─────────────────────────────────────────────────────────

async function parseInviteError(resp: Response): Promise<string> {
  let body: Record<string, unknown> = {}
  try { body = await resp.json() } catch { /* non-JSON body */ }

  const msg = String(body?.message ?? body?.code ?? '').toUpperCase()

  if (resp.status === 429) return 'weekly_limit_reached'
  if (resp.status === 403) return `not_logged_in:${msg.slice(0, 80) || 'no_body'}`

  if (msg.includes('CANT_RESEND_YET') || msg.includes('DUPLICATE') ||
      (msg.includes('ALREADY') && msg.includes('INVIT'))) return 'already_pending'
  if (msg.includes('FIRST_DEGREE') || msg.includes('ALREADY_CONNECTED')) return 'already_connected'
  if (msg.includes('QUOTA') || msg.includes('LIMIT')) return 'weekly_limit_reached'

  return `api_error_${resp.status}:${msg.slice(0, 60)}`
}

// ── DOM helpers (pre-flight checks and name verification only) ────────────────

function getMain(): Element {
  return document.querySelector('main') ?? document.body
}

function getProfileName(): string {
  return document.querySelector<HTMLElement>('h1')?.textContent?.trim() ?? ''
}

function namesMatch(pageName: string, expectedName: string): boolean {
  if (!expectedName) return true
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, '').trim()
  const page = normalize(pageName)
  const pageWords = page.split(/\s+/)
  const parts = normalize(expectedName).split(/\s+/).filter(Boolean)
  return parts.every(part =>
    page.includes(part) ||
    // LinkedIn abbreviates last names to "F." for privacy — accept single-letter match
    pageWords.some(w => w.length === 1 && part.startsWith(w))
  )
}

function findButtonByText(text: string, root: Element = document.body): HTMLButtonElement | null {
  const lower = text.toLowerCase()
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
  return (
    buttons.find(b => b.textContent?.trim() === text) ??
    buttons.find(b => b.textContent?.trim().toLowerCase().includes(lower)) ??
    null
  )
}

// ── Note quota storage ────────────────────────────────────────────────────────

function getNoteQuotaReached(): Promise<boolean> {
  return new Promise(resolve => chrome.storage.local.get('noteQuotaReached', r => resolve(!!r.noteQuotaReached)))
}

function setNoteQuotaReached(): Promise<void> {
  return new Promise(resolve => chrome.storage.local.set({ noteQuotaReached: true }, resolve))
}

// ── Core invite call ──────────────────────────────────────────────────────────

async function postInvite(
  profileUrn: string,
  note: string,
  headers: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    invitee: {
      inviteeUnion: {
        memberProfile: profileUrn,  // full "urn:li:fsd_profile:..." string
      },
    },
  }
  if (note) payload.customMessage = note

  let resp: Response
  try {
    resp = await fetch(INVITE_URL, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return { success: false, error: `fetch_failed: ${String(e)}` }
  }

  if (resp.ok) return { success: true }

  return { success: false, error: await parseInviteError(resp) }
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

async function sendConnection(note?: string, expectedName?: string): Promise<{ success: boolean; error?: string }> {
  if (!window.location.pathname.startsWith('/in/')) {
    return { success: false, error: 'Not a profile page' }
  }

  // Name verification (DOM — fast, no extra request)
  const pageName = getProfileName()
  if (!namesMatch(pageName, expectedName ?? '')) {
    return { success: false, error: `wrong_profile: expected "${expectedName}", got "${pageName}"` }
  }

  const csrf = getCsrfToken()
  if (!csrf) return { success: false, error: 'no_csrf_token' }

  const headers = voyagerHeaders(csrf)
  const vanityName = window.location.pathname.split('/').filter(Boolean)[1] ?? ''

  // Quick DOM pre-flight: bail early if already pending
  const main = getMain()
  if (findButtonByText('Pending', main) || findButtonByText('Withdraw', main)) {
    return { success: false, error: 'already_pending' }
  }

  // Get profile URN (try page HTML first, then API)
  let profileUrn = getProfileUrnFromPage(vanityName)
  if (!profileUrn) {
    profileUrn = await fetchProfileUrn(vanityName, headers)
  }
  if (!profileUrn) {
    return { success: false, error: 'no_profile_urn' }
  }

  // Skip note if quota previously reached
  const noteQuotaReached = await getNoteQuotaReached()
  const effectiveNote = note && !noteQuotaReached ? note : ''

  const result = await postInvite(profileUrn, effectiveNote, headers)

  // If invite with note failed, retry without (note might be hitting quota or format issue)
  if (!result.success && effectiveNote) {
    await setNoteQuotaReached()
    return postInvite(profileUrn, '', headers)
  }

  return result
}

// ── LinkedIn name fetching (unchanged — already uses fetch) ───────────────────

function extractNameFromHtml(html: string): string {
  const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/)
    ?? html.match(/content="([^"]+)"\s+property="og:title"/)
  if (ogMatch) return ogMatch[1].trim()
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  if (titleMatch) return titleMatch[1].replace(/\s*[|\-–]\s*.*$/i, '').trim()
  return ''
}

// ── Message listener ──────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendConnection(msg.note || '', msg.expectedName || '').then(result => sendResponse(result))
    return true
  }
  if (msg.type === 'GET_LINKEDIN_NAME') {
    sendResponse({ name: getProfileName() })
    return true
  }
  if (msg.type === 'FETCH_LINKEDIN_PROFILES') {
    ;(async () => {
      const contacts: { id: string; linkedin_url: string }[] = msg.contacts ?? []
      const results: { id: string; linkedin_name: string }[] = []
      for (const c of contacts) {
        const url = c.linkedin_url.replace('https://linkedin.com/', 'https://www.linkedin.com/')
        let linkedinName = ''
        try {
          const resp = await fetch(url, { credentials: 'include' })
          const html = await resp.text()
          linkedinName = extractNameFromHtml(html)
        } catch { /* ignore */ }
        results.push({ id: c.id, linkedin_name: linkedinName })
        chrome.runtime.sendMessage({ type: 'LINKEDIN_NAMES_PROGRESS', done: results.length, total: contacts.length }).catch(() => {})
      }
      sendResponse(results)
    })()
    return true
  }
})
