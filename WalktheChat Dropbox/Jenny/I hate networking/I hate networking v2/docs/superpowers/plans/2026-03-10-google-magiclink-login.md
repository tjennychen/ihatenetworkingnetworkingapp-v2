# Google OAuth + Magic Link Login

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/password login with Google OAuth + magic link for a minimal, passwordless experience.

**Architecture:** Supabase handles both Google OAuth and magic links natively. Both flows use PKCE code exchange: user authenticates → Supabase redirects to `/auth/callback?code=...` → our route exchanges code for session → redirect to `/contacts`. The login page becomes two options: a Google button and an email input for magic links.

**Tech Stack:** Supabase Auth (OAuth + OTP), Next.js route handlers, existing `@supabase/ssr`

---

## File Map

- **Create:** `dashboard/app/auth/callback/route.ts` — handles code exchange for both OAuth and magic link
- **Modify:** `dashboard/app/login/page.tsx` — rewrite to Google button + magic link (remove password, toggle, verification screen)
- **Keep:** `dashboard/app/auth/confirm/route.ts` — backward compat for users who signed up with email/password but haven't confirmed yet
- **Keep:** `dashboard/middleware.ts` — already allows `/auth/*` paths through
- **Keep:** `dashboard/lib/supabase.ts`, `dashboard/lib/supabase-server.ts` — unchanged

---

### Task 1: Create OAuth/magic-link callback route

**Files:**
- Create: `dashboard/app/auth/callback/route.ts`

- [ ] **Step 1: Create the callback route**

This route handles the redirect from both Google OAuth and magic link flows. Supabase sends a `code` query param that we exchange for a session.

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  const redirectTo = request.nextUrl.clone()
  redirectTo.searchParams.delete('code')

  if (!code) {
    redirectTo.pathname = '/login'
    redirectTo.searchParams.set('error', 'auth_failed')
    return NextResponse.redirect(redirectTo)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    redirectTo.pathname = '/login'
    redirectTo.searchParams.set('error', 'auth_failed')
    return NextResponse.redirect(redirectTo)
  }

  // Redirect to login with flag so it can sync session to extension, then forward to /contacts
  redirectTo.pathname = '/login'
  redirectTo.searchParams.set('authenticated', '1')
  return NextResponse.redirect(redirectTo)
}
```

Note: We redirect to `/login?authenticated=1` (not directly to `/contacts`) so the login page can pick up the session and send it to the Chrome extension via `sendSessionToExtension()`. This keeps extension sync in one place.

- [ ] **Step 2: Verify the route loads**

Run: `cd dashboard && npm run dev`
Visit: `http://localhost:3000/auth/callback` (no code param)
Expected: redirects to `/login?error=auth_failed`

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/auth/callback/route.ts
git commit -m "feat: add /auth/callback route for OAuth and magic link code exchange"
```

---

### Task 2: Rewrite login page

**Files:**
- Modify: `dashboard/app/login/page.tsx`

- [ ] **Step 1: Rewrite the login page**

Replace the entire login page with Google button + magic link. Key changes:
- Remove: password field, sign-in/sign-up toggle, `handleVerified`, `pendingVerification` for email/password
- Add: Google OAuth button (`signInWithOAuth`), magic link input (`signInWithOtp`)
- Keep: `sendSessionToExtension()`, error display
- Add: `?authenticated=1` handler (picks up session after OAuth/magic link callback, sends to extension, redirects to `/contacts`)
- Add: "Check your email" state for magic link

```tsx
'use client'
import { Suspense, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  )
}

function LoginInner() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Handle return from OAuth/magic-link callback or legacy email confirmation
  useEffect(() => {
    if (searchParams.get('authenticated') === '1' || searchParams.get('confirmed') === '1') {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          sendSessionToExtension(session)
          router.push('/contacts')
        }
      })
    }
    if (searchParams.get('error') === 'auth_failed') {
      setError('Sign-in failed. Please try again.')
    }
    if (searchParams.get('error') === 'confirmation_failed') {
      setError('Confirmation link expired or invalid. Try again below.')
    }
  }, [])

  function sendSessionToExtension(session: any) {
    try {
      const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ''
      const chromeExt = (globalThis as any).chrome
      if (EXTENSION_ID && chromeExt?.runtime) {
        chromeExt.runtime.sendMessage(EXTENSION_ID, {
          type: 'SET_AUTH',
          session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            user: { id: session.user.id, email: session.user.email },
          }
        })
      }
    } catch (_) { /* extension not installed */ }
  }

  async function handleGoogle() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // If no error, browser redirects to Google — no need to setLoading(false)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setMagicLinkSent(true)
    setLoading(false)
  }

  // "Check your email" screen after magic link sent
  if (magicLinkSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-sm border border-gray-100 text-center">
          <div className="text-4xl mb-4">📬</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Check your email</h1>
          <p className="text-gray-500 text-sm mb-6">
            We sent a sign-in link to <strong>{email}</strong>.
          </p>
          <button
            onClick={() => { setMagicLinkSent(false); setError('') }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">I Hate Networking</h1>
        <p className="text-gray-500 text-sm mb-6">Sign in to your account</p>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors mb-4"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Magic link */}
        <form onSubmit={handleMagicLink} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email address"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? '...' : 'Send me a sign-in link'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the page renders**

Run: `cd dashboard && npm run dev`
Visit: `http://localhost:3000/login`
Expected: Google button on top, "or" divider, email input + "Send me a sign-in link" button. No password field, no toggle.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/login/page.tsx
git commit -m "feat: replace email/password login with Google OAuth + magic link"
```

---

### Task 3: Supabase + Google Cloud configuration (manual)

These steps must be done by Jenny in browser UIs. Cannot be automated.

- [ ] **Step 1: Enable Google provider in Supabase**

1. Go to Supabase Dashboard → Authentication → Providers
2. Find Google and enable it
3. Note the "Callback URL (for OAuth)" shown — you'll need it for Google Cloud Console (looks like `https://<project-ref>.supabase.co/auth/v1/callback`)

- [ ] **Step 2: Create Google OAuth credentials**

1. Go to https://console.cloud.google.com/
2. Create a new project (or use existing)
3. Go to APIs & Services → Credentials → Create Credentials → OAuth Client ID
4. Application type: Web application
5. Authorized JavaScript origins: `https://ihatenetworking.space`
6. Authorized redirect URIs: paste the Supabase callback URL from Step 1
7. Copy the Client ID and Client Secret

- [ ] **Step 3: Add Google credentials to Supabase**

1. Back in Supabase Dashboard → Authentication → Providers → Google
2. Paste the Client ID and Client Secret
3. Save

- [ ] **Step 4: Set site URL in Supabase**

1. Supabase Dashboard → Authentication → URL Configuration
2. Set Site URL to `https://ihatenetworking.space`
3. Add `https://ihatenetworking.space/auth/callback` to Redirect URLs

- [ ] **Step 5: Test the full flow**

1. Visit login page
2. Click "Continue with Google" → should redirect to Google → back to app → land on `/contacts`
3. Enter email + click "Send me a sign-in link" → check email → click link → land on `/contacts`
