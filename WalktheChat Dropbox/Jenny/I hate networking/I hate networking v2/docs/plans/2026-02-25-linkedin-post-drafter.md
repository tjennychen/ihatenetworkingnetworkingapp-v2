# LinkedIn Post Drafter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Draft LinkedIn post" button to the progress page that generates a ready-to-copy thank-you post using real LinkedIn names fetched on demand.

**Architecture:** New `draftPickerOpen` state variable in `panel.ts` (mirrors existing `exportPickerOpen` pattern) drives a 3-stage draft UI: event picker → loading (fetching LinkedIn names via background tabs) → editable draft. A new `GET_LINKEDIN_NAMES` service-worker handler visits each LinkedIn URL in a background tab, uses the existing `getProfileName()` in `linkedin.ts` to extract the display name, caches it in a new `linkedin_name` DB column, and returns results. Names are capped at 15 guests; a Shuffle button picks a fresh random 15.

**Tech Stack:** TypeScript, esbuild, Chrome Extension MV3, Supabase (project `urgibxjxbcyvprdejplp`)

**Build command:** `cd extension && npm run build`

---

### Task 1: DB migration — add `linkedin_name` column

**Files:**
- Modify: `supabase/migrations/001_initial_schema.sql` (append comment only — migration runs via MCP)

**Step 1: Apply migration via Supabase MCP**

Run this SQL against project `urgibxjxbcyvprdejplp`:
```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_name TEXT DEFAULT '';
```

**Step 2: Verify column exists**

Run:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'contacts' AND column_name = 'linkedin_name';
```
Expected: one row returned.

**Step 3: Commit**
```bash
cd "I hate networking v2"
git add supabase/migrations/
git commit -m "feat: add linkedin_name column to contacts"
```

---

### Task 2: `linkedin.ts` — add `GET_LINKEDIN_NAME` message handler

**Files:**
- Modify: `extension/content/linkedin.ts` (after line 158, inside the existing `chrome.runtime.onMessage.addListener`)

**Step 1: Add handler inside the existing listener**

The existing listener block at line 153 is:
```typescript
if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendConnection(msg.note || '', msg.expectedName || '').then(result => sendResponse(result))
    return true
  }
})
```

Add the `GET_LINKEDIN_NAME` case before the closing `})`:
```typescript
  if (msg.type === 'GET_LINKEDIN_NAME') {
    sendResponse({ name: getProfileName() })
    return true
  }
```

So the full listener becomes:
```typescript
if (typeof chrome !== 'undefined' && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONNECT') {
    sendConnection(msg.note || '', msg.expectedName || '').then(result => sendResponse(result))
    return true
  }
  if (msg.type === 'GET_LINKEDIN_NAME') {
    sendResponse({ name: getProfileName() })
    return true
  }
})
```

**Step 2: Build and verify no TypeScript errors**
```bash
cd extension && npm run build 2>&1 | grep -i error
```
Expected: no errors.

**Step 3: Commit**
```bash
git add extension/content/linkedin.ts extension/dist/linkedin.js
git commit -m "feat: add GET_LINKEDIN_NAME message handler to linkedin content script"
```

---

### Task 3: `service-worker.ts` — add `GET_DRAFT_DATA` and `GET_LINKEDIN_NAMES` handlers

**Files:**
- Modify: `extension/background/service-worker.ts`

**Context:** The existing pattern for visiting a LinkedIn tab is at lines 501–525. The pattern for a message handler is: check `msg.type`, call an async function, call `sendResponse`, return `true`.

**Step 1: Add `GET_DRAFT_DATA` handler**

This fetches hosts and a random sample of ≤15 guests for an event, returning their cached `linkedin_name`.

Add after the last `if (msg.type === ...)` block (find the last one by searching for `return true` near the end of the listener):

```typescript
  if (msg.type === 'GET_DRAFT_DATA') {
    ;(async () => {
      const { data: { session } } = await getSupabase().auth.getSession()
      if (!session) { sendResponse(null); return }
      const supabase = getAuthedSupabase(session.access_token)
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, linkedin_url, linkedin_name, is_host')
        .eq('event_id', msg.eventId)
        .eq('user_id', session.user.id)
      if (!contacts) { sendResponse(null); return }
      const hosts = contacts.filter((c: any) => c.is_host)
      const guests = contacts.filter((c: any) => !c.is_host && c.linkedin_url)
      // Random sample of up to 15 guests
      const shuffled = [...guests].sort(() => Math.random() - 0.5)
      const sample = shuffled.slice(0, 15)
      sendResponse({ hosts, guests: sample, totalGuests: guests.length })
    })()
    return true
  }
