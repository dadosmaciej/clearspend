# Natural Language Expense Querying — Plan Brief

> Full plan: `context/changes/natural-language-querying/plan.md`

## What & Why

S-03 adds natural language querying to ClearSpend (FR-010, FR-011, FR-012). Users can type "how much did I spend on food last month?" and receive a plain-language answer backed by citations to specific receipts — closing the gap between raw receipt data and the spending insights the product promises.

## Starting Point

F-01 enabled `pgvector` in the migration but added no embedding columns. S-01 built the extraction pipeline that produces structured receipt + line-item data. Every ingredient is in place; what's missing is the embedding → retrieval → answer layer.

## Desired End State

A collapsible "Ask about your expenses" section at the top of `/receipts` accepts free-text questions. The backend embeds the question, runs hybrid retrieval (vector similarity + SQL date/category keyword supplements), calls GPT-4o once to generate an answer with cited receipt IDs, and returns source receipt cards the user can click through to verify.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Embedding unit | One per receipt | Simpler schema, one API call per upload, sufficient for aggregate questions | Plan |
| Embedding model | text-embedding-3-small (1536 dims) | Best cost/quality balance; standard pgvector config | Plan |
| Embedding timing | At upload time (pipeline tail) | Every new receipt immediately queryable; FR-012 compliance | Plan |
| Retrieval strategy | Hybrid: vector top-15 + SQL date/category keyword supplements, merged cap 20 | Handles both open-ended and date/category-specific queries without a second LLM call | Plan |
| Answer generation | Single GPT-4o call with `response_format: json_object` | Clean structured output; one LLM call per query | Plan |
| Citations | Linked receipt cards below the answer | Verifiable; cards link to existing `/receipts/{id}` detail pages | Plan |
| Query UI location | Inline collapsible section on `/receipts` | No new page; users stay in context of the receipt list | User |
| Query history | Stateless per session | Zero DB schema changes; no history table needed | Plan |
| Backfill | Lazy at query time + explicit `/api/receipts/backfill-embeddings` endpoint | Covers existing receipts; endpoint allows pre-warming | Plan |
| Queryable receipts | Only `processing_status = 'done'` | Pending/failed receipts have incomplete data; would pollute results | Plan |

## Scope

**In scope:** Embedding column + index + `match_receipts` RPC, embedding generation in upload pipeline, backfill endpoint, hybrid query API, inline collapsible query UI with answer + source cards.

**Out of scope:** Per-line-item embeddings, query history persistence, streaming answers, multi-turn conversation, date/entity extraction via LLM (keyword regex only), category correction UI.

## Architecture / Approach

Pure server-side RAG on Cloudflare Workers + Supabase + OpenAI. Each receipt gets one 1536-dimension embedding at upload time. At query time: embed the question → call `match_receipts` RPC (vector cosine similarity) → independently run SQL date/category supplements based on keyword detection → merge all receipt IDs → fetch full receipt + line-item data → single GPT-4o call with `response_format: json_object` → validate cited IDs → return answer + source metadata. The UI is a React island (`client:only="react"`) on the existing receipts list page, following the same pattern as `UploadForm`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema | `embedding vector(1536)` column, HNSW index, `match_receipts` RPC function, updated database.types.ts | Migration must apply without breaking existing data |
| 2. Embedding pipeline | Embeddings generated at upload tail; backfill endpoint for existing receipts | Embedding failure must not break the upload response |
| 3. Query API | POST `/api/receipts/query` — hybrid retrieval + GPT-4o answer + citation validation | Keyword extraction accuracy; GPT-4o JSON parse reliability |
| 4. Query UI | Collapsible query form on `/receipts`; answer + source cards | React island integration in index.astro; `client:only="react"` pattern |

**Prerequisites:** F-01 ✓, F-02 ✓, S-01 ✓ (extraction pipeline and receipt data in place)
**Estimated effort:** ~1–2 sessions across 4 phases

## Open Risks & Assumptions

- `match_receipts` RPC with a 0.3 cosine-similarity threshold may need tuning against real data — start there, adjust if too few or too many receipts are returned.
- Keyword-based date/category extraction covers common phrases but won't catch every phrasing (e.g. "Q4 last year", "the week before Christmas"). Vector search is the safety net for edge cases.
- At very small data volumes (< 5 receipts), vector similarity scores cluster near the threshold and retrieval may return few results — the friendly no-data message handles this gracefully.

## Success Criteria (Summary)

- A user can type "how much did I spend on food last month?" on `/receipts` and receive a correct, sourced answer citing the relevant receipts
- Source receipt cards are clickable and navigate to the correct detail page
- A question with no matching receipts returns a friendly no-data message, not a hallucinated amount
