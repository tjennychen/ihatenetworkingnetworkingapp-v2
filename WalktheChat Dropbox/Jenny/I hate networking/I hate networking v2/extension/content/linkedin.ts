// LinkedIn content script — Voyager API approach
// Replaces brittle DOM clicking with LinkedIn's internal REST API.
// Same-origin context (content script on linkedin.com) means cookies and CSRF work naturally.

const VOYAGER = 'https://www.linkedin.com/voyager/api'

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
  }
}

// ── Profile ID extraction ─────────────────────────────────────────────────────
//
// LinkedIn's profile pages hydrate data into <code> elements as JSON blobs.
// We scan for the profile's entityUrn there first (zero extra requests).
// Fall back to a Voyager profileView call if the page JSON doesn't have it.

function getProfileIdFromPage(): string | null {
  const codeEls = Array.from(document.querySelectorAll('code'))
  for (const el of codeEls) {
    const text = el.textContent ?? ''
    // fsd_profile (newer dash API format)
    let m = text.match(/"entityUrn":"urn:li:fsd_profile:([A-Za-z0-9_-]+)"/)
    if (m) return m[1]
    // fs_miniProfile (older format — same base64 value, interchangeable)
    m = text.match(/"entityUrn":"urn:li:fs_miniProfile:([A-Za-z0-9_-]+)"/)
    if (m) return m[1]
  }
  return null
}

async function fetchProfileId(vanityName: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const resp = await fetch(
      `${VOYAGER}/identity/profiles/${encodeURIComponent(vanityName)}/profileView`,
      { headers, credentials: 'include' }
    )
    if (!resp.ok) return null
    const data = await resp.json()
    const miniUrn: string = data?.profile?.miniProfile?.entityUrn ?? ''
    const m = miniUrn.match(/urn:li:(?:fsd_profile|fs_miniProfile):([A-Za-z0-9_-]+)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// ── API error parsing ─────────────────────────────────────────────────────────

async function parseInviteError(resp: Response): Promise<string> {
  let body: Record<string, unknown> = {}
  try { body = await resp.json() } catch { /* non-JSON */ }

  const msg = String(body?.message ?? body?.exceptionClass ?? '').toUpperCase()

  if (resp.status === 429) return 'weekly_limit_reached'
  if (resp.status === 403) return 'not_logged_in'

  if (msg.includes('FIRST_DEGREE') || msg.includes('ALREADY_CONNECTED')) return 'already_connected'
  if (msg.includes('DUPLICATE') || msg.includes('ALREADY') && msg.includes('INVIT')) return 'already_pending'
  if (msg.includes('QUOTA') || msg.includes('LIMIT')) return 'weekly_limit_reached'

  return `api_error_${resp.status}:${msg.slice(0, 60)}`
}

// ── DOM helpers (kept for pre-flight checks and name verification only) ───────

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
  profileId: string,
  note: string,
  headers: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    emberEntityName: 'growth/invitation',
    invitee: {
      'com.linkedin.voyager.growth.invitation.InviteeProfile': { profileId },
    },
  }
  if (note) payload.message = note

  let resp: Response
  try {
    resp = await fetch(`${VOYAGER}/growth/normInvitations`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return { success: false, error: `fetch_failed: ${String(e)}` }
  }

  // 201 Created = success
  if (resp.status === 201) return { success: true }

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

  // Quick DOM pre-flight: bail early if already pending or already connected
  const main = getMain()
  if (findButtonByText('Pending', main) || findButtonByText('Withdraw', main)) {
    return { success: false, error: 'already_pending' }
  }

  // Get profile ID (try page JSON first, then API)
  let profileId = getProfileIdFromPage()
  if (!profileId) {
    profileId = await fetchProfileId(vanityName, headers)
  }
  if (!profileId) {
    return { success: false, error: 'no_profile_urn' }
  }

  // Determine effective note (skip if quota reached)
  const noteQuotaReached = await getNoteQuotaReached()
  const effectiveNote = note && !noteQuotaReached ? note : ''

  const result = await postInvite(profileId, effectiveNote, headers)

  // If note caused a quota error, retry without note and remember for future
  if (!result.success && effectiveNote && result.error?.includes('already_pending')) {
    await setNoteQuotaReached()
    return postInvite(profileId, '', headers)
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