```

**Step 2: Add `GET_LINKEDIN_NAMES` handler**

This visits each LinkedIn URL in a background tab, sends `GET_LINKEDIN_NAME`, caches the result.

```typescript
  if (msg.type === 'GET_LINKEDIN_NAMES') {
    ;(async () => {
      const { data: { session } } = await getSupabase().auth.getSession()
      if (!session) { sendResponse([]); return }
      const supabase = getAuthedSupabase(session.access_token)
      const results: { id: string; linkedin_name: string }[] = []

      for (const contact of msg.contacts as { id: string; linkedin_url: string }[]) {
        const url = contact.linkedin_url.replace('https://linkedin.com/', 'https://www.linkedin.com/')
        try {
          const tab = await chrome.tabs.create({ url, active: false })
          const tabId = tab.id!
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 15000)
            chrome.tabs.onUpdated.addListener(function listener(tid, info) {
              if (tid === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener)
                clearTimeout(timeout)
                setTimeout(resolve, 2500)
              }
            })
          })
          const nameResult: { name: string } = await new Promise(resolve => {
            const timeout = setTimeout(() => resolve({ name: '' }), 10000)
            chrome.tabs.sendMessage(tabId, { type: 'GET_LINKEDIN_NAME' }, response => {
              clearTimeout(timeout)
              resolve(response ?? { name: '' })
            })
          })
          chrome.tabs.remove(tabId).catch(() => {})
          const linkedinName = nameResult.name || ''
          if (linkedinName) {
            await supabase.from('contacts').update({ linkedin_name: linkedinName }).eq('id', contact.id)
          }
          results.push({ id: contact.id, linkedin_name: linkedinName })
        } catch {
          results.push({ id: contact.id, linkedin_name: '' })
        }
      }
      sendResponse(results)
    })()
    return true
  }
```

**Step 3: Build and check for errors**
```bash
cd extension && npm run build 2>&1 | grep -i error
```
Expected: no errors.

**Step 4: Commit**
```bash
git add extension/background/service-worker.ts extension/dist/service-worker.js
git commit -m "feat: add GET_DRAFT_DATA and GET_LINKEDIN_NAMES service worker handlers"
```

---

### Task 4: `panel.ts` — draft state variables, CTA button, and draft view

**Files:**
- Modify: `extension/content/panel.ts`

**Context:**
- `exportPickerOpen` (boolean) + `exportPickerOpen = false` pattern already exists — follow this exactly.
- The progress view body is rendered at line 476 inside `} else if (state.type === 'progress') {`.
- The events list closes at the `</div>` after line 535.
- The export CSV button listener is wired at line 559.

**Step 1: Add draft state variables near `exportPickerOpen`**

Find `let exportPickerOpen = false` in panel.ts and add after it:

```typescript
let draftPickerOpen = false
type DraftState =
  | { stage: 'pick' }
  | { stage: 'loading'; eventId: string; eventName: string; total: number }
  | { stage: 'ready'; eventId: string; eventShortName: string; postText: string; guestNames: string[]; totalGuests: number }
let draftState: DraftState = { stage: 'pick' }
```

**Step 2: Add `shortenEventName` helper function**

Add this pure function near the other helper functions at the top of the file (after `escHtml`):

```typescript
function shortenEventName(name: string): string {
  // Remove {BRACKETS} prefix
  let s = name.replace(/^\{[^}]*\}\s*/i, '')
  // Remove subtitle after ': '
  s = s.replace(/\s*:\s*.+$/, '')
  // Remove parenthetical suffix
  s = s.replace(/\s*\([^)]*\)\s*$/, '')
  // Remove trailing punctuation/separators
  s = s.replace(/[-–—\s]+$/, '').trim()
  return s
}
```

**Step 3: Add "Draft LinkedIn post" CTA button to the progress view body**

In the progress view body HTML (around line 535), find the closing `</div>` of `ihn-events-list` and the `${!data || ...}` empty state. Add the draft button after the events list div:

Replace this section (after the events list and before where the `body.innerHTML` template string closes):
```typescript
      ${!data || data.events.length === 0 ? '<p class="ihn-empty">No events yet.</p>' : ''}
      </div>
    `
```

