# Design: Full Rebuild — I Hate Networking

**Date:** 2026-02-23
**Status:** Approved

## Problem

The current Streamlit app has fundamental UI/UX issues: buttons clip text, dialogs can't be restyled reliably, and the user flow is confusing. Streamlit's CSS is fragile and breaks with every update. The app needs to be rebuilt on a stack that supports a professional product feel.

## Goals

1. Professional, clean UI with no styling bugs
2. Simple two-button flow on Luma event pages
3. LinkedIn connection automation with daily rate limiting
4. Contacts database across all events
5. Stats dashboard (connections sent/accepted, acceptance rate, daily chart)
6. LinkedIn post generator (thank host + tag guests)
7. Usage tracking ready for Stripe billing later

## Stack

```
Next.js (Vercel)     — dashboard, auth, Claude API calls for post generation
Chrome Extension     — Luma scraping, LinkedIn automation
Supabase             — auth, database, usage logs
Stripe Meters        — usage-based billing (added later)
```

No FastAPI needed. Luma scraping moves to the Chrome extension (runs in user's own browser session — harder to detect/block than server-side scraping). Post generation is a Next.js API route calling Claude directly.

## Architecture

```
User's Browser
    ├── Next.js Dashboard (Vercel)
    │       ├── Auth (Supabase)
    │       ├── Contacts tab — searchable table of all scraped contacts
    │       ├── Stats tab — Hey Reach-style cards + area chart
    │       └── Post Generator — Claude API → copy-paste output
    │
    └── Chrome Extension
            ├── Detects lu.ma/[event] URLs
            ├── Shows popup with 2 buttons
            ├── Scrapes attendees → saves to Supabase
            ├── Queues + sends LinkedIn connection requests (max 40/day)
            └── Tracks accepted connections back to Supabase

Supabase
    ├── Auth + users
    ├── events
    ├── contacts
    ├── connection_queue
    └── usage_logs
```

## User Flow

### On a Luma event page (Chrome extension popup)

```
┌─────────────────────────────────┐
│  I Hate Networking              │
│─────────────────────────────────│
│  Founder Summit NYC             │
│  47 attendees found             │
│                                 │
│  [Connect with Attendees →]     │
│  [Generate LinkedIn Post →]     │
└─────────────────────────────────┘
```

- **Connect with Attendees:** scrapes Luma page, extracts LinkedIn URLs, queues connection requests. Sends at up to 40/day with random delays. No confirmation screen — just starts.
- **Generate LinkedIn Post:** scrapes Luma page, generates post text thanking the host + listing guest names for manual tagging on LinkedIn. User copies the text.

### Dashboard — Stats tab

- Stat cards: Connections Sent, Connections Accepted (with % rate)
- Area chart: connections sent vs accepted per day (last 30 days)

### Dashboard — Contacts tab

Searchable/filterable table with columns:
- Name, LinkedIn headline, Company, City
- Event name, Event date
- Instagram URL
- Connection status (pending / sent / accepted)

## Data Model

### `events`
| Column | Type |
|---|---|
| id | uuid PK |
| user_id | uuid FK users |
| luma_url | text |
| name | text |
| date | date |
| city | text |
| created_at | timestamptz |

### `contacts`
| Column | Type |
|---|---|
| id | uuid PK |
| user_id | uuid FK users |
| event_id | uuid FK events |
| name | text |
| first_name | text |
| last_name | text |
| linkedin_url | text |
| linkedin_urn | text |
| headline | text |
| company | text |
| city | text |
| instagram_url | text |
| photo_url | text |
| luma_profile_url | text |
| created_at | timestamptz |

### `connection_queue`
| Column | Type |
|---|---|
| id | uuid PK |
| user_id | uuid FK users |
| contact_id | uuid FK contacts |
| status | enum: pending / sent / accepted / failed |
| scheduled_at | timestamptz |
| sent_at | timestamptz |
| accepted_at | timestamptz |
| error | text |
| created_at | timestamptz |

### `usage_logs`
| Column | Type |
|---|---|
| id | uuid PK |
| user_id | uuid FK users |
| action | text (connection_sent, post_generated) |
| created_at | timestamptz |

## Luma Scraping Strategy

Scraping runs inside the Chrome extension in the user's own browser session:
- Luma sees a real browser with a real user session — not a bot
- If Luma ever blocks, it affects only that user temporarily, not all users
- No server IP to block

Fields extracted per attendee: name, LinkedIn URL, Instagram URL, Luma profile URL.

## LinkedIn Rate Limiting

- Max 40 connection requests per day per user
- Random delays between requests (8–15 minutes) to mimic human behavior
- Queue persists in Supabase — extension picks up where it left off on next browser open
- Status tracked per contact: pending → sent → accepted / failed

## Post Generator

- User clicks "Generate LinkedIn Post" in extension while on Luma page
- Extension scrapes host name + all guest names
- Calls Next.js API route → Claude API
- Returns: thank-host paragraph + list of guest first names for manual @tagging
- User copies text, pastes into LinkedIn, manually tags guests in the photo

## Usage Tracking (Stripe-ready)

Every `connection_sent` and `post_generated` action writes to `usage_logs`. When Stripe Meters is added later, this table feeds directly into usage-based billing with no schema changes needed.

## Out of Scope (v1)

- LinkedIn message sequences (post-connection follow-up)
- Scheduling posts
- Team/org accounts
- Mobile
