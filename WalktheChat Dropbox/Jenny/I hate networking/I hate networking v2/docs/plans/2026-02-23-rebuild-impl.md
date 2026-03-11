# I Hate Networking v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the app from Streamlit to Next.js + Chrome Extension + Supabase — a professional, bug-free product.

**Architecture:** Next.js dashboard on Vercel for the UI + post generation (Claude API). Chrome Extension (MV3) handles Luma scraping and LinkedIn automation running inside the user's own browser. Supabase handles auth, all data, and usage tracking.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind), Chrome Extension MV3 (TypeScript, esbuild), Supabase (Postgres + Auth + RLS), Anthropic SDK, Recharts

---

## File Structure

```
i hate networking v2/
├── dashboard/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                        (redirect to /contacts)
│   │   ├── login/page.tsx
│   │   ├── contacts/page.tsx
│   │   ├── stats/page.tsx
│   │   ├── post/page.tsx
│   │   └── api/generate-post/route.ts
│   ├── components/
│   │   ├── ContactsTable.tsx
│   │   ├── StatsCards.tsx
│   │   ├── StatsChart.tsx
│   │   └── PostGenerator.tsx
│   ├── lib/
│   │   ├── supabase.ts                     (browser client)
│   │   ├── supabase-server.ts              (server client)
│   │   └── types.ts
│   ├── middleware.ts
│   ├── package.json
│   └── tsconfig.json
├── extension/
│   ├── manifest.json
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   ├── content/
│   │   ├── luma.ts
│   │   └── linkedin.ts
│   ├── background/
│   │   └── service-worker.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── rate-limiter.ts
│   │   └── types.ts
│   ├── tests/
│   │   ├── rate-limiter.test.ts
│   │   └── luma-parser.test.ts
│   ├── package.json
│   └── tsconfig.json
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql
```

---

## Task 1: Supabase Setup

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Create Supabase project**

Go to supabase.com → New project. Save these values:
- Project URL (looks like `https://xxxxx.supabase.co`)
- `anon` key (public, safe to embed in extension)
- `service_role` key (secret, Next.js API routes only — NEVER in extension or browser)

**Step 2: Write migration SQL**

Create `supabase/migrations/001_initial_schema.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  luma_url   TEXT NOT NULL,
  name       TEXT DEFAULT '',
  date       DATE,
  city       TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contacts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name             TEXT DEFAULT '',
  first_name       TEXT DEFAULT '',
  last_name        TEXT DEFAULT '',
  linkedin_url     TEXT DEFAULT '',
  linkedin_urn     TEXT DEFAULT '',
  headline         TEXT DEFAULT '',
  company          TEXT DEFAULT '',
  city             TEXT DEFAULT '',
  instagram_url    TEXT DEFAULT '',
  photo_url        TEXT DEFAULT '',
  luma_profile_url TEXT DEFAULT '',
  is_host          BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, luma_profile_url)
);

CREATE TABLE connection_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','sent','accepted','failed')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  accepted_at  TIMESTAMPTZ,
  error        TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own events"    ON events           FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own contacts"  ON contacts         FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own queue"     ON connection_queue FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own logs"      ON usage_logs       FOR ALL USING (user_id = auth.uid());

-- Indexes
CREATE INDEX ON events(user_id, created_at DESC);
CREATE INDEX ON contacts(user_id, event_id);
CREATE INDEX ON connection_queue(user_id, status, scheduled_at);
CREATE INDEX ON usage_logs(user_id, action, created_at DESC);
```

**Step 3: Run the migration**

In Supabase dashboard → SQL Editor → paste and run the SQL above.

**Step 4: Verify**

In Table Editor, confirm these tables exist: `events`, `contacts`, `connection_queue`, `usage_logs`. Each should show RLS as "enabled".

**Step 5: Commit**

```bash
git init "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/i hate networking v2"
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/i hate networking v2"
git add supabase/
git commit -m "feat: add supabase schema + RLS policies"
```

---

## Task 2: Next.js Dashboard Scaffold

**Files:**
- Create: `dashboard/` (entire Next.js app)

**Step 1: Create Next.js app**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/i hate networking v2"
npx create-next-app@latest dashboard \
  --typescript \
  --tailwind \
  --app \
  --src-dir=false \
  --import-alias="@/*"
```

When prompted: Yes to ESLint, No to `src/` directory (already said no), Yes to App Router.

**Step 2: Install dependencies**

```bash
cd dashboard
npm install @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk recharts date-fns clsx
npm install -D jest ts-jest @types/jest
```

**Step 3: Create `dashboard/lib/types.ts`**

```typescript
export type Event = {
  id: string
  user_id: string
  luma_url: string
  name: string
  date: string | null
  city: string
  created_at: string
}

export type Contact = {
  id: string
  user_id: string
  event_id: string
  name: string
  first_name: string
  last_name: string
  linkedin_url: string
  linkedin_urn: string
  headline: string
  company: string
  city: string
  instagram_url: string
  photo_url: string
  luma_profile_url: string
  is_host: boolean
  created_at: string
  // Joined
  events?: Event
}

export type ConnectionQueue = {
  id: string
  user_id: string
  contact_id: string
  status: 'pending' | 'sent' | 'accepted' | 'failed'
  scheduled_at: string
  sent_at: string | null
  accepted_at: string | null
  error: string
  created_at: string
}
```

**Step 4: Create `dashboard/lib/supabase.ts`** (browser client)

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Step 5: Create `dashboard/lib/supabase-server.ts`** (server client)

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
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
}
```