With:
```typescript
      ${!data || data.events.length === 0 ? '<p class="ihn-empty">No events yet.</p>' : ''}
      </div>
      ${data && data.events.length > 0 ? `<button id="ihn-draft-post-btn" class="ihn-cta-btn ihn-cta-btn-secondary" style="margin-top:8px">✍️ Draft LinkedIn post</button>` : ''}
    `
```

**Step 4: Wire the draft button click handler**

After `panelEl.querySelector('#ihn-progress-export-csv')?.addEventListener(...)`, add:

```typescript
    panelEl.querySelector('#ihn-draft-post-btn')?.addEventListener('click', () => {
      draftPickerOpen = true
      draftState = { stage: 'pick' }
      renderPanel()
    })
```

**Step 5: Add the draft picker rendering block**

In the progress view section, add this block at the top (after `if (exportPickerOpen) {` block closes with `return`), before the `const topLabel = ...` line:

```typescript
    if (draftPickerOpen) {
      const events = data?.events ?? []

      if (draftState.stage === 'pick') {
        if (events.length === 1) {
          // Skip picker, go straight to loading
          const ev = events[0]
          draftState = { stage: 'loading', eventId: ev.id, eventName: ev.name ?? '', total: 0 }
          startDraftFetch(ev.id, ev.name ?? '')
        }
        body.innerHTML = `
          <div class="ihn-export-picker">
            <p class="ihn-export-picker-title">Which event?</p>
            <div class="ihn-export-picker-list">
              ${events.map((ev: any) => `
                <button class="ihn-draft-event-btn ihn-cta-btn ihn-cta-btn-secondary" data-event-id="${escHtml(ev.id)}" data-event-name="${escHtml(ev.name ?? '')}">
                  ${escHtml(ev.name ?? 'Untitled event')}
                </button>
              `).join('')}
            </div>
            <div class="ihn-export-picker-actions">
              <button id="ihn-draft-cancel-btn">Cancel</button>
            </div>
          </div>
        `
        panelEl.querySelectorAll<HTMLButtonElement>('.ihn-draft-event-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const evId = btn.dataset.eventId!
            const evName = btn.dataset.eventName!
            draftState = { stage: 'loading', eventId: evId, eventName: evName, total: 0 }
            startDraftFetch(evId, evName)
            renderPanel()
          })
        })
        panelEl.querySelector('#ihn-draft-cancel-btn')?.addEventListener('click', () => {
          draftPickerOpen = false
          renderPanel()
        })
        return
      }

      if (draftState.stage === 'loading') {
        const approxSecs = Math.max(15, draftState.total)
        body.innerHTML = `
          <div class="ihn-draft-loading">
            <div class="ihn-draft-spinner"></div>
            <p class="ihn-draft-loading-msg">Getting LinkedIn names…</p>
            <p class="ihn-draft-loading-sub">Visiting each profile to get their real LinkedIn name — takes ~${approxSecs} seconds</p>
            <button id="ihn-draft-cancel-btn" style="margin-top:12px">Cancel</button>
          </div>
        `
        panelEl.querySelector('#ihn-draft-cancel-btn')?.addEventListener('click', () => {
          draftPickerOpen = false
          renderPanel()
        })
        return
      }

      if (draftState.stage === 'ready') {
        const { postText, guestNames, totalGuests, eventId, eventShortName } = draftState
        body.innerHTML = `
          <div class="ihn-draft-ready">
            <p class="ihn-draft-section-label">Copy this as your post:</p>
            <textarea id="ihn-draft-textarea" class="ihn-draft-textarea">${escHtml(postText)}</textarea>
            <button id="ihn-draft-copy-btn" class="ihn-cta-btn ihn-cta-btn-primary">Copy post</button>

            <p class="ihn-draft-section-label" style="margin-top:14px">Tag these people in your photo:</p>
            <p class="ihn-draft-tag-hint">In the LinkedIn app: tap your photo → Tag people → search each name below</p>
            <div class="ihn-draft-names">${guestNames.map(n => `<span class="ihn-draft-name">${escHtml(n)}</span>`).join('')}</div>
            ${totalGuests > 15 ? `<button id="ihn-draft-shuffle-btn" class="ihn-cta-btn ihn-cta-btn-secondary" data-event-id="${escHtml(eventId)}" data-event-short="${escHtml(eventShortName)}" style="margin-top:8px">Shuffle (${totalGuests} guests total)</button>` : ''}

            <button id="ihn-draft-cancel-btn" class="ihn-cta-btn ihn-cta-btn-secondary" style="margin-top:8px">Done</button>
          </div>
        `
        panelEl.querySelector('#ihn-draft-copy-btn')?.addEventListener('click', () => {
          const text = (panelEl.querySelector('#ihn-draft-textarea') as HTMLTextAreaElement)?.value ?? postText
          navigator.clipboard.writeText(text).catch(() => {})
          const btn = panelEl.querySelector('#ihn-draft-copy-btn') as HTMLButtonElement
          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy post' }, 2000) }
        })
        panelEl.querySelector('#ihn-draft-shuffle-btn')?.addEventListener('click', () => {
          const btn = panelEl.querySelector('#ihn-draft-shuffle-btn') as HTMLButtonElement
          const evId = btn.dataset.eventId!
          const evShort = btn.dataset.eventShort!
          // Re-fetch with a new random sample
          draftState = { stage: 'loading', eventId: evId, eventName: evShort, total: 0 }
          startDraftFetch(evId, evShort)
          renderPanel()
        })
        panelEl.querySelector('#ihn-draft-cancel-btn')?.addEventListener('click', () => {
          draftPickerOpen = false
          renderPanel()
        })
        return
      }
    }
