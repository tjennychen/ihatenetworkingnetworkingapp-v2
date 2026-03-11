# Events Month Grouping — Design

## Problem
The sidepanel fetches all events with no limit, making the list long and hard to scan.

## Solution
Group events by month using `created_at` (scan date). Each month is a collapsible section. Most recent month open by default.

## Design

### Data
- No schema changes. Use existing `created_at` on events table.
- `GET_PROGRESS_DATA` already returns all events ordered by `created_at` desc — no changes needed.

### UI
- Replace flat events list with month-grouped sections
- Each section header: "March 2026 · 3 events" — clickable to expand/collapse
- Most recent month: expanded by default
- All other months: collapsed by default
- Individual event rows keep existing chevron expand/collapse for contacts

### State
- `expandedMonths: Set<string>` — keys are "YYYY-MM" strings
- Initialize with current month key expanded
- Toggle on header click, same pattern as existing `expandedEvents`

### Rendering
- Group `events` array by `created_at.slice(0, 7)` (YYYY-MM)
- Render month headers + nested event rows
- Month label: format "MMMM YYYY" from key

## Out of scope
- Actual event date extraction from Luma
- Date filter UI / dropdowns
- Pagination
