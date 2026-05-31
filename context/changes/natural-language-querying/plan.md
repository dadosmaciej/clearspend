# S-03: Natural Language Expense Querying Implementation Plan

## Overview

Add RAG-based natural language querying to ClearSpend. Users type a free-text question about their expenses and receive a plain-language answer backed by citations to specific receipts. The pipeline: embed each receipt at upload time, retrieve relevant receipts at query time via hybrid search (vector similarity + SQL keyword supplements), generate an answer with GPT-4o, and display source receipt cards.

## Current State Analysis

- `pgvector` extension is already enabled in the F-01 migration (`CREATE EXTENSION IF NOT EXISTS vector`) — no extension work needed.
- `receipts` and `line_items` tables exist with full RLS; no `embedding` column yet.
- `openai` singleton (`src/lib/llm.ts`) is configured and uses the `openai` SDK v6 — only `chat.completions` is used today; `embeddings.create` is additive.
- Upload pipeline (`src/pages/api/receipts/upload.ts`) ends after the `processing_status: 'done'` update — embedding generation slots in there.
- No vector search function or index exists in the DB.
- There are existing receipts without embeddings — lazy backfill at query time + a dedicated backfill endpoint covers this.
- Query UI lives inline on `/receipts` (index page), not a separate page.

## Desired End State

- Every new receipt uploaded gets an embedding generated as the final step of the upload pipeline.
- A "Ask about your expenses" section at the top of `/receipts` accepts a free-text question, POSTs to a new query endpoint, and displays the GPT-4o answer followed by linked source receipt cards.
- The query endpoint uses hybrid retrieval: vector similarity top-15 + SQL date-window supplement + SQL category supplement, merged and capped at 20, then a single GPT-4o call returns `{ answer, cited_receipt_ids }`.
- Existing receipts without embeddings are backfilled lazily on first query and can also be pre-warmed via `POST /api/receipts/backfill-embeddings`.
- A non-existent or unanswerable query returns a friendly "no data" message without hallucinating amounts.

### Key Discoveries

- `database.types.ts` is handwritten (not CLI-generated) — the `embedding` column must be added manually to receipts Row/Insert/Update types.
- The upload endpoint already awaits a GPT-4o vision call (~5–10 s); one additional embeddings API call (~300 ms) is acceptable latency at the tail.
- `client:only="react"` is required for React islands that use browser APIs or stateful fetching — see S-02 lesson; `QueryForm` follows the same pattern as `UploadForm`.
- The `no-misused-promises` ESLint rule is already disabled for `.astro` files in `eslint.config.js` — no extra config needed for the new index.astro changes.

## What We're NOT Doing

- No separate `/receipts/query` page — query UI is inline on the list page.
- No query history persistence — stateless per session only.
- No multi-turn conversation — single question/answer cycle.
- No per-line-item embeddings — one embedding per receipt.
- No second LLM call for date/entity extraction — simple keyword regex only.
- No streaming answer — single buffered GPT-4o response.
- No category-correction UI — out of scope (PRD §Non-Goals).

## Implementation Approach

Four sequential phases. Phase 1 is a pure DB + types change, independently verifiable with `npx astro check` and `npx supabase db push`. Phases 2–4 each depend on the previous. Each phase has its own manual gate before the next begins.

## Critical Implementation Details

- **Embedding text format**: `"{shop_name ?? 'Unknown shop'} {purchase_date ?? ''} {item1_name} {item1_category} {item2_name} {item2_category} ..."` — shop and date first (temporal signal), then all item names+categories concatenated. Omit prices from the embedding text; they create numeric noise that hurts semantic similarity.
- **Embedding failure in upload must not fail the upload**: if `openai.embeddings.create` throws, catch it, leave `embedding` as `null`, and return the successful upload response. The receipt data is what matters; queryability can be recovered via backfill.
- **match_receipts RPC parameter security**: the function accepts `p_user_id uuid` and the receipts table has RLS (`user_id = auth.uid()`). Both the parameter filter and RLS apply simultaneously — a server-side caller that passes `userId` from `context.locals.user.id` is safe because even if the parameter were manipulated, RLS blocks access to other users' rows.
- **GPT-4o answer format**: use `response_format: { type: "json_object" }` with an explicit schema in the prompt (`{ answer: string, cited_receipt_ids: string[] }`). Parse with `JSON.parse(content)` and guard against parse errors with a fallback "no data" response.
- **IVFFlat vs HNSW**: use HNSW (`USING hnsw (embedding vector_cosine_ops)`) — better performance at small dataset sizes and no need to pre-specify `lists`.

---

## Phase 1: Schema — embedding column + vector search function

### Overview

Add an `embedding vector(1536)` column to the `receipts` table, create an HNSW index for cosine similarity, add a `match_receipts` RPC function for vector search, and update the TypeScript database types.

