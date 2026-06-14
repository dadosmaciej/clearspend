<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete Receipt

- **Plan**: `context/changes/delete/plan.md`
- **Scope**: Full plan (all 3 phases)
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — No user_id equality filter on DELETE query

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/receipts/[id].ts:28`
- **Detail**: The DELETE query relies solely on Supabase RLS for ownership enforcement. `upload.ts` always passes `user_id` explicitly (lines 107–115) as defense-in-depth. If RLS is ever misconfigured, a service-role key is accidentally wired in, or a migration temporarily disables it, any authenticated user could delete any other user's receipt. The current code: `.delete().eq("id", id).select("image_path").single()` — no `.eq("user_id", userId)`.
- **Fix A ⭐ Recommended**: Add `.eq("user_id", context.locals.user.id)` to the delete chain.
  - Strength: Matches the explicit user_id guard in `upload.ts:109–113`; eliminates the risk class entirely with one chained call.
  - Tradeoff: Redundant when RLS works correctly, but harmless — Supabase evaluates both and the DB index on `receipts(user_id)` makes the extra filter near-free.
  - Confidence: HIGH — same pattern used throughout this project for writes.
  - Blind spot: None significant.
- **Fix B**: Document the RLS-only approach in a comment and accept the risk.
  - Strength: Keeps the query minimal.
  - Tradeoff: One undocumented assumption; any future RLS change silently becomes a privilege escalation.
  - Confidence: LOW — the rest of the codebase doesn't rely on RLS alone for writes.
  - Blind spot: Future developers won't know RLS is load-bearing here.
- **Decision**: PENDING

### F2 — Default export breaks named-export convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/receipts/DeleteReceiptButton.tsx:11`
- **Detail**: `DeleteReceiptButton` uses `export default function`. Both `UploadForm.tsx` and `QueryForm.tsx` use named exports (`export function UploadForm`, `export function QueryForm`). The import in `index.astro:5` reflects this inconsistency — `import DeleteReceiptButton from ...` vs `import { QueryForm } from ...` on the same page.
- **Fix**: Change to `export function DeleteReceiptButton(...)` and update the two import sites (`index.astro:5`, `[id].astro:4`) to use `{ DeleteReceiptButton }`.
- **Decision**: PENDING

### F3 — "Yes, delete" button unguarded during in-flight request

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: `src/components/receipts/DeleteReceiptButton.tsx:50`
- **Detail**: The "Yes, delete" button has no `disabled` prop. React's state batching means a rapid second click between the first click and the re-render that shows the `loading` state can dispatch a second `fetch`. The second request will get a 404 (receipt already deleted), which pushes the UI into the error state unnecessarily.
- **Fix**: Add `disabled={state === "loading"}` to the "Yes, delete" button (line 50).
- **Decision**: PENDING

### F4 — Storage remove error silently discarded

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/receipts/[id].ts:43`
- **Detail**: `await supabase.storage.from("receipts").remove([data.image_path])` discards the `{ error }` result. The no-console lint rule prevented the originally-planned `console.error` call, leaving storage failures completely invisible. The plan explicitly accepted orphaned images as an outcome, so this is not a correctness issue, but there is no signal when cleanup fails.
- **Fix**: Destructure the error and discard it with a comment: `const { error: _storageErr } = await supabase.storage.from("receipts").remove([data.image_path]); // non-fatal — orphaned images are acceptable`.
- **Decision**: PENDING

### F5 — PGRST116 covers RLS-blocked rows — undocumented

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/api/receipts/[id].ts:31–35`
- **Detail**: The `PGRST116` check correctly returns 404 for both non-existent receipts and receipts blocked by RLS (another user's receipt). Future maintainers might change this to a 403 for the RLS case without knowing the PGRST116 code covers both paths — accidentally leaking receipt ownership via the status code.
- **Fix**: Add a single comment: `// PGRST116 = zero rows — covers both "not found" and RLS-blocked (don't 403 here; it leaks ownership)`.
- **Decision**: PENDING
