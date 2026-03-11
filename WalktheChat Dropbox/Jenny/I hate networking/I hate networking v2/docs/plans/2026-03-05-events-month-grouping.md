# Events Month Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Group the events list in the sidepanel by month (using scan date), with each month collapsible and the most recent month open by default.

**Architecture:** Add `expandedMonths: Set<string>` state alongside existing `expandedEvents`. Replace the flat `events.map(...)` render with a grouped render that buckets events by `created_at.slice(0,7)` (YYYY-MM). Month headers get click handlers that toggle visibility without re-fetching. Individual event row expand/collapse is unchanged.

**Tech Stack:** TypeScript, Chrome Extension Manifest V3, esbuild

---

### Task 1: Add month grouping state + helper

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:27`

**Step 1: Add `expandedMonths` state and `monthLabel` helper after line 27**

```typescript
let expandedMonths = new Set<string>()

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleString('default', { month: 'long', year: 'numeric' })
}
```

**Step 2: Verify build still passes**

```bash
cd extension && npm run build
```
Expected: no errors

**Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts
git commit -m "feat: add expandedMonths state and monthLabel helper"
```

---

### Task 2: Replace flat events list with month-grouped render

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:412-458` (the `eventsListHtml` block)

**Step 1: Replace the `eventsListHtml` block**

Replace from `// ── Expandable events list` through the closing `\`` of `eventsListHtml` with:

```typescript
  // ── Expandable events list ─────────────────────────────────────────────────
  // Group events by YYYY-MM of created_at (scan date)
  const eventsByMonth = new Map<string, any[]>()
  for (const ev of events) {
    const key = (ev.created_at as string | undefined)?.slice(0, 7) ?? 'unknown'
    if (!eventsByMonth.has(key)) eventsByMonth.set(key, [])
    eventsByMonth.get(key)!.push(ev)
  }
  // Init: expand most recent month by default
  const [mostRecentMonth] = [...eventsByMonth.keys()]
  if (mostRecentMonth && expandedMonths.size === 0) expandedMonths.add(mostRecentMonth)

  const eventsListHtml = events.length === 0 ? '' : `
    <div class="section">
      <div class="feed-header">
        <span class="feed-title">Events</span>
      </div>
      <div class="events-list">
        ${[...eventsByMonth.entries()].map(([monthKey, monthEvents]) => {
          const isMonthExpanded = expandedMonths.has(monthKey)
          const eventsHtml = isMonthExpanded ? monthEvents.map(ev => {
            const evId: string = ev.id ?? ''
            const contacts: any[] = ev.contacts ?? []
            const evSent = contacts.filter(c => ['sent', 'accepted'].includes(c.connection_queue?.[0]?.status ?? '')).length
            const evPending = contacts.filter(c => c.connection_queue?.[0]?.status === 'pending').length
            const isExpanded = expandedEvents.has(evId)
            const badgeText = evPending > 0 ? `${evPending} queued` : evSent > 0 ? `${evSent} sent` : `${contacts.length} scanned`
            const badgeClass = evPending > 0 ? 'queued' : ''
            const contactsHtml = isExpanded ? `
              <div class="event-contacts">
                ${contacts.map(c => {
                  const status = c.connection_queue?.[0]?.status ?? ''
                  const statusBadge = status ? `<span class="status-badge ${status}">${status}</span>` : ''
                  const liUrl = c.linkedin_url ?? ''
                  return `
                    <div class="contact-row">
                      <span class="contact-name">${escHtml(c.name ?? '')}</span>
                      <div style="display:flex;align-items:center;gap:4px;">
                        ${liUrl ? `<a href="${escHtml(liUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
                        ${statusBadge}
                      </div>
                    </div>
                  `
                }).join('')}
              </div>
            ` : ''
            return `
              <div class="event-row">
                <div class="event-row-header" data-event-id="${escHtml(evId)}">
                  <span class="event-row-name">${escHtml(ev.name ?? 'Event')}</span>
                  <span class="event-row-badge ${badgeClass}">${escHtml(badgeText)}</span>
                  <span class="chevron" data-chevron>${isExpanded ? '▲' : '▼'}</span>
                </div>
                ${contactsHtml}
              </div>
            `
          }).join('') : ''
          return `
            <div class="month-group">
              <div class="month-header" data-month-key="${escHtml(monthKey)}">
                <span class="month-label">${escHtml(monthLabel(monthKey))}</span>
                <span class="month-count">${monthEvents.length}</span>
                <span class="chevron">${isMonthExpanded ? '▲' : '▼'}</span>
              </div>
              ${eventsHtml}
            </div>
          `
        }).join('')}
      </div>
    </div>
  `
```

**Step 2: Build**

```bash
cd extension && npm run build
```
Expected: no errors

**Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts
git commit -m "feat: group events list by month with collapsible sections"
```

---

### Task 3: Wire month header click handlers

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts` — after the existing `.event-row-header` listener block (~line 522)

**Step 1: Add month header toggle handler after the `event-row-header` listener block**

```typescript
  // ── Wire month header expansion ────────────────────────────────────────────
  document.querySelectorAll<HTMLElement>('.month-header').forEach(header => {
    header.addEventListener('click', () => {
      const key = header.getAttribute('data-month-key') ?? ''
      if (expandedMonths.has(key)) {
        expandedMonths.delete(key)
      } else {
        expandedMonths.add(key)
      }
      render()
    })
  })
```

**Step 2: Build**

```bash
cd extension && npm run build
```
Expected: no errors

**Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts
git commit -m "feat: wire month header click to expand/collapse"
```

---

### Task 4: Add month group styles

**Files:**
- Modify: `extension/sidepanel/sidepanel.css`

**Step 1: Check what `.feed-header` and `.event-row` styles look like**

Read `extension/sidepanel/sidepanel.css` and find existing `.feed-header`, `.event-row-header` rules to match the style.

**Step 2: Add styles**

```css
.month-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 4px;
  cursor: pointer;
  user-select: none;
}
.month-label {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex: 1;
}
.month-count {
  font-size: 11px;
  color: #9ca3af;
}
.month-group + .month-group {
  border-top: 1px solid #f3f4f6;
  margin-top: 4px;
  padding-top: 2px;
}
```

**Step 3: Build**

```bash
cd extension && npm run build
```

**Step 4: Commit**

```bash
git add extension/sidepanel/sidepanel.css extension/sidepanel/sidepanel.ts
git commit -m "style: add month group styles to events list"
```

---

### Task 5: Manual verification

Load the extension in Chrome (`chrome://extensions` → Load unpacked → `extension/` folder).

Check:
- [ ] Events list shows month headers (e.g., "March 2026 · 3")
- [ ] Most recent month is expanded on first open
- [ ] Clicking a month header collapses/expands it
- [ ] Individual event rows still expand to show contacts
- [ ] No events are missing from any month