**Step 6: Create `dashboard/.env.local`**

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ANTHROPIC_API_KEY=sk-ant-...
```

Replace with real values from Supabase dashboard.

**Step 7: Create `dashboard/middleware.ts`** (protect all routes except /login)

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

**Step 8: Verify dev server starts**

```bash
npm run dev
```

Expected: Opens at http://localhost:3000, redirects to /login (which 404s for now — that's fine).

**Step 9: Commit**

```bash
git add dashboard/
git commit -m "feat: scaffold next.js dashboard with supabase auth middleware"
```

---

## Task 3: Dashboard Login Page

**Files:**
- Create: `dashboard/app/login/page.tsx`

**Step 1: Create login page**

```typescript
// dashboard/app/login/page.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/contacts')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">I Hate Networking</h1>
        <p className="text-gray-500 text-sm mb-8">Sign in to your account</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

**Step 2: Create a test user in Supabase**

Supabase dashboard → Authentication → Users → Add user. Use a real email + password.

**Step 3: Verify login works**

```bash
npm run dev
```

Navigate to http://localhost:3000/login, enter credentials. Expected: redirects to /contacts (which 404s — fine).

**Step 4: Commit**

```bash
git add dashboard/app/login/
git commit -m "feat: add login page with supabase email auth"
```

---

## Task 4: Dashboard Layout + Navigation

**Files:**
- Create: `dashboard/app/layout.tsx`
- Create: `dashboard/app/page.tsx`
- Create: `dashboard/components/Nav.tsx`

**Step 1: Create nav component**

```typescript
// dashboard/components/Nav.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

const links = [
  { href: '/contacts', label: 'Contacts' },
  { href: '/stats',    label: 'Stats' },
  { href: '/post',     label: 'Post Generator' },
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <nav className="fixed left-0 top-0 h-full w-56 bg-white border-r border-gray-100 flex flex-col p-4">
      <div className="mb-8">
        <span className="text-sm font-bold text-gray-900">I Hate Networking</span>
      </div>
      <div className="flex-1 space-y-1">
        {links.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={clsx(
              'block px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              pathname === link.href
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <button
        onClick={handleLogout}
        className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 text-left"
      >
        Sign out
      </button>
    </nav>
  )
}
```

**Step 2: Update `dashboard/app/layout.tsx`**

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Nav from '@/components/Nav'
import { cookies } from 'next/headers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'I Hate Networking',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const isLoginPage = false  // middleware handles redirect

  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50`}>
        <Nav />
        <main className="ml-56 min-h-screen p-8">
          {children}
        </main>
      </body>
    </html>
  )
}
```

Note: Nav will show on the login page too — fix by conditionally rendering. For now, keep it simple.

**Step 3: Create `dashboard/app/page.tsx`** (redirect)

```typescript
import { redirect } from 'next/navigation'
export default function Home() {
  redirect('/contacts')
}
```

**Step 4: Verify layout renders**

```bash
npm run dev
```

Navigate to http://localhost:3000 after login. Expected: left nav with 3 links visible.

**Step 5: Commit**

```bash
git add dashboard/app/layout.tsx dashboard/app/page.tsx dashboard/components/
git commit -m "feat: add dashboard layout and nav"
```

---

## Task 5: Dashboard Contacts Page

**Files:**
- Create: `dashboard/app/contacts/page.tsx`
- Create: `dashboard/components/ContactsTable.tsx`

**Step 1: Write the test first**

Create `dashboard/lib/__tests__/contacts.test.ts`:

```typescript
import { filterContacts } from '../contacts'
import type { Contact } from '../types'

const mockContacts: Contact[] = [
  { id: '1', name: 'Alice Chen', headline: 'CEO', company: 'Startup', city: 'SF',
    linkedin_url: '', linkedin_urn: '', first_name: 'Alice', last_name: 'Chen',
    instagram_url: '', photo_url: '', luma_profile_url: '', is_host: false,
    user_id: 'u1', event_id: 'e1', created_at: '2026-01-01' },
  { id: '2', name: 'Bob Smith', headline: 'Engineer', company: 'BigCo', city: 'NYC',
    linkedin_url: '', linkedin_urn: '', first_name: 'Bob', last_name: 'Smith',
    instagram_url: '', photo_url: '', luma_profile_url: '', is_host: false,
    user_id: 'u1', event_id: 'e1', created_at: '2026-01-01' },
]

describe('filterContacts', () => {
  it('returns all contacts when query is empty', () => {
    expect(filterContacts(mockContacts, '')).toHaveLength(2)
  })
  it('filters by name case-insensitively', () => {
    expect(filterContacts(mockContacts, 'alice')).toHaveLength(1)
    expect(filterContacts(mockContacts, 'alice')[0].name).toBe('Alice Chen')
  })
  it('filters by company', () => {
    expect(filterContacts(mockContacts, 'bigco')).toHaveLength(1)
  })
  it('returns empty array when no match', () => {
    expect(filterContacts(mockContacts, 'zzz')).toHaveLength(0)
  })
})
```

**Step 2: Run test to see it fail**

```bash
cd dashboard && npx jest lib/__tests__/contacts.test.ts
```

Expected: FAIL — `filterContacts` is not defined.

**Step 3: Create `dashboard/lib/contacts.ts`**

```typescript
import type { Contact } from './types'

export function filterContacts(contacts: Contact[], query: string): Contact[] {
  if (!query.trim()) return contacts
  const q = query.toLowerCase()
  return contacts.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.headline.toLowerCase().includes(q) ||
    c.company.toLowerCase().includes(q) ||
    c.city.toLowerCase().includes(q)
  )
}
```

**Step 4: Run test to see it pass**

```bash
npx jest lib/__tests__/contacts.test.ts
```

Expected: PASS

