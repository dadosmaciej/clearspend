# S-01: Receipt Upload and LLM Extraction Implementation Plan

## Overview

Build the North Star slice: a photo upload flow that sends a receipt image to GPT-4o vision, extracts structured line items, and surfaces the result in a receipt list. Three phases: (1) the extraction API route (multipart → Storage → LLM → DB write); (2) the upload page with client-side resize + React form; (3) the receipt list page. All routes protected behind auth.

## Current State Analysis

- Auth middleware at `src/middleware.ts:4` only protects `/dashboard`. `/receipts` needs to be added.
- Supabase typed client at `src/lib/supabase.ts` returns `SupabaseClient<Database>` — `receipts` and `line_items` tables are fully typed via `src/lib/database.types.ts`.
- OpenAI singleton at `src/lib/llm.ts` — exports `openai` ready for vision calls.
- Storage bucket `receipts` exists (private, 10 MiB limit, MIME allowlist: jpeg, jpg, png, webp, heic, heif); RLS path-prefix policy requires objects at `{user_id}/{anything}`.
- `src/components/auth/ServerError.tsx` — renders a red error banner; accepts `message?: string | null`.
- `src/components/auth/SubmitButton.tsx` — uses `useFormStatus()`, tied to React 19 form action API; not usable with manual `fetch()`. The upload form manages its own loading state instead.
- `src/layouts/Layout.astro` — accepts `title?: string` prop, renders `<slot />`.
- API route pattern: `export const POST: APIRoute = async (context) => {...}` with `createClient(context.request.headers, context.cookies)`.

## Desired End State

- `POST /api/receipts/upload` accepts `multipart/form-data` with an `image` field, runs the full pipeline (Storage upload → DB insert → GPT-4o vision → line_items insert → status update), and returns `{ receiptId, shopName, purchaseDate, totalAmount, lineItemCount }` on success.
- `/receipts/upload` page renders an `<UploadForm>` React island that resizes the image client-side (Canvas API, max 1920px), POSTs to the API route, shows a spinner while waiting, shows an inline error on failure, and redirects to `/receipts` on success.
- `/receipts` page queries the authenticated user's receipts server-side and renders rows (shop name, date, total, status badge) with an "Upload receipt" CTA.
- `/receipts` and all sub-paths are protected in `src/middleware.ts`.

## What We're NOT Doing

- Server-side image resize — `sharp` and `OffscreenCanvas` are unavailable in Cloudflare Workers; resize is client-side only via browser Canvas API.
- Receipt detail view — clicking a row opens nothing in S-01 (S-02 scope).
- Date-range filter on the list — simple unfiltered list in S-01 (S-02 scope).
- Embedding generation for NL querying — S-03 scope. (Note: during S-03 Phase 2, embedding generation was intentionally added to the tail of this upload route. The code is correct; this guardrail is superseded by S-03.)
- Retry logic beyond the OpenAI SDK's built-in defaults.
- Manual category correction UI.

## Implementation Approach

Three sequential phases. Phase 1 builds the server pipeline end-to-end and is independently testable via `curl` or a REST client. Phase 2 builds the frontend and connects it to Phase 1. Phase 3 builds the list page that surfaces the result. Each phase has automated and manual success criteria before advancing.

## Critical Implementation Details

- **Storage path format**: objects must be stored at `{user_id}/{uuid}.{ext}` — the RLS policy checks `(storage.foldername(name))[1] = auth.uid()::text`, so the first path segment must be the user's UUID.
- **Private bucket → signed URL**: the `receipts` bucket is private, so GPT-4o cannot access a plain storage path. After upload, generate a 60-second signed URL with `supabase.storage.from('receipts').createSignedUrl(path, 60)` and pass that URL to the vision model.
- **Synchronous processing**: the API route awaits the full GPT-4o call before responding. No background jobs, no status polling.
- **DB error safety**: if any step after the `receipts` INSERT fails, update `processing_status` to `'failed'` before returning the error response — never leave orphaned rows stuck in `'processing'`.
- **GPT-4o response format**: the prompt instructs the model to return a raw JSON object with no markdown fences. Parse with `JSON.parse(content)`; catch parse errors and treat as extraction failure (set `processing_status = 'failed'`).
- **Cloudflare Workers file access**: `context.request.formData()` returns a native `FormData`; `file.arrayBuffer()` returns the bytes; `new Uint8Array(buf)` converts for Supabase Storage upload.
- **Client-side resize**: Canvas 2D context draws the image at reduced dimensions; `canvas.toBlob('image/jpeg', 0.85)` produces the upload-ready blob. Maximum dimension is 1920px on the longer side, aspect ratio preserved.

