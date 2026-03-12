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

// Look up profile URN via Voyager memberIdentity API.
// More reliable than HTML parsing — LinkedIn's profile HTML is JS-rendered so raw
// HTTP fetch() doesn't contain the embedded URN data.
async function fetchProfileUrnViaApi(vanityName: string, csrf: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `${VOYAGER}/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}`,
      {
        credentials: 'include',
        headers: {
          accept: 'application/vnd.linkedin.normalized+json+2.1',
          'csrf-token': csrf,
          'x-restli-protocol-version': '2.0.0',
          'x-li-lang': 'en_US',
        },
      }
    )
    if (!resp.ok) return null
    const m = JSON.stringify(await resp.json()).match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// Fallback: fetch the profile page HTML and extract the URN.
// Works when the content script is already on the profile page (DOM has JS-rendered data).
async function fetchProfileUrnFromHtml(vanityName: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/`, {
      credentials: 'include',
    })
    if (!resp.ok) return null
    const html = await resp.text()
    const pubIdx = html.indexOf(`"publicIdentifier":"${vanityName}"`)
    if (pubIdx !== -1) {
      const slice = html.slice(Math.max(0, pubIdx - 400), pubIdx + 400)
      const m = slice.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/)
      if (m) return m[1]
    }
    const m = html.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/)
    return m ? m[1] : null
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
  // Only check the first name — the URL is the real authoritative identifier.
  // Checking all words breaks for: middle initials, abbreviated last names,
  // nicknames, stage names, etc.
  const firstName = normalize(expectedName).split(/\s+/)[0]
  if (!firstName) return true
  return page.includes(firstName) ||
    pageWords.some(w => w.length === 1 && firstName.startsWith(w))
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
// vanityName comes from the CONNECT message — the content script doesn't need
// to be on the target profile page. Any LinkedIn tab works as a relay.

async function sendConnection(vanityName: string, note?: string, csrfOverride?: string): Promise<{ success: boolean; error?: string }> {
  if (!vanityName) return { success: false, error: 'no_vanity_name' }

  // Prefer the csrf passed from service worker (read via chrome.cookies, bypasses HttpOnly).
  // document.cookie cannot read HttpOnly cookies, so getCsrfToken() returns '' if LinkedIn
  // has set JSESSIONID as HttpOnly — which causes silent CSRF failures on all Voyager calls.
  const csrf = csrfOverride || getCsrfToken()
  if (!csrf) return { success: false, error: 'no_csrf_token' }

  const headers = voyagerHeaders(csrf)

  // Get profile URN with diagnostic logging
  let profileUrn = getProfileUrnFromPage(vanityName)
  let urnSource = 'page'
  if (!profileUrn) {
    profileUrn = await fetchProfileUrnViaApi(vanityName, csrf)
    urnSource = 'api'
  }
  if (!profileUrn) {
    profileUrn = await fetchProfileUrnFromHtml(vanityName)
    urnSource = 'html'
  }
  if (!profileUrn) {
    const html = document.documentElement.innerHTML
    return {
      success: false,
      error: 'no_profile_urn',
      // Diagnostic: tells us what LinkedIn served
      debug: `url=${location.href} htmlLen=${html.length} hasPublicId=${html.includes('"publicIdentifier":"' + vanityName + '"')} hasFsd=${/urn:li:fsd_profile:/.test(html)}`,
    } as any
  }
  console.log('[IHN] URN found via', urnSource, profileUrn)

  // Skip note if quota previously reached
  const noteQuotaReached = await getNoteQuotaReached()
  const effectiveNote = note && !noteQuotaReached ? note : ''

  const result = await postInvite(profileUrn, effectiveNote, headers)

  // If invite with note failed, retry without
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
  if (ogMatch) return ogMatch[1].replace(/\s*[|\-–]\s*LinkedIn\s*$/i, '').trim()
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  if (titleMatch) return titleMatch[1].replace(/\s*[|\-–]\s*.*$/i, '').trim()
  return ''
}

// ── Message listener ──────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendConnection(msg.vanityName || '', msg.note || '', msg.csrfToken || '').then(result => sendResponse(result))
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
          const ac = new AbortController()
          const timer = setTimeout(() => ac.abort(), 8000)
          const resp = await fetch(url, { credentials: 'include', signal: ac.signal })
          clearTimeout(timer)
          if (resp.url.includes('/in/')) {
            const html = await resp.text()
            linkedinName = extractNameFromHtml(html)
          }
        } catch { /* ignore — timeout or network error */ }
        results.push({ id: c.id, linkedin_name: linkedinName })
        chrome.runtime.sendMessage({ type: 'LINKEDIN_NAMES_PROGRESS', done: results.length, total: contacts.length }).catch(() => {})
      }
      sendResponse(results)
    })()
    return true
  }
})
