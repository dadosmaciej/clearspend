---
date: 2026-06-03T00:00:00+00:00
researcher: user
git_commit: f95c0777f7d4c406a9b23c40a2aacf01712b0d2a
branch: main
repository: clearspend
topic: "Risk #1 — Upload pipeline fails partway: data lost silently or stuck at 'processing'"
tags: [research, upload-pipeline, error-handling, processing-status, integration-tests]
status: complete
last_updated: 2026-06-03
last_updated_by: user
---

# Research: Risk #1 — Upload pipeline silent failure modes

**Date**: 2026-06-03  
**Researcher**: user  
**Git Commit**: f95c0777f7d4c406a9b23c40a2aacf01712b0d2a  
**Branch**: main  
**Repository**: clearspend

---

## Research Question

Ground Risk #1 from `context/foundation/test-plan.md`:

> Receipt processing pipeline fails partway — data is lost silently; user sees no error or receives a silent empty result instead of an explicit failure with a retry option.

Specifically: map every pipeline step in the upload route, identify which have individual catch blocks vs. a shared top-level handler, and determine what the error response body contains and what DB state is left behind for each failure mode.

---

## Summary

The upload route at [`src/pages/api/receipts/upload.ts`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts) has **no outer try/catch**. Every step has an independent inline guard. No silent 200 with empty data exists anywhere in the failure paths.

**Protection is mostly solid**: steps 3–7 (the post-INSERT, pre-success steps) all set `processing_status = 'failed'` and return an explicit 500. The one identified gap is the **final status update step**: if `update({ processing_status: "done" })` fails, the receipt stays stuck at `'processing'` (not `'failed'`) while the API correctly returns 500. This gap satisfies Risk #1's "explicit error" requirement but violates Risk #5's "never stuck at processing" requirement — it is the primary cross-over point between the two risks.

**Eight integration test scenarios** follow directly from this map. Seven validate the existing protection; one (S8) documents and stress-tests the gap.

---

## Detailed Findings

### 1. Route entry point and auth gate

File: [`src/pages/api/receipts/upload.ts:43–56`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L43)

- `export const POST: APIRoute` is the single exported handler. No outer try/catch wraps it.
- Auth guard at line 44: `if (!context.locals.user)` → 401 `{ error: "Unauthorized" }`.
- Supabase client guard at line 52: `if (!supabase)` → 500 `{ error: "Database not configured" }`.
- Neither pre-INSERT guard can leave an orphaned receipt row — no row exists yet at these checks.

### 2. Pre-INSERT validation steps (lines 60–105)

These steps fire before any `receipts` row is created. No `processing_status` update is possible or needed on failure.

| Line | Step | Guard style | Response on failure | DB side-effect |
|---|---|---|---|---|
| 60–75 | Form parse + image field present | try/catch | 400 `image field is required` or `Invalid multipart body` | None |
| 77–81 | MIME type validation | inline `if` | 400 `Unsupported image type` | None |
| 84–88 | File size guard (10 MiB) | inline `if` | 413 `File too large (max 10 MB)` | None |
| 96–104 | Supabase Storage upload | inline `if (storageError)` | 500 `Storage upload failed` | None |

### 3. DB receipt INSERT (lines 107–123)

File: [`src/pages/api/receipts/upload.ts:107`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L107)

- Inserts `{ user_id, image_path, processing_status: "processing" }`.
- On `insertError`: fire-and-forget storage cleanup (`void supabase.storage.from("receipts").remove([storagePath])`), then returns 500 `Failed to create receipt record`.
- No `processing_status` update is needed — the INSERT failed, so no row exists.
- **Note**: storage cleanup is unawaited (`void`) — if the cleanup itself fails, the uploaded file is orphaned silently. This is a known trade-off; it does not affect `processing_status`.

### 4. Signed URL generation (lines 127–137) — PROTECTED

File: [`src/pages/api/receipts/upload.ts:131`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L131)

```typescript
if (signedError) {
  await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
  return new Response(JSON.stringify({ error: "Failed to generate image URL" }), { status: 500, ... });
}
```

- `processing_status` set to `'failed'` ✓ (awaited)
- Explicit 500 returned ✓
- No silent 200 ✓

### 5. GPT-4o LLM call (lines 140–166) — PROTECTED

File: [`src/pages/api/receipts/upload.ts:140`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L140)

- The entire LLM call + JSON parse is wrapped in its own `try { ... } catch { ... }`.
- Covers: OpenAI SDK throw, network error, and `JSON.parse()` failure.
- On any catch:

```typescript
} catch {
  await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
  return new Response(JSON.stringify({ error: "LLM extraction failed" }), { status: 500, ... });
}
```

- `processing_status` set to `'failed'` ✓ (awaited)
- Explicit 500 returned ✓

### 6. Line items validation (lines 168–178) — PROTECTED

File: [`src/pages/api/receipts/upload.ts:172`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L172)

