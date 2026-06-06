# Testing Bootstrap — Critical-Path Coverage Implementation Plan

## Overview

Install Vitest from scratch, apply a one-line production fix for the S8 `processing_status` gap, then prove all 9 upload pipeline scenarios (1 happy path + 8 failure modes) against a local Supabase instance with OpenAI mocked at module scope. Covers Risks #1 and #5 from `context/foundation/test-plan.md`.

## Current State Analysis

The project has no test runner, no test files, and no mocking infrastructure (`package.json` has no Vitest, Jest, or MSW). The upload route at `src/pages/api/receipts/upload.ts` has 13 pipeline steps guarded individually — no outer try/catch. Research confirmed all post-INSERT steps (signed URL, LLM call, line-items validation, line-items INSERT) correctly set `processing_status = 'failed'` except the final-status-update step (line 207–211), where a failure leaves the receipt stuck at `'processing'` while correctly returning 500.

**Key Discoveries:**

- `getViteConfig()` from `astro/config` is the Astro 6 required integration; plain `defineConfig` will not resolve `@/` aliases correctly — `context/foundation/test-plan.md` §4
- Cloudflare Workers adapter: tests must run with `environment: 'node'`; Astro 6 removed jsdom/happy-dom for server routes — `test-plan.md` §4
- `supabase` CLI is already in devDependencies — `supabase start` provides a local instance with migrations applied
- `receipts.user_id` FK-references `auth.users(id)` ON DELETE CASCADE — tests that create real receipt rows need a real auth user — `supabase/migrations/20260527000000_receipt_schema.sql`
- `import.meta.env` provides env vars to the route; Vite reads `.env.test` during Vitest runs
- The route imports `createClient` from `@/lib/supabase` and `openai` from `@/lib/llm` — both are module-mockable via `vi.mock`

## Desired End State

`npm test` runs 9 integration tests against the local Supabase instance. Each test injects a single pipeline failure, asserts the HTTP response shape (status + `{ error }` body), and verifies the actual `processing_status` value in the DB. All tests pass. `context/foundation/test-plan.md` §3 Phase 1 status advances to `complete`.

### Key Discoveries:

- `src/pages/api/receipts/upload.ts:44` — auth guard; `upload.ts:207` — the S8 gap
- `supabase/migrations/20260527000000_receipt_schema.sql` — CHECK constraint: `processing_status IN ('pending', 'processing', 'done', 'failed')`
- `src/lib/supabase.ts` — `createClient` can return `null`; all three routes guard it
- `src/lib/llm.ts` — `openai` singleton; mocked at module scope for LLM scenarios
- Eight distinct failure injection points mapped in `context/changes/testing-bootstrap-critical-path/research.md`

## What We're NOT Doing

