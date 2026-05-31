# Plan Brief: receipt-upload-extraction (S-01)

## What we're building

Receipt photo upload + GPT-4o extraction + receipt list. The North Star slice.

## 3 phases

| Phase | Files | Output |
|-------|-------|--------|
| 1 — Extraction API | `src/pages/api/receipts/upload.ts`, `src/middleware.ts` | POST route: multipart → Storage → DB → GPT-4o → line_items |
| 2 — Upload UI | `src/pages/receipts/upload.astro`, `src/components/receipts/UploadForm.tsx` | Client-side resize + fetch + spinner + error banner |
| 3 — List page | `src/pages/receipts/index.astro` | Server-side query, rows with status badges |

## Key decisions locked

- **Sync processing** — API route blocks until GPT-4o responds; no polling.
- **Client-side resize** — Canvas API to max 1920px. `sharp` / `OffscreenCanvas` unavailable in Cloudflare Workers.
- **Private bucket → signed URL** — generate 60-second signed URL after upload; pass to GPT-4o.
- **Structured JSON prompt** — model returns raw JSON (no fences); parse with `JSON.parse`.
- **Fixed categories** — food, fuel, electronics, household, health, clothing, transport, entertainment, other.
- **DB safety** — always update `processing_status = 'failed'` on any post-INSERT failure before returning error.
- **Storage path** — `{user_id}/{uuid}.{ext}` (RLS policy checks first folder segment = `auth.uid()`).

## Resume command

```
/10x-implement receipt-upload-extraction phase 1
```