- Validates each item against `ALLOWED_CATEGORIES` and non-negative price.
- On invalid item:

```typescript
if (invalidItem) {
  await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
  return new Response(JSON.stringify({ error: "LLM extraction failed" }), { status: 500, ... });
}
```

- `processing_status` set to `'failed'` ✓ (awaited)
- Response body reuses `"LLM extraction failed"` — same message as step 5.

### 7. Line items INSERT (lines 179–194) — PROTECTED

File: [`src/pages/api/receipts/upload.ts:188`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L188)

```typescript
if (lineItemsError) {
  await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
  return new Response(JSON.stringify({ error: "Failed to save line items" }), { status: 500, ... });
}
```

- `processing_status` set to `'failed'` ✓ (awaited)
- Explicit 500 returned ✓

### 8. Final status UPDATE — GAP (lines 197–212)

File: [`src/pages/api/receipts/upload.ts:207`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L207)

```typescript
if (finalUpdateError) {
  return new Response(JSON.stringify({ error: "Failed to finalize receipt" }), { status: 500, ... });
}
```

- API returns 500 ✓ (not a silent 200)
- But **`processing_status` is NOT updated to `'failed'`** ✗ — receipt stays at `'processing'`
- This is the primary cross-over with **Risk #5**: receipt is not silently lost, but it is stuck indefinitely.
- A test at this injection point will verify both criteria: explicit error returned AND receipt stays at `'processing'` (a confirmed gap to document).

### 9. Embedding generation (lines 215–231) — INTENTIONALLY SILENT

