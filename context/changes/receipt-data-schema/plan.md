# Receipt Data Schema Implementation Plan

## Overview

Create the complete data foundation for ClearSpend: `receipts` and `line_items` tables with per-user RLS policies, a private Storage bucket for receipt images with user-isolated access, and the pgvector extension for future NL querying. End with committed TypeScript types so every downstream slice starts fully typed, and a seed file that lets S-02 be developed and tested before any real upload occurs.

## Current State Analysis

- Supabase client factory lives at `src/lib/supabase.ts` — cookie-based SSR, returns `SupabaseClient` (untyped)
- Auth routes are live (`src/pages/api/auth/`); session stored in cookies; middleware at `src/middleware.ts:12` guards `/dashboard`
- `supabase/config.toml` is present (project id: `10x-astro-starter`); `schema_paths = []` (empty)
- No `supabase/migrations/` directory exists; no domain tables; no Storage bucket configured; pgvector not enabled
- Remote Supabase project is live (credentials in `wrangler.jsonc`); local CLI stack assumed available via Docker

## Desired End State

After this plan:
- `supabase/migrations/20260527000000_receipt_schema.sql` is committed and clean
- `supabase db reset` applies the migration and seed without errors on a fresh local stack
- `receipts` and `line_items` tables exist in the local (and later remote) DB with all columns, constraints, indexes, and RLS enabled
- Storage bucket `receipts` (private) exists with path-prefix-based access policies
- pgvector extension is enabled
- `src/lib/database.types.ts` is committed and reflects the live schema
- `src/lib/supabase.ts` returns `SupabaseClient<Database>` — all table queries downstream will be fully typed
- `supabase/seed.sql` provides 3 sample receipts + 10 line items for a local test user, enabling S-02 UI development without needing S-01

### Key Discoveries

- `src/lib/supabase.ts` uses `createServerClient` from `@supabase/ssr` — adding `<Database>` generic is a one-line change to make the whole client typed
- `@supabase/supabase-js` v2.99.1 is installed; the `Database` generic is supported via the standard `createClient<Database>()` pattern
- `supabase/config.toml` has Storage enabled globally with a 50 MiB default file size limit; the per-bucket limit in the migration can be lower (10 MiB is appropriate for receipt photos)
- pgvector ships with Supabase local (PostgreSQL 17); `CREATE EXTENSION IF NOT EXISTS vector` is sufficient — no package install needed

## What We're NOT Doing

- No embedding column on `line_items` or `receipts` — the chunk strategy (one chunk per item vs. per receipt) is an open question deferred to S-03's planning session
- No `currency` column — PRD §Non-Goals explicitly excludes multi-currency; all amounts are single-currency
- No manual correction fields (e.g., `corrected_name`, `is_verified`) — best-effort extraction is a known v1 limitation (PRD FR-004 Socratic note)
- No `supabase migration new` shell wiring in the plan — the migration file is written directly
- No remote migration push in this plan — `supabase db push` to the remote project is a manual step the developer runs when ready; this plan covers local only

## Implementation Approach

Two phases, cleanly separated: Phase 1 is pure SQL (everything the DB needs to know), Phase 2 is TypeScript and tooling (everything the application code needs to consume the schema). Running `supabase db reset` at the start of Phase 2 is the bridge.

## Critical Implementation Details

**Storage bucket SQL**: Supabase Storage bucket creation is done via `INSERT INTO storage.buckets` — this is not standard PostgreSQL DDL. The storage policies use `storage.foldername(name)[1]` to extract the first folder segment from the object path (the user_id prefix). Both `storage.buckets` and `storage.foldername` are Supabase-specific and are only available when the Supabase stack is running.

**Seed user insertion**: `supabase/seed.sql` must insert a row directly into `auth.users` to satisfy the `user_id` FK on `receipts`. This requires populating specific auth schema fields (`instance_id`, `aud`, `role`, `encrypted_password` via `crypt()`). The `pgcrypto` extension (which provides `crypt` and `gen_salt`) is always enabled in the Supabase local stack.

---

## Phase 1: SQL Migration

### Overview

One migration file creates everything the database needs: pgvector extension, both domain tables with all columns and constraints, composite indexes for the list queries S-02 will run, an `updated_at` auto-trigger on receipts, RLS policies for both tables, the storage bucket, and storage access policies.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260527000000_receipt_schema.sql`

**Intent**: Bootstrap the entire data layer in a single migration. This file is the canonical source of schema truth for all downstream slices — get it right before S-01 writes live data, because any breaking change after that requires a migration on real user rows.

**Contract**: The file must execute in this order (dependency-driven): extension → tables → indexes → trigger → receipts RLS → line_items RLS → storage bucket → storage policies.

Schema:

```sql
-- receipts
id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
shop_name    text
purchase_date date
total_amount  numeric(10,2)
processing_status text   NOT NULL DEFAULT 'pending'
                         CHECK (processing_status IN ('pending','processing','done','failed'))
