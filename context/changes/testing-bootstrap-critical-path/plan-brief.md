# Testing Bootstrap — Critical-Path Coverage — Plan Brief

> Full plan: `context/changes/testing-bootstrap-critical-path/plan.md`
> Research: `context/changes/testing-bootstrap-critical-path/research.md`

## What & Why

Install Vitest from zero and prove the upload pipeline fails safely under every error mode — never silently, never leaving a receipt stuck at `'processing'`. This is Phase 1 of the phased test rollout (`context/foundation/test-plan.md` §3), covering Risks #1 and #5: the two highest-priority failure scenarios for the ClearSpend MVP.

## Starting Point

The project has no test runner, no test files, and no mocking infrastructure — `package.json` lists Vitest and MSW as absent. The upload route (`src/pages/api/receipts/upload.ts`) is fully implemented and reviewed, with one known gap: when the final `processing_status = 'done'` UPDATE fails, the receipt is stuck at `'processing'` rather than `'failed'` (while the API correctly returns 500).

## Desired End State

`npm test` runs 9 integration tests — 1 happy path and 8 failure scenarios — all passing against a local Supabase instance. Every failure scenario asserts both the HTTP response (correct status + `{ error }` body) and the actual `processing_status` in the DB. The S8 gap is closed by a one-line production fix applied before the tests run.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| DB verification strategy | Local Supabase via `supabase start` | Only real DB writes allow asserting actual `processing_status` state, not just that the right HTTP call was made | Research open question |
| OpenAI mock approach | `vi.mock('@/lib/llm')` at module scope | Zero deps, works at function-call level, clean per-test `mockRejectedValueOnce`/`mockResolvedValueOnce` | Research open question |
| S8 gap | Fix it + test | One-line fix closes Risk #5 completely; cost is trivial | Planning session |
| Happy path included | Yes | A passing happy-path test proves the test rig works before failure tests run | Planning session |
| Test file location | `src/pages/api/receipts/__tests__/` | Co-located with the route; easier to navigate when editing the route | Planning session |
| Vitest config | `getViteConfig()` from `astro/config` | Required for `@/` alias resolution and Astro module system; plain `defineConfig` breaks | Research / test plan §4 |

## Scope

**In scope:**
- Vitest install + config for Astro 6 + Cloudflare Workers
- `.env.test` template for local Supabase credentials
- One-line fix for `processing_status` gap in `upload.ts`
- 9 integration tests: 1 happy path + 8 failure scenarios (S1–S8)
- Test helpers: mock context factory, verification client, cleanup utility

**Out of scope:**
- E2e tests, access-control tests, NL-query tests (later phases)
- `backfill-embeddings` route tests (excluded per test plan §7)
- CI gate wiring (Phase 4)
- Code coverage reporting

## Architecture / Approach

Tests call the `POST` handler directly — no HTTP server. Each test builds a mock `APIContext` (multipart `Request` with a 1×1 JPEG, `locals.user.id` set to a test user ID), calls `POST(context)`, then asserts the response and DB state via a service-role verification client.

`@/lib/llm` is mocked at file scope; per-test overrides control what GPT-4o returns (valid JSON, invalid JSON, throw). `@/lib/supabase`'s `createClient` is mocked at file scope; for failure scenarios that need a real receipt INSERT (S3–S8), tests configure it to return a real local Supabase client with only the targeted operation overridden.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Bootstrap Vitest | `npm test` passes on a smoke test; runner configured for Astro 6 + Node env | `getViteConfig` import fails if Astro version is misaligned |
| 2. S8 gap fix | `processing_status = 'failed'` on final UPDATE error (one-line change) | Accidental scope creep into other error handlers |
| 3. Integration tests | 9 named tests passing; DB state verified after each | Supabase builder-chain mocking complexity for per-step failure injection |

**Prerequisites:** `supabase start` running locally; `.env.test` populated with values from `supabase status`  
**Estimated effort:** ~1–2 sessions (bootstrap is ~30 min; tests are the bulk)

## Open Risks & Assumptions

- **FK constraint on test user**: Tests S3–S8 create real receipt rows — a test user must exist in `auth.users`. The setup file creates one via the admin API; if the local Supabase instance is reset, the setup creates it fresh.
- **Supabase builder-chain mocking**: The Supabase JS SDK uses method chaining (`from().insert().select().single()`). Overriding a single step (e.g., only `line_items` INSERT) requires either a Proxy wrapper or targeted spying — the implementer chooses the pattern; the plan specifies the contract.
- **`import.meta.env` availability**: If `.env.test` is absent, `createClient` returns `null` and all tests fail at the Supabase guard — misleadingly indistinguishable from a real test failure without reading the error message.

## Success Criteria (Summary)

- `npm test` exits 0 with 9 tests passing and descriptive names visible via `--reporter=verbose`
- After the run, `SELECT * FROM receipts` in Supabase Studio returns no test rows
- Commenting out the Phase 2 fix turns exactly S8 red; all other tests remain green
