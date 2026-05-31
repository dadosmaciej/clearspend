<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-01 Receipt Upload and LLM Extraction

- **Plan**: context/changes/receipt-upload-extraction/plan.md
- **Scope**: All Phases (1–3)
- **Date**: 2026-05-31
- **Verdict**: NEEDS ATTENTION (resolved via triage)
- **Findings**: 1 critical | 4 warnings | 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — line_items accessed outside try/catch; bad LLM shape orphans receipt

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/receipts/upload.ts:145
- **Detail**: The try/catch ended at line 143. Line 145 accessed extracted.line_items.length outside any error boundary. If JSON.parse succeeded but line_items was null/missing, a TypeError propagated unhandled leaving the receipt stuck in 'processing' forever.
- **Fix Applied**: Parse into `unknown` first, validate shape inside try block before casting to ExtractionResult.
- **Decision**: FIXED via Fix A

### F2 — No file size check before buffering upload

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/receipts/upload.ts:77
- **Detail**: file.arrayBuffer() called with no size check. Oversized body fully buffered in Workers memory.
- **Fix Applied**: Added 10 MiB guard returning 413 before arrayBuffer() call.
- **Decision**: FIXED

### F3 — LLM-returned price and category not validated before DB insert

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/receipts/upload.ts:146–154
- **Detail**: item.price cast as number but JSON.parse doesn't enforce types at runtime. item.category stored verbatim without checking against the enum.
- **Fix Applied**: Added ALLOWED_CATEGORIES const and invalidItem validation before bulk insert. Invalid items return 500 + set status to 'failed'.
- **Decision**: FIXED via Fix A

### F4 — Orphaned storage object when receipts INSERT fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/receipts/upload.ts:99–104
- **Detail**: Uploaded file remained in bucket on INSERT failure with no DB row to reference it.
- **Fix Applied**: Added fire-and-forget `supabase.storage.from("receipts").remove([storagePath])` on insertError.
- **Decision**: FIXED

### F5 — Embedding generation is S-03 scope, live in S-01

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/receipts/upload.ts:175–191
- **Detail**: Plan guardrail said "No embedding generation — S-03 scope." Code was intentionally added during S-03 Phase 2. Documentation drift, not a code bug.
- **Fix Applied**: Added note to S-01 plan's What We're NOT Doing section acknowledging the intentional scope addition from S-03.
- **Decision**: FIXED (plan note added)

### F6 — Final receipts UPDATE error silently discarded

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/receipts/upload.ts:164–172
- **Detail**: Final .update({ processing_status: "done" }) error return discarded. Row could be stuck in 'processing' while API returns 200.
- **Fix Applied**: Destructured error and return 500 if finalUpdateError is set.
- **Decision**: FIXED

### F7 — URL.revokeObjectURL not called in img.onerror

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/receipts/UploadForm.tsx:37–40
- **Detail**: revokeObjectURL called in onload but not onerror. Object URL leaks on image load failure.
- **Fix Applied**: Added URL.revokeObjectURL(url) as first line of img.onerror.
- **Decision**: FIXED

### F8 — client:load in plan vs client:only="react" in upload.astro

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/receipts/upload.astro:9
- **Detail**: Plan specified client:load; implementation uses client:only="react". The implementation is correct — client:only skips SSR for browser-API components.
- **Decision**: ACCEPTED-AS-RULE: Use client:only="react" for browser-API React islands (saved to context/foundation/lessons.md)