### Changes Required

#### 1. New migration

**File**: `supabase/migrations/20260530000000_receipts_embeddings.sql` (new)

**Intent**: Extend the receipts table with the embedding column, index it for similarity search, and expose a typed RPC function that the query endpoint will call.

**Contract**:

```sql
ALTER TABLE receipts ADD COLUMN embedding vector(1536);

CREATE INDEX receipts_embedding_idx ON receipts
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_receipts(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int,
  p_user_id       uuid
)
RETURNS TABLE (
  id            uuid,
  shop_name     text,
  purchase_date date,
  total_amount  numeric,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    r.id,
    r.shop_name,
    r.purchase_date,
    r.total_amount,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM receipts r
  WHERE r.user_id             = p_user_id
    AND r.processing_status   = 'done'
    AND r.embedding           IS NOT NULL
    AND 1 - (r.embedding <=> query_embedding) > match_threshold
  ORDER BY r.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;
```

#### 2. Update database types

**File**: `src/lib/database.types.ts`

**Intent**: Reflect the new `embedding` column so TypeScript callers can pass and receive embedding data without type errors.

**Contract**: In the `receipts` object, add `embedding: number[] | null` to `Row`, and `embedding?: number[] | null` to `Insert` and `Update`.

### Success Criteria

#### Automated Verification

- Migration applies cleanly to remote Supabase: `npx supabase db push`
- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Supabase Studio → Table Editor → receipts: `embedding` column exists (type `vector`)
- `match_receipts` function visible in Supabase Studio → Database → Functions

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Embedding pipeline — generation at upload + backfill endpoint

### Overview

Update the upload pipeline to generate a receipt embedding as the final step after `processing_status: 'done'` is set. Create a backfill endpoint for existing receipts. Both use the same embedding-text builder and the same `text-embedding-3-small` model.

### Changes Required

#### 1. Update upload pipeline

**File**: `src/pages/api/receipts/upload.ts`

**Intent**: After the receipt is fully processed (line items inserted, status set to `done`), generate an embedding from the receipt's text representation and store it. Failure here must not fail the overall upload — the receipt data is already saved.

**Contract**: At the very end of the route, after the final `supabase.from("receipts").update({ processing_status: "done", ... })` call, wrap an embedding generation block in try/catch. Build the embedding text as: shop name + purchase date + each line item's name and category joined by spaces. Call `openai.embeddings.create({ model: "text-embedding-3-small", input: text })`. On success, call `supabase.from("receipts").update({ embedding: vector }).eq("id", receiptId)`. On any error, silently continue — return the existing success response without modification.

#### 2. Create backfill endpoint

**File**: `src/pages/api/receipts/backfill-embeddings.ts` (new)

**Intent**: Allow pre-warming all existing receipts that have `processing_status = 'done'` but `embedding IS NULL`. Called manually after deploying this feature to make historical receipts queryable.

**Contract**:

- Auth gate: 401 if `!context.locals.user`.
- Supabase gate: 500 if `createClient` returns null.
- Query: `supabase.from("receipts").select("id, shop_name, purchase_date, line_items(name, category)").eq("user_id", userId).eq("processing_status", "done").is("embedding", null)`. Default to `[]` on error.
- For each receipt, build embedding text (same format as upload), call `openai.embeddings.create`, update `receipts.embedding`. Failures on individual receipts are skipped (logged to console).
- Return `{ backfilled: N }` where N is the count of successfully updated receipts.
- The endpoint is POST (state-mutating) and protected by auth middleware automatically (under `/receipts`... wait — this is under `/api/receipts/`, not `/receipts`). Add `"/api/receipts"` to `PROTECTED_ROUTES` in `src/middleware.ts` to protect it, OR include the standard `if (!context.locals.user)` auth check at the top (matching the pattern in `upload.ts`). Use the inline auth check pattern (upload.ts style) since the API routes already do this consistently.

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Upload a new receipt → Supabase Studio → receipts row has a non-null `embedding` value
- Call `POST /api/receipts/backfill-embeddings` (authenticated) → response `{ backfilled: N }` where N matches count of existing receipts without embeddings
- After backfill, all done receipts in Supabase Studio have non-null embeddings

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Query API endpoint

### Overview

Create `POST /api/receipts/query`. Accepts a natural language question, performs hybrid retrieval (vector + SQL date/category supplements), calls GPT-4o once to generate an answer with cited receipt IDs, and returns `{ answer, sources }`.

### Changes Required

#### 1. Create query endpoint

**File**: `src/pages/api/receipts/query.ts` (new)

**Intent**: The complete NL query pipeline in one route — embedding, hybrid retrieval, answer generation, citation validation. Returns a JSON response the front-end can render directly.