```

**Step 6: Add `startDraftFetch` function**

Add this function near the other helper functions in panel.ts (e.g., near `shortenEventName`):

```typescript
function startDraftFetch(eventId: string, eventName: string): void {
  chrome.runtime.sendMessage({ type: 'GET_DRAFT_DATA', eventId }, (resp) => {
    if (!resp) {
      draftPickerOpen = false
      renderPanel()
      return
    }
    const { hosts, guests, totalGuests } = resp as {
      hosts: { id: string; name: string; linkedin_name: string }[]
      guests: { id: string; name: string; linkedin_url: string; linkedin_name: string }[]
      totalGuests: number
    }
    // Update loading total
    if (draftState.stage === 'loading') {
      (draftState as any).total = guests.length
    }
    renderPanel()

    const needFetch = guests.filter(g => !g.linkedin_name && g.linkedin_url)
    const alreadyCached = guests.filter(g => !!g.linkedin_name)

    const buildDraft = (fetchedNames: { id: string; linkedin_name: string }[]) => {
      // Merge cached + freshly fetched names
      const nameMap = new Map<string, string>()
      for (const g of guests) nameMap.set(g.id, g.linkedin_name || g.name || '')
      for (const f of fetchedNames) if (f.linkedin_name) nameMap.set(f.id, f.linkedin_name)
      for (const g of alreadyCached) nameMap.set(g.id, g.linkedin_name)

      const hostMentions = hosts
        .map(h => h.linkedin_name || h.name || '')
        .filter(Boolean)
        .map(n => `@${n}`)
        .join(' ')
      const shortName = shortenEventName(eventName)
      const postText = `Thanks ${hostMentions} for organizing the ${shortName} event!`
      const guestNames = guests.map(g => nameMap.get(g.id) || g.name || '').filter(Boolean)

      draftState = { stage: 'ready', eventId, eventShortName: shortName, postText, guestNames, totalGuests }
      renderPanel()
    }

    if (needFetch.length === 0) {
      buildDraft([])
      return
    }

    chrome.runtime.sendMessage(
      { type: 'GET_LINKEDIN_NAMES', contacts: needFetch.map(g => ({ id: g.id, linkedin_url: g.linkedin_url })) },
      (fetched) => buildDraft(fetched ?? [])
    )
  })
}
```

**Step 7: Build and check for errors**
```bash
cd extension && npm run build 2>&1 | grep -i error
```
Expected: no errors.

**Step 8: Commit**
```bash
git add extension/content/panel.ts extension/dist/panel.js
git commit -m "feat: add draft LinkedIn post UI to progress page"
```

---

### Task 5: `panel.css` — styles for draft view

**Files:**
- Modify: `extension/content/panel.css`

**Step 1: Add styles at end of file**

Append to `extension/content/panel.css`:

```css
/* ── Draft post ──────────────────────────────────────────── */
.ihn-draft-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  text-align: center;
  gap: 6px;
}
.ihn-draft-spinner {
  width: 22px; height: 22px;
  border: 2px solid #e5e7eb;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: ihn-spin 0.8s linear infinite;
  margin-bottom: 6px;
}
@keyframes ihn-spin { to { transform: rotate(360deg); } }
.ihn-draft-loading-msg { font-size: 13px; font-weight: 600; color: #111827; margin: 0; }
.ihn-draft-loading-sub { font-size: 11px; color: #6b7280; margin: 0; max-width: 220px; }

.ihn-draft-ready { padding: 8px 0; display: flex; flex-direction: column; gap: 4px; }
.ihn-draft-section-label { font-size: 11px; font-weight: 600; color: #374151; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.ihn-draft-textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid #d1d5db; border-radius: 6px;
  padding: 8px; font-size: 12px; line-height: 1.5;
  color: #111827; resize: vertical; min-height: 72px;
  font-family: inherit;
}
.ihn-draft-textarea:focus { outline: none; border-color: #6366f1; }
.ihn-draft-tag-hint { font-size: 11px; color: #6b7280; margin: 0 0 6px; }
.ihn-draft-names { display: flex; flex-direction: column; gap: 2px; }
.ihn-draft-name { font-size: 12px; color: #374151; padding: 2px 0; }
.ihn-draft-event-btn { text-align: left; margin-bottom: 4px; }
```

**Step 2: Build (copies CSS to dist)**
```bash
cd extension && npm run build 2>&1 | grep -i error
```
Expected: no errors, `dist/panel.css` updated.

**Step 3: Commit**
```bash
git add extension/content/panel.css extension/dist/panel.css
git commit -m "feat: add draft post styles"
```

---

### Task 6: Manual smoke test

**No automated tests possible** — this feature requires a real browser with LinkedIn session and live Supabase data.

**Test checklist:**
1. Load the extension in Chrome (`chrome://extensions` → Load unpacked → point to `extension/` folder)
2. Go to a Luma event you've already scanned and open the panel
3. Navigate to the Progress view
4. Scroll to bottom — verify "Draft LinkedIn post" button appears
5. Click it
   - If one event: skips picker, goes to loading state immediately
   - If multiple events: shows event picker
6. Loading screen shows spinner + "Getting LinkedIn names… Visiting each profile…" message
7. After ~15s (or instantly if cached), draft appears
8. Section 1: editable textarea with `Thanks @HostName for organizing the [ShortName] event!`
9. "Copy post" button copies textarea content, briefly shows "Copied!"
10. Section 2: list of guest LinkedIn names (hosts NOT in this list)
11. If >15 guests: "Shuffle" button appears, clicking it re-fetches a new random 15
12. "Done" closes the draft view, returns to normal progress view
13. Re-opening draft for same event: loading is instant (names are cached)

**Step 1: Reload extension after build**

In `chrome://extensions`, click the reload icon next to "I Hate Networking".

**Step 2: Verify the `linkedin_name` column gets populated**

After generating a draft, run in Supabase SQL editor:
```sql
SELECT name, linkedin_name FROM contacts WHERE linkedin_name != '' LIMIT 5;
```
Expected: rows showing Luma name vs real LinkedIn name.