- E2e tests (Playwright) — not scheduled until after Phase 4 gates are wired
- Access-control and IDOR tests (Risks #2, #4) — Phase 2 of the test rollout
- NL query and signed-URL tests (Risks #3, #6) — Phase 3
- `backfill-embeddings` route tests — excluded per test plan §7 (maintenance endpoint)
- CI gate wiring — Phase 4
- Code coverage reporting

## Implementation Approach

Three sequential phases. Phase 1 bootstraps the runner and verifies it with a smoke test. Phase 2 applies the one-line S8 production fix. Phase 3 writes all 9 integration tests. Each phase has independent success criteria.

Tests call the `POST` handler directly — no HTTP server is spun up. Each test constructs a mock `APIContext` (request with multipart body, `locals.user` with a test user ID), calls `POST(context)`, asserts the response, then uses a service-role Supabase client to verify DB state and clean up.

`@/lib/llm` is mocked at file scope via `vi.mock`; individual tests configure the mock's return value or throw. For Supabase, `@/lib/supabase`'s `createClient` is mocked at file scope; each test configures it to return a real local client (for most operations) with the specific failing operation overridden.

## Critical Implementation Details

**Test user and FK constraint**: `receipts.user_id` FK-references `auth.users(id)`. Tests for scenarios S3–S8 (which cause a real receipt INSERT to succeed before the injected failure) need a real user in local Supabase's `auth.users` table. The test setup file creates this user via the Supabase admin API (service-role key) on `beforeAll` and exports the user's UUID as `TEST_USER_ID`. Without this, receipt INSERT calls will fail with a foreign-key violation, making all failure-mode tests pass for the wrong reason.

**Supabase partial-failure injection**: For S3–S8, the receipt INSERT must succeed in the real DB (so that the `processing_status = 'failed'` update can be verified). This means `createClient` must return a real local Supabase client for the INSERT step, with only the targeted later operation overridden. A complete mock that never writes to the DB makes DB state verification meaningless. The recommended pattern: mock `@/lib/supabase` at file scope with `vi.fn()`, then in each test configure `vi.mocked(createClient).mockReturnValue(partialClient)`, where `partialClient` is the real local client wrapped to fail at one operation.

**`import.meta.env` in Vitest**: The route reads `SUPABASE_URL` and `SUPABASE_KEY` via `import.meta.env`. Vitest populates these from Vite's `.env.test` file. If `.env.test` is absent or `SUPABASE_URL`/`SUPABASE_KEY` are empty, `createClient` returns `null` and all tests fail at the Supabase client guard — misleadingly, they report 500 errors rather than missing-config errors.

---

## Phase 1: Bootstrap Vitest

### Overview

Install Vitest, configure it for Astro 6 + Cloudflare Workers constraints, add `npm test` and `test:watch` scripts, provide an env template, and verify with a trivial smoke test.

### Changes Required

#### 1. Install Vitest

**File**: `package.json` (devDependencies)

**Intent**: Add Vitest as the project's first and only test runner. The test plan mandates ≥3.2; the project's pinned Vite 7.3.2 satisfies the requirement.

**Contract**: `"vitest": ">=3.2.0"` in `devDependencies`. Install via `npm install --save-dev vitest`.

#### 2. Add test scripts

**File**: `package.json` (scripts)

**Intent**: Expose single-run (`npm test`) and watch-mode (`npm run test:watch`) as first-class project commands.

**Contract**: Add `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`.

#### 3. Create Vitest config

**File**: `vitest.config.ts` (new, project root)

**Intent**: Wire Vitest to Astro's Vite config so that `@/` aliases, Astro plugins, and module resolution all work correctly in tests. Set the environment to `node` (required for Cloudflare Workers route code).

**Contract**: Use `getViteConfig` from `'astro/config'` (not `defineConfig`). Set `environment: 'node'`, `setupFiles: ['./src/test-setup.ts']`, and `include: ['src/**/__tests__/**/*.test.ts']`.

```ts
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

This snippet is the non-negotiable contract: `getViteConfig` (not `defineConfig`) is the Astro 6 integration point; without it the `@/` alias and Astro module resolution break.

#### 4. Create test setup file

**File**: `src/test-setup.ts` (new)

**Intent**: Global test lifecycle entry point, executed once before any test file. Minimal at this stage — Phase 3 adds test-user creation here.

**Contract**: File must exist (referenced in `vitest.config.ts`). Empty or a single `// Global test setup` comment is sufficient for Phase 1.

#### 5. Create env template and update gitignore

**Files**: `.env.test.example` (new), `.gitignore` (update)

**Intent**: Tell developers which env vars are needed for tests without committing real credentials. The route reads `SUPABASE_URL` and `SUPABASE_KEY` from `import.meta.env`; tests additionally need `SUPABASE_SERVICE_ROLE_KEY` for the verification client.

**Contract**: `.env.test.example` contains these three vars with placeholder values:
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon-key-from-supabase-status>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-status>
```

Add `.env.test` to `.gitignore`. Developers copy `.env.test.example` → `.env.test` and fill in values from `supabase status` output.

#### 6. Create smoke test

**File**: `src/__tests__/smoke.test.ts` (new)

**Intent**: Prove that Vitest finds and runs test files before the real integration work begins. A broken runner that silently skips tests would otherwise give a false green.

**Contract**: One `describe` with one `it` block containing `expect(1 + 1).toBe(2)`. No project imports, no DB. Must produce one passing test on `npm test`.

### Success Criteria

#### Automated Verification

- `npm install` completes; `node_modules/vitest` directory exists
- `npm test` exits 0; output reports 1 passing test
- `npm run lint` passes on all new files
- `npx astro check` passes with no TypeScript errors

#### Manual Verification

- Terminal shows Vitest output with "1 passed" after `npm test`
- `.env.test` is not tracked by git (`git status` does not list it)

**Implementation Note**: Pause here until `npm test` shows 1 passing smoke test. Do not proceed to Phase 2 until this is confirmed.

---

## Phase 2: Fix S8 processing_status Gap

### Overview

A one-line production fix: when the final receipt `UPDATE` (setting `processing_status = 'done'`) fails, the route correctly returns 500 but leaves the receipt stuck at `'processing'`. Adding a `processing_status = 'failed'` update before the error return closes this gap and satisfies Risk #5.

### Changes Required

#### 1. Update finalUpdateError handler

**File**: `src/pages/api/receipts/upload.ts`, the `if (finalUpdateError)` block (line ~207)

**Intent**: Make the final-status-update failure handler consistent with every other post-INSERT failure handler: update `processing_status` to `'failed'` before returning the error response. Currently it returns 500 but leaves the row at `'processing'`.

**Contract**: Before the existing `return new Response(JSON.stringify({ error: "Failed to finalize receipt" }), ...)`, add `await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId)`. The resulting block should be structurally identical to the `if (signedError)` handler at line 131–136.

### Success Criteria

#### Automated Verification

- `npx astro check` passes with no new TypeScript errors
- `npm run lint` passes

#### Manual Verification

- Code diff shows exactly one new `await supabase.from("receipts").update(...)` line inside the `if (finalUpdateError)` block

**Implementation Note**: This is a one-line change. Pause and confirm via code review before Phase 3 begins.

---

## Phase 3: Integration Tests — Upload Pipeline Failure Modes

### Overview

Write the test utilities and all 9 integration tests. Each test is independent: it injects a single pipeline failure, calls `POST`, asserts the HTTP response, verifies `processing_status` in the real local DB, and cleans up.

### Changes Required

#### 1. Expand test setup file

**File**: `src/test-setup.ts`

**Intent**: Ensure a test user exists in local Supabase's `auth.users` before any test runs, satisfying the `receipts.user_id` FK constraint for tests that create real receipt rows.

**Contract**: In a `beforeAll`: read `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` from `import.meta.env`; use the Supabase admin API (`supabase.auth.admin.createUser` or `getUserByEmail` + `createUser`) to create or retrieve a test user with a fixed email (`test-upload@clearspend.test`). Export the resulting user UUID as `TEST_USER_ID` — used by helpers in change 2.

#### 2. Create test helpers

**File**: `src/pages/api/receipts/__tests__/helpers.ts` (new)

**Intent**: Centralise the boilerplate for building mock contexts, creating test requests, reading DB state, and cleaning up — so that each test is readable as scenario + assertion.

**Contract**: Export:

- **`makeRequest(formData: FormData): Request`** — wraps FormData into a `Request` for `http://localhost/api/receipts/upload` (method `'POST'`). The `Content-Type: multipart/form-data` boundary is set automatically by the `FormData` + `Request` constructors.

- **`makeContext(request: Request, userId?: string): APIContext`** — returns a minimal object satisfying the properties the route actually reads: `{ request, locals: { user: { id: userId ?? TEST_USER_ID } }, cookies: {} as AstroCookies }`. The `cookies` field is only passed to the mocked `createClient` and does not need to be a real `AstroCookies` instance.

- **`makeImageFormData(): FormData`** — returns a `FormData` with key `'image'` containing a `File` wrapping a minimal valid JPEG (a hardcoded 1×1 JPEG, ≤200 bytes). Sufficient to pass the route's MIME type (`image/jpeg`) and 10 MiB size guards.

- **`makeVerificationClient(): SupabaseClient`** — creates a Supabase client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Used only in tests to read receipt rows and clean up. This client bypasses RLS and can read any user's rows.

- **`cleanupReceipt(receiptId: string): Promise<void>`** — deletes the receipt row by `id` using `makeVerificationClient()`. The `line_items` FK has `ON DELETE CASCADE`, so only the parent row needs to be deleted.

#### 3. Write integration tests

**File**: `src/pages/api/receipts/__tests__/upload.test.ts` (new)

**Intent**: Nine tests covering the complete failure-mode surface of the upload pipeline. Every test asserts both the HTTP response and the actual DB state — never the response alone.

**Contract**: 

At file scope, establish two module mocks:
- `vi.mock('@/lib/llm', () => ({ openai: { chat: { completions: { create: vi.fn() } }, embeddings: { create: vi.fn() } } }))` — default happy-path LLM mock; per-test overrides use `vi.mocked(openai.chat.completions.create).mockX(...)`.
- `vi.mock('@/lib/supabase', () => ({ createClient: vi.fn() }))` — per-test, configure `vi.mocked(createClient).mockReturnValue(...)` to return the appropriate client (real or partially-overridden).

In `afterEach`: if `capturedReceiptId` was set during the test, call `cleanupReceipt(capturedReceiptId)` and reset it.

Nine tests (each wraps `POST(makeContext(makeRequest(makeImageFormData())))`):

| ID | Label | Failure injection | Response assertion | DB assertion |
|---|---|---|---|---|
| HP | Happy path | LLM mock resolves with valid extraction JSON | 200; body has `receiptId`, `lineItemCount` | `processing_status = 'done'` |
| S1 | Storage upload fails | `createClient` mock: `storage.from().upload` returns `{ error: ... }` | 500; `{ error: 'Storage upload failed' }` | No receipt row for TEST_USER_ID |
| S2 | Receipt INSERT fails | `createClient` mock: `from('receipts').insert` returns `{ error: ... }` | 500; `{ error: 'Failed to create receipt record' }` | No receipt row for TEST_USER_ID |
| S3 | Signed URL fails | `createClient` mock: real client with `storage.from().createSignedUrl` overridden | 500; `{ error: 'Failed to generate image URL' }` | `processing_status = 'failed'` |
| S4 | LLM call throws | `openai.chat.completions.create` rejects with `new Error('network error')` | 500; `{ error: 'LLM extraction failed' }` | `processing_status = 'failed'` |
| S5 | LLM returns invalid JSON | `openai.chat.completions.create` resolves with `content: 'not valid json'` | 500; `{ error: 'LLM extraction failed' }` | `processing_status = 'failed'` |
| S6 | Invalid line item | LLM resolves with item containing `price: -1` (negative price fails validation) | 500; `{ error: 'LLM extraction failed' }` | `processing_status = 'failed'` |
| S7 | line_items INSERT fails | `createClient` mock: real client with `from('line_items').insert` overridden | 500; `{ error: 'Failed to save line items' }` | `processing_status = 'failed'` |
| S8 | Final UPDATE fails | `createClient` mock: real client with `from('receipts').update` (done path) overridden | 500; `{ error: 'Failed to finalize receipt' }` | `processing_status = 'failed'` (requires Phase 2 fix) |

**Invariant** enforced across all failure tests: response must never be 200. The happy-path test acts as a rig sanity check — if the test infrastructure is broken, it fails first.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; output reports 9 tests passing, 0 failing, 0 skipped
- `npm run lint` passes on `helpers.ts` and `upload.test.ts`
- `npx astro check` passes on the new test files

#### Manual Verification

- `supabase start` is running; `supabase status` shows the local instance
- `.env.test` is populated with values from `supabase status`
- `npm test -- --reporter=verbose` shows all 9 test names (not just counts)
- After the test run, `SELECT * FROM receipts` in Supabase Studio returns no test rows
- Commenting out the Phase 2 fix turns S8 red (expected `'failed'`, got `'processing'`); all other tests remain green

**Implementation Note**: Once all 9 tests pass, update `context/foundation/test-plan.md` §3 Phase 1 status from `change opened` to `complete`.

---

## Testing Strategy

### Integration Tests

All 9 tests in `src/pages/api/receipts/__tests__/upload.test.ts`. Each test is independent: own setup, single failure injection, assertion of HTTP status + body + DB state, and cleanup.

### Manual Testing Steps

1. `supabase start` (confirm with `supabase status`)
2. Copy `.env.test.example` → `.env.test`; fill in `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status`
3. `npm test -- --reporter=verbose` — expect 9 passing with descriptive names
4. Open Supabase Studio → Table Editor → receipts — confirm no leftover rows
5. Break S8 (comment out the Phase 2 update line) — `npm test` should show S8 red, others green

## References

- Research: `context/changes/testing-bootstrap-critical-path/research.md`
- Test plan: `context/foundation/test-plan.md`
- Upload route: `src/pages/api/receipts/upload.ts`
- DB schema migration: `supabase/migrations/20260527000000_receipt_schema.sql`
- Upload pipeline plan: `context/changes/receipt-upload-extraction/plan.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bootstrap Vitest

#### Automated

- [x] 1.1 npm install completes; node_modules/vitest exists — e77905e
- [x] 1.2 npm test exits 0; 1 passing (smoke test) — e77905e
- [x] 1.3 npm run lint passes — e77905e
- [x] 1.4 npx astro check passes — e77905e

#### Manual

- [x] 1.5 Terminal shows "1 passed" after npm test — e77905e
- [x] 1.6 .env.test is not tracked by git — e77905e

### Phase 2: Fix S8 processing_status Gap

#### Automated

- [x] 2.1 npx astro check passes with no new errors — 936e39d
- [x] 2.2 npm run lint passes — 936e39d

#### Manual

- [x] 2.3 Code diff shows one new await supabase.from("receipts").update(...) line in the finalUpdateError block — 936e39d

### Phase 3: Integration Tests — Upload Pipeline Failure Modes

#### Automated

- [x] 3.1 npm test exits 0; 9 passing, 0 failing — f5c9278
- [x] 3.2 npm run lint passes on helpers.ts and upload.test.ts — f5c9278
- [x] 3.3 npx astro check passes on test files — f5c9278

#### Manual

- [x] 3.4 supabase start running; supabase status confirms local instance — f5c9278
- [x] 3.5 npm test --reporter=verbose shows 9 named tests passing — f5c9278
- [x] 3.6 No leftover receipts rows in Supabase Studio after test run — f5c9278
- [x] 3.7 Commenting out Phase 2 fix turns S8 red; all other tests remain green — f5c9278
