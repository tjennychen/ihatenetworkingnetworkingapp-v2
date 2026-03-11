# CSV Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a CSV export button to the Events list in the campaign view that lets users select which events to export (defaulting to all), then download a CSV with guest info.

**Architecture:** Pure client-side. The `events` array is already in memory in `sidepanel.ts`. Add `exportMode` + `exportSelected` state vars, modify the events list HTML to render a selectable UI when in export mode, and generate/download the CSV via a Blob URL. No new service worker messages needed.

**Tech Stack:** TypeScript, DOM manipulation, Blob URL download, esbuild

---

### Task 1: Add state variables and CSV helper functions

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:27` (after `let expandedEvents`)

**Step 1: Add two new state variables after `expandedEvents` (line 27)**

```typescript
let exportMode = false
let exportSelected = new Set<string>()
```

**Step 2: Add CSV helper functions after the `escHtml` helper (after line 41)**

```typescript
function generateCsv(selectedIds: Set<string>): string {
  const rows = ['Event,Name,LinkedIn URL,Status']
  for (const ev of events) {
    if (!selectedIds.has(ev.id ?? '')) continue
    for (const c of (ev.contacts ?? [])) {
      const status = c.connection_queue?.[0]?.status ?? ''
      const row = [ev.name ?? '', c.name ?? '', c.linkedin_url ?? '', status]
        .map((v: string) => `"${v.replace(/"/g, '""')}"`)
        .join(',')
      rows.push(row)
    }
  }
  return rows.join('\n')
}

function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'connections.csv'
  a.click()
  URL.revokeObjectURL(url)
}
```

**Step 3: Verify file is syntactically valid**

```bash
cd extension && npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this change)

---

### Task 2: Modify the events list HTML to support export mode

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:439-485` (the `eventsListHtml` block)

**Step 1: Replace the entire `eventsListHtml` block with this version**

Find this comment: `// ── Expandable events list ─────────────────────────────────────────────────`

Replace the whole `eventsListHtml` const (lines 439–485) with:

```typescript
  // ── Expandable events list ─────────────────────────────────────────────────
  const eventsListHtml = events.length === 0 ? '' : (() => {
    const exportBtn = exportMode
      ? `<button class="export-cancel-btn" id="btnExportCancel">Cancel</button>`
      : `<button class="export-trigger-btn" id="btnExportCsv">Export CSV</button>`

    if (exportMode) {
      // Selectable export mode
      const rowsHtml = events.map(ev => {
        const evId: string = ev.id ?? ''
        const contacts: any[] = ev.contacts ?? []
        const checked = exportSelected.has(evId)
        return `
          <label class="event-export-row ${checked ? 'export-checked' : ''}" data-export-id="${escHtml(evId)}">
            <input type="checkbox" class="export-check" data-event-id="${escHtml(evId)}" ${checked ? 'checked' : ''}>
            <span class="event-row-name">${escHtml(ev.name ?? 'Event')}</span>
            <span class="event-row-badge">${contacts.length} contacts</span>
          </label>
        `
      }).join('')

      return `
        <div class="section">
          <div class="feed-header">
            <span class="feed-title">Select events to export</span>
            ${exportBtn}
          </div>
          <div class="events-list">${rowsHtml}</div>
          <button class="btn btn-primary" id="btnDownloadCsv" style="margin-top:10px;">Download CSV</button>
        </div>
      `
    }

    // Normal expandable mode
    const rowsHtml = events.map(ev => {
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
    }).join('')

    return `
      <div class="section">
        <div class="feed-header">
          <span class="feed-title">Events</span>
          ${exportBtn}
        </div>
        <div class="events-list">${rowsHtml}</div>
      </div>
    `
  })()
```

**Step 2: Verify no TypeScript errors**

```bash
cd extension && npx tsc --noEmit
```

---

### Task 3: Wire up export mode event handlers

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts` — in `renderCampaign()`, after the existing event row expansion handler (around line 546)

**Step 1: Add export handlers after the `// ── Wire event row expansion` block**

Find: `// ── Wire draft button → navigate to full-page draft view ──────────────────`

Insert before that comment:

```typescript
  // ── Wire CSV export ────────────────────────────────────────────────────────
  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    if (events.length === 1) {
      // Single event: skip selection UI, download immediately
      exportSelected = new Set(events.map((e: any) => e.id ?? ''))
      downloadCsv(generateCsv(exportSelected))
    } else {
      // Multiple events: enter select mode, default all selected
      exportMode = true
      exportSelected = new Set(events.map((e: any) => e.id ?? ''))
      render()
    }
  })

  document.getElementById('btnExportCancel')?.addEventListener('click', () => {
    exportMode = false
    render()
  })

  document.getElementById('btnDownloadCsv')?.addEventListener('click', () => {
    downloadCsv(generateCsv(exportSelected))
    exportMode = false
    render()
  })

  document.querySelectorAll<HTMLInputElement>('.export-check').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const evId = checkbox.getAttribute('data-event-id') ?? ''
      if (checkbox.checked) {
        exportSelected.add(evId)
      } else {
        exportSelected.delete(evId)
      }
      // Update row highlight without full re-render
      const row = checkbox.closest('.event-export-row')
      if (row) row.classList.toggle('export-checked', checkbox.checked)
    })
  })
```

**Step 2: Verify no TypeScript errors**

```bash
cd extension && npx tsc --noEmit
```

---

### Task 4: Add CSS for export mode

**Files:**
- Modify: `extension/sidepanel/sidepanel.css` — append to end of file

**Step 1: Append these styles to `sidepanel.css`**

```css
/* ── CSV export mode ── */
.export-trigger-btn, .export-cancel-btn {
  background: none; border: none; cursor: pointer;
  font-size: 11px; font-weight: 600;
  font-family: inherit; padding: 0;
}
.export-trigger-btn { color: #4f46e5; }
.export-cancel-btn { color: #9ca3af; }
.export-trigger-btn:hover { opacity: 0.75; }
.export-cancel-btn:hover { color: #6b7280; }

.event-export-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; cursor: pointer;
  border: 1px solid #e5e7eb; border-radius: 8px;
  background: #f9fafb;
  transition: background 0.1s;
}
.event-export-row.export-checked { background: #eef2ff; border-color: #c7d2fe; }
.event-export-row input[type="checkbox"] { flex-shrink: 0; accent-color: #4f46e5; }
```

---

### Task 5: Build and verify

**Step 1: Run the build**

```bash
cd extension && npm run build
```

Expected: build completes with no errors, all 4 dist files updated.

**Step 2: Manual test in Chrome**

1. Load unpacked from `extension/` in `chrome://extensions`
2. Open side panel — navigate to campaign view with 2+ events
3. Click "Export CSV" → events list switches to checkboxes, all pre-checked
4. Uncheck one → row loses highlight
5. Click "Download CSV" → file downloads, export mode exits
6. Open file → correct Event/Name/LinkedIn URL/Status columns
7. Test with 1 event: click "Export CSV" → downloads immediately, no selection UI

**Step 3: Commit**

```bash
cd extension
git add sidepanel/sidepanel.ts sidepanel/sidepanel.css dist/sidepanel.js dist/sidepanel.css
git commit -m "feat: add CSV export to events list with multi-event selection"
```
