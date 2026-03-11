# Duplicate Event UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When user scans an already-scanned event, show them existing contact count + offer to scan for new attendees — instead of silently jumping to results.

**Architecture:** Add an `already_scanned` state to `PanelState`. In `handleImportClick`, when no new attendees are found (`toEnrich.length === 0`), transition to `already_scanned` instead of immediately showing `results`. Render a simple screen with count + two buttons.

**Tech Stack:** TypeScript, Chrome extension content script, esbuild

---

### Task 1: Add `already_scanned` to PanelState and populate it

**Files:**
- Modify: `extension/content/panel.ts:131-138` (PanelState type)
- Modify: `extension/content/panel.ts:699-727` (handleImportClick, the "already up to date" branch)

**Step 1: Add the new state shape to PanelState**

In `panel.ts`, find the `PanelState` type (around line 131) and add:

```typescript
| { type: 'already_scanned'; count: number; linkedInCount: number; eventId: string; eventName: string; eventLocation: string; noNew?: boolean }
```

**Step 2: Replace the "already up to date" branch in handleImportClick**

Find the block starting at line 699:
```typescript
  if (toEnrich.length === 0) {
    // Already up to date — skip enrichment, jump straight to results
    enrichedContacts = (existingContacts as any[]).map(...)
    ...
    state = { type: 'results', ... }
    renderPanel()
    ...
    return
  }
```

Replace with:
```typescript
  if (toEnrich.length === 0) {
    // Already up to date — show "already scanned" screen
    enrichedContacts = (existingContacts as any[]).map((c: any) => ({
      url: c.luma_profile_url ?? '',
      isHost: c.is_host ?? false,
      name: c.name ?? '',
      linkedInUrl: c.linkedin_url ?? '',
      instagramUrl: c.instagram_url ?? '',
      twitterUrl: '',
    }))
    noteValue = defaultNote(eventName)
    state = {
      type: 'already_scanned',
      count: existingUrls.length,
      linkedInCount,
      eventId: cachedEventId,
      eventName,
      eventLocation,
    }
    renderPanel()
    return
  }
```

**Step 3: Build and verify no TypeScript errors**

```bash
cd extension && npm run build 2>&1
```
Expected: clean build, no errors.

---

### Task 2: Render the `already_scanned` state

**Files:**
- Modify: `extension/content/panel.ts` — add branch in `renderPanel()` before the `idle` fallthrough

**Step 1: Add the render branch**

In `renderPanel()`, add an `else if` for `already_scanned`. Insert it after the `else if (state.type === 'contacts')` block (around line 570), before the closing brace:

```typescript
} else if (state.type === 'already_scanned') {
  titleEl.textContent = eventShort || 'Event'
  subtitleEl.textContent = ''
  body.innerHTML = `
    <div class="ihn-already-scanned">
      <div class="ihn-already-count">&#10003; ${state.count} contacts saved &middot; ${state.linkedInCount} have LinkedIn</div>
      ${state.noNew ? '<div class="ihn-already-nonew">No new attendees found</div>' : ''}
      <button id="ihn-view-results-btn" class="ihn-cta-btn ihn-cta-btn-primary">View results &rarr;</button>
      <button id="ihn-scan-new-btn" class="ihn-cta-btn ihn-cta-btn-secondary">Scan for new attendees</button>
    </div>
  `
  panelEl.querySelector('#ihn-view-results-btn')?.addEventListener('click', async () => {
    if (state.type !== 'already_scanned') return
    const linkedInReady = await checkLinkedInLogin()
    state = {
      type: 'results',
      found: state.linkedInCount,
      total: state.count,
      eventId: state.eventId,
      linkedInReady,
      eventName: state.eventName,
      eventLocation: state.eventLocation,
    }
    renderPanel()
  })
  panelEl.querySelector('#ihn-scan-new-btn')?.addEventListener('click', () => {
    handleImportClick()
  })
}
```

**Step 2: Build and verify**

```bash
cd extension && npm run build 2>&1
```
Expected: clean build.

---

### Task 3: Handle the "Scan for new" → no results case

**Context:** When user clicks "Scan for new", `handleImportClick` runs again. If still `toEnrich.length === 0`, it'll show `already_scanned` again — but now we want to show "No new attendees found". We need to detect this re-scan scenario.

**Files:**
- Modify: `extension/content/panel.ts` — add `noNew: true` when transitioning from `already_scanned` back to `already_scanned`

**Step 1: Pass a flag into handleImportClick**

Change the function signature:
```typescript
async function handleImportClick(rescan = false): Promise<void> {
```

In the `toEnrich.length === 0` branch, use `rescan` to set `noNew`:
```typescript
    state = {
      type: 'already_scanned',
      count: existingUrls.length,
      linkedInCount,
      eventId: cachedEventId,
      eventName,
      eventLocation,
      noNew: rescan,   // ← show "No new attendees" only on re-scan
    }
```

In the "Scan for new" button handler, call with `true`:
```typescript
  panelEl.querySelector('#ihn-scan-new-btn')?.addEventListener('click', () => {
    handleImportClick(true)
  })
```

The message listener also calls `handleImportClick()` — leave that with default `false`.

**Step 2: Build**

```bash
cd extension && npm run build 2>&1
```
Expected: clean build.

---

### Task 4: Add minimal CSS for new elements

**Files:**
- Modify: `extension/content/panel.css`

**Step 1: Add styles**

Append to `panel.css`:
```css
.ihn-already-scanned {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.ihn-already-count {
  font-size: 13px;
  color: #6366f1;
  margin-bottom: 4px;
}
.ihn-already-nonew {
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 4px;
}
```

**Step 2: Build**

```bash
cd extension && npm run build 2>&1
```
Expected: clean build, CSS copied to dist/.
