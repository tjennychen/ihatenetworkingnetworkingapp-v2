# LinkedIn Post Drafter — Design

**Date:** 2026-02-25

## Overview

A CTA button at the bottom of the progress page that generates a LinkedIn post draft thanking event hosts and listing guests to tag in photos.

## Entry Point

"Draft LinkedIn post" button at the bottom of the progress page.

- If only one event exists: skip the selector, go straight to loading
- If multiple events: show a simple event picker first

## Loading State

The extension visits each contact's LinkedIn profile URL in background tabs to scrape their real LinkedIn display name (Luma names differ from LinkedIn names and are not usable for tagging).

- Cap at 15 guests regardless of total event size
- If event has >15 guests: randomly pick 15 to fetch
- Loading indicator: "Getting LinkedIn names... (4/15) — takes about 15 seconds"
- LinkedIn names are cached in a new `linkedin_name` column on the `contacts` table — subsequent opens are instant

## Draft Output

### Section 1 — Post text (copy this)

Editable textarea pre-filled with:

```
Thanks @[Host 1 LinkedIn name] @[Host 2 LinkedIn name] for organizing the [Shortened Event Name] event!
```

- Event name auto-shortened (best guess: strip subtitle after colon, strip bracketed prefixes like `{WFTD}`)
- Fully editable before copying
- **Copy** button copies this section only

### Section 2 — Tagging cheat sheet (not part of the post)

Read-only list of guest LinkedIn full names (hosts excluded — they are already in the post text).

Label: *"In the LinkedIn app, tap your photo → Tag people → search each name below."*

```
Alice Wang
Bob Johnson
Sarah Lee
...
```

- Shows 15 names max
- **Shuffle** button picks a fresh random 15 from the same event
  - If those names are already cached: instant
  - If not: fetches with the same loading indicator
- Contacts with no LinkedIn URL fall back to Luma name with a `*` marker

## Data Changes

- Add `linkedin_name TEXT` column to `contacts` table via migration
- Populate on demand when draft is generated; reuse cached value on subsequent opens

## New Extension Message Types

- `GET_LINKEDIN_NAMES` — given a list of `{ contact_id, linkedin_url }`, visits each URL in a background tab, scrapes the display name, upserts `linkedin_name` into `contacts`, returns results
- `GET_DRAFT_DATA` — returns event hosts + sampled guests (up to 15) with cached `linkedin_name` values for a given event
