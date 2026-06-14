---
date: 2026-06-14T20:00:00+02:00
researcher: claude-sonnet-4-6
git_commit: bb6ad2eccc755b27a14ac9c57f8432849d95a708
branch: main
repository: clearspend
topic: "Delete receipt — pages, components, API routes, and database layer"
tags: [research, codebase, receipts, delete, line_items, supabase, api]
status: complete
last_updated: 2026-06-14
last_updated_by: claude-sonnet-4-6
---

# Research: Delete Receipt

**Date**: 2026-06-14T20:00:00+02:00
**Researcher**: claude-sonnet-4-6
**Git Commit**: bb6ad2eccc755b27a14ac9c57f8432849d95a708
**Branch**: main
**Repository**: clearspend

## Research Question

Research how receipts are listed and displayed. I need to add a delete button to
the receipts list page and to the receipt detail page (end of line items). Find
the relevant pages, components, API routes, and database layer for receipts.

## Summary

There is no delete functionality anywhere in the codebase today. The database
already has all the plumbing needed (RLS DELETE policy, CASCADE delete on
`line_items`). What's missing is: (1) a `DELETE /api/receipts/[id]` route, and
(2) delete UI on two pages. One structural complication: the receipt list rows
are currently entire `<a>` tags — the delete button cannot live inside the link,
so the row markup needs restructuring. A critical non-obvious requirement:
deleting a receipt from Supabase does **not** remove the image from Storage;
the API route must explicitly call `supabase.storage.from("receipts").remove()`
using `receipt.image_path`.

## Detailed Findings

### Receipts List Page (`src/pages/receipts/index.astro`)

- **GitHub**: https://github.com/dadosmaciej/clearspend/blob/bb6ad2eccc755b27a14ac9c57f8432849d95a708/src/pages/receipts/index.astro
- SSR-only (no React components in the list itself). Data fetched server-side
  via Supabase at the top of the frontmatter block.
- Each receipt row is rendered as:
  ```astro
  <li>
    <a href="/receipts/{id}" class="border-border bg-card hover:bg-card/80 flex items-center justify-between rounded-lg border px-4 py-3 transition-colors">
      <div class="flex flex-col gap-0.5">
        <span class="text-foreground font-medium">{shop_name}</span>
        <span class="text-muted-foreground text-sm">{date}</span>
      </div>
      <div class="flex items-center gap-3">
        <span>€{amount}</span>
        <span>{status badge}</span>
        <span aria-hidden="true">→</span>
      </div>
    </a>
  </li>
  ```
- **Problem for delete**: the entire `<li>` content is one `<a>` tag. A delete
  `<button>` or `<form>` cannot be nested inside `<a>` (invalid HTML). The row
  must be restructured so the link covers only the left/info section and the
  delete control sits as a sibling to the right.

### Receipt Detail Page (`src/pages/receipts/[id].astro`)

- **GitHub**: https://github.com/dadosmaciej/clearspend/blob/bb6ad2eccc755b27a14ac9c57f8432849d95a708/src/pages/receipts/%5Bid%5D.astro
- SSR-only, no React components at all — pure Astro/HTML.
- Line items section (lines 112–140):
  ```astro
  <h2>Line items ({lineItems.length})</h2>
  <ul class="flex flex-col gap-2">
    {lineItems.map(item => (
      <li class="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3">
        <span class="text-foreground font-medium">{item.name}</span>
        <div class="flex items-center gap-3">
          {category badge}
          <span>€{item.price.toFixed(2)}</span>
        </div>
      </li>
    ))}
  </ul>
  ```
- Delete button for the receipt belongs **after** the line items list (per spec).
- A plain `<form method="POST" action="/api/receipts/{id}/delete">` with a submit
  button works here without any JS — or a React island if a confirmation dialog
  is needed.

### Existing API Routes for Receipts

All routes live under `src/pages/api/receipts/`:

| File | Method | Purpose |
|------|--------|---------|
| `upload.ts` | POST | Upload image, run LLM extraction, insert receipt + line_items |
| `query.ts` | POST | NL search with vector similarity + date/category filtering |
| `backfill-embeddings.ts` | POST | Batch-embed receipts missing vector |

**No DELETE endpoint exists.**

#### Consistent auth pattern across all routes:
```typescript
if (!context.locals.user) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
```

#### Supabase client creation (every route):
```typescript
import { createClient } from "@/lib/supabase";
const supabase = createClient(context.request.headers, context.cookies);
```

Returns `null` when env vars are missing — must guard against this.

#### Standard JSON error response shape:
```typescript
new Response(JSON.stringify({ error: "message" }), {
  status: 4xx | 5xx,
  headers: { "Content-Type": "application/json" },
})
```

### Database Layer