File: [`src/pages/api/receipts/upload.ts:215`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts#L215)

```typescript
} catch {
  // Silently continue — receipt data is already saved; backfill can recover this.
}
```

- Intentional design — embedding failure does not fail the upload.
- `processing_status` is NOT updated on embedding failure — also intentional.
- Tests **must not** assert `processing_status = 'failed'` for embedding failures.
- The `backfill-embeddings.ts` route exists specifically to recover these cases.

---

## Complete Pipeline Step Map

| # | Step | Lines | Guard | On error: DB state | On error: response |
|---|---|---|---|---|---|
| 1 | Auth check | 44–49 | inline `if` | None (no row) | 401 `Unauthorized` |
| 2 | Supabase client | 51–57 | inline `if` | None (no row) | 500 `Database not configured` |
| 3 | Form parse + image field | 60–75 | try/catch | None (no row) | 400 `image field is required` / `Invalid multipart body` |
| 4 | MIME type | 77–81 | inline `if` | None (no row) | 400 `Unsupported image type` |
| 5 | File size | 84–88 | inline `if` | None (no row) | 413 `File too large (max 10 MB)` |
| 6 | Storage upload | 96–104 | inline `if (storageError)` | None (no row) | 500 `Storage upload failed` |
| 7 | Receipt INSERT | 107–123 | inline `if (insertError)` | None (no row); void cleanup | 500 `Failed to create receipt record` |
| 8 | Signed URL | 127–137 | inline `if (signedError)` | `processing_status = 'failed'` | 500 `Failed to generate image URL` |
| 9 | GPT-4o call + JSON parse | 140–166 | try/catch | `processing_status = 'failed'` | 500 `LLM extraction failed` |
| 10 | Line items validation | 168–178 | inline `if (invalidItem)` | `processing_status = 'failed'` | 500 `LLM extraction failed` |
| 11 | Line items INSERT | 179–194 | inline `if (lineItemsError)` | `processing_status = 'failed'` | 500 `Failed to save line items` |
| 12 | Final status UPDATE | 197–212 | inline `if (finalUpdateError)` | **`processing_status = 'processing'` ← GAP** | 500 `Failed to finalize receipt` |
| 13 | Embedding generation | 215–231 | try/catch (intentional silent) | No change (intentional) | None (200 still returned) |
| — | **SUCCESS** | 233–245 | — | `processing_status = 'done'` | 200 `{ receiptId, shopName, purchaseDate, totalAmount, lineItemCount }` |

---

## Integration Test Scenarios (direct output for /10x-plan)

Eight scenarios derived from the step map above. Each injects a failure at a specific step and verifies both DB state and HTTP response.

| Scenario | Injection | Expected `processing_status` | Expected HTTP | Notes |
|---|---|---|---|---|
| S1: Storage upload fails | Mock `supabase.storage.from("receipts").upload` → return error | No row in DB | 500 | No receipt row created |
| S2: Receipt INSERT fails | Mock `supabase.from("receipts").insert` → return error | No row in DB | 500 | Fire-and-forget storage cleanup fires but not awaited |
| S3: Signed URL fails | Mock `supabase.storage.createSignedUrl` → return error | `'failed'` | 500 | Row exists; must be `'failed'` not `'processing'` |
| S4: LLM call throws | Mock `openai.chat.completions.create` → throw | `'failed'` | 500 | Covers network errors, SDK errors |
| S5: LLM returns invalid JSON | Mock OpenAI → return `content: "not json"` | `'failed'` | 500 | `JSON.parse` catch path |
| S6: LLM returns invalid line item | Mock OpenAI → return item with invalid category or negative price | `'failed'` | 500 | Validation path; response body = `"LLM extraction failed"` |
| S7: Line items INSERT fails | Mock `supabase.from("line_items").insert` → return error | `'failed'` | 500 | Row exists; must be `'failed'` |
| S8: Final UPDATE fails | Mock `supabase.from("receipts").update({ processing_status: "done" })` → return error | **`'processing'`** | 500 | **Known gap — Risk #5 cross-over. API correctly returns error; row is stuck.** |

**Critical constraint for S1–S7**: Must never return HTTP 200. Must never return HTTP 200 with empty `receiptId` or `lineItemCount: 0`.

**Anti-pattern to avoid**: A single top-level test that only verifies the outer response status. Each scenario needs to assert **both** the HTTP status/body AND the `receipts.processing_status` DB column state after the response.

---

## Code References

- [`src/pages/api/receipts/upload.ts`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/upload.ts) — full upload pipeline route
- [`src/pages/api/receipts/query.ts`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/query.ts) — NL query route (Risk #3 territory)
- [`src/pages/api/receipts/backfill-embeddings.ts`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/pages/api/receipts/backfill-embeddings.ts) — embedding backfill (maintenance; excluded from test scope per test-plan §7)
- [`src/lib/supabase.ts`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/lib/supabase.ts) — `createClient()` can return `null` if env vars are missing; all three routes guard this
- [`src/lib/database.types.ts`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/src/lib/database.types.ts) — typed schema; `processing_status: string` (NOT NULL)
- [`supabase/migrations/20260527000000_receipt_schema.sql`](https://github.com/dadosmaciej/clearspend/blob/f95c0777f7d4c406a9b23c40a2aacf01712b0d2a/supabase/migrations/20260527000000_receipt_schema.sql) — CHECK constraint on `processing_status IN ('pending', 'processing', 'done', 'failed')`

---

## Architecture Insights

**No outer try/catch is deliberate**: the route catches failures per-step rather than centralising. This means an unanticipated exception outside any of the three local try/catch blocks (steps 3, 9, 13) would propagate unhandled — in Cloudflare Workers/Astro this causes a 500, but `processing_status` would remain at `'processing'`. The current code has no such uncaught paths (all non-try-wrapped steps return early on inline error checks), but this is a structural fragility worth noting for future route changes.

**`processing_status` DB constraint**: the migration enforces `CHECK (processing_status IN ('pending', 'processing', 'done', 'failed'))`. Any attempt to update to an unlisted value would fail at the DB level; tests that assert `'failed'` are asserting against a value the DB will always accept.

**`createClient()` returns null**: the Supabase factory returns `null` if env vars are absent. All three routes check for this and return 500 before touching the DB. Integration tests that use a real Supabase test database do not need to mock this path — it is an env-level pre-condition.

**Embedding failure is structurally invisible**: the catch block at lines 229–231 is empty with an explanatory comment. Any test that sets up a Supabase mock will observe a successful 200 response even if the embedding update fails. Tests for Risk #1 should not inject embedding failures — they belong in the backfill flow tests, if any.

---

## Historical Context

- `context/changes/receipt-upload-extraction/plan.md` §Critical Implementation Details — documents the "DB error safety" invariant: *"if any step after the `receipts` INSERT fails, update `processing_status` to `'failed'` before returning the error response — never leave orphaned rows stuck in `'processing'`."* The gap at step 12 (final UPDATE failure) violates this invariant for that one path.
- `context/changes/receipt-upload-extraction/reviews/impl-review.md` F1, F3, F4, F6 — four findings were raised and fixed during impl review. F6 (silent failure on final status update) was fixed to return 500 instead of 200, but the `processing_status` was not set to `'failed'` in the fix — this is the remaining gap.

---

## Open Questions

1. **S8 gap remediation**: Should the final status UPDATE failure also set `processing_status = 'failed'` before returning 500? The plan invariant says yes; the fix only addressed the silent-200 half of the problem. This is a candidate for a one-line fix — or a documented exception.
2. **Mocking strategy for Supabase**: Need to decide between MSW (intercept at HTTP edge) vs. dependency injection (pass a mock Supabase client into the route). The test plan recommends HTTP edge mocking for the most realistic coverage. Cloudflare Workers' `fetch` interception via Vitest (or MSW in node mode) is the likely path — needs a brief spike in Phase 1 setup.
3. **Test user / DB state**: Scenarios S3–S8 require a real `receiptId` in the DB (the INSERT must succeed before the injected failure). Tests will need to either: (a) hit a real Supabase test project and clean up after, or (b) mock the INSERT step's DB call to return a fake ID while mocking subsequent steps. This is a test architecture decision for `/10x-plan`.
