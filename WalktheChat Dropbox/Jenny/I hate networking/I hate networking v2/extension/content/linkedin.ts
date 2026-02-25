function findButtonByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === text) as HTMLButtonElement ?? null
  )
}

function findConnectButton(): HTMLButtonElement | null {
  const direct = document.querySelector<HTMLButtonElement>(
    '[aria-label*="Connect with"], button[aria-label*="Invite"], [data-control-name="connect"]'
  )
  if (direct) return direct
  return findButtonByText('Connect')
}

async function openMoreActionsIfNeeded(): Promise<void> {
  const moreBtn = document.querySelector<HTMLButtonElement>(
    "button[aria-label='More actions'], button[aria-label*='More member actions']"
  )
  if (moreBtn) {
    moreBtn.click()
    await new Promise(r => setTimeout(r, 600))
  }
}

async function dismissPremiumPaywall(): Promise<boolean> {
  const paywall = document.querySelector(
    '[class*="premium-upsell"], [class*="premium_upsell"], [data-test-modal*="premium"], ' +
    '[class*="upsell"], [aria-label*="Premium"]'
  )
  if (!paywall) return false
  const closeBtn = document.querySelector<HTMLButtonElement>(
    '[aria-label="Dismiss"], [aria-label="Close"], [data-test-modal-close-btn], button[data-modal-dismiss]'
  )
  closeBtn?.click()
  await new Promise(r => setTimeout(r, 500))
  return true
}

async function sendConnection(note?: string): Promise<{ success: boolean; error?: string }> {
  await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))

  if (!window.location.pathname.startsWith('/in/')) {
    return { success: false, error: 'Not a profile page' }
  }

  // Check for already-pending request
  if (findButtonByText('Pending') || findButtonByText('Withdraw')) {
    return { success: false, error: 'already_pending' }
  }

  // Check for already-connected (primary action is "Message", no Connect)
  if (findButtonByText('Message') && !findConnectButton()) {
    return { success: false, error: 'already_connected' }
  }

  // Check degree — LinkedIn shows "3rd+" near the name
  const degreeEl = document.querySelector('[class*="distance-badge"], [class*="dist-value"]')
  const degree = degreeEl?.textContent?.trim() ?? ''
  const isThirdDegree = degree.startsWith('3')

  let connectBtn = findConnectButton()

  if (!connectBtn) {
    await openMoreActionsIfNeeded()
    connectBtn = findConnectButton()
  }

  if (!connectBtn) {
    if (isThirdDegree) return { success: false, error: 'third_degree' }
    return { success: false, error: 'connect_not_available' }
  }

  connectBtn.click()
  await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

  // Dismiss any premium popup that appears immediately after clicking Connect
  await dismissPremiumPaywall()

  if (note) {
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
        // Note quota hit — back on profile page, retry Connect to get the modal again
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
    document.querySelector<HTMLButtonElement>('[aria-label="Send now"]')

  if (!sendBtn) {
    return { success: false, error: 'send_btn_not_found' }
  }

  sendBtn.click()
  await new Promise(r => setTimeout(r, 500))

  return { success: true }
}

if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendConnection(msg.note || '').then(result => sendResponse(result))
    return true
  }
})
