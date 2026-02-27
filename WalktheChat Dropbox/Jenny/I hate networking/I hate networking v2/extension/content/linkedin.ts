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
  // If a dropdown/menu is currently open, search it first (this is where Connect lives after clicking "More")
  const openMenu = document.querySelector<Element>('[role="menu"]')
  if (openMenu) {
    // Check aria-label first (reference pattern), then text content fallback
    const ariaBtn = openMenu.querySelector<HTMLButtonElement>('[aria-label*="Connect"]')
    if (ariaBtn) return ariaBtn
    const inMenu = findButtonByText('Connect', openMenu)
    if (inMenu) return inMenu
    // LinkedIn sometimes renders the Connect option as div[role="button"], not <button>
    const divBtn = openMenu.querySelector<HTMLElement>(
      'div[role="button"][aria-label*="Invite"][aria-label*="connect"], div[role="button"][aria-label*="connect" i]'
    )
    if (divBtn) return divBtn as unknown as HTMLButtonElement
  }
  // No dropdown open: scope text search to profile top card to avoid "More profiles" sidebar Connect buttons
  return findButtonByText('Connect', getProfileTopCard())
}

async function openMoreActionsIfNeeded(): Promise<void> {
  const topCard = getProfileTopCard()
  // Use wildcard for "More actions" to match "More actions for [Name]" variants (reference: button[aria-label*="More actions"])
  const moreBtn = topCard.querySelector<HTMLButtonElement>(
    "button[aria-label*='More actions'], button[aria-label*='More member actions']"
  ) ?? findButtonByText('More', topCard)
  if (moreBtn) {
    moreBtn.click()
    await new Promise(r => setTimeout(r, 600))
  }
}

async function dismissPremiumPaywall(): Promise<boolean> {
  const paywall = document.querySelector(
    '[class*="premium-upsell"], [class*="premium_upsell"], [data-test-modal*="premium"], [aria-label*="Premium"]'
  )
  if (!paywall) return false
  const closeBtn = document.querySelector<HTMLButtonElement>(
    '[aria-label="Dismiss"], [aria-label="Close"], [data-test-modal-close-btn], button[data-modal-dismiss]'
  )
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

async function sendConnection(note?: string, expectedName?: string): Promise<{ success: boolean; error?: string }> {
  await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))

  if (!window.location.pathname.startsWith('/in/')) {
    return { success: false, error: 'Not a profile page' }
  }

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
  if (!connectBtn) {
    await openMoreActionsIfNeeded()
    connectBtn = findConnectButton()
  }

  // Only now check already-connected — after we've tried More
  if (!connectBtn && findButtonByText('Message', main)) {
    return { success: false, error: 'already_connected' }
  }

  if (!connectBtn) {
    if (isThirdDegree) return { success: false, error: 'third_degree' }
    return { success: false, error: 'connect_not_available' }
  }

  connectBtn.click()
  await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

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
  await dismissPremiumPaywall()

  const noteQuotaReached = await getNoteQuotaReached()

  if (note && !noteQuotaReached) {
    const addNoteBtn = findButtonByText('Add a note')
    if (addNoteBtn) {
      addNoteBtn.click()
      await new Promise(r => setTimeout(r, 500))

      const paywalled = await dismissPremiumPaywall()
      if (!paywalled) {
        // Fill textarea normally
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[name="message"], textarea[id*="note"], [class*="connect-button"] textarea, textarea'
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
        // Back on profile page, retry Connect to get the modal again
        await new Promise(r => setTimeout(r, 800))
        let retryBtn = findConnectButton()
        if (!retryBtn) { await openMoreActionsIfNeeded(); retryBtn = findConnectButton() }
        if (!retryBtn) return { success: false, error: 'note_quota_reached' }
        retryBtn.click()
        await new Promise(r => setTimeout(r, 800 + Math.random() * 500))
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

  if (!sendBtn) {
    return { success: false, error: 'send_btn_not_found' }
  }

  sendBtn.click()
  await new Promise(r => setTimeout(r, 500))

  // Text-based weekly limit check — won't break when LinkedIn changes class names
  const bodyText = document.body.innerText
  if (bodyText.includes('weekly invitation limit') || bodyText.includes('reached the weekly')) {
    return { success: false, error: 'weekly_limit_reached' }
  }

  return { success: true }
}

function extractNameFromHtml(html: string): string {
  // og:title is cleanest (just the name, no suffix)
  const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/)
    ?? html.match(/content="([^"]+)"\s+property="og:title"/)
  if (ogMatch) return ogMatch[1].trim()
  // Fall back to <title> and strip " | LinkedIn" etc.
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  if (titleMatch) return titleMatch[1].replace(/\s*[|\-–]\s*.*$/i, '').trim()
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