**Step 5: Create `dashboard/components/ContactsTable.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { filterContacts } from '@/lib/contacts'
import type { Contact } from '@/lib/types'

const STATUS_BADGE: Record<string, string> = {
  pending:  'bg-yellow-50 text-yellow-700',
  sent:     'bg-blue-50 text-blue-700',
  accepted: 'bg-green-50 text-green-700',
  failed:   'bg-red-50 text-red-700',
}

type Props = {
  contacts: (Contact & { status?: string; events?: { name: string; city: string } })[]
}

export default function ContactsTable({ contacts }: Props) {
  const [query, setQuery] = useState('')
  const filtered = filterContacts(contacts, query)

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, company, city…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Headline</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Company</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">City</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Event</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Instagram</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No contacts yet. Use the extension on a Luma event page to import.
                </td>
              </tr>
            )}
            {filtered.map(contact => (
              <tr key={contact.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {contact.linkedin_url ? (
                    <a href={contact.linkedin_url} target="_blank" rel="noopener"
                       className="hover:text-indigo-600">{contact.name}</a>
                  ) : contact.name}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{contact.headline}</td>
                <td className="px-4 py-3 text-gray-600">{contact.company}</td>
                <td className="px-4 py-3 text-gray-600">{contact.city}</td>
                <td className="px-4 py-3 text-gray-600">{contact.events?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  {contact.status && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[contact.status] ?? ''}`}>
                      {contact.status}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {contact.instagram_url
                    ? <a href={contact.instagram_url} target="_blank" rel="noopener"
                         className="hover:text-indigo-600">@{contact.instagram_url.split('/').filter(Boolean).pop()}</a>
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">{filtered.length} contacts</p>
    </div>
  )
}
```

**Step 6: Create `dashboard/app/contacts/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase-server'
import ContactsTable from '@/components/ContactsTable'

export default async function ContactsPage() {
  const supabase = await createClient()

  const { data: contacts } = await supabase
    .from('contacts')
    .select('*, events(name, city)')
    .order('created_at', { ascending: false })

  // Get connection status for each contact
  const { data: queue } = await supabase
    .from('connection_queue')
    .select('contact_id, status')

  const statusMap = Object.fromEntries(
    (queue ?? []).map(q => [q.contact_id, q.status])
  )

  const enriched = (contacts ?? []).map(c => ({
    ...c,
    status: statusMap[c.id],
  }))

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Contacts</h1>
      <ContactsTable contacts={enriched} />
    </div>
  )
}
```

**Step 7: Verify page loads (with empty state)**

```bash
npm run dev
```

Navigate to /contacts. Expected: table with "No contacts yet" empty state.

**Step 8: Commit**

```bash
git add dashboard/
git commit -m "feat: add contacts page with search + status badges"
```

---

## Task 6: Dashboard Stats Page

**Files:**
- Create: `dashboard/app/stats/page.tsx`
- Create: `dashboard/components/StatsCards.tsx`
- Create: `dashboard/components/StatsChart.tsx`

**Step 1: Create `dashboard/components/StatsCards.tsx`**

```typescript
type CardProps = {
  label: string
  value: number
  rate?: number
  color: string
}

function Card({ label, value, rate, color }: CardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {rate != null && (
          <span className="mb-1 text-sm font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            {rate.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

type Props = {
  sent: number
  accepted: number
}

export default function StatsCards({ sent, accepted }: Props) {
  const rate = sent > 0 ? (accepted / sent) * 100 : 0
  return (
    <div className="grid grid-cols-2 gap-4 max-w-xl mb-8">
      <Card label="Connections Sent"     value={sent}     color="bg-blue-400" />
      <Card label="Connections Accepted" value={accepted} rate={rate} color="bg-green-400" />
    </div>
  )
}
```

**Step 2: Create `dashboard/components/StatsChart.tsx`**

```typescript
'use client'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

type DayData = { date: string; sent: number; accepted: number }

export default function StatsChart({ data }: { data: DayData[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <h2 className="text-sm font-medium text-gray-600 mb-4">Daily Activity</h2>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="acceptedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Area type="monotone" dataKey="sent"     stroke="#6366f1" fill="url(#sentGrad)"     strokeWidth={2} name="Sent" />
          <Area type="monotone" dataKey="accepted" stroke="#22c55e" fill="url(#acceptedGrad)" strokeWidth={2} name="Accepted" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

**Step 3: Create `dashboard/app/stats/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase-server'
import StatsCards from '@/components/StatsCards'
import StatsChart from '@/components/StatsChart'
import { format, subDays } from 'date-fns'

export default async function StatsPage() {
  const supabase = await createClient()

  const { data: queue } = await supabase
    .from('connection_queue')
    .select('status, sent_at, accepted_at')

  const rows = queue ?? []
  const sent     = rows.filter(r => r.status === 'sent' || r.status === 'accepted').length
  const accepted = rows.filter(r => r.status === 'accepted').length

  // Build last-30-days chart data
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = format(subDays(new Date(), 29 - i), 'MMM d')
    const isoDate = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
    const daySent     = rows.filter(r => r.sent_at?.startsWith(isoDate)).length
    const dayAccepted = rows.filter(r => r.accepted_at?.startsWith(isoDate)).length
    return { date, sent: daySent, accepted: dayAccepted }
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Stats</h1>
      <StatsCards sent={sent} accepted={accepted} />
      <StatsChart data={days} />
    </div>
  )
}
```

**Step 4: Verify page renders**

```bash
npm run dev
```

Navigate to /stats. Expected: 2 stat cards (0s) + empty area chart.

**Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat: add stats page with cards and area chart"
```

---

## Task 7: Post Generator

**Files:**
- Create: `dashboard/app/api/generate-post/route.ts`
- Create: `dashboard/app/post/page.tsx`
- Create: `dashboard/components/PostGenerator.tsx`

**Step 1: Write the test first**

Create `dashboard/lib/__tests__/postGenerator.test.ts`:

```typescript
import { buildPostPrompt } from '../postGenerator'

describe('buildPostPrompt', () => {
  it('includes host name', () => {
    const prompt = buildPostPrompt({ hostName: 'Jenny Lee', guestNames: [], eventName: 'Test Event' })
    expect(prompt).toContain('Jenny Lee')
  })
  it('includes event name', () => {
    const prompt = buildPostPrompt({ hostName: 'Jenny', guestNames: [], eventName: 'Founder Summit' })
    expect(prompt).toContain('Founder Summit')
  })
  it('includes guest names', () => {
    const prompt = buildPostPrompt({ hostName: 'Jenny', guestNames: ['Alice', 'Bob'], eventName: 'Test' })
    expect(prompt).toContain('Alice')
    expect(prompt).toContain('Bob')
  })
})
```

**Step 2: Run test to see it fail**

```bash
npx jest lib/__tests__/postGenerator.test.ts
```

Expected: FAIL

**Step 3: Create `dashboard/lib/postGenerator.ts`**

```typescript
type PostInput = {
  hostName: string
  guestNames: string[]
  eventName: string
}

export function buildPostPrompt({ hostName, guestNames, eventName }: PostInput): string {
  const guestList = guestNames.length > 0
    ? `Guests to thank: ${guestNames.join(', ')}.`
    : 'No guests to tag.'

  return `Write a warm, genuine LinkedIn post for someone who just attended "${eventName}".

Requirements:
- Thank the host ${hostName} by name (they will manually tag them on LinkedIn)
- ${guestList} Include first names only — the user will manually tag them in the LinkedIn post
- Tone: genuine, warm, not corporate or salesy
- Length: 150–250 words
- No hashtags
- Write in first person
- Do not use phrases like "I had the pleasure" or "incredible" — keep it natural
- End with a call to connect with people at the event

Return only the post text, nothing else.`
}
```

**Step 4: Run test to see it pass**

```bash
npx jest lib/__tests__/postGenerator.test.ts
```

Expected: PASS

**Step 5: Create `dashboard/app/api/generate-post/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { buildPostPrompt } from '@/lib/postGenerator'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: Request) {
  // Verify auth
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: max 10 per day
  const today = new Date().toISOString().split('T')[0]
  const { count } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('action', 'post_generated')
    .gte('created_at', `${today}T00:00:00Z`)

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Daily limit reached (10 posts/day)' }, { status: 429 })
  }

  const { hostName, guestNames, eventName } = await req.json()

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: buildPostPrompt({ hostName, guestNames, eventName }) }],
  })

  const postText = (message.content[0] as { type: string; text: string }).text

  // Log usage (use service role to bypass RLS for logging)
  await supabase.from('usage_logs').insert({ user_id: user.id, action: 'post_generated' })

  return NextResponse.json({ post: postText })
}
```

**Step 6: Create `dashboard/components/PostGenerator.tsx`**

```typescript
'use client'
import { useState } from 'react'
import type { Contact } from '@/lib/types'

