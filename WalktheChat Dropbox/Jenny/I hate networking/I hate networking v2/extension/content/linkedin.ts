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
  const paywall = document.querySelector('[class*="premium"], [class*="upsell"]')
  if (!paywall) return false
  const closeBtn = document.querySelector<HTMLButtonElement>(
    '[aria-label="Dismiss"], [aria-label="Close"], button[data-modal-dismiss]'
  )
  closeBtn?.click()
  await new Promise(r => setTimeout(r, 500))
  return true
}

async function sendConnection(): Promise<{ success: boolean; error?: string }> {
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

  const addNoteBtn = findButtonByText('Add a note')
  if (addNoteBtn) {
    if (await dismissPremiumPaywall()) {
      // dismissed — try send without note
    } else {
      addNoteBtn.click()
      await new Promise(r => setTimeout(r, 500))
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
    sendConnection().then(result => sendResponse(result))
    return true
  }
})
