# Delete Receipt — Plan Brief

> Full plan: `context/changes/delete/plan.md`
> Research: `context/changes/delete/research.md`

## What & Why

Add a delete button to the receipts list (one per row) and to the receipt detail
page (below line items). Users currently have no way to remove a receipt once
uploaded. This is a standard CRUD gap that needs closing before the app is
production-ready.

## Starting Point

No delete API, no delete UI exists today. The database is fully ready (RLS DELETE
policy on `receipts`, ON DELETE CASCADE on `line_items`) — no migration needed.
Both target pages are pure SSR Astro with no React components in the list/detail
sections. The list page rows are full `<a>` tags that must be restructured to
accommodate a sibling delete control.

## Desired End State

A Delete button appears on every receipt row in the list and below the line items
on the detail page. Clicking it shows an inline "Are you sure?" confirm state;
confirming permanently removes the receipt (DB row + Storage image) and navigates
to `/receipts`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Confirmation UX | React island with inline confirm state | Styled confirm without a modal; `client:only="react"` required per lessons.md since component uses `window.location.href` | Plan |
| After-delete navigation | Full page reload to `/receipts` | Consistent with the SSR-first, form-less architecture; no client-side state to manage | Plan |
| Storage cleanup failure | Non-fatal — log and return 200 | Receipt is already deleted from DB; consistent with how `upload.ts` treats embedding failures | Plan |
| API method | `DELETE /api/receipts/:id` | RESTful; fetch from React island supports any method | Research |
| Line_items cleanup | DB CASCADE — no app code needed | `receipt_id` FK already has `ON DELETE CASCADE` in the migration | Research |
| Migration needed | No | RLS DELETE policies already exist for both `receipts` and `line_items` | Research |

## Scope

**In scope:**
- `DELETE /api/receipts/[id]` API route
- `DeleteReceiptButton` React component (idle / confirming / loading / error states)
- List page row restructure + delete island per row
- Detail page delete island below line items
- Storage image cleanup (non-fatal)

**Out of scope:**
- Bulk delete
- Soft delete / undo / trash
- Optimistic row removal on the list (full reload chosen)
- Any change to `line_items` directly

## Architecture / Approach

One new API route (`src/pages/api/receipts/[id].ts`) handles the `DELETE` method:
auth check → Supabase delete with `.select("image_path")` (RLS enforces ownership,
`PGRST116` = 404) → storage remove (non-fatal) → 200 JSON. One new React component
(`DeleteReceiptButton.tsx`) manages the confirm/loading/error state machine and
calls the API, then redirects. The component is mounted with `client:only="react"`
on both pages. The list page row markup is restructured so the `<a>` shrinks to
`flex-1` and the delete island sits outside it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. API Route | Secure DELETE endpoint with storage cleanup | `PGRST116` handling for RLS-blocked deletes |
| 2. DeleteReceiptButton | React island with full confirm/loading/error UX | State machine edge cases (rapid clicks, network errors) |
| 3. Wire into pages | Delete button live on list + detail; row restructure | List row restructure must not break existing hover/link behavior |

**Prerequisites:** Local Supabase running (`supabase start`), dev server running (`npm run dev`)
**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- Storage orphan accumulation if cleanup fails repeatedly — acceptable at current scale, can be addressed with a future cleanup job.
- Many React islands on the list page (one per row) — fine at current data volumes; worth revisiting if pagination is ever added.

## Success Criteria (Summary)

- Delete button on list and detail pages triggers confirm → deletes receipt + image → navigates to `/receipts`
- Wrong-user and unauthenticated delete attempts are rejected at the API layer
- Existing list date-filter and detail page behavior are unaffected
