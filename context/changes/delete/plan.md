# Delete Receipt Implementation Plan

## Overview

Add the ability for a user to delete a receipt from two entry points: a per-row
delete button on the receipts list page, and a delete button below the line items
on the receipt detail page. Deleting a receipt removes the DB row (line_items
cascade automatically), then cleans up the associated Storage image (non-fatal if
the storage step fails).

## Current State Analysis

- No delete UI or API exists anywhere in the codebase.
- The database is fully ready: `receipts` has an RLS DELETE policy
  (`user_id = auth.uid()`), and `line_items` has `ON DELETE CASCADE` on
  `receipt_id` — no migration needed.
- Storage images are **not** cascade-deleted; `receipts.image_path` holds the
  bucket path and must be passed to `supabase.storage.from("receipts").remove()`.
- Both target pages (`index.astro`, `[id].astro`) are pure SSR Astro with no
  existing React components in the list/detail sections.
- The list page rows are currently full `<a>` tags — a delete control cannot nest
  inside `<a>` (invalid HTML), so the row markup must be restructured.

## Desired End State

- A **Delete** button appears on every row of the receipts list and below the line
  items on the detail page.
- Clicking **Delete** shows an inline "Are you sure? / Yes, delete / Cancel" confirm
  state without a page reload.
- Confirming fires a `DELETE /api/receipts/:id` request. On success the browser
  navigates to `/receipts`.
- On error a short error message appears inline; the user can dismiss and retry.
- Receipts belonging to other users cannot be deleted (RLS + server-side user check).
- After deletion, the receipt row and all its line_items are gone from the DB, and
  the image is removed from Storage (orphaned images are acceptable if storage
  cleanup fails).

### Key Discoveries

- `supabase.storage.from("receipts").remove([imagePath])` is the cleanup call;
  the same pattern already exists in `upload.ts` (~line 118) for failed-insert cleanup.
- Astro supports `export const DELETE: APIRoute` for HTTP DELETE on API routes.
- Deleting via `.delete().eq("id", id).select("image_path").single()` returns the
  deleted row's `image_path` and a `PGRST116` error (no rows) when RLS blocks the
  delete — a clean 404 path.
- `lessons.md`: any React island that touches browser APIs must use
  `client:only="react"` (not `client:load`). The confirmation component uses
  `window.location.href` — this applies.
- The list page row restructure must move the border/background styling from the
  `<a>` to the `<li>` and shrink the `<a>` to `flex-1` so the delete button sits
  outside the link.

## What We're NOT Doing

- No bulk delete.
- No soft delete / trash / undo — deletion is immediate and permanent.
- No migration — RLS DELETE policies already exist.
- No change to `line_items` directly — CASCADE handles it.
- No pagination change on the list page.
- The list page does not do optimistic DOM removal — after delete it reloads `/receipts`.

## Implementation Approach

Three phases, each independently verifiable:

1. **API route** — new file, no UI dependencies.
2. **DeleteReceiptButton component** — new React island, no page dependency.
3. **Wire into pages** — import component into both Astro pages; restructure list rows.

The React component owns the full UX state machine (idle → confirming → loading →
success/error) and is the only JS on these otherwise SSR pages. The API route
follows the exact auth + Supabase client pattern from `upload.ts`.

## Critical Implementation Details

**Storage cleanup ordering**: delete the DB row first (so RLS can verify ownership),
capture `image_path` from the returned row, then call storage remove. If the DB
delete fails, do not attempt storage cleanup. If the storage delete fails after a
successful DB delete, log the error and return 200 — the receipt is gone from the
user's perspective.

**List row restructure**: the `hover:bg-card/80` transition currently lives on the
`<a>` tag. After restructuring, the `<a>` shrinks to `flex-1` inside the `<li>`.
The hover should remain on the `<a>` for the link area only — the delete button
area has its own hover state.

---

## Phase 1: API Route

### Overview

Create `src/pages/api/receipts/[id].ts` exporting a `DELETE` handler. It
authenticates the caller, deletes the receipt (relying on RLS for ownership), and
cleans up the Storage image. Returns JSON on success and error.

### Changes Required

#### 1. API route file

**File**: `src/pages/api/receipts/[id].ts`

