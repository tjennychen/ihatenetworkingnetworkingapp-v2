function nativeClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function getMain(): Element {
  return document.querySelector('main') ?? document.body
}

// Walk up from the <h1> (person's name) to find the profile top card section.
// This keeps button searches scoped away from the "More profiles" sidebar.
function getProfileTopCard(): Element {
  const h1 = document.querySelector('h1')
  if (h1) {
    let el: Element | null = h1.parentElement
    for (let i = 0; i < 8 && el && el !== document.documentElement; i++) {
      if (el.tagName === 'SECTION') return el
      el = el.parentElement
    }
  }
  return getMain()
}

function findButtonByText(text: string, root: Element = document.body): HTMLButtonElement | null {
  const lower = text.toLowerCase()
  // Prefer exact match, fall back to trimmed-includes to handle LinkedIn's nested spans/icons
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
  return (
    buttons.find(b => b.textContent?.trim() === text) ??
    buttons.find(b => b.textContent?.trim().toLowerCase().includes(lower)) ??
    null
  )
}

function findConnectButton(): HTMLButtonElement | null {
  const main = getMain()
  // Primary: bare wildcard matches both "Connect" and "Connect with Jenny" aria-labels (reference: button[aria-label*="Connect"])
  const direct = main.querySelector<HTMLButtonElement>(
    'button[aria-label*="Connect"], [aria-label*="Connect with"], button[aria-label*="Invite"], [data-control-name="connect"]'
  )
  if (direct) return direct
  // If a dropdown/menu is currently open, search it for Connect.
  // LinkedIn's artdeco-dropdown uses CSS classes, NOT role="menu" — check both.
  const openMenu = document.querySelector<Element>(
    '[role="menu"], .artdeco-dropdown__content--is-open, [data-test-dropdown-content]'
  )
  if (openMenu) {
    // Check aria-label first (reference pattern), then text content fallback
    const ariaBtn = openMenu.querySelector<HTMLButtonElement>('[aria-label*="Connect" i]')
    if (ariaBtn) return ariaBtn
    const inMenu = findButtonByText('Connect', openMenu)
    // Guard: includes() fallback is too broad — "Remove connection" contains "connect".
    // Only return if the button text actually starts with "Connect".
    if (inMenu && /^connect/i.test(inMenu.textContent?.trim() ?? '')) return inMenu
    // LinkedIn sometimes renders the Connect option as div[role="button"], not <button>
    const divBtn = openMenu.querySelector<HTMLElement>(
      'div[role="button"][aria-label*="Invite"][aria-label*="connect"], div[role="button"][aria-label*="connect" i]'
    )
    if (divBtn) return divBtn as unknown as HTMLButtonElement
  }
  // Fallback: search [role="menuitem"] / [role="option"] items anywhere on page —
  // these only exist when a dropdown is open, so no risk of hitting sidebar buttons.
  const menuItems = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="menuitem"], [role="option"], .artdeco-dropdown__item'
  ))
  const connectItem = menuItems.find(el =>
    /^connect$/i.test(el.textContent?.trim() ?? '') ||
    el.textContent?.trim().toLowerCase().startsWith('connect')
  )
  if (connectItem) return connectItem as unknown as HTMLButtonElement
  // Last resort: scope text search to profile top card (handles inline dropdowns)
  return findButtonByText('Connect', getProfileTopCard())
}

export function buildTrace() {
  const fields: string[] = []
  return {
    set(key: string, val: string) { fields.push(`${key}=${val}`) },
    toString() { return fields.join('|') }
  }
}

export function waitForDropdown(timeoutMs = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const interval = 100
    let elapsed = 0
    const check = () => {
      const open = !!document.querySelector(
        '.artdeco-dropdown__content--is-open, [role="menu"], [data-test-dropdown-content]'
      )
      if (open) { resolve(true); return }
      elapsed += interval
      if (elapsed >= timeoutMs) { resolve(false); return }
      setTimeout(check, interval)
    }
    check()
  })
}

export function waitForModal(timeoutMs = 3000): Promise<boolean> {
  return new Promise(resolve => {
    const interval = 150
    let elapsed = 0
    const check = () => {
      const hasDialog = !!document.querySelector('[role="dialog"]')
      const hasShadow = !!((document.querySelector('#interop-outlet') as HTMLElement | null)
        ?.shadowRoot?.childElementCount)
      if (hasDialog || hasShadow) { resolve(true); return }
      elapsed += interval
      if (elapsed >= timeoutMs) { resolve(false); return }
      setTimeout(check, interval)
    }
    check()
  })
}