image_path   text        NOT NULL
created_at   timestamptz NOT NULL DEFAULT now()
updated_at   timestamptz NOT NULL DEFAULT now()

-- line_items
id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
receipt_id   uuid        NOT NULL REFERENCES receipts(id) ON DELETE CASCADE
name         text        NOT NULL
price        numeric(10,2) NOT NULL
category     text
position     integer     NOT NULL DEFAULT 0
created_at   timestamptz NOT NULL DEFAULT now()
```

Indexes: `receipts(user_id)`, `receipts(user_id, purchase_date DESC)`, `line_items(receipt_id)`.

Trigger: a `set_updated_at()` PL/pgSQL function that sets `NEW.updated_at = now()`, applied as `BEFORE UPDATE` on `receipts`.

RLS on `receipts`: enable RLS; four policies (SELECT/INSERT/UPDATE/DELETE) all using `user_id = auth.uid()`. UPDATE needs both `USING` and `WITH CHECK`.

RLS on `line_items`: enable RLS; four policies using `EXISTS (SELECT 1 FROM receipts WHERE receipts.id = line_items.receipt_id AND receipts.user_id = auth.uid())`.

Storage bucket:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts', 'receipts', false,
  10485760,   -- 10 MiB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif']
) ON CONFLICT (id) DO NOTHING;
```

Storage policies (SELECT, INSERT, DELETE on `storage.objects`):

```sql
-- path prefix enforces user isolation:
-- bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]
```

### Success Criteria

#### Automated Verification

- `supabase start` exits 0 (local stack healthy)
- `supabase db reset` exits 0 — migration applies cleanly with no errors
- `psql $LOCAL_DB_URL -c "\dt"` lists both `receipts` and `line_items`
- `psql $LOCAL_DB_URL -c "SELECT * FROM pg_extension WHERE extname = 'vector';"` returns one row
- `psql $LOCAL_DB_URL -c "SELECT * FROM storage.buckets WHERE id = 'receipts';"` returns one row

#### Manual Verification

- Open Supabase Studio at `http://localhost:54323` → Table Editor: confirm `receipts` and `line_items` columns match the contract above (including the `processing_status` check constraint and `position` column)
- Studio → Authentication → Policies: confirm RLS is enabled on both tables and all 8 policies are listed
- Studio → Storage: confirm the `receipts` bucket is listed as private with the 10 MiB limit
- Studio → Database → Extensions: confirm `vector` is active

**Implementation Note**: After Phase 1 automated verification passes, pause for manual Studio review before proceeding to Phase 2.

---

## Phase 2: TypeScript Integration and Seed Data

### Overview

Apply the migration to the running local stack, generate `database.types.ts` from the live schema, update the Supabase client to use the `Database` generic, and write a seed file that creates a test user plus sample receipts so S-02 can be developed without waiting for S-01.

### Changes Required

#### 1. TypeScript database types

**File**: `src/lib/database.types.ts` (generated, committed)

**Intent**: Provide the single source of typed DB shapes for the entire application. Every Supabase query in S-01, S-02, and S-03 will import from this file. Committing it means CI always type-checks against the current schema without needing a live DB.

**Contract**: Generated by running `supabase gen types typescript --local > src/lib/database.types.ts` while the local stack is running with the Phase 1 migration applied. The file exports a `Database` type with `public.Tables` entries for `receipts` and `line_items`, each with `Row`, `Insert`, and `Update` shapes.

#### 2. Supabase client — add Database generic

**File**: `src/lib/supabase.ts`

**Intent**: Make the existing client factory return a typed client so all subsequent `supabase.from('receipts')` calls in downstream slices receive inferred row types automatically.

**Contract**: Add `import type { Database } from './database.types'` at the top; change `createServerClient(` to `createServerClient<Database>(`. No other changes — the function signature and cookie handling stay identical.

#### 3. Seed data

**File**: `supabase/seed.sql`

**Intent**: Populate a local test user and three sample receipts (grocery, fuel, electronics) with realistic line items so S-02's list and detail UI can be built and verified against real-shaped data before any LLM integration exists.