**Intent**: New file. Export a `DELETE` Astro API route handler that: (1) checks
`context.locals.user`, (2) creates the Supabase client (with null-guard for missing
env), (3) parses `context.params.id`, (4) issues `.delete().eq("id", id).select("image_path").single()`
against the `receipts` table (RLS enforces ownership — a non-owned receipt returns
a `PGRST116` "no rows" error, treated as 404), (5) calls
`supabase.storage.from("receipts").remove([imagePath])` and logs but does not
propagate any error, (6) returns `{ success: true }` with status 200.

**Contract**: `DELETE /api/receipts/:id` → `200 { success: true }` | `401` |
`404` | `500`. No other HTTP methods are handled (Astro returns 405 automatically).
Response body is always `application/json`.

### Success Criteria

#### Automated Verification

- TypeScript type-check passes: `npm run typecheck` (or `astro check`)
- Lint passes: `npm run lint`

#### Manual Verification

- `DELETE /api/receipts/{own-receipt-id}` with a valid session → 200 `{ success: true }`; receipt row and its line_items are gone from the DB; Storage image is removed.
- `DELETE /api/receipts/{other-users-receipt-id}` → 404 (RLS blocks).
- `DELETE /api/receipts/{nonexistent-id}` → 404.
- `DELETE /api/receipts/{id}` with no session → 401.

**Implementation note**: pause here and confirm all manual checks pass before moving to Phase 2.

---

## Phase 2: DeleteReceiptButton Component

### Overview

Create `src/components/receipts/DeleteReceiptButton.tsx` — a React island that
manages the full delete UX: idle → confirming → loading → redirect on success, or
error with dismiss. Used with `client:only="react"` on both pages.

### Changes Required

#### 1. Component file

**File**: `src/components/receipts/DeleteReceiptButton.tsx`

**Intent**: New file. The component accepts `receiptId: string` as its only prop.
Internal state machine:

- **idle** — renders a "Delete" button. On click → `confirming`.
- **confirming** — renders "Are you sure?" text with a "Yes, delete" button and a
  "Cancel" button. "Yes, delete" → `loading`. "Cancel" → `idle`.
- **loading** — both buttons disabled, shows "Deleting…" text.
- **success** — `fetch(\`/api/receipts/${receiptId}\`, { method: "DELETE" })` returned
  ok → `window.location.href = "/receipts"` (no dedicated success render state needed).
- **error** — fetch returned non-ok or threw. Renders the error message with a
  "Dismiss" button → `idle`.

Styling should follow the app's destructive-action pattern: the primary delete /
confirm button uses red/danger coloring; cancel is muted; loading state uses opacity
or disabled styling consistent with other interactive elements in the app.

**Contract**: Props `{ receiptId: string }`. No other props. Internally uses
`useState` for the state machine and `fetch` for the API call. Must be used with
`client:only="react"` — it references `window.location.href`.

### Success Criteria

#### Automated Verification

- TypeScript type-check passes: `npm run typecheck`
- Lint passes: `npm run lint`

#### Manual Verification

- Component renders a "Delete" button in idle state.
- Clicking "Delete" shows the confirm state with "Yes, delete" and "Cancel".
- "Cancel" returns to idle — no API call made.
- "Yes, delete" shows loading state, then navigates to `/receipts` on API success.
- If the API returns an error, the error message is displayed with a "Dismiss" button.
- "Dismiss" returns to idle.

**Implementation note**: test this in isolation on the detail page (Phase 3) before verifying on the list page.

---

## Phase 3: Wire Into Both Pages

### Overview

Import `DeleteReceiptButton` into the list and detail pages. The list page also
requires a row markup restructure (full-`<a>` → `<li>` container + `<a flex-1>` +
delete island).

### Changes Required

#### 1. Receipts list page — row restructure + delete button

**File**: `src/pages/receipts/index.astro`

**Intent**: Import `DeleteReceiptButton`. Restructure each `<li>` so the `<a>`
is `flex-1` (covering shop name, date, amount, status badge, arrow) and the delete
button sits as a sibling to the right of the link, inside the `<li>`. The `<li>`
itself becomes the styled container (border, background, rounded corners, flex row).
Mount `<DeleteReceiptButton client:only="react" receiptId={r.id} />` in the right
section of each row.