**Contract**:

- Auth gate: 401. Supabase gate: 500.
- Parse JSON body: `{ question: string }`. Return 400 if `question` is empty or not a string.
- **Lazy backfill**: query `receipts` for `{ id, shop_name, purchase_date, line_items(name, category) }` where `user_id = userId AND processing_status = 'done' AND embedding IS NULL`. For each, generate an embedding and update the row (same logic as the backfill endpoint). Skip failures silently.
- **Query embedding**: `openai.embeddings.create({ model: "text-embedding-3-small", input: question })`. On failure return 500 `{ error: "Query processing failed" }`.
- **Vector search**: `supabase.rpc("match_receipts", { query_embedding, match_threshold: 0.3, match_count: 15, p_user_id: userId })`. Collect result IDs into a `Set<string>`.
- **Date supplement**: scan the lowercased question for time keywords ("last month", "this month", "last year", "this year", and the 12 month names). When found, compute the corresponding `from`/`to` date strings (YYYY-MM-DD). Query `receipts` by `user_id + processing_status = 'done' + purchase_date range`. Add result IDs to the Set.
- **Category supplement**: scan the lowercased question for the 8 category strings defined in the extraction prompt ("food", "fuel", "electronics", "household", "health", "clothing", "transport", "entertainment"). For each match, query `line_items` by `category` (RLS ensures only the user's items). Add `receipt_id` values to the Set.
- **Merge**: take `[...idSet].slice(0, 20)`. If empty, return 200 `{ answer: "I couldn't find any receipts relevant to your question. Try rephrasing or check your date filter.", sources: [] }`.
- **Fetch full data**: `supabase.from("receipts").select("id, shop_name, purchase_date, total_amount, line_items(name, price, category)").in("id", mergedIds).eq("user_id", userId)`.
- **Format receipts for GPT-4o**: build a string with one block per receipt: `[Receipt ID: {id}]\nShop: {shop} | Date: {date} | Total: €{total}\nItems: {name} ({category}) €{price}, ...`.
- **GPT-4o answer call**:

  ```typescript
  openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expense analysis assistant. Answer the user's question using ONLY the receipts provided. Return a JSON object: { "answer": "...", "cited_receipt_ids": ["id1", "id2"] }. cited_receipt_ids must be IDs from the provided receipts only. If the data is insufficient, explain what's missing in the answer field. Never invent amounts.`,
      },
      { role: "user", content: `Receipts:\n${receiptsText}\n\nQuestion: ${question}` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  })
  ```

- Parse the response. On parse failure or missing fields, return `{ answer: "I couldn't process the answer. Please try again.", sources: [] }`.
- Validate `cited_receipt_ids`: filter to only IDs present in `mergedIds` (prevent any hallucinated IDs).
- Build `sources`: for each validated cited ID, find the matching receipt object from the fetched data and return `{ id, shop_name, purchase_date, total_amount }`.
- Return 200 `{ answer: string, sources: { id, shop_name, purchase_date, total_amount }[] }`.

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Authenticated POST to `/api/receipts/query` with `{ "question": "how much did I spend last month?" }` → 200 with `answer` and `sources` array
- Authenticated POST with a question about a category (e.g. `"show me food purchases"`) → sources include receipts with food line items
- POST to `/api/receipts/query` with `{ "question": "" }` → 400
- Unauthenticated POST → 401
- Question with no matching receipts → 200 with friendly no-data answer and empty sources

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Query UI — inline on receipts list

### Overview

Add a `QueryForm` React island to the top of `/receipts/index.astro`. The component renders a collapsible "Ask about your expenses" section: text input, submit button, loading state, answer display, and source receipt cards that link to `/receipts/{id}`.

### Changes Required

#### 1. Create QueryForm React component

**File**: `src/components/receipts/QueryForm.tsx` (new)

**Intent**: Self-contained React island that handles the full question/answer cycle — collapsed by default, expands on user interaction, manages loading and error state, renders the answer and source cards.

**Contract**:

- State: `open: boolean` (starts `false`), `loading: boolean`, `question: string`, `result: { answer: string, sources: Source[] } | null`, `error: string | null`.
- `interface Source { id: string; shop_name: string | null; purchase_date: string | null; total_amount: number | null; }`.
- Toggle button "Ask about your expenses ▾" / "▴": flips `open`. When closed, hide the rest of the component.
- When open: a `<textarea>` for the question (2 rows, disabled while loading), a submit button (disabled while `loading || !question.trim()`), and below it the result or error area.
- `handleSubmit`: prevent default → `setLoading(true)` → `fetch("/api/receipts/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) })` → on non-ok throw `data.error` → on success set `result` → on catch set `error` → always `setLoading(false)`.
- Loading state: show spinner + "Thinking…" text in place of the submit button.
- Result area: `result.answer` in a prose paragraph; if `result.sources.length > 0` render a "Sources" label followed by one card per source — shop name (fallback "Unknown shop"), date, total (`€{total.toFixed(2)}`), wrapped in `<a href={/receipts/${source.id}}>`.
- Error: render via `<ServerError message={error} />` (same component used in upload flow).
- Style: use the same dark neutral palette as the rest of the receipts pages (`bg-neutral-800 border-neutral-700` etc.).

#### 2. Update receipts list page

**File**: `src/pages/receipts/index.astro`

**Intent**: Embed the QueryForm island at the top of the page so users can ask questions from the same screen where they browse receipts.

**Contract**: Import `QueryForm` from `"@/components/receipts/QueryForm"`. Add `<QueryForm client:only="react" />` as the first child of `<main>`, before the heading row. Wrap it in a `<div class="mb-6">` for spacing.

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Navigate to `/receipts` — "Ask about your expenses" toggle button is visible
- Click the toggle → query form expands
- Type a question and submit → spinner shows "Thinking…", then answer appears with source cards
- Source cards are clickable and navigate to the correct `/receipts/{id}` detail page
- Toggling closed hides the form and result
- Submit with empty question → button stays disabled
- Simulated 500 from query endpoint → error banner appears

---

## Testing Strategy

### Automated

- `npx astro check` — TypeScript correctness after each phase
- `npm run lint` — ESLint passes on all modified/new files
- `npx supabase db push` — migration applies cleanly

### Manual Testing Steps (End-to-End)

1. `npm run dev`
2. Sign in and upload a fresh receipt — verify Supabase Studio shows non-null `embedding` on the new row
3. Navigate to `/receipts` — verify "Ask about your expenses" section is present
4. Type "how much did I spend last month?" → answer mentions a total or notes no data; sources list receipts
5. Type "show me food purchases" → sources include receipts with food line items
6. Click a source card → navigates to the correct detail page
7. Type a question with no matching data → friendly "no data" message, empty sources
8. Test the backfill endpoint: call `POST /api/receipts/backfill-embeddings` → returns `{ backfilled: N }`

## References

- Roadmap S-03: `context/foundation/roadmap.md` §S-03
- PRD FR-010, FR-011, FR-012: `context/foundation/prd.md`
- F-01 migration (pgvector baseline): `supabase/migrations/20260527000000_receipt_schema.sql`
- Upload pipeline: `src/pages/api/receipts/upload.ts`
- LLM client: `src/lib/llm.ts`
- Supabase client: `src/lib/supabase.ts`
- Database types: `src/lib/database.types.ts`
- Layout: `src/layouts/Layout.astro`
- UploadForm (pattern reference): `src/components/receipts/UploadForm.tsx`
- ServerError component: `src/components/auth/ServerError.tsx`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema — embedding column + vector search function

#### Automated

- [x] 1.1 Migration applies cleanly: npx supabase db push
- [x] 1.2 TypeScript build passes: npx astro check
- [x] 1.3 Linting passes: npm run lint

#### Manual

- [x] 1.4 receipts table has embedding column in Supabase Studio
- [x] 1.5 match_receipts function visible in Supabase Studio → Database → Functions

### Phase 2: Embedding pipeline — generation at upload + backfill endpoint

#### Automated

- [x] 2.1 TypeScript build passes: npx astro check
- [x] 2.2 Linting passes: npm run lint

#### Manual

- [x] 2.3 New upload generates non-null embedding on receipts row
- [x] 2.4 POST /api/receipts/backfill-embeddings returns { backfilled: N }
- [x] 2.5 All done receipts have non-null embeddings after backfill

### Phase 3: Query API endpoint

#### Automated

- [x] 3.1 TypeScript build passes: npx astro check
- [x] 3.2 Linting passes: npm run lint

#### Manual

- [x] 3.3 POST /api/receipts/query with valid question → 200 with answer and sources
- [x] 3.4 Category-scoped question returns receipts with matching line items
- [x] 3.5 Empty question → 400
- [x] 3.6 Unauthenticated POST → 401
- [x] 3.7 No-match question → 200 with friendly no-data message and empty sources

### Phase 4: Query UI — inline on receipts list

#### Automated

- [x] 4.1 TypeScript build passes: npx astro check
- [x] 4.2 Linting passes: npm run lint

#### Manual

- [x] 4.3 "Ask about your expenses" toggle visible on /receipts
- [x] 4.4 Question submit shows spinner then answer with source cards
- [x] 4.5 Source cards link to correct /receipts/{id}
- [x] 4.6 Toggle closes and hides form/result
- [x] 4.7 Error banner appears on query failure
