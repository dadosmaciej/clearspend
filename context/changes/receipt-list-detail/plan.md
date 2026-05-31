# S-02: Receipt List and Detail Views Implementation Plan

## Overview

Extend the existing `/receipts` list page with a date-range filter and make each row click through to a full detail page at `/receipts/[id]`. No new infrastructure — pure Astro SSR pages using the existing Supabase client and database schema.

## Current State Analysis

- `src/pages/receipts/index.astro` already exists (built in S-01) — shows an unfiltered list of all user receipts, ordered by `created_at` DESC. No clickable rows, no date filter.
- `receipts` rows have `purchase_date date | null` and `created_at timestamptz`. The filter targets `purchase_date`; receipts with a null `purchase_date` are always included regardless of the selected range.
- `line_items` rows have `receipt_id`, `name`, `price`, `category`, `position` — sufficient for the detail view. No schema changes needed.
- No dynamic route (`[id].astro`) exists yet in the codebase — this will be the first.
- Supabase Storage bucket `receipts` is private; images need a signed URL for display.
- Middleware at `src/middleware.ts:4` already protects `/receipts` and all sub-paths.

## Desired End State

- `/receipts?from=YYYY-MM-DD&to=YYYY-MM-DD` — list filtered to the given date range, defaulting to the current month when params are absent.
- Filter UI: three preset `<a>` buttons (This month / Last month / Last 3 months) computed server-side + a plain HTML `<form method="get">` with two `<input type="date">` fields for custom ranges. No client-side JS required.
- Each receipt row is a clickable link to `/receipts/{id}`.
- `/receipts/{id}` — detail page showing: back link, shop name, purchase date, total, processing status banner, receipt image thumbnail (signed URL, opens full-size in a new tab), and a card list of all line items (name, category badge, price).
- Receipts with `processing_status ≠ 'done'` show a status banner but still render whatever metadata was saved.
- Navigating to an ID that doesn't exist or belongs to another user returns a 404 response.

## What We're NOT Doing

- Editing or correcting extracted line items (S-03 / future).
- Deleting receipts.
- Pagination on the list (data volume is small in v1).
- Real-time status polling for processing receipts.
- Category-based filtering on the list.

## Implementation Approach

Two phases, each a single file change. Phase 1 updates the existing list page (filter + links). Phase 2 creates the new detail page. No new components, no new API routes — all data access via server-side Supabase queries in the `.astro` frontmatter.

## Critical Implementation Details

- **Date filter query**: `purchase_date` can be null. Use `.or("purchase_date.is.null,and(purchase_date.gte.${from},purchase_date.lte.${to})")` so null-date receipts always appear. PostgREST supports nested `and()` inside `.or()`.
- **Active preset detection**: compare the current `from`/`to` params against each preset's computed values to highlight the active button. Use string comparison (`from === thisMonthFrom && to === thisMonthTo`).
- **Detail page 404**: Supabase RLS means a query for a receipt that belongs to another user returns `null` data (not an error). The same `if (!receipt)` guard handles both "not found" and "wrong user" cases cleanly.
- **Signed URL expiry**: generate a 300-second (5-minute) signed URL for the image — long enough to not expire while the user reads the detail page, short enough to be meaningless if the URL leaks.

---

## Phase 1: Date-range filter and clickable list rows

### Overview

Update `src/pages/receipts/index.astro` to: read `from`/`to` URL params (defaulting to the current month), apply them to the Supabase query, render preset filter buttons and a custom date form, and wrap each receipt row in a link to its detail page.

### Changes Required

#### 1. Update receipts list page

**File**: `src/pages/receipts/index.astro`

**Intent**: Transform the static unfiltered list into a date-filtered, click-through list. The entire change lives in one file — no new components.

**Contract**:

Frontmatter additions:
- Compute today's date and derive three preset ranges (this month / last month / last 3 months) as `YYYY-MM-DD` strings using `new Date()` arithmetic.
- Read `from` and `to` from `Astro.url.searchParams`; default to the current-month range when either is absent.
- Apply the filter to the Supabase query: `.or(`purchase_date.is.null,and(purchase_date.gte.${from},purchase_date.lte.${to})`)` chained before `.order(...)`.

Filter UI (above the receipt list, below the heading row):
- Three `<a>` tags linking to `/receipts?from=...&to=...` with the preset dates embedded. Apply a distinct `bg-purple-600 text-white` class when the current params match a preset; default to `bg-neutral-700 text-neutral-300` otherwise.
- A `<form method="get" action="/receipts">` with two `<input type="date" name="from|to">` fields pre-filled with the current `from`/`to` values, and a submit button.

List row change: wrap the `<li>` content in `<a href={`/receipts/${r.id}`} class="...">` so the entire row is clickable. Add a `→` chevron at the far right to signal navigability.

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Default visit to `/receipts` (no params) shows only current-month receipts (based on `purchase_date`); receipts with null `purchase_date` also appear
- "Last month" preset button navigates to `/receipts?from=...&to=...` and shows last month's receipts
- Custom date form: entering a date range and submitting filters the list correctly
- The active preset button is visually highlighted
- Each receipt row is clickable and navigates to `/receipts/{id}`
- Receipts with null `purchase_date` appear in all filter ranges

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Receipt detail page