async function openMoreActionsIfNeeded(): Promise<string> {
  const topCard = getProfileTopCard()
  // Cover "More actions", "More member actions" (older), and "Resources" (renamed Oct 2024 on creator profiles)
  const moreBtn = topCard.querySelector<HTMLButtonElement>(
    "button[aria-label*='More actions'], button[aria-label*='More member actions'], button[aria-label*='Resources']"
  ) ?? findButtonByText('More', topCard) ?? findButtonByText('Resources', topCard)
  if (!moreBtn) return 'not-found'
  nativeClick(moreBtn)
  const opened = await waitForDropdown(2000)
  return opened ? 'opened' : 'timeout'
}

async function dismissPremiumPaywall(): Promise<boolean> {
  const paywall = document.querySelector(
    '[class*="premium-upsell"], [class*="premium_upsell"], [data-test-modal*="premium"], [aria-label*="Premium"]'
  )
  // Also detect "out of free custom notes" modal by presence of "Reactivate Premium" button
  const reactivateBtn = findButtonByText('Reactivate Premium')
  if (!paywall && !reactivateBtn) return false
  // Find close button; fall back to any dismiss button in the same dialog
  const dialog = (reactivateBtn ?? paywall)?.closest('[role="dialog"]') ?? document
  const closeBtn =
    dialog.querySelector<HTMLButtonElement>('[aria-label="Dismiss"], [aria-label="Close"], [data-test-modal-close-btn], button[data-modal-dismiss]') ??
    document.querySelector<HTMLButtonElement>('[aria-label="Dismiss"], [aria-label="Close"]')
  closeBtn?.click()
  await new Promise(r => setTimeout(r, 500))
  return true
}

function getProfileName(): string {
  const h1 = document.querySelector<HTMLElement>('h1')
  return h1?.textContent?.trim() ?? ''
}

