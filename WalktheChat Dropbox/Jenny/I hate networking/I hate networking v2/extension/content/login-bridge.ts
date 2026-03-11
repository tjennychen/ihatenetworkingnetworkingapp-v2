// Runs on ihatenetworking.space/login — reads Supabase session from localStorage
// and forwards it to the extension's service worker (no extension ID needed).

const STORAGE_KEY = 'sb-urgibxjxbcyvprdejplp-auth-token'

function forwardSession() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    if (data.access_token && data.user) {
      chrome.runtime.sendMessage({
        type: 'SET_AUTH',
        session: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          user: { id: data.user.id, email: data.user.email },
        }
      })
    }
  } catch {}
}

// Check immediately
forwardSession()

// Re-check whenever the page DOM changes (login page shows "You're signed in")
new MutationObserver(() => forwardSession()).observe(document.body, { childList: true, subtree: true })
