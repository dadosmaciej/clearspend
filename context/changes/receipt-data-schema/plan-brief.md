# Receipt Data Schema — Plan Brief

> Full plan: `context/changes/receipt-data-schema/plan.md`

## What & Why

ClearSpend has auth but no data layer — no tables, no storage, no type safety. F-01 lays the foundation that every downstream slice depends on: `receipts` and `line_items` tables, per-user row-level security, a private Storage bucket for receipt images, and the pgvector extension for future NL querying. It ships TypeScript types and seed data so S-01 and S-02 can start immediately.

## Starting Point

`supabase/config.toml` is present and the Supabase client is wired (`src/lib/supabase.ts`), but `schema_paths = []` — no migrations folder, no domain tables, no storage bucket, no extensions. The client returns an untyped `SupabaseClient`.

## Desired End State

A developer can run `supabase db reset` and get a fully structured local database: `receipts` + `line_items` with RLS, a `receipts` Storage bucket with user-isolated access, pgvector enabled, and 3 sample receipts with 10 line items ready for the S-02 list UI. `src/lib/supabase.ts` returns `SupabaseClient<Database>` — every subsequent table query is typed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Receipt lifecycle state | `processing_status` column in F-01 | S-01 needs this on day one; adding it later means migrating live data | Plan |
| pgvector scope | Extension only, no embedding column | Chunk strategy (per-item vs per-receipt) is an open question deferred to S-03 planning | Plan (roadmap note) |
| Storage path | `{user_id}/{receipt_id}.ext` in `receipts` bucket | Path prefix = user boundary; storage RLS policy enforces isolation via `foldername()[1]` | Plan |
| TypeScript types | Generate + commit `src/lib/database.types.ts` in F-01 | S-01 and S-02 start fully typed with zero untyped `any` risk | Plan |
| Seed data | `supabase/seed.sql` with test user + 3 receipts | S-02 list/detail UI can be built and tested before S-01's LLM pipeline exists | Plan |
| Receipt total | `total_amount` stored on `receipts` | LLM may extract a printed total that differs from sum of extracted items (partial extraction) | Plan |
| Line item order | `position integer NOT NULL DEFAULT 0` | Preserves receipt order explicitly; removal later = migration | Plan |
| Currency | None (single-currency) | PRD §Non-Goals: multi-currency is explicitly out of scope for v1 | PRD |

## Scope

**In scope:**
- `supabase/migrations/20260527000000_receipt_schema.sql` — all DDL in one file
- `receipts` and `line_items` tables with full column set, constraints, indexes, `updated_at` trigger
- RLS on both tables (4 policies each)
- Storage bucket `receipts` (private, 10 MiB limit) with SELECT/INSERT/DELETE policies
- pgvector extension enabled
- `src/lib/database.types.ts` generated and committed
- `src/lib/supabase.ts` updated to `SupabaseClient<Database>`
- `supabase/seed.sql` — test user + 3 receipts + 10 line items

**Out of scope:**
- Embedding column on any table (S-03)
- `supabase db push` to the remote project (manual step after local testing passes)
- Remote seed data
- Any API routes or UI components (S-01, S-02)

## Architecture / Approach

One migration file covers everything SQL-side in dependency order: extension → tables → indexes → trigger → receipts RLS → line_items RLS → storage bucket → storage policies. Phase 2 runs the migration locally, generates types, updates the one-line client change, and writes the seed. The RLS strategy for `line_items` uses an `EXISTS` join to `receipts` to keep the schema normalized (no denormalized `user_id` on line_items).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. SQL Migration | Complete DB schema + RLS + storage bucket + pgvector in one clean migration file | Storage bucket SQL is Supabase-specific (`storage.buckets` INSERT + `foldername()` policies) — not standard PostgreSQL |
| 2. TypeScript Integration + Seed | Typed Supabase client, committed `database.types.ts`, seed data for local development | Seed inserts directly into `auth.users` (non-obvious required fields for the Supabase auth schema) |

**Prerequisites:** Docker running locally (for `supabase start`)
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- Docker must be available for local `supabase start`; if not, migration must be applied directly to the remote project via `supabase db push` (skipping local verification)
- The `storage.foldername()` function and `storage.buckets` table are Supabase-specific — the migration will fail if run against a plain PostgreSQL instance

## Success Criteria (Summary)

- `supabase db reset` applies migration + seed cleanly; Studio shows correct tables, policies, storage bucket, and extension
- `npm run typecheck` passes after `database.types.ts` is committed and `supabase.ts` is updated
- Signing in with the seed user (`test@clearspend.dev`) reaches the dashboard; an unauthenticated SELECT on `receipts` returns 0 rows