export default function PostGenerator({ contacts }: { contacts: Contact[] }) {
  const [hostName, setHostName]   = useState('')
  const [eventName, setEventName] = useState('')
  const [post, setPost]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)

  // Pre-fill guests from contacts (first names only, non-hosts)
  const guestNames = contacts
    .filter(c => !c.is_host && c.first_name)
    .map(c => c.first_name)

  async function handleGenerate() {
    setLoading(true)
    setError('')
    setPost('')
    const res = await fetch('/api/generate-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName, guestNames, eventName }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to generate post')
    } else {
      setPost(data.post)
    }
    setLoading(false)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(post)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-xl">
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event name</label>
          <input value={eventName} onChange={e => setEventName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Founder Summit NYC" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Host name</label>
          <input value={hostName} onChange={e => setHostName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Sarah Chen" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Guests to tag <span className="text-gray-400">({guestNames.length} from contacts)</span>
          </label>
          <p className="text-xs text-gray-400">{guestNames.slice(0, 8).join(', ')}{guestNames.length > 8 ? '…' : ''}</p>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !hostName || !eventName}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {loading ? 'Generating…' : 'Generate Post'}
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {post && (
        <div className="mt-6">
          <div className="bg-white border border-gray-100 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {post}
          </div>
          <button
            onClick={handleCopy}
            className="mt-3 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            Paste into LinkedIn, then manually tag the host and guests in your photo.
          </p>
        </div>
      )}
    </div>
  )
}
```

**Step 7: Create `dashboard/app/post/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase-server'
import PostGenerator from '@/components/PostGenerator'

