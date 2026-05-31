---
project: "ClearSpend"
version: 2
status: draft
created: 2026-05-26
updated: 2026-05-31
prd_version: 1
main_goal: market-feedback
top_blocker: capacity
---

# Roadmap: ClearSpend

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

ClearSpend fills the gap that existing expense trackers ignore: they capture transaction totals ("€47 at Lidl") but not what was inside the receipt. ClearSpend extracts every line item automatically from a photo and makes the data conversationally queryable, so a household budget manager can finally ask "how much did I spend on food vs. fuel vs. electronics over the last two months?" without building a spreadsheet. The core bet is that LLM-based OCR is now accurate enough that automatic item-level extraction from a receipt photo is worth using.

## North star

**S-01: Receipt upload and LLM extraction** — the smallest end-to-end slice whose successful delivery proves the core product hypothesis (the bet that photo → LLM extraction → structured receipt list works well enough to be useful with real users), placed as early as prerequisites allow because everything else only matters if this works.

> "North star" here means the single slice that, if shipped and tested with real users, would confirm or refute whether the product's central claim holds in practice. It is placed first because a failed north star makes all downstream slices irrelevant.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                                                                     | Prerequisites    | PRD refs                                                     | Status   |
|------|----------------------------|----------------------------------------------------------------------------------------------------------|------------------|--------------------------------------------------------------|----------|
| F-01 | receipt-data-schema        | (foundation) receipt schema, per-user RLS policies, storage bucket, and pgvector extension in place     | —                | §NFR, §Access Control, §Success Criteria Guardrails          | ready    |
| F-02 | llm-provider-integration   | (foundation) LLM provider client configured and smoke-tested; vision-capable model confirmed callable   | —                | FR-004, FR-006, FR-010, FR-011, FR-012                       | ready    |
| S-01 | receipt-upload-extraction  | upload a receipt photo, see every extracted line item, price, category, shop name, and date              | F-01, F-02       | US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007 | proposed |
| S-02 | receipt-list-detail        | browse receipts filtered by date range and view full line-item detail for any receipt                    | F-01             | FR-008, FR-009                                               | proposed |
| S-03 | natural-language-querying  | ask a natural language expense question and receive a sourced answer citing specific receipts             | F-01, F-02, S-01 | FR-010, FR-011, FR-012                                       | proposed |
| S-04 | ui-ux-overhaul             | experience a polished landing page, meaningful dashboard with spending summary, and consistent styling    | S-01, S-02, S-03 | —                                                            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                       | Note                                                                                       |
|--------|---------------------------|-----------------------------|--------------------------------------------------------------------------------------------|
| A      | Data foundation & viewing | `F-01` → `S-02`             | Pure data + display path; no LLM dependency; parallelisable with Stream B from F-01 onward.|
| B      | LLM pipeline              | `F-02` → `S-01` → `S-03`   | North star lives here; S-01 also requires F-01 (joins Stream A at F-01).                   |

## Baseline

What's already in place in the codebase as of 2026-05-26 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.3.1 + React 19, file-based routing, auth pages, Tailwind CSS components (`src/pages/`, `src/components/`)
- **Backend / API:** partial — Astro SSR + Cloudflare adapter wired; auth endpoints only (`src/pages/api/auth/`); no domain API routes
- **Data:** partial — Supabase client configured (`src/lib/supabase.ts`); no schema or migrations (`supabase/config.toml` only)
- **Auth:** present — Supabase email/password, middleware guard (`src/middleware.ts:12`), sign-in/sign-up/sign-out endpoints (`src/pages/api/auth/`)
- **Deploy / infra:** partial — GitHub Actions CI (`.github/workflows/ci.yml`) + Wrangler/Cloudflare Pages config (`wrangler.jsonc`); no Docker
- **Observability:** absent — no logging library, no error tracking, no metrics

## Foundations

### F-01: Receipt data schema

- **Outcome:** (foundation) PostgreSQL schema (receipts, line_items tables) with per-user row-level security policies, Supabase Storage bucket for receipt images, and pgvector extension enabled — data and storage are absent from baseline; nothing persists or is isolated until this lands.
- **Change ID:** receipt-data-schema
- **PRD refs:** §NFR, §Access Control, §Success Criteria Guardrails
- **Unlocks:** S-01 (upload and extraction need storage + persistence), S-02 (list and detail need the receipts/line_items tables), S-03 (NL querying needs the vector-ready schema)
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because all three slices write to or read from these tables; a schema change after S-01 ships risks a data migration on real user data — better to get the model right before writing live data.
- **Status:** ready

### F-02: LLM provider integration

- **Outcome:** (foundation) LLM API client configured in the codebase, credentials wired to environment variables, a vision-capable model (required for receipt image understanding) confirmed callable from an API route — absent from baseline.
- **Change ID:** llm-provider-integration
- **PRD refs:** FR-004, FR-006, FR-010, FR-011, FR-012
- **Unlocks:** S-01 (LLM OCR + categorization call), S-03 (NL query + answer generation)
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Which LLM provider and vision-capable model to use for receipt OCR? (Anthropic Claude, OpenAI GPT-4o, or OpenRouter routing to either) — Owner: user. Block: no (multiple viable options; can decide during `/10x-plan llm-provider-integration`).
- **Risk:** Sequenced before S-01 to avoid discovering a vision model limitation mid-slice; a failed OCR smoke test here is cheap, a failed OCR integration deep in S-01 is expensive.
- **Status:** ready

## Slices

