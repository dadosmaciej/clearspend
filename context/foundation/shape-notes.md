---
project: "ClearSpend"
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: null
  hard_deadline: null
  after_hours_only: true
created: 2026-05-19
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 12
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction + missing capability (item-level detail) + data trapped on paper receipts"
    - topic: "primary persona"
      decision: "budget-conscious individual / household manager"
    - topic: "product insight"
      decision: "existing apps capture transaction totals only; item-level granularity is the unaddressed gap"
    - topic: "auth model"
      decision: "email/password only; OAuth deferred to v2"
    - topic: "user roles"
      decision: "flat per-user model — each user sees only their own receipts; household feature removed from scope"
    - topic: "product type"
      decision: "web-app (mobile + desktop browser)"
    - topic: "target scale"
      decision: "medium — dozens to a hundred users"
    - topic: "timeline"
      decision: "no hard deadline; after-hours work; mvp_weeks TBD"
  quality_check_status: accepted
---

<!-- Seed idea (verbatim): An app for expense tracking where users take a photo of a receipt and automatically by using llm each position on receipt is classified, name and price is tracked, also the details of seller and the store. Then this data is indexed in rag and user in natural language can ask for example: "How much did i spend on food/fuel/electronics between 5th september and 10th november". User should also be able to see some charts and statistics of his expenses -->

## Vision & Problem Statement

A budget-conscious household manager returns from a shopping trip and wants to log their receipt. Today, that means manually typing every line item — product name, price — plus the shop name and purchase date, then categorizing each item by hand. A typical grocery run with 15–20 items takes several minutes to enter, and the accuracy depends entirely on how disciplined the person is. Most give up after a few weeks.

The gap no current app fills: existing expense trackers (bank apps, Expensify, and similar tools) capture transaction-level totals — "€47 at Lidl on Tuesday." They do not capture what was inside that receipt. This means a user can answer "how much did I spend at supermarkets?" but cannot answer "how much did I spend on food vs. fuel vs. electronics across the last two months?" The data exists on every receipt; it has never been automatically extracted at item level and made conversationally queryable.

## User & Persona

**Primary persona: The Household Budget Tracker**

A budget-conscious individual — often the person in a household who manages spending across multiple store categories (food, fuel, electronics, and others) — who shops regularly and wants to understand where their money goes at a granular level. Their goal: be able to ask specific spending questions without manually building spreadsheets.

They reach for this product immediately after a shopping trip, receipt in hand or camera ready. The primary trigger is the friction of the current logging ritual.

## Access Control

Authentication: email/password only. Account-based — each user's data is accessible from any device. OAuth deferred to v2.

User model: flat per-user. Each account has its own isolated expense history. No sharing, no household groups, no multi-user collaboration in v1.

Roles: single role — authenticated user. Every user sees only their own receipts and can only query their own data.

## Success Criteria

### Primary
A user uploads a receipt image from their device gallery; every line item (name + price), the shop name, and the purchase date are extracted and categorized automatically by the LLM; the receipt appears in the filterable receipt list with correct data. This flow working end-to-end = the product works.

### Secondary
Natural language querying is functional: the user can ask "how much did I spend on food/fuel/electronics between [date] and [date]" and receive a correct, sourced answer from their expense history.

### Guardrails
- Receipt data is never silently lost: if a photo is submitted and processing completes, the structured data persists exactly as extracted.
- No expense data leaks across accounts: receipts logged by User A are never visible to User B under any path.
- Processing failures surface to the user: if the LLM fails to parse a receipt, the user sees an explicit error — not a silent empty result.
- New receipts never corrupt existing ones: adding a receipt does not modify or delete previously stored receipt data.

## Functional Requirements

### Authentication
- FR-001: User can register with email and password. Priority: must-have
  > Socrates: Counter-argument: OAuth alone covers auth, doubling the surface area with password-reset flows and email verification. Resolution: kept; email/password is the fallback users expect and removes a signup blocker for users without OAuth accounts.

- FR-002: User can log out. Priority: must-have
  > Socrates: Counter-argument: log out without account deletion is incomplete — a user who wants their data removed has no path. Resolution: kept as log-out only; account deletion deferred to v2.

### Receipt capture
- FR-003: User can upload a receipt image from their device gallery. Priority: must-have
  > Socrates: Counter-argument: in-app camera and gallery upload are two different UX flows. Resolution: scoped to gallery upload only for v1; the user photographs with their default camera app first. In-app camera in v2.

- FR-004: System extracts each line item (name, price) from the receipt image using best-effort extraction. Priority: must-have
  > Socrates: Counter-argument: partial extraction with no correction path produces bad data the user can't fix, eroding trust. Resolution: accepted as a known v1 limitation; best-effort is more useful than nothing for early users, and accuracy improves with prompt iteration.

- FR-005: System extracts shop name and purchase date from the receipt image; saves partial data when any field cannot be extracted. Priority: must-have
  > Socrates: Counter-argument: silent blank fields pollute the receipt list with "Unknown store" entries that degrade query quality. Resolution: kept; partial data saved with visible blank fields rather than discarding the whole receipt over one missing field.