export default async function PostPage() {
  const supabase = await createClient()
  const { data: contacts } = await supabase.from('contacts').select('*')
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Post Generator</h1>
      <p className="text-sm text-gray-500 mb-6">Generate a LinkedIn post thanking your host and tagging guests.</p>
      <PostGenerator contacts={contacts ?? []} />
    </div>
  )
}
```

**Step 8: Run all tests**

```bash
npx jest
```

Expected: all tests pass.

**Step 9: Commit**

```bash
git add dashboard/
git commit -m "feat: add post generator with claude api + rate limiting"
```

---

## Task 8: Chrome Extension Scaffold

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/popup/popup.html`
- Create: `extension/popup/popup.ts`
- Create: `extension/background/service-worker.ts`
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`

**Step 1: Create `extension/package.json`**

```json
{
  "name": "ihn-extension",
  "version": "1.0.0",
  "scripts": {
    "build": "npx esbuild popup/popup.ts background/service-worker.ts content/luma.ts content/linkedin.ts --bundle --outdir=dist --platform=browser --target=chrome120",
    "test": "npx jest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "esbuild": "^0.24.0",
    "@types/chrome": "^0.0.280",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@types/jest": "^29.5.0",
    "jsdom": "^25.0.0",
    "@types/jsdom": "^21.1.0"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

**Step 2: Install extension deps**

```bash
cd extension && npm install
```

**Step 3: Create `extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "outDir": "./dist",
    "rootDir": ".",
    "moduleResolution": "bundler"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "I Hate Networking",
  "version": "1.0.0",
  "description": "Connect with Luma event attendees on LinkedIn",
  "permissions": ["storage", "tabs", "alarms", "activeTab"],
  "host_permissions": [
    "https://*.lu.ma/*",
    "https://luma.com/*",
    "https://www.linkedin.com/*",
    "https://*.supabase.co/*"
  ],
  "background": {
    "service_worker": "dist/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://*.lu.ma/*", "https://luma.com/*"],
      "js": ["dist/luma.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.linkedin.com/in/*"],
      "js": ["dist/linkedin.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "I Hate Networking"
  },
  "externally_connectable": {
    "matches": ["https://*.vercel.app/*", "http://localhost:3000/*"]
  }
}
```

**Step 5: Create `extension/popup/popup.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; width: 280px; padding: 16px; background: #fff; }
    .header { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 4px; }
    .subtitle { font-size: 11px; color: #888; margin-bottom: 16px; }
    .event-name { font-size: 13px; font-weight: 600; color: #111; margin-bottom: 2px; }
    .attendee-count { font-size: 11px; color: #888; margin-bottom: 16px; }
    button {
      width: 100%; padding: 10px 14px; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 600; cursor: pointer; margin-bottom: 8px;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-secondary { background: #f3f4f6; color: #111; }
    .not-luma { font-size: 12px; color: #888; text-align: center; padding: 12px 0; }
    .login-prompt { font-size: 12px; color: #888; text-align: center; padding: 12px 0; }
    .login-prompt a { color: #4f46e5; text-decoration: none; }
    #status { font-size: 11px; color: #888; margin-top: 8px; min-height: 16px; }
  </style>
</head>
<body>
  <div class="header">I Hate Networking</div>
  <div id="content"></div>
  <div id="status"></div>
  <script src="../dist/popup.js"></script>
</body>
</html>
```

**Step 6: Create `extension/lib/supabase.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'

// These are public/anon keys — safe to embed in extension
export const SUPABASE_URL  = 'https://xxxxx.supabase.co'   // replace
export const SUPABASE_ANON_KEY = 'eyJhbGci...'              // replace

export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
```

**Step 7: Create `extension/lib/types.ts`**

```typescript
export type StoredSession = {
  access_token: string
  refresh_token: string
  user: { id: string; email: string }
}
```

**Step 8: Create minimal `extension/popup/popup.ts`** (auth check only for now)

```typescript
import { getSupabase } from '../lib/supabase'

async function init() {
  const content = document.getElementById('content')!
  const { session }: { session?: any } = await chrome.storage.local.get('session')

  if (!session) {
    content.innerHTML = `
      <div class="login-prompt">
        Not logged in.<br><br>
        <a href="http://localhost:3000/login" target="_blank">Open dashboard to log in</a>
      </div>`
    return
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab.url ?? ''
  const isLuma = url.includes('lu.ma') || url.includes('luma.com')

  if (!isLuma) {
    content.innerHTML = '<div class="not-luma">Navigate to a Luma event page to get started.</div>'
    return
  }

  content.innerHTML = `
    <div class="event-name" id="eventName">Loading…</div>
    <div class="attendee-count" id="attendeeCount"></div>
    <button class="btn-primary" id="btnConnect">Connect with Attendees →</button>
    <button class="btn-secondary" id="btnPost">Generate LinkedIn Post →</button>
  `

  document.getElementById('btnConnect')!.addEventListener('click', onConnect)
  document.getElementById('btnPost')!.addEventListener('click', onPost)
}

async function onConnect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  document.getElementById('status')!.textContent = 'Scraping attendees…'
  chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_LUMA' }, (response) => {
    if (response?.count != null) {
      document.getElementById('status')!.textContent =
        `Queued ${response.count} connections. Sending at 40/day.`
    }
  })
}

async function onPost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  document.getElementById('status')!.textContent = 'Scraping event…'
  chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_LUMA_FOR_POST' }, (response) => {
    if (response?.eventName) {
      // Open dashboard post page with pre-filled data
      const params = new URLSearchParams({
        event: response.eventName,
        host: response.hostName ?? '',
      })
      chrome.tabs.create({ url: `http://localhost:3000/post?${params}` })
    }
  })
}

init()
```

**Step 9: Create minimal `extension/background/service-worker.ts`**

```typescript
// Placeholder — full implementation in Task 10
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
  console.log('I Hate Networking extension installed')
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkQueue') {
    console.log('Queue check — implementation coming in Task 10')
  }
})
```

**Step 10: Create placeholder content scripts**

```bash
# Create extension/content/luma.ts and extension/content/linkedin.ts as empty exports
```

`extension/content/luma.ts`:
```typescript
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCRAPE_LUMA') {
    sendResponse({ count: 0, error: 'Not implemented yet' })
  }
  return true
})
```

`extension/content/linkedin.ts`:
```typescript
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendResponse({ success: false, error: 'Not implemented yet' })
  }
  return true
})
```

**Step 11: Build extension**

```bash
cd extension && npm run build
```

Expected: `dist/` folder with `popup.js`, `service-worker.js`, `luma.js`, `linkedin.js`

**Step 12: Load extension in Chrome**

1. Open Chrome → chrome://extensions
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension/` folder
5. Click the extension icon in toolbar

Expected: popup opens showing "Not logged in. Open dashboard to log in."

**Step 13: Commit**

```bash
git add extension/
git commit -m "feat: scaffold chrome extension MV3 with popup and auth check"
```

---

## Task 9: Extension Auth Handoff (Dashboard → Extension)

**Goal:** When user logs in on the dashboard, the session is shared with the extension.

**Files:**
- Modify: `dashboard/app/login/page.tsx`

**Step 1: Update login page to send session to extension**

After successful login, send the session to the extension via `chrome.runtime.sendMessage`:

```typescript
// In handleLogin, after successful auth:
const { data: { session } } = await supabase.auth.getSession()
if (session) {
  // Send to extension if installed
  try {
    const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ''
    if (EXTENSION_ID && typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(EXTENSION_ID, {
        type: 'SET_AUTH',
        session: {
          access_token:  session.access_token,
          refresh_token: session.refresh_token,
          user: { id: session.user.id, email: session.user.email },
        }
      })
    }
  } catch (_) { /* extension not installed — silent */ }
}
router.push('/contacts')
```