### Overview

Create `src/pages/receipts/[id].astro`. Fetches the receipt and its line items in one query, generates a signed URL for the image, and renders the detail view. Returns 404 for missing or unauthorised receipt IDs.

### Changes Required

#### 1. Create receipt detail page

**File**: `src/pages/receipts/[id].astro` (new)

**Intent**: First dynamic route in the codebase. Shows everything extracted from one receipt: image, metadata, and all line items as a card list.

**Contract**:

Frontmatter:
- `const { id } = Astro.params;`
- Query: `supabase.from("receipts").select("*, line_items(*)").eq("id", id).single()`. RLS ensures another user's receipt returns null data.
- If `!receipt`: `return new Response("Receipt not found", { status: 404 });`
- Generate signed URL: `supabase.storage.from("receipts").createSignedUrl(receipt.image_path, 300)`. If this fails, set `imageUrl = null` — image is optional.
- Sort `receipt.line_items` by `position` ascending before rendering.

Page structure:
- `<a href="/receipts">← Back to receipts</a>` at the top.
- Header section: shop name (fallback "Unknown shop"), purchase date (fallback "Date unknown"), total amount (`€{total.toFixed(2)}` when non-null).
- Status banner when `processing_status !== 'done'`:
  - `processing`: yellow banner — "Extraction in progress — check back shortly."
  - `failed`: red banner — "Extraction failed. The image was saved but no items could be read."
  - `pending`: neutral banner — "Queued for processing."
- Image block (when `imageUrl` is non-null): `<a href={imageUrl} target="_blank" rel="noopener noreferrer"><img src={imageUrl} alt="Receipt" /></a>` with `max-w-xs` constraint.
- Line items section (when `line_items.length > 0`):
  - Heading "Line items ({count})"
  - One card per item: item name on the left, category badge in the middle (same color scheme as status badges), price right-aligned (`€{price.toFixed(2)}`).
  - Category badge colors: food → green, fuel → yellow, electronics → blue, household/health/clothing/transport/entertainment → neutral, other → gray.
- Empty line items (done receipt with zero items): paragraph "No line items were extracted from this receipt."

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Navigate to `/receipts/{valid-id}` → detail page renders with image, metadata, and line items
- Category badges display with correct colors per category
- Image thumbnail links open full-size in a new tab
- Navigate to `/receipts/nonexistent-id` → 404 response
- A receipt with `processing_status = 'failed'` shows the red status banner
- "← Back to receipts" link returns to the list and preserves the last filter (link should include current params if practical; otherwise plain `/receipts`)

**Implementation Note**: After automated verification passes, pause for manual confirmation before closing S-02.

---

## Testing Strategy

### Automated

- `npx astro check` — TypeScript correctness after each phase
- `npm run lint` — ESLint passes on all modified/new files

### Manual Testing Steps (End-to-End)

1. `npm run dev`
2. Sign in and navigate to `/receipts`
3. Confirm default view shows current-month receipts
4. Click each preset — confirm list updates and active button is highlighted
5. Use custom date form — confirm arbitrary range works
6. Click a receipt row — confirm navigation to `/receipts/{id}`
7. On detail page: verify image thumbnail, all line items visible with category badges, back link works
8. Navigate to `/receipts/00000000-0000-0000-0000-000000000000` — confirm 404

## References

- Roadmap S-02: `context/foundation/roadmap.md` §S-02
- PRD FR-008, FR-009: `context/foundation/prd.md`
- Existing list page: `src/pages/receipts/index.astro`
- Database types: `src/lib/database.types.ts`
- Supabase client: `src/lib/supabase.ts`
- Layout: `src/layouts/Layout.astro`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Date-range filter and clickable list rows

#### Automated

- [x] 1.1 TypeScript build passes: npx astro check
- [x] 1.2 Linting passes: npm run lint

#### Manual

- [x] 1.3 Default /receipts shows current-month receipts; null purchase_date receipts also appear
- [x] 1.4 Preset buttons navigate and filter correctly; active button is highlighted
- [x] 1.5 Custom date form filters correctly
- [x] 1.6 Each receipt row is clickable and navigates to /receipts/{id}

### Phase 2: Receipt detail page

#### Automated

- [x] 2.1 TypeScript build passes: npx astro check
- [x] 2.2 Linting passes: npm run lint

#### Manual

- [x] 2.3 Detail page renders with image, metadata, and line items for a valid receipt
- [x] 2.4 Category badges show correct colors
- [x] 2.5 Image thumbnail opens full-size in new tab
- [x] 2.6 Navigating to a nonexistent ID returns 404
- [x] 2.7 Failed receipt shows red status banner
- [x] 2.8 Back link returns to receipts list