---

## Phase 1: Extraction API Route

### Overview

Create `POST /api/receipts/upload`. Validates auth, parses the multipart body, uploads the image to Supabase Storage, inserts a `receipts` row, calls GPT-4o vision with a structured extraction prompt, parses the JSON response, inserts `line_items`, updates `processing_status` to `'done'`, and returns a success payload. Also update `src/middleware.ts` to protect `/receipts`.

### Changes Required

#### 1. Update middleware to protect /receipts

**File**: `src/middleware.ts`

**Intent**: Protect `/receipts` and all sub-paths behind auth so unauthenticated users cannot reach the upload or list pages directly.

**Contract**: Add `"/receipts"` to the `PROTECTED_ROUTES` array at line 4:

```ts
const PROTECTED_ROUTES = ["/dashboard", "/receipts"];
```

---

#### 2. Create upload API route

**File**: `src/pages/api/receipts/upload.ts` (new)

**Intent**: Single route that handles the complete receipt ingestion pipeline synchronously — one request in, one response out.

**Contract**:

- Auth gate: return 401 if `!context.locals.user`.
- Supabase gate: return 500 if `createClient` returns null.
- Multipart parse: `context.request.formData()`. Return 400 if `form.get("image")` is not a `File`.
- MIME check: return 400 if `file.type` is not in `["image/jpeg","image/jpg","image/png","image/webp","image/heic","image/heif"]`.
- Storage upload: `supabase.storage.from("receipts").upload(storagePath, new Uint8Array(buf), { contentType: file.type })` where `storagePath = \`${userId}/${crypto.randomUUID()}.${ext}\`` and `ext = file.type.split("/")[1].replace("jpeg","jpg")`.
- DB insert: `supabase.from("receipts").insert({ user_id: userId, image_path: storagePath, processing_status: "processing" }).select("id").single()`.
- Signed URL: `supabase.storage.from("receipts").createSignedUrl(storagePath, 60)`. On failure → update status to `'failed'`, return 500.
- GPT-4o call: `openai.chat.completions.create({ model: "gpt-4o", messages: [...], max_tokens: 1500 })`. On any throw or JSON parse failure → update status to `'failed'`, return 500.
- Line items insert: `supabase.from("line_items").insert([...])`. On failure → update status to `'failed'`, return 500.
- Final update: `supabase.from("receipts").update({ processing_status: "done", shop_name, purchase_date, total_amount }).eq("id", receiptId)`.
- Success response: `{ receiptId, shopName, purchaseDate, totalAmount, lineItemCount }` with status 200.

Extraction prompt (passed as the `text` part of the vision message):

```
You are a receipt parsing assistant. Extract information from this receipt image and return a single JSON object with no markdown formatting or code fences.

Return exactly this structure:
{
  "shop_name": "string or null",
  "purchase_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "line_items": [
    {
      "name": "item name",
      "price": number,
      "category": "food|fuel|electronics|household|health|clothing|transport|entertainment|other"
    }
  ]
}

Rules: line_items is always an array (empty array if no items are visible); all prices are positive numbers; total_amount has no currency symbol; use "other" for any item that doesn't clearly match a category.
```

The `ExtractionResult` interface used to type the parsed response:

```ts
interface ExtractionResult {
  shop_name: string | null;
  purchase_date: string | null;
  total_amount: number | null;
  line_items: Array<{ name: string; price: number; category: string }>;
}
```

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Unauthenticated POST to `/api/receipts/upload` → 401
- Authenticated POST with no `image` field → 400 with `"image field is required"`
- Authenticated POST with a real receipt image file → 200 with `receiptId` and `lineItemCount > 0`
- Supabase Studio → Storage → receipts bucket: image appears at `{user_id}/{uuid}.jpg`
- Supabase Studio → Table Editor → receipts: row with `processing_status = 'done'`, extracted shop name, date, total
- Supabase Studio → Table Editor → line_items: rows linked to receipt with names, prices, categories

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Upload Page and Form

### Overview

Create the Astro upload page and the React `UploadForm` island. The form handles file selection, client-side Canvas resize, POST to the Phase 1 route, spinner/status text while waiting, inline error banner on failure, and redirect to `/receipts` on success.

### Changes Required

#### 1. Create UploadForm React component

**File**: `src/components/receipts/UploadForm.tsx` (new)

**Intent**: Self-contained React island encapsulating the upload flow. Manages its own loading state (cannot use `SubmitButton`'s `useFormStatus` with a manual `fetch()`). Uses `ServerError` for the error banner.

**Contract**:

- State: `loading: boolean`, `error: string | null`, `statusText: string`.
- File input ref (`useRef<HTMLInputElement>`); `accept="image/*"`, disabled while `loading`.
- `resizeImage(file: File): Promise<Blob>` — creates a temporary `<img>`, measures dimensions, scales so the longer side ≤ 1920, draws to a `<canvas>`, returns `canvas.toBlob('image/jpeg', 0.85)`.
- `handleSubmit` flow: prevent default → get file → `setLoading(true)` → `resizeImage` → append blob to `FormData` as `"image"` key → `fetch('/api/receipts/upload', { method: 'POST', body: form })` → on non-ok response throw with `data.error` → on success `window.location.href = '/receipts'` → on catch `setError(...)` + `setLoading(false)`.
- Status text sequence: `"Resizing image…"` before resize, `"Uploading…"` before fetch.
- Submit button: `<Button type="submit" disabled={loading}>` — shows spinner + `statusText` when loading, `<Upload className="size-4" />` + `"Upload receipt"` otherwise.
- Error rendered via `<ServerError message={error} />` above the file input.

---

#### 2. Create upload Astro page

**File**: `src/pages/receipts/upload.astro` (new)

**Intent**: Minimal page shell that hosts the `<UploadForm>` island. Middleware already guards `/receipts` from Phase 1.

**Contract**:

- Imports `Layout` from `"@/layouts/Layout.astro"` and `UploadForm` from `"@/components/receipts/UploadForm"`.
- Renders `<Layout title="Upload Receipt">` with a `<main class="mx-auto max-w-md px-4 py-8">` containing an `<h1>` and `<UploadForm client:load />`.

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Navigate to `/receipts/upload` while signed out → redirected to `/auth/signin`
- Navigate to `/receipts/upload` while signed in → upload form renders
- Select a receipt image and submit → spinner appears cycling "Resizing image…" → "Uploading…"
- On success → redirected to `/receipts` and new receipt row is visible
- Simulate failure (e.g., invalid file or disconnected) → error banner appears, form is re-enabled

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Receipt List Page

### Overview

Create the `/receipts` Astro page. Server-side query fetches the authenticated user's receipts ordered by `created_at DESC`. Renders as simple rows (shop name, date, total, status badge) with an "Upload receipt" CTA. No detail click-through in S-01.

### Changes Required

#### 1. Create receipt list page

**File**: `src/pages/receipts/index.astro` (new)

**Intent**: Landing page after a successful upload. Shows all receipts as rows with key metadata and a color-coded status badge.

**Contract**:

- Server-side: `createClient(Astro.request.headers, Astro.cookies)` → `supabase.from("receipts").select("id, shop_name, purchase_date, total_amount, processing_status, created_at").order("created_at", { ascending: false })`. If supabase is null or query errors, default to empty array.
- Status badge color map:
  - `pending` → `bg-neutral-700 text-neutral-300`
  - `processing` → `bg-yellow-900/40 text-yellow-300`
  - `done` → `bg-green-900/40 text-green-300`
  - `failed` → `bg-red-900/40 text-red-300`
- Empty state: text "No receipts yet. Upload your first receipt above."
- Each receipt row: shop name (fallback `"Unknown shop"`), date (`purchase_date` or `created_at.slice(0,10)`), total (`€{total_amount.toFixed(2)}` when not null), status badge.
- Header: `<h1>Receipts</h1>` + `<a href="/receipts/upload">Upload receipt</a>` button.

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Navigate to `/receipts` while signed out → redirected to `/auth/signin`
- Navigate to `/receipts` while signed in with seed data → 3 seed receipts (Lidl, BP Fuel, MediaMarkt) with green "Done" badges
- Upload a new receipt via `/receipts/upload` → new row appears at the top with correct shop name, date, total, and "Done" badge
- A receipt row with `processing_status = 'failed'` shows a red "Failed" badge

---

## Testing Strategy

### Automated

- `npx astro check` — TypeScript correctness after each phase
- `npm run lint` — ESLint passes on all new files

### Manual Testing Steps (End-to-End)

1. `npm run dev`
2. Sign in as `test@clearspend.dev` / `test123456`
3. Navigate to `http://localhost:4321/receipts` — 3 seed receipts with "Done" badges
4. Navigate to `/receipts/upload` — form renders
5. Select a real receipt photo (JPEG, PNG, or HEIC); submit — watch spinner cycle through status text
6. On redirect to `/receipts`, confirm new receipt row at the top with extracted data
7. Supabase Studio: Storage image at `{user_id}/{uuid}.jpg`; receipts row with `done` status + extracted fields; line_items rows with names, prices, categories
8. Sign out; navigate to `/receipts` → redirect to `/auth/signin`

## References

- Roadmap S-01: `context/foundation/roadmap.md` §S-01
- Database types: `src/lib/database.types.ts`
- Supabase client: `src/lib/supabase.ts`
- LLM client: `src/lib/llm.ts`
- API route pattern: `src/pages/api/llm/smoke-test.ts`
- ServerError component: `src/components/auth/ServerError.tsx`
- Button component: `src/components/ui/button.tsx`
- Auth middleware: `src/middleware.ts`
- Layout: `src/layouts/Layout.astro`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extraction API Route

#### Automated

- [x] 1.1 TypeScript build passes: npx astro check
- [x] 1.2 Linting passes: npm run lint

#### Manual

- [x] 1.3 Unauthenticated POST to /api/receipts/upload → 401
- [x] 1.4 POST with no image field → 400
- [x] 1.5 Authenticated POST with receipt image → 200 with receiptId and lineItemCount
- [x] 1.6 Storage: image file at {user_id}/{uuid}.jpg in receipts bucket
- [x] 1.7 DB: receipts row processing_status = 'done' with extracted shop name / date / total
- [x] 1.8 DB: line_items rows linked to receipt with names, prices, categories

### Phase 2: Upload Page and Form

#### Automated

- [x] 2.1 TypeScript build passes: npx astro check
- [x] 2.2 Linting passes: npm run lint

#### Manual

- [x] 2.3 Unauthenticated GET /receipts/upload → redirect to /auth/signin
- [x] 2.4 Authenticated: upload form renders at /receipts/upload
- [x] 2.5 Submit with image → spinner with status text, then redirect to /receipts
- [x] 2.6 Error state: error banner appears and form is re-enabled on failure

### Phase 3: Receipt List Page

#### Automated

- [x] 3.1 TypeScript build passes: npx astro check
- [x] 3.2 Linting passes: npm run lint

#### Manual

- [x] 3.3 Unauthenticated GET /receipts → redirect to /auth/signin
- [x] 3.4 Seed receipts render: Lidl, BP Fuel, MediaMarkt with Done badges
- [x] 3.5 Newly uploaded receipt appears at the top with correct extracted data
- [x] 3.6 Receipt with processing_status = 'failed' shows red Failed badge