#### Schema — `receipts` table
```sql
CREATE TABLE receipts (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name         text,
  purchase_date     date,
  total_amount      numeric(10, 2),
  processing_status text        NOT NULL DEFAULT 'pending'
                                CHECK (processing_status IN ('pending','processing','done','failed')),
  image_path        text        NOT NULL,   -- ← Storage path, needed for cleanup
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

#### Schema — `line_items` table
```sql
CREATE TABLE line_items (
  id          uuid           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id  uuid           NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name        text           NOT NULL,
  price       numeric(10, 2) NOT NULL,
  category    text,
  position    integer        NOT NULL DEFAULT 0,
  created_at  timestamptz    NOT NULL DEFAULT now()
);
```

#### RLS policies already in place
- `receipts`: SELECT / INSERT / UPDATE / **DELETE** own — `user_id = auth.uid()`
- `line_items`: SELECT / INSERT / UPDATE / **DELETE** own — via EXISTS subquery to parent receipt

**Both DELETE policies already exist in the migration.** No new migration is needed.

#### CASCADE behaviour
- Deleting a receipt row → `line_items` rows auto-deleted by DB (ON DELETE CASCADE).
- Deleting a user → receipts auto-deleted (ON DELETE CASCADE from `auth.users`).
- **Storage images are NOT cascaded** — they must be removed manually.

#### Storage
- Bucket: `receipts` (private)
- Path pattern: `{user_id}/{uuid}.{ext}` — stored in `receipts.image_path`
- Deletion API: `supabase.storage.from("receipts").remove([imagePath])`
- This pattern is already used in `upload.ts` line ~118 for cleanup after failed INSERT.

### Lessons Learned Prior (from `context/foundation/lessons.md`)

> **Use `client:only="react"` for browser-API React islands.** If the delete
> button needs `window.confirm` or any browser API, it must use
> `client:only="react"`, not `client:load`.

## Code References

- `src/pages/receipts/index.astro` — receipt list page, row structure at lines 126–149
- `src/pages/receipts/[id].astro` — detail page, line items section at lines 112–140; `receiptId` at line 6; `image_path` fetched via `select("*, line_items(*)")` at line 15
- `src/pages/api/receipts/upload.ts` — auth check pattern (lines 44–48); Supabase client (line 51); storage remove example (line ~118)
- `src/lib/supabase.ts` — `createClient(headers, cookies)` helper
- `src/middleware.ts` — `context.locals.user` population
- `supabase/migrations/20260527000000_receipt_schema.sql` — full DDL, RLS policies, CASCADE rules
- `src/lib/database.types.ts` — TypeScript types for `receipts` and `line_items`

## Architecture Insights

### Delete operation sequence for the API route
```
1. Auth check — context.locals.user
2. Parse receipt ID from URL params
3. Fetch receipt (need image_path) — SELECT with user_id guard (or rely on RLS)
4. Delete receipt row — Supabase DELETE .eq("id", id).eq("user_id", userId)
   └─ DB CASCADE deletes all line_items automatically
5. Delete storage image — supabase.storage.from("receipts").remove([image_path])
   └─ Non-fatal if this fails (receipt is already gone from DB)
6. Return 200 JSON or redirect
```

### Row restructure needed on list page

Current (invalid for adding a button):
```
<li>
  <a href="...">  ← entire row is the link
    [info] [amount] [badge] [→]
  </a>
</li>
```

Required restructure:
```
<li class="flex items-center ...">
  <a href="..." class="flex-1 ...">   ← link covers left portion only
    [info]
  </a>
  <div class="flex items-center gap-3">
    [amount] [badge] [delete button/form]
  </div>
</li>
```

### Confirmation dialog decision

- **No JS (simpler)**: Plain `<form method="POST">` submit — no confirmation, just
  immediate delete. Browser back button restores the list.
- **With JS (better UX)**: Small React island with `client:only="react"` wrapping
  a confirm step before `fetch("/api/receipts/{id}", { method: "DELETE" })`.
  Per lessons.md, must use `client:only="react"` if `window.confirm` is used.

For the list page a React island per row would mean many islands. A single shared
React component receiving the receipt ID as a prop is cleaner.

## Historical Context (from prior changes)

- `context/changes/receipt-data-schema/plan.md` — established table DDL including
  the `ON DELETE CASCADE` on `line_items.receipt_id` and RLS DELETE policies.
  No image cleanup was needed then (no delete UI was planned).
- `context/changes/receipt-upload-extraction/reviews/impl-review.md` — critical
  finding that taught the project to always clean up storage on failed inserts
  (`supabase.storage.from("receipts").remove([storagePath])`). The delete route
  must apply the same discipline in reverse.
- `context/changes/receipt-list-detail/plan.md` — established the full-row `<a>`
  link pattern on the list page. This will need to be revised when adding the
  delete button.

## Open Questions

1. **Confirmation dialog?** Plain form submit (no JS) or React island with confirm
   step? Affects whether a new component file is needed.
2. **After delete on detail page** — redirect to `/receipts` list? (Assumed yes.)
3. **After delete on list page** — full page reload (form POST + redirect) or
   client-side row removal (fetch + DOM update)? The current list is SSR so a
   redirect/reload is the simplest path.
4. **Storage delete failure handling** — treat as fatal (roll back DB delete) or
   non-fatal (log and continue)? Precedent in upload.ts treats storage cleanup
   as fire-and-forget.
