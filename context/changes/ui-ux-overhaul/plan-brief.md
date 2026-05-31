# UI/UX Overhaul — Plan Brief

> Full plan: `context/changes/ui-ux-overhaul/plan.md`
> Research: `context/changes/ui-ux-overhaul/research.md`

## What & Why

Replace the starter-kit placeholder UI with a polished, branded ClearSpend product. All functional slices (F-01, F-02, S-01, S-02, S-03) are implemented and working — the app now needs a landing page that explains what it does, a dashboard that shows real data, and a design system that looks like an intentional product rather than a scaffolded template.

## Starting Point

The app has a landing page titled "10x Astro Starter," a dashboard stub that shows only the user's email and a sign-out button, and no persistent navigation on any authenticated page. Two conflicting visual themes exist side-by-side: "cosmic dark" (auth/landing) and "neutral dark" (receipts). A bug causes sign-in to redirect to `/` instead of `/dashboard`.

## Desired End State

After the overhaul: `/` is a ClearSpend marketing page with a hero and three-step "How it works" section; `/dashboard` shows a welcome heading, an Upload CTA, and the 5 most recent receipts in a compact list; every page in the app — landing, auth, dashboard, receipts — uses the same clean dark design system (near-black `#0d0d0f` background, dark card surfaces, Inter font, purple-600 accent). A sticky Navbar appears on all pages.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Visual direction | Clean dark product (no cosmic elements) | Neutral dark is already the pattern on receipts pages — least delta, most product-like | Plan |
| Accent color | Keep purple-600 | Already on every button/focus ring; zero migration cost | Research |
| Font | Inter (via `@fontsource-variable/inter`) | Industry standard for financial/dashboard UIs; excellent number glyph legibility | Plan |
| Navigation | Unconditional top Navbar (auth-aware) | Replaces defunct `Topbar.astro` pattern; wires into `Layout.astro` once | Plan |
| Landing sections | Hero + How-it-works (3 steps), text+icons only | No screenshot coupling to current UI; communicates product loop in seconds | Plan |
| Auth pages | Full restyle (same palette) | Keeping cosmic on auth pages creates jarring transition into the restyled app | Plan |
| Dashboard content | 5-row compact list of recent receipts only | Reuses exact receipts-list row pattern; no new query complexity | Plan + Research |
| Component strategy | Extend existing CVA/cn pattern (add Card, Badge) | Adding shadcn mid-project risks conflicts; existing Button pattern is proven | Plan |
| Signin redirect | `/` → `/dashboard` | One-line fix; authenticated users should land in the app, not the marketing page | Research |

## Scope

**In scope:**
- New CSS design tokens (updated `global.css` dark-mode vars + Inter font)
- `Navbar.astro` — new auth-aware top nav wired into `Layout.astro`
- `Card` and `Badge` UI primitives following CVA/cn pattern
- Rewritten `src/pages/index.astro` (ClearSpend marketing page)
- Delete `Welcome.astro` and `Topbar.astro` (replaced/obsolete)
- Full restyle of auth pages (signin, signup, confirm-email)
- Rebuilt `src/pages/dashboard.astro` with Supabase SSR data fetch
- Restyle of all receipts pages and React islands (QueryForm, UploadForm)
- One-line fix to `signin.ts` redirect target

**Out of scope:**
- Spending totals, trend charts, or NL query shortcut on the dashboard
- Product screenshots on the landing page
- Sidebar navigation
- `shadcn/ui` CLI additions
- New API routes
- Changes to form/upload logic

## Architecture / Approach

Dark mode is activated by adding `class="dark"` to `<html>` in `Layout.astro`, which makes the existing (dormant) CSS custom properties in `global.css` take effect. The dark-mode variable values are updated to the new palette before the class is added. `Navbar.astro` is rendered unconditionally in the layout and internally branches on `Astro.locals.user`. New `Card` and `Badge` primitives follow the existing `button.tsx` CVA pattern. The dashboard fetch reuses the exact Supabase query pattern from the receipts list page — no new abstractions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Design System & Foundation | New color tokens, Inter font, Navbar, Card/Badge primitives, signin redirect fix | Dark mode class activation order — tokens must be updated before the class lands |
| 2. Landing Page | ClearSpend marketing page; Welcome.astro and Topbar.astro deleted | Deleting Welcome.astro/Topbar.astro breaks build if any stale import remains |
| 3. Auth Pages Restyle | Signin/signup/confirm-email on new palette; FormField colors updated | Input field legibility on dark background (white-on-white if class swap is wrong) |
| 4. Dashboard Rebuild | Real Supabase SSR data; compact 5-receipt list; empty state | TypeScript typing of Supabase query result row |
| 5. App Pages Restyle | Receipts list, upload, detail, QueryForm, UploadForm on new palette | `client:only="react"` directives must not change (browser-API islands) |

**Prerequisites:** All functional slices implemented (confirmed — F-01, F-02, S-01, S-02, S-03 all show `implemented` or `impl_reviewed` status).  
**Estimated effort:** ~3–4 sessions across 5 phases. Phases 1–2 are foundational; 3 and 4 are moderate; Phase 5 is the largest surface area but lowest risk.

## Open Risks & Assumptions

- The `bg-cosmic` utility is assumed to only be used in `src/pages/auth/*.astro` and `Welcome.astro` — grep for stray usages before deleting the utility from `global.css` in Phase 3
- The `Camera` lucide icon name must be verified (lucide-react v1.14.0 — the correct name may be `Camera` or `CameraIcon`)
- Inter variable font requires `font-display: swap` to avoid render-blocking; `@fontsource-variable/inter` handles this, but confirm with a Network tab check after Phase 1

## Success Criteria (Summary)

- Signing in with valid credentials redirects to `/dashboard`, which shows real receipt data
- Every page in the app loads Inter and shares the same near-black background, card surfaces, and purple accent
- `/` introduces ClearSpend correctly to a first-time visitor and provides a clear sign-up path