**Step 2: Update extension service worker to receive auth**

Add to `extension/background/service-worker.ts`:

```typescript
chrome.runtime.onMessageExternal.addListener(async (msg, _sender, _sendResponse) => {
  if (msg.type === 'SET_AUTH' && msg.session) {
    await chrome.storage.local.set({ session: msg.session })
    console.log('Session stored from dashboard')
  }
})
```

**Step 3: Add `NEXT_PUBLIC_EXTENSION_ID` to `.env.local`**

After loading the extension, copy its ID from chrome://extensions.

```
NEXT_PUBLIC_EXTENSION_ID=abcdefghijklmnopqrstuvwxyz123456
```

**Step 4: Test the handoff**

1. Open dashboard at http://localhost:3000/login
2. Log in
3. Open extension popup
Expected: popup no longer shows "Not logged in"

**Step 5: Commit**

```bash
git add dashboard/ extension/
git commit -m "feat: auth handoff from dashboard to extension via externally_connectable"
```

---

## Task 10: Luma Content Script

**Files:**
- Modify: `extension/content/luma.ts`
- Create: `extension/tests/luma-parser.test.ts`

**Step 1: Write the failing tests**

Create `extension/tests/luma-parser.test.ts`:

```typescript
import { JSDOM } from 'jsdom'
import { extractLinkedInUrl, extractInstagramUrl, parseGuestLinks } from '../content/luma'

describe('extractLinkedInUrl', () => {
  it('extracts linkedin URL from profile page HTML', () => {
    const html = '<a href="https://linkedin.com/in/alice-chen">LinkedIn</a>'
    const dom = new JSDOM(html)
    expect(extractLinkedInUrl(dom.window.document)).toBe('https://linkedin.com/in/alice-chen')
  })
  it('returns empty string if no linkedin link', () => {
    const dom = new JSDOM('<p>no links here</p>')
    expect(extractLinkedInUrl(dom.window.document)).toBe('')
  })
})

describe('parseGuestLinks', () => {
  it('extracts /u/ links from page HTML', () => {
    const html = `
      <a href="/u/alice">Alice</a>
      <a href="/u/bob">Bob</a>
      <a href="/other">Other</a>
    `
    const dom = new JSDOM(html)
    const links = parseGuestLinks(dom.window.document)
    expect(links).toHaveLength(2)
    expect(links[0]).toContain('/u/alice')
  })
})
```

**Step 2: Run tests to see them fail**

```bash
cd extension && npx jest tests/luma-parser.test.ts
```

Expected: FAIL — functions not exported

**Step 3: Implement `extension/content/luma.ts`**

```typescript
// ── Exported pure helpers (testable with jsdom) ─────────────────────────────

export function parseGuestLinks(doc: Document): string[] {
  const selectors = ["a[href*='/u/']", "a[href*='/user/']"]
  const seen = new Set<string>()
  const links: string[] = []

  for (const sel of selectors) {
    doc.querySelectorAll<HTMLAnchorElement>(sel).forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) {
        seen.add(href)
        links.push(href)
      }
    })
  }
  return links
}

export function extractLinkedInUrl(doc: Document): string {
  const selectors = [
    "a[href*='linkedin.com/in/']",
    "a[href*='linkedin.com/pub/']",
  ]
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLAnchorElement>(sel)
    if (el) return el.href || el.getAttribute('href') || ''
  }
  return ''
}

export function extractInstagramUrl(doc: Document): string {
  const el = doc.querySelector<HTMLAnchorElement>("a[href*='instagram.com/']")
  return el ? (el.href || el.getAttribute('href') || '') : ''
}

export function extractEventName(doc: Document): string {
  const selectors = ['h1', '[class*="event-title"]', '[class*="title"] h1']
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  return ''
}

export function extractHostName(doc: Document): string {
  // Luma shows organizer in a specific element
  const selectors = [
    '[class*="organizer"] [class*="name"]',
    '[class*="host"] [class*="name"]',
    '[data-testid*="organizer"]',
  ]
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el?.textContent?.trim()) return el.textContent.trim()
  }
  return ''
}

// ── Scroll helper ────────────────────────────────────────────────────────────

async function scrollToLoadAll(container: Element | null, maxIter = 15): Promise<void> {
  if (!container) return
  let prevHeight = 0
  for (let i = 0; i < maxIter; i++) {
    container.scrollTop += 600
    await new Promise(r => setTimeout(r, 500))
    const newHeight = container.scrollHeight
    if (newHeight === prevHeight) break
    prevHeight = newHeight
  }
}

// ── Guest modal opener ───────────────────────────────────────────────────────

function findAndOpenGuestButton(): boolean {
  const labels = ['Guests', 'Going', 'Attendees', 'See all']
  for (const label of labels) {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
    const btn = btns.find(b => b.textContent?.includes(label)) as HTMLElement | undefined
    if (btn) { btn.click(); return true }
  }
  return false
}

// ── Main scrape function ─────────────────────────────────────────────────────

async function scrapeLumaPage(): Promise<{
  eventName: string
  hostName: string
  guestProfileUrls: string[]
}> {
  const eventName = extractEventName(document)
  const hostName  = extractHostName(document)

  // Try to open the guest list modal
  findAndOpenGuestButton()
  await new Promise(r => setTimeout(r, 1000))

  // Find scrollable container (modal or page)
  const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="guest-list"]')
  await scrollToLoadAll(modal ?? document.scrollingElement)

  const links = parseGuestLinks(document)
  return { eventName, hostName, guestProfileUrls: links }
}

// ── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCRAPE_LUMA' || msg.type === 'SCRAPE_LUMA_FOR_POST') {
    scrapeLumaPage().then(result => {
      sendResponse({
        count: result.guestProfileUrls.length,
        eventName: result.eventName,
        hostName: result.hostName,
        guestProfileUrls: result.guestProfileUrls,
      })
    })
    return true // keep channel open for async response
  }
})
```