- FR-006: System assigns a spending category to each line item automatically. Priority: must-have
  > Socrates: Counter-argument: wrong read-only auto-categories produce misleading charts. Resolution: accepted; category inaccuracy is a known v1 limitation to surface in onboarding. The spending-by-category chart is deferred to v2 until categorization accuracy is trustworthy.

- FR-007: User sees an explicit error with a retry option if the system cannot parse a receipt. Priority: must-have
  > Socrates: Counter-argument: an error with no recovery path is a dead end — the shopping trip data is lost with no recourse. Resolution: retry option added to the error state, giving the user one more attempt before accepting failure.

### Viewing
- FR-008: User can view a list of receipts filterable by date range. Priority: must-have
  > Socrates: Counter-argument: current-month-only is arbitrary and blocks month-to-month comparison immediately. Resolution: expanded to date-range filter; current month is the default view.

- FR-009: User can view the full detail of one receipt (items, prices, shop, date, categories). Priority: must-have
  > Socrates: Counter-argument: a detail screen duplicates what the list already shows at summary level. Resolution: kept; line items don't fit in a list row — the list shows shop/date/total, the detail shows every line item.

### Natural language querying
- FR-010: User can ask a natural language question about their expenses and receive an answer with source citations showing which receipts the answer drew from. Priority: must-have
  > Socrates: Counter-argument: wrong NL answers with no verification path destroy trust faster than having no query feature. Resolution: source citations added — every answer references the receipts it used, making wrong answers auditable.

- FR-011: System returns an answer drawn from the user's stored receipt data. Priority: must-have
  > Socrates: Counter-argument: without visible sourcing, answers are unverifiable. Resolution: source citations resolved in FR-010; FR-011 describes the retrieval layer that makes citations possible and stands as written.

- FR-012: System makes each processed receipt queryable through the natural language interface. Priority: must-have
  > Socrates: Counter-argument: example queries (date+category totals) could be answered with SQL — RAG is expensive infrastructure for simple filtering. Resolution: kept; RAG handles open-ended questions beyond date+category that don't map to a fixed SQL schema (e.g., "what was my most expensive single item last month?").

## User Stories

### US-01: User scans a receipt and sees extracted data

- **Given** a logged-in user with the app open
- **When** they select a receipt image from their device gallery and submit it
- **Then** they see the extracted line items (names, prices, categories), shop name, and date appear in their receipt list

#### Acceptance Criteria
- All line items visible on the receipt appear in the extracted list with auto-assigned categories
- Shop name and purchase date are captured (shown as blank if not extractable — receipt is not discarded)
- If parsing fails entirely, an explicit error message is shown with a retry option — not a silent empty result

## Business Logic

The app determines the spending category of every purchased item based on its name and store context.

The categorization rule consumes two user-facing inputs: the item name and the store name as extracted from the receipt image. It produces a category label for each line item (e.g., food, fuel, electronics). The user encounters this immediately after uploading a receipt — every extracted item arrives pre-categorized, with no manual tagging required.

The app also allows users to query their expense history in natural language. The query rule consumes a free-text question typed by the user (e.g., "how much did I spend on food between September 5th and November 10th?"). It produces a plain-language answer sourced from the indexed receipt data, with citations showing which receipts contributed to the answer. The user encounters this via a query input field; they type a question and receive a verifiable, source-backed response.

## Non-Functional Requirements

- A user sees extracted line items, prices, and categories within 30 seconds of submitting a receipt image (p95). Any operation that takes longer than 30 seconds shows continuous visible progress feedback.
- A user can request permanent deletion of all their data (receipts, extracted items, query history) and have the deletion honored. No data associated with a deleted account persists.
- The app is fully functional in the current release of mobile browsers (Safari on iOS, Chrome on Android) and desktop browsers (Chrome, Firefox, Safari on macOS/Windows). No native app install required.

## Non-Goals

- **No manual expense entry**: photo upload from the device gallery is the only input method. Users cannot type in expenses without a receipt image. Rationale: keeps scope narrow to the core photo-based capture loop; manual entry would require a separate UX and validation path.
- **No spending-by-category chart in v1**: deferred until auto-categorization accuracy is high enough that chart data is trustworthy. Rationale: a chart built on unreliable categories actively misleads users (confirmed in Socratic round on FR-011).
- **No multi-currency support**: all receipts are assumed to be in one currency. Cross-currency tracking, FX conversion rates, and currency detection are out of scope. Rationale: adds significant data-model and UX complexity for an edge case most early users won't hit.
- **No tax or accounting features**: no VAT breakdown, no expense report export, no tax deductibility tagging, no accountant-ready format. This is a personal expense tracker, not accounting software.

## Quality cross-check

Run on 2026-05-19. All six elements verified present:
- Access Control: present — email/password, flat per-user model
- Business Logic: present — one-sentence rule opens the section
- Project artifacts: present — shape-notes.md with valid checkpoint
- Timeline-cost acknowledged: present — user accepted longer runway on 2026-05-19
- Non-Goals: present — 4 explicit entries
- Preserved behavior: n/a (greenfield)

Status: accepted. No gaps to surface in /10x-prd Open Questions.

## Timeline acknowledgment
Acknowledged on 2026-05-19: MVP scope includes LLM receipt parsing, RAG pipeline, vector indexing, and natural language querying — this exceeds a 3-week after-hours timeline. User accepted the longer runway. Exact week estimate: TBD.