### S-01: Receipt upload and LLM extraction

- **Outcome:** user can upload a receipt photo from their device gallery and see every extracted line item (name + price), assigned category, shop name, and purchase date appear in their receipt list; if parsing fails, an explicit error with a retry option is shown.
- **Change ID:** receipt-upload-extraction
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-02 (once F-01 is done, S-02's list/detail UI work can proceed independently; neither slice writes to or reads from the other)
- **Blockers:** —
- **Unknowns:**
  - Best-effort extraction accuracy is a known v1 limitation (accepted in Socratic review of FR-004); no correction UI planned for v1. Owner: user. Block: no.
- **Risk:** This is the riskiest slice — LLM OCR quality on real-world receipts is uncertain; sequenced immediately after Foundations so that quality signal arrives as early as possible and prompt iteration can begin before the rest of the product is built.
- **Status:** proposed

### S-02: Receipt list and detail views

- **Outcome:** user can view their receipts filtered by a date range (default: current month) and open any receipt to see all line items, prices, categories, shop name, and date.
- **Change ID:** receipt-list-detail
- **PRD refs:** FR-008, FR-009
- **Prerequisites:** F-01
- **Parallel with:** S-01 (S-02 depends only on F-01; S-01 depends on F-01 + F-02; neither blocks the other — the list/detail UI can be built and tested with seeded data while the upload/extraction pipeline is in progress)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Lower risk than S-01; the main concern is that the list UI is shaped around the schema decided in F-01 — if the schema changes after S-02 is built, the list component will need updating.
- **Status:** proposed

### S-03: Natural language expense querying

- **Outcome:** user can type a natural language question about their expenses (e.g., "how much did I spend on food in October?") and receive a plain-language answer that cites the specific receipts it drew from.
- **Change ID:** natural-language-querying
- **PRD refs:** FR-010, FR-011, FR-012
- **Prerequisites:** F-01, F-02, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How should receipts be indexed for retrieval — full receipt text + item list as one chunk, or one chunk per line item? Affects query accuracy vs. retrieval cost. Owner: user/TBD. Block: no (decision can be made during `/10x-plan natural-language-querying`).
- **Risk:** Sequenced last because it depends on real indexed receipts from S-01; a retrieval pipeline built on empty data is unverifiable. The secondary Success Criterion confirms this is valuable but not the core hypothesis.
- **Status:** proposed

### S-04: UI/UX overhaul

- **Outcome:** user lands on a compelling marketing/landing page that explains the product; after sign-in they see a dashboard with a meaningful spending summary (total this month, top categories, recent receipts); all pages share consistent typography, spacing, and color usage.
- **Change ID:** ui-ux-overhaul
- **PRD refs:** —
- **Prerequisites:** S-01, S-02, S-03 (overhaul is most useful once all functional slices exist and real data flows through the UI)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - What should the dashboard surface? (totals by category, month-over-month trend, recent receipts, NL query shortcut) — Owner: user. Block: no (decide during `/10x-plan ui-ux-overhaul`).
  - Is the landing page public (pre-auth marketing) or the post-auth home screen? — Owner: user. Block: no.
- **Risk:** Low functional risk — no new data model or API work. Main risk is scope creep; keeping the overhaul focused on the three named surfaces (landing, dashboard, global styling) prevents it from ballooning.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                          | Ready for `/10x-plan` | Notes                               |
|------------|---------------------------|----------------------------------------------------------------|-----------------------|-------------------------------------|
| F-01       | receipt-data-schema        | Design and migrate receipt data schema with RLS + pgvector     | yes                   | Run `/10x-plan receipt-data-schema` |
| F-02       | llm-provider-integration   | Wire LLM provider client and smoke-test vision model           | yes                   | Run `/10x-plan llm-provider-integration` |
| S-01       | receipt-upload-extraction  | Receipt photo upload + LLM extraction + list appearance        | no                    | Awaiting F-01 + F-02                |
| S-02       | receipt-list-detail        | Receipt list (date-range filter) + full receipt detail view    | no                    | Awaiting F-01                       |
| S-03       | natural-language-querying  | Natural language expense querying with receipt citations        | no                    | Awaiting F-01 + F-02 + S-01         |
| S-04       | ui-ux-overhaul             | Landing page, dashboard with spending summary, consistent styling | no                  | Awaiting S-01, S-02, S-03           |

## Open Roadmap Questions

1. **What is the MVP timeline in weeks?** — Owner: user. Block: roadmap-wide (soft — the answer may trim S-03 from v1 scope if the runway is very short; all slices can proceed to planning regardless, but knowing the timeline informs how aggressively to defer S-03).

## Parked

- **In-app camera capture** — Why parked: scoped to gallery upload only for v1 (PRD §Non-Goals); in-app camera is v2.
- **Spending-by-category chart** — Why parked: deferred until auto-categorization accuracy is trustworthy (PRD §Non-Goals, Socratic review of FR-006).
- **Multi-currency support** — Why parked: out of scope for v1; all receipts assumed single currency (PRD §Non-Goals).
- **Tax and accounting features** — Why parked: personal tracker, not accounting software (PRD §Non-Goals).
- **Manual expense entry** — Why parked: gallery photo upload is the only v1 input method (PRD §Non-Goals).
- **OAuth login** — Why parked: email/password is the only auth method in v1 (PRD §Access Control).
- **Account deletion** — Why parked: log-out only in v1; deletion deferred to v2 (Socratic review of FR-002).

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches a roadmap item is archived.)