**Step 4: Run tests to see them pass**

```bash
cd extension && npx jest tests/luma-parser.test.ts
```

Expected: PASS

**Step 5: Build and test manually**

```bash
npm run build
```

In Chrome, reload the extension, navigate to a real public Luma event, open popup, click "Connect with Attendees".

Expected: popup shows "Queued X connections" (X > 0 if guests are visible).

**Step 6: Commit**

```bash
git add extension/
git commit -m "feat: luma content script with guest scraping and tests"
```

---

## Task 11: Save Contacts to Supabase (Extension → DB)

**Files:**
- Modify: `extension/background/service-worker.ts`

**Goal:** When `SCRAPE_LUMA` completes, service worker receives scraped data, upserts event + contacts into Supabase, queues connection requests.

**Step 1: Add contact saving logic to `extension/background/service-worker.ts`**

```typescript
import { getSupabase } from '../lib/supabase'

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQueue', { periodInMinutes: 0.5 })
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkQueue') await processNextQueueItem()
})

chrome.runtime.onMessageExternal.addListener(async (msg) => {
  if (msg.type === 'SET_AUTH' && msg.session) {
    await chrome.storage.local.set({ session: msg.session })
  }
})

// Called by popup after SCRAPE_LUMA response
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SAVE_CONTACTS') {
    saveContacts(msg.data).then(count => sendResponse({ saved: count }))
    return true
  }
})

async function getSession() {
  const { session } = await chrome.storage.local.get('session')
  return session
}

async function saveContacts(data: {
  eventName: string
  lumaUrl: string
  hostName: string
  guestProfileUrls: string[]
}): Promise<number> {
  const session = await getSession()
  if (!session) return 0

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  // Upsert event
  const { data: event } = await supabase
    .from('events')
    .upsert({ user_id: session.user.id, luma_url: data.lumaUrl, name: data.eventName },
             { onConflict: 'luma_url,user_id' })
    .select()
    .single()

  if (!event) return 0

  // Insert placeholder contacts (name from URL slug for now)
  // Full LinkedIn enrichment is out of scope for v1 — users see contacts populate as connections are sent
  const contacts = data.guestProfileUrls.map(url => ({
    user_id: session.user.id,
    event_id: event.id,
    luma_profile_url: url,
    name: url.split('/').pop()?.replace(/-/g, ' ') ?? 'Unknown',
  }))

  const { data: saved } = await supabase
    .from('contacts')
    .upsert(contacts, { onConflict: 'event_id,luma_profile_url' })
    .select('id, linkedin_url')

  if (!saved) return 0

  // Queue connections for contacts that have a LinkedIn URL
  const toQueue = saved
    .filter(c => c.linkedin_url)
    .map(c => ({ user_id: session.user.id, contact_id: c.id, status: 'pending' }))

  if (toQueue.length > 0) {
    await supabase.from('connection_queue').upsert(toQueue, { onConflict: 'contact_id' })
  }

  return saved.length
}

// Placeholder — full implementation in Task 12
async function processNextQueueItem() {
  console.log('processNextQueueItem — implemented in Task 12')
}
```

**Step 2: Update popup to send SAVE_CONTACTS after scrape**

In `extension/popup/popup.ts`, update `onConnect`:

```typescript
async function onConnect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  document.getElementById('status')!.textContent = 'Scraping attendees…'

  chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_LUMA' }, async (response) => {
    if (!response?.guestProfileUrls) {
      document.getElementById('status')!.textContent = 'Could not scrape page.'
      return
    }
    document.getElementById('status')!.textContent = 'Saving contacts…'

    chrome.runtime.sendMessage({
      type: 'SAVE_CONTACTS',
      data: {
        eventName: response.eventName,
        lumaUrl: tab.url,
        hostName: response.hostName,
        guestProfileUrls: response.guestProfileUrls,
      }
    }, (result) => {
      document.getElementById('status')!.textContent =
        `Queued ${result?.saved ?? 0} contacts. Sending connections at 40/day.`
    })
  })
}
```

**Step 3: Build and manually verify**

```bash
cd extension && npm run build
```

Navigate to a real Luma event, click "Connect with Attendees". Check Supabase Table Editor — confirm contacts appear in the `contacts` table.

**Step 4: Commit**

```bash
git add extension/
git commit -m "feat: save scraped contacts to supabase and queue connection requests"
```

---

## Task 12: LinkedIn Connection Automation

**Files:**
- Modify: `extension/content/linkedin.ts`
- Modify: `extension/background/service-worker.ts`
- Create: `extension/lib/rate-limiter.ts`
- Create: `extension/tests/rate-limiter.test.ts`

**Step 1: Write rate limiter test**

Create `extension/tests/rate-limiter.test.ts`:

```typescript
import { checkDailyLimit } from '../lib/rate-limiter'

describe('checkDailyLimit', () => {
  it('returns canSend=true when count is below 40', () => {
    expect(checkDailyLimit(39)).toEqual({ canSend: true, remaining: 1 })
  })
  it('returns canSend=false when count is 40', () => {
    expect(checkDailyLimit(40)).toEqual({ canSend: false, remaining: 0 })
  })
  it('returns canSend=false when count exceeds 40', () => {
    expect(checkDailyLimit(41)).toEqual({ canSend: false, remaining: 0 })
  })
  it('returns full remaining when count is 0', () => {
    expect(checkDailyLimit(0)).toEqual({ canSend: true, remaining: 40 })
  })
})
```

**Step 2: Run test to see it fail**

```bash
npx jest tests/rate-limiter.test.ts
```

Expected: FAIL