**Contract**: The file must:
1. INSERT a test user into `auth.users` (id: `00000000-0000-0000-0000-000000000001`, email: `test@clearspend.dev`, password: `test123456`) using `crypt('test123456', gen_salt('bf'))` — wrap in `ON CONFLICT (id) DO NOTHING` so `supabase db reset` is idempotent.
2. INSERT three receipts with `processing_status = 'done'` for that user (shop names: Lidl / BP Fuel / MediaMarkt; dates spread across May 2026; realistic total_amount values).
3. INSERT 10 line items across the three receipts (4 grocery, 2 fuel, 4 electronics) with `position` values starting at 0 and incrementing per receipt.
4. All IDs are fixed UUIDs starting with `00000000-0000-0000-0000-0000000001xx` — deterministic so developers can reference them in ad-hoc queries.

### Success Criteria

#### Automated Verification

- `supabase db reset` exits 0 (migration + seed apply together without errors)
- `npm run typecheck` passes with zero errors after `database.types.ts` is committed and `supabase.ts` is updated
- `psql $LOCAL_DB_URL -c "SELECT COUNT(*) FROM receipts;"` returns `3`
- `psql $LOCAL_DB_URL -c "SELECT COUNT(*) FROM line_items;"` returns `10`

#### Manual Verification

- Open Studio → Table Editor → receipts: confirm 3 rows with correct shop names, dates, totals, and `processing_status = 'done'`
- Open Studio → Table Editor → line_items: confirm 10 rows with correct categories, non-null prices, and incrementing `position` per receipt
- Sign in to the local app (`npm run dev`) using `test@clearspend.dev` / `test123456` and confirm the session works (user is redirected to `/dashboard` after sign-in) — this verifies the seeded auth user is valid
- In a Supabase Studio SQL editor, run `SELECT * FROM receipts` as the anon role (no auth) and confirm 0 rows are returned — RLS is blocking unauthenticated reads

**Implementation Note**: After both automated and manual criteria pass, Phase 2 is complete. The foundation is ready for S-01 and S-02.

---

## Testing Strategy

### Automated Tests

No unit or integration tests are planned for this change — this is a DDL-only foundation. The automated verification steps above (migration applies, type-check passes, row counts match) are the test suite for F-01.

### Manual Testing Steps

1. `supabase start` — confirm Studio is accessible at `localhost:54323`
2. `supabase db reset` — confirm migration + seed apply cleanly in the console output
3. Studio: inspect each table's columns, constraints, and policies as described in the success criteria
4. `npm run dev` — sign in with the seed user and confirm auth works end-to-end through the existing dashboard

## Migration Notes

The remote Supabase project (credentials in `wrangler.jsonc`) does not yet have this schema. Once local testing passes:
- Run `supabase db push` to apply the migration to the remote project
- The seed data is local-only — do not seed the remote database

## References

- Roadmap F-01: `context/foundation/roadmap.md` §F-01
- PRD access control: `context/foundation/prd.md` §Access Control
- Supabase client: `src/lib/supabase.ts`
- Existing middleware: `src/middleware.ts:12`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: SQL Migration

#### Automated

- [x] 1.1 `supabase start` exits 0 (local stack healthy)
- [x] 1.2 `supabase db reset` exits 0 — migration applies without errors
- [x] 1.3 `\dt` lists `receipts` and `line_items`
- [x] 1.4 pgvector extension row confirmed in `pg_extension`
- [x] 1.5 `storage.buckets` row confirmed for `receipts` bucket

#### Manual

- [x] 1.6 Studio Table Editor: columns, constraints, and `processing_status` check match contract
- [x] 1.7 Studio Policies: RLS enabled on both tables; all 8 policies listed
- [x] 1.8 Studio Storage: `receipts` bucket listed as private with 10 MiB limit
- [x] 1.9 Studio Extensions: `vector` extension is active

### Phase 2: TypeScript Integration and Seed Data

#### Automated

- [x] 2.1 `supabase db reset` exits 0 (migration + seed apply together)
- [x] 2.2 `npm run typecheck` passes with zero errors
- [x] 2.3 `SELECT COUNT(*) FROM receipts` returns 3
- [x] 2.4 `SELECT COUNT(*) FROM line_items` returns 10

#### Manual

- [x] 2.5 Studio Table Editor: 3 receipts and 10 line items with correct data
- [x] 2.6 App sign-in with seed user (`test@clearspend.dev`) succeeds and reaches dashboard
- [x] 2.7 Anon-role SELECT on receipts returns 0 rows (RLS blocks unauthenticated reads)
