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

  let connectBtn = findConnectButton()

  if (!connectBtn) {
    await openMoreActionsIfNeeded()
    connectBtn = findConnectButton()
  }

  if (!connectBtn) {
    return { success: false, error: 'Connect button not found — may already be connected or pending' }
  }

  connectBtn.click()
  await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

  // Dismiss any premium popup that appears immediately after clicking Connect
  await dismissPremiumPaywall()

  const addNoteBtn = findButtonByText('Add a note')
  if (addNoteBtn && note) {
    addNoteBtn.click()
    await new Promise(r => setTimeout(r, 500))

    // Premium may also appear after clicking "Add a note"
    const paywalled = await dismissPremiumPaywall()
    if (!paywalled) {
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
    }
  }

  const sendBtn =
    findButtonByText('Send') ??
    findButtonByText('Send without a note') ??
    document.querySelector<HTMLButtonElement>('[aria-label="Send now"]')

  if (!sendBtn) {
    return { success: false, error: 'Send button not found' }
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
