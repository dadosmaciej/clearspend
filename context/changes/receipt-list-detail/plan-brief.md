# Receipt List and Detail Views — Plan Brief

> Full plan: `context/changes/receipt-list-detail/plan.md`

## What & Why

S-02 adds a date-range filter to the receipts list and a full detail view for each receipt (FR-008 + FR-009). The list built in S-01 shows every receipt with no way to narrow by date and no way to drill into line items — this change closes both gaps.

## Starting Point

`src/pages/receipts/index.astro` exists from S-01 with a static unfiltered list and no clickable rows. The `receipts` and `line_items` tables are fully populated and typed. No dynamic Astro routes exist yet.

## Desired End State

`/receipts` defaults to the current month, supports preset buttons (This month / Last month / Last 3 months) and a custom date form — all via URL params, no client JS needed. Each row links to `/receipts/{id}`, which shows the receipt image, shop/date/total, a status banner for non-done receipts, and a card list of every extracted line item with category badges.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Filter UI | Presets + custom date inputs | One-click common cases + arbitrary range | Plan |
| Filter state | URL query params (`?from=&to=`) | Shareable, works with back button, pure SSR | Plan |
| Image preview | Signed URL thumbnail → new tab | Lets users verify OCR output | Plan |
| Line items display | Card list (not table) | Mobile-friendly | Plan |
| Non-done receipt detail | Show metadata + status banner | Never show a blank page | Plan |
| Not found / wrong user | 404 response | RLS returns null for both cases — same guard | Plan |
| Null purchase_date handling | Always included in any range | Don't hide receipts with missing dates | Plan |

## Scope

**In scope:** Date-range filter on list, clickable rows, detail page (image + metadata + line items + status banner), 404 for missing IDs.

**Out of scope:** Editing line items, deleting receipts, pagination, real-time processing updates, category filtering.

## Architecture / Approach

Pure Astro SSR — no new React components, no new API routes. Phase 1 updates one existing file; Phase 2 creates one new dynamic route. Both pages use `createClient()` + Supabase queries in `.astro` frontmatter. The filter is a plain HTML `<form method="get">` — zero JavaScript. Preset buttons are server-rendered `<a>` tags with pre-computed date strings.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Filter + links | Filtered list with preset/custom date UI; rows link to detail | PostgREST `.or()` with nested `and()` for null-date handling |
| 2. Detail page | `/receipts/[id]` with image, metadata, line items, 404 | First dynamic route in codebase — verify param access pattern |

**Prerequisites:** F-01 ✓, S-01 ✓ (list page and upload pipeline already live)
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- The `.or("purchase_date.is.null,and(...)")` PostgREST syntax is assumed supported by the installed Supabase JS version — verify at implementation time; fall back to two separate queries if needed.
- Signed URL generation adds one Storage API call per detail page load — acceptable at v1 data volumes.

## Success Criteria (Summary)

- Filtering by date range narrows the receipt list correctly; null-date receipts always appear
- Clicking a receipt row opens the detail page with the image, all line items, and correct category badges
- A nonexistent or unauthorised receipt ID returns 404