function namesMatch(pageName: string, expectedName: string): boolean {
  if (!expectedName) return true // no expectation, allow
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

function getNoteQuotaReached(): Promise<boolean> {
  return new Promise(resolve => chrome.storage.local.get('noteQuotaReached', r => resolve(!!r.noteQuotaReached)))
}

function setNoteQuotaReached(): Promise<void> {
  return new Promise(resolve => chrome.storage.local.set({ noteQuotaReached: true }, resolve))
}

async function sendConnection(note?: string, expectedName?: string): Promise<{ success: boolean; error?: string; trace?: string }> {
  await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))

  if (!window.location.pathname.startsWith('/in/')) {
    return { success: false, error: 'Not a profile page' }
  }

  const trace = buildTrace()

  const pageName = getProfileName()
  if (!namesMatch(pageName, expectedName ?? '')) {
    return { success: false, error: `wrong_profile: expected "${expectedName}", got "${pageName}"` }
  }

  const main = getMain()

  // Check for already-pending request
  if (findButtonByText('Pending', main) || findButtonByText('Withdraw', main)) {
    return { success: false, error: 'already_pending' }
  }

  // Check degree — LinkedIn shows "3rd+" near the name
  const degreeEl = document.querySelector('[class*="distance-badge"], [class*="dist-value"]')
  const degree = degreeEl?.textContent?.trim() ?? ''
  const isThirdDegree = degree.startsWith('3')

  // Try Connect directly first, then open "More" if needed
  // (2nd-degree connections often hide Connect under "More" button)
  let connectBtn = findConnectButton()
  trace.set('connectBtn', connectBtn ? 'direct' : 'null')
  if (!connectBtn) {
    const moreResult = await openMoreActionsIfNeeded()
    trace.set('more', moreResult)
    connectBtn = findConnectButton()
    trace.set('connectAfterMore', connectBtn ? 'found' : 'null')
  }

  // Only now check already-connected — after we've tried More
  if (!connectBtn && findButtonByText('Message', main)) {
    return { success: false, error: 'already_connected' }
  }

  if (!connectBtn) {
    if (isThirdDegree) return { success: false, error: 'third_degree' }
    return { success: false, error: 'connect_not_available' }
  }

  nativeClick(connectBtn)
  const modalAppeared = await waitForModal(3000)
  trace.set('modal', modalAppeared ? 'yes' : 'timeout')

  // Check for LinkedIn error toast (e.g. "You've reached the weekly invitation limit")
  const errorToast = document.querySelector('div[data-test-artdeco-toast-item-type="error"]')
  if (errorToast) {
    return { success: false, error: `linkedin_error: ${errorToast.textContent?.trim() ?? 'unknown'}` }
  }

  // Verify the invite dialog is for the right person — LinkedIn modal says
  // "Personalize your invitation to [Name]" so we can cross-check the name.
  // This catches clicks that accidentally landed on a sidebar recommendation.
  if (expectedName) {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog) {
      const dialogText = dialog.textContent ?? ''
      if (!namesMatch(dialogText, expectedName)) {
        // Wrong person's dialog — close it and bail
        dialog.querySelector<HTMLButtonElement>('[aria-label="Dismiss"], [aria-label="Close"]')?.click()
        return { success: false, error: `wrong_connect_modal: expected "${expectedName}"` }
      }
    }
  }

  // Dismiss any premium popup that appears immediately after clicking Connect
  const paywallDismissed = await dismissPremiumPaywall()
  trace.set('paywall', paywallDismissed ? 'yes' : 'no')

  const noteQuotaReached = await getNoteQuotaReached()

  if (note && !noteQuotaReached) {
    const addNoteBtn = findButtonByText('Add a note')
    if (addNoteBtn) {
      nativeClick(addNoteBtn)
      await new Promise(r => setTimeout(r, 500))

      const paywalled = await dismissPremiumPaywall()
      if (!paywalled) {
        // Fill textarea normally
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea#custom-message, textarea[name="message"], textarea[id*="note"], [class*="connect-button"] textarea, textarea'
        )
        if (textarea) {
          textarea.focus()
          textarea.value = note
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          textarea.dispatchEvent(new Event('change', { bubbles: true }))
          await new Promise(r => setTimeout(r, 300))
        }
      } else {
        // Note quota hit — remember this so future connections skip the note entirely
        await setNoteQuotaReached()
        await new Promise(r => setTimeout(r, 600))
        // If "Send without a note" is already visible the connect modal is still open
        // (paywall was an overlay on it) — no need to re-click Connect
        if (!findButtonByText('Send without a note')) {
          // Modal closed after paywall — need to re-find and re-click Connect
          let retryBtn = findConnectButton()
          if (!retryBtn) { await openMoreActionsIfNeeded(); retryBtn = findConnectButton() } // retry path, trace not needed
          if (!retryBtn) return { success: false, error: 'note_quota_reached', trace: trace.toString() }
          nativeClick(retryBtn)
          await waitForModal(2000)
          // (no trace needed here — it's a retry path, trace already set)
        }
        // Fall through — sendBtn search below will find "Send without a note"
      }
    }
  }

  const sendBtn =
    findButtonByText('Send') ??
    findButtonByText('Send without a note') ??
    document.querySelector<HTMLButtonElement>('[aria-label="Send now"]') ??
    // Reference fallback: data-control-name="send_invite" for older LinkedIn modal variants
    document.querySelector<HTMLButtonElement>('[data-control-name="send_invite"]')

  trace.set('regularBtn', sendBtn ? 'found' : 'null')

  if (!sendBtn) {
    return { success: false, error: 'send_btn_not_found', trace: trace.toString() }
  }

  // Pre-click weekly limit check — catches alert that appears before send
  const preSendLimit = document.querySelector('.ip-fuse-limit-alert, #ip-fuse-limit-alert__header')
  if (preSendLimit && getComputedStyle(preSendLimit).display !== 'none') {
    return { success: false, error: 'weekly_limit_reached', trace: trace.toString() }
  }

  nativeClick(sendBtn)
  await new Promise(r => setTimeout(r, 500))

  // Text-based weekly limit check — won't break when LinkedIn changes class names
  const bodyText = document.body.innerText
  if (bodyText.includes('weekly invitation limit') || bodyText.includes('reached the weekly')) {
    return { success: false, error: 'weekly_limit_reached', trace: trace.toString() }
  }

  return { success: true, trace: trace.toString() }
}

const BAD_NAMES = new Set(['linkedin', 'sign in', 'log in', 'login', 'join linkedin'])

function extractNameFromHtml(html: string): string {
  // og:title is cleanest (just the name, no suffix)
  const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/)
    ?? html.match(/content="([^"]+)"\s+property="og:title"/)
  if (ogMatch) {
    const name = ogMatch[1].trim()
    if (!BAD_NAMES.has(name.toLowerCase())) return name
  }
  // Fall back to <title> and strip " | LinkedIn" etc.
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  if (titleMatch) {
    const name = titleMatch[1].replace(/\s*[|\-–]\s*.*$/i, '').trim()
    if (!BAD_NAMES.has(name.toLowerCase())) return name
  }
  return ''
}

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
          if (resp.ok) {
            const html = await resp.text()
            linkedinName = extractNameFromHtml(html)
          }
        } catch { /* ignore */ }
        results.push({ id: c.id, linkedin_name: linkedinName })
        chrome.runtime.sendMessage({ type: 'LINKEDIN_NAMES_PROGRESS', done: results.length, total: contacts.length }).catch(() => {})
      }
      sendResponse(results)
    })()
    return true
  }
})