**Step 3: Create `extension/lib/rate-limiter.ts`**

```typescript
const DAILY_LIMIT = 40

export function checkDailyLimit(sentToday: number): { canSend: boolean; remaining: number } {
  const remaining = Math.max(0, DAILY_LIMIT - sentToday)
  return { canSend: sentToday < DAILY_LIMIT, remaining }
}

export async function getSentTodayCount(supabase: any, userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const { count } = await supabase
    .from('connection_queue')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'sent')
    .gte('sent_at', `${today}T00:00:00Z`)
  return count ?? 0
}
```

**Step 4: Run test to see it pass**

```bash
npx jest tests/rate-limiter.test.ts
```

Expected: PASS

**Step 5: Implement `extension/content/linkedin.ts`**

```typescript
function findButtonByText(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === text) as HTMLButtonElement ?? null
  )
}

function findConnectButton(): HTMLButtonElement | null {
  // Direct connect button
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

  // Make sure we're on a profile page
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

  // Handle "Add a note" modal
  const addNoteBtn = findButtonByText('Add a note')
  if (addNoteBtn) {
    // Check for premium paywall
    if (await dismissPremiumPaywall()) {
      // Try again without note
    } else {
      addNoteBtn.click()
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // Click send (with or without note)
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendConnection().then(result => sendResponse(result))
    return true
  }
})
```

**Step 6: Implement full queue processor in `extension/background/service-worker.ts`**

Replace the placeholder `processNextQueueItem`:

```typescript
import { getSupabase } from '../lib/supabase'
import { checkDailyLimit, getSentTodayCount } from '../lib/rate-limiter'

async function processNextQueueItem(): Promise<void> {
  const session = await getSession()
  if (!session) return

  const supabase = getSupabase()
  await supabase.auth.setSession(session)

  // Check daily limit
  const sentToday = await getSentTodayCount(supabase, session.user.id)
  const { canSend } = checkDailyLimit(sentToday)
  if (!canSend) return

  // Get next pending item
  const { data: item } = await supabase
    .from('connection_queue')
    .select('*, contacts(linkedin_url, name)')
    .eq('user_id', session.user.id)
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .single()

  if (!item) return
  const linkedinUrl = (item.contacts as any)?.linkedin_url
  if (!linkedinUrl) {
    await supabase.from('connection_queue').update({ status: 'failed', error: 'no_linkedin_url' }).eq('id', item.id)
    return
  }

  // Open LinkedIn tab
  const tab = await chrome.tabs.create({ url: linkedinUrl, active: false })
  await new Promise(r => setTimeout(r, 3000)) // wait for page load

  // Send connect message to content script
  const result: { success: boolean; error?: string } = await new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id!, { type: 'CONNECT' }, response => {
      resolve(response ?? { success: false, error: 'no_response' })
    })
  })

  // Update queue
  if (result.success) {
    await supabase.from('connection_queue').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', item.id)

    await supabase.from('usage_logs').insert({
      user_id: session.user.id,
      action: 'connection_sent',
    })
  } else {
    await supabase.from('connection_queue').update({
      status: 'failed',
      error: result.error ?? 'unknown',
    }).eq('id', item.id)
  }

  // Close the LinkedIn tab
  chrome.tabs.remove(tab.id!)

  // Schedule next: 8–15 minutes random delay
  const delayMinutes = 8 + Math.random() * 7
  await supabase.from('connection_queue')
    .update({ scheduled_at: new Date(Date.now() + delayMinutes * 60000).toISOString() })
    .eq('user_id', session.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
}
```

**Step 7: Run all extension tests**

```bash
cd extension && npx jest
```

Expected: all tests pass

**Step 8: Build and manually test LinkedIn automation**

```bash
npm run build
```

Reload extension in Chrome. Add a test contact to `connection_queue` in Supabase directly (status: pending, scheduled_at: now). Watch Chrome — it should open a LinkedIn tab, click Connect, close the tab.

**Step 9: Commit**

```bash
git add extension/
git commit -m "feat: linkedin connection automation with rate limiting (40/day)"
```

---

## Task 13: Deploy to Production

**Step 1: Deploy dashboard to Vercel**

```bash
cd dashboard
npx vercel --prod
```

Or: connect GitHub repo to Vercel, add env vars in Vercel dashboard, auto-deploy on push.

**Step 2: Update extension with production URL**

In `extension/manifest.json`, update `externally_connectable.matches` to include the Vercel production URL.

In `extension/popup/popup.ts`, update the dashboard URL from `localhost:3000` to the production URL.

**Step 3: Update Supabase values in extension**

In `extension/lib/supabase.ts`, confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` are the production values.

**Step 4: Final build**

```bash
cd extension && npm run build
```

**Step 5: Package extension for distribution**

For sharing with 20 users: zip the `extension/` folder (excluding `node_modules/`). Users load it as an unpacked extension in Chrome.

For Chrome Web Store (later): run `npm run build` and submit the `dist/` folder contents per Chrome Web Store submission guidelines.

**Step 6: Run all tests one final time**

```bash
cd dashboard && npx jest
cd ../extension && npx jest
```

Expected: all pass

**Step 7: Final commit**

```bash
git add .
git commit -m "feat: production deploy — dashboard on vercel, extension packaged"
```

---

## Summary: Task Order

1. Supabase setup + schema
2. Next.js scaffold + env vars
3. Login page + auth
4. Dashboard layout + nav
5. Contacts page
6. Stats page
7. Post generator
8. Chrome extension scaffold
9. Auth handoff
10. Luma content script
11. Save contacts to Supabase
12. LinkedIn automation + rate limiter
13. Deploy

## Environment Variables Checklist

**dashboard/.env.local**
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `ANTHROPIC_API_KEY`
- [ ] `NEXT_PUBLIC_EXTENSION_ID`

**extension/lib/supabase.ts** (hardcoded constants)
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