**Contract**: The `<li>` outer element takes over the `border-border bg-card rounded-lg border flex items-center` styling previously on the `<a>`. The `<a>` keeps `hover:bg-card/80 transition-colors` and becomes `flex-1`. The delete island sits in a small right-padding container outside the `<a>`.

#### 2. Receipt detail page — delete button below line items

**File**: `src/pages/receipts/[id].astro`

**Intent**: Import `DeleteReceiptButton`. After the closing `</ul>` of the line
items list, add a delete button section. Mount
`<DeleteReceiptButton client:only="react" receiptId={receiptId} />` with appropriate
top margin to separate it from the line items.

**Contract**: The `receiptId` variable is already in scope at line 6 of the file.
No additional data fetching is needed.

### Success Criteria

#### Automated Verification

- TypeScript type-check passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- **List page**: each receipt row shows a Delete button on the right; the row link
  still navigates to the detail page when clicked anywhere on the left/main area.
- **List page**: confirm flow works per row; on confirm the receipt disappears and
  the list reloads at `/receipts`.
- **Detail page**: Delete button appears below the line items section.
- **Detail page**: confirm flow works; on confirm redirects to `/receipts`.
- **Both pages**: cancelling the confirm leaves the receipt intact.
- **Both pages**: deleting a receipt via the UI leaves no orphaned rows in `line_items`
  (verify via Supabase Studio or `supabase db console`).
- **Regression**: existing list filtering (date range presets, custom date form) still
  works after the row restructure.

---

## Testing Strategy

### Manual Testing Steps

1. Sign in as `test@clearspend.dev` (seed user) on local dev.
2. Upload a test receipt to use as a delete target.
3. On the list page: confirm the delete button appears, run the confirm flow, verify
   the row is gone after reload.
4. Upload another receipt, navigate to its detail page, delete from there, verify
   redirect to `/receipts`.
5. In Supabase Studio (localhost:54323), confirm no orphaned `line_items` rows.
6. Check the `receipts` Storage bucket — the image file should be removed.
7. Attempt to `DELETE /api/receipts/{seed-receipt-id}` as an unauthenticated request
   (curl or Postman) — expect 401.

## References

- Research: `context/changes/delete/research.md`
- Auth pattern: `src/pages/api/receipts/upload.ts:44–48`
- Supabase client helper: `src/lib/supabase.ts`
- Storage remove precedent: `src/pages/api/receipts/upload.ts:~118`
- Row structure to restructure: `src/pages/receipts/index.astro:126–149`
- Line items section to append after: `src/pages/receipts/[id].astro:112–140`
- Lessons: `context/foundation/lessons.md` (client:only="react" rule)

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API Route

#### Automated

- [x] 1.1 TypeScript type-check passes — dd10bb8
- [x] 1.2 Lint passes — dd10bb8

#### Manual

- [x] 1.3 DELETE own receipt → 200, row + line_items gone, image removed from Storage — dd10bb8
- [x] 1.4 DELETE other user's receipt → 404 — dd10bb8
- [x] 1.5 DELETE non-existent id → 404 — dd10bb8
- [x] 1.6 DELETE without session → 401 — dd10bb8

### Phase 2: DeleteReceiptButton Component

#### Automated

- [x] 2.1 TypeScript type-check passes
- [x] 2.2 Lint passes

#### Manual

- [ ] 2.3 Idle state renders Delete button
- [ ] 2.4 Confirm state renders Yes/Cancel
- [ ] 2.5 Cancel returns to idle with no API call
- [ ] 2.6 Confirm triggers loading state then redirects on success
- [ ] 2.7 API error shows error message with Dismiss
- [ ] 2.8 Dismiss returns to idle

### Phase 3: Wire Into Both Pages

#### Automated

- [ ] 3.1 TypeScript type-check passes
- [ ] 3.2 Lint passes
- [ ] 3.3 Build passes

#### Manual

- [ ] 3.4 List page — Delete button visible per row, link area still navigates
- [ ] 3.5 List page — confirm flow deletes and reloads list
- [ ] 3.6 Detail page — Delete button below line items
- [ ] 3.7 Detail page — confirm flow deletes and redirects to /receipts
- [ ] 3.8 Cancel leaves receipt intact on both pages
- [ ] 3.9 No orphaned line_items after delete (verify in DB)
- [ ] 3.10 Storage image removed after delete
- [ ] 3.11 Regression: date filter still works after row restructure
