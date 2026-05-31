---
date: 2026-05-31T00:00:00+00:00
researcher: claude-sonnet-4-6
git_commit: afd426e
branch: main
repository: 10x_dev_3
topic: "UI/UX overhaul — full visual redesign, public landing page, and dashboard with recent receipts"
tags: [research, codebase, ui, ux, tailwind, astro, react, components, routing, auth, design-tokens]
status: complete
last_updated: 2026-05-31
last_updated_by: claude-sonnet-4-6
---

# Research: UI/UX Overhaul

**Date**: 2026-05-31  
**Researcher**: claude-sonnet-4-6  
**Git Commit**: afd426e  
**Branch**: main  
**Repository**: 10x_dev_3

## Research Question

What does the current UI look like structurally — pages, components, styling, auth flow, navigation — so that the UI/UX overhaul can be planned with full evidence of what needs to change and what needs to be built from scratch?

**Scope agreed with user:**
- Dashboard: show **recent receipts only**
- Landing page: **public marketing page** (pre-auth, with sign-up CTA)
- Depth: **full visual overhaul** (new color palette, typography scale, layouts — everything restyled end-to-end)

---

## Summary

All functional prerequisites (F-01, F-02, S-01, S-02, S-03) are implemented. The app has a working but minimal UI: a cosmic-dark-themed landing page built on a starter template (still says "10x Astro Starter"), a stub dashboard showing only the user's email and a sign-out button, and three functional receipt pages (list, upload, detail). The design language is split between a "cosmic" auth/landing theme and a "neutral dark" app theme — a visual inconsistency. No shared navigation component or responsive layout wraps the authenticated app.

The overhaul needs to:
1. **Replace the landing page** (currently a starter-kit placeholder) with a ClearSpend-specific marketing page
2. **Replace the stub dashboard** with a real page showing recent receipts
3. **Apply a unified design system** across all pages — the cosmic/neutral split must be resolved into one coherent visual language
4. **Add a persistent navigation component** (none exists in the app shell beyond the Topbar on the landing page)

---

## Detailed Findings

### Current Page Inventory

| Route | File | Auth Guard | Status |
|-------|------|-----------|--------|
| `/` | `src/pages/index.astro` | No | Starter-kit placeholder (says "10x Astro Starter") |
| `/dashboard` | `src/pages/dashboard.astro` | Yes (middleware) | Stub — shows email + sign-out only |
| `/auth/signin` | `src/pages/auth/signin.astro` | No | Functional |
| `/auth/signup` | `src/pages/auth/signup.astro` | No | Functional |
| `/auth/confirm-email` | `src/pages/auth/confirm-email.astro` | No | Functional, env-aware |
| `/receipts` | `src/pages/receipts/index.astro` | Yes | Functional — date filter + list + QueryForm |
| `/receipts/upload` | `src/pages/receipts/upload.astro` | Yes | Functional |
| `/receipts/[id]` | `src/pages/receipts/[id].astro` | Yes | Functional — full detail + line items |

**Critical gap**: After sign-in, `POST /api/auth/signin` redirects to `/` (home page) — `src/pages/api/auth/signin.ts:19`. The user lands on the public landing page, not the dashboard. This must change to redirect to `/dashboard`.

### Auth Flow

- **Middleware** (`src/middleware.ts:4`): only `/dashboard` and `/receipts` are protected. `/receipts/upload` and `/receipts/[id]` are covered by the `/receipts` prefix match.
- **Sign-out** redirects to `/` (`src/pages/api/auth/signout.ts:9`) — acceptable, but must ensure `/` doesn't show auth nav for signed-out users.
- **Sign-in success redirect**: currently `/` — must change to `/dashboard`.

### Landing Page (current state)

`src/pages/index.astro` uses `Welcome.astro`, which is the starter-kit hero:
- Title: "10x Astro Starter" (`src/components/Welcome.astro:35`) — needs replacing with "ClearSpend"
- Three generic feature cards: Authentication, Modern Stack, Developer Experience (`src/components/Welcome.astro:57–124`) — needs replacing with product features (photo-to-items, item-level search, spending insights)
- Hero CTA buttons link to `/auth/signin` and `/auth/signup` — correct, keep the routing
- Uses `Topbar.astro` at top (`src/components/Welcome.astro:28`) — Topbar works correctly (shows Dashboard link when authenticated)

The `Welcome.astro` component should either be fully replaced or the `index.astro` page should stop using it and render new ClearSpend-specific content directly.

### Dashboard (current state)

`src/pages/dashboard.astro` renders (`src/pages/dashboard.astro:10–24`):
- "Dashboard" heading with gradient text effect
- "Welcome, {user.email}" message
- "This page is only for authenticated users." note
- A sign-out button

It imports nothing from Supabase — there is **no data fetching** on the dashboard. The overhaul must add a Supabase query for recent receipts.

**Data available for recent receipts** (from `src/pages/receipts/index.astro:35–43`):
```
receipts: id, shop_name, purchase_date, total_amount, processing_status, created_at
```
Query pattern: `.from("receipts").select(...).eq("user_id", user.id).order("created_at", { ascending: false }).limit(5)`

### Receipts List Page

`src/pages/receipts/index.astro` — already the most complex page. It includes:
- Date range filter buttons (this month / last month / last 3 months + custom) (`src/pages/receipts/index.astro:77–119`)
- Receipt rows linking to `/receipts/{id}` (`src/pages/receipts/index.astro:126–150`)
- `QueryForm` React island for NL querying (`src/pages/receipts/index.astro:4`, `client:only="react"`)
- Status badge color map already defined (`src/pages/receipts/index.astro:45–57`)

No changes to functionality needed here — only styling consistency.

### Component Inventory

**Auth components** (all under `src/components/auth/`):
- `FormField.tsx` — base input with icon, label, validation
- `PasswordToggle.tsx` — eye/eyeoff button for password inputs
- `ServerError.tsx` — error banner (reused across forms and receipts)
- `SignInForm.tsx` — complete sign-in form (email + password)
- `SignUpForm.tsx` — complete sign-up form (email + password + confirm)
- `SubmitButton.tsx` — loading-aware submit button

**Receipt components** (under `src/components/receipts/`):
- `UploadForm.tsx` — file upload with canvas resize, fetch submit
- `QueryForm.tsx` — collapsible NL query UI with source cards

**UI primitives** (under `src/components/ui/`):
- `button.tsx` — CVA-based polymorphic button (Radix Slot), variants: default/destructive/outline/secondary/ghost/link
- `LibBadge.astro` — tech stack badge (starter-kit artifact, likely unused post-overhaul)

**Layout/navigation** (under `src/components/`):
- `Topbar.astro` — conditional nav bar (auth-aware, used only in Welcome.astro currently)
- `Welcome.astro` — the starter-kit landing hero, to be replaced/rewritten
- `Banner.astro` — info/warning/error status banners (used in Layout.astro for missing-config alerts)

**Layout** (`src/layouts/Layout.astro`):
- Imports `global.css`, `Banner.astro`, and `getMissingConfigs()`
- No header/nav — the Topbar is only wired inside `Welcome.astro`, not in the global Layout
- **Gap**: Authenticated app pages (dashboard, receipts) have NO top navigation bar

---

## Design Token Analysis

### Current Visual Split (the core problem)

The app has **two distinct visual themes** applied to different page groups:

**"Cosmic" theme** (auth pages + landing):
- Background: `bg-cosmic` — dark navy gradient (`linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a)`) defined in `src/styles/global.css:113–115`
- Containers: `bg-white/5` with `backdrop-blur-xl` (frosted glass)
- Borders: `border-white/10`
- Text: `text-white`, `text-blue-100/70`
- Accent: `bg-purple-600`, `text-purple-300`
- Decorative: animated blurred orbs, star-field radial gradient

**"Neutral dark" theme** (receipt pages):
- Background: implicit dark (body bg from CSS custom properties)
- Containers: `bg-neutral-800`, `border-neutral-700`
- Text: `text-neutral-100`, `text-neutral-400`
- Accent: `bg-purple-600` (consistent), `focus:ring-purple-500`

The purple accent color is consistent across both themes — this is the **strongest existing design anchor**.

### Tailwind Setup

- Tailwind v4.2.4 (`@tailwindcss/vite` integration — no `tailwind.config.ts` file)
- Custom design tokens live in `src/styles/global.css` as CSS custom properties (OKLch color space)
- The CSS variable system defines `--background`, `--foreground`, `--card`, `--primary`, etc. with full light/dark mode support (`src/styles/global.css:6–73`)
- These map into Tailwind via `@theme inline` (`src/styles/global.css:75–111`)
- Custom utility: `@utility bg-cosmic` (`src/styles/global.css:113–115`)
- `cn()` utility at `src/lib/utils.ts` (clsx + tailwind-merge)
- Icon library: `lucide-react` v1.14.0
- Component variant system: `class-variance-authority` v0.7.1

### Color Palette in Use

| Role | Class(es) | Where |
|------|-----------|-------|
| Primary action | `bg-purple-600`, `hover:bg-purple-500` | Buttons across the app |
| Focus ring | `focus:ring-purple-500`, `focus:ring-purple-400` | All interactive inputs |
| Nav/link accent | `text-purple-300`, `hover:text-purple-100` | Topbar, Welcome |
| Success/done | `bg-green-900/40 text-green-300` | Status badges |
| Warning/processing | `bg-yellow-900/40 text-yellow-300` | Status badges |
| Error/failed | `bg-red-900/40 text-red-300` | Status badges, ServerError |
| Neutral surface | `bg-neutral-800`, `bg-neutral-900` | Receipt page containers |
| Neutral border | `border-neutral-700`, `border-neutral-600` | Receipt cards |
| Cosmic background | `bg-cosmic` (custom utility) | Auth pages, landing |

### Typography Patterns

- Hero headings: `text-5xl sm:text-6xl font-bold` with `bg-gradient-to-r from-blue-200 via-purple-200 to-pink-200 bg-clip-text text-transparent`
- Page titles: `text-2xl font-bold text-white` (or `text-neutral-100`)
- Section headings: `text-lg font-semibold`
- Body text: `text-sm text-neutral-300` or `text-neutral-400`
- Labels: `text-sm text-blue-100/80` (cosmic) or `text-sm text-neutral-300` (neutral)
- No explicit font family loaded — using system sans-serif

### Spacing Conventions

- Page wrapper: `mx-auto max-w-2xl px-4 py-8` (receipts list) or `max-w-4xl` (Welcome)
- Auth form wrapper: `max-w-sm` with `p-6` or `p-8`
- Section bottom margin: `mb-6`
- Card internal padding: `p-4` to `p-6`
- Button padding: `px-4 py-2` (standard) or `px-6 py-3` (hero CTA)
- Flex gap: `gap-3` or `gap-4` most common

---

## Architecture Insights

### What the overhaul adds vs. changes

| Surface | Action | Notes |
|---------|--------|-------|
| `/` landing page | **Replace** Welcome.astro content with ClearSpend marketing | Route stays `/`; index.astro rewired |
| `/dashboard` | **Rebuild** with recent receipts query + receipt card list | Needs Supabase SSR fetch |
| Global layout | **Add** persistent nav bar for authenticated pages | Currently no header in app shell |
| All pages | **Restyle** to unified design system | Resolve cosmic/neutral split |
| Sign-in redirect | **Fix** `POST /api/auth/signin` redirect from `/` to `/dashboard` | `src/pages/api/auth/signin.ts:19` |

### Navigation gap

There is no persistent header/nav in the authenticated app shell. `Topbar.astro` exists but is only used inside `Welcome.astro`. The `Layout.astro` has no nav slot. The overhaul must either:
- Wire Topbar (or a new nav component) into `Layout.astro` directly, or
- Create a separate `AuthLayout.astro` that includes the nav bar for authenticated pages

Authenticated pages currently have zero navigation — a user on `/receipts/[id]` has no visible way back except a "← Back to receipts" link on the detail page.

### Lesson prior: `client:only="react"` required for browser-API islands

From `context/foundation/lessons.md`: any React island that uses canvas, `useRef`, `window`, or `fetch-on-mount` must use `client:only="react"`, not `client:load`. This applies to `UploadForm` (canvas resize) and `QueryForm` (fetch). The dashboard's recent-receipts section will be server-rendered Astro, so this lesson does not apply there — but any new interactive widget added to the overhaul must follow the rule.

### Data shape for dashboard recent receipts

The dashboard needs a Supabase query. Based on the existing receipts list query pattern (`src/pages/receipts/index.astro:35–43`):

```typescript
const { data: recentReceipts } = await supabase
  .from("receipts")
  .select("id, shop_name, purchase_date, total_amount, processing_status, created_at")
  .order("created_at", { ascending: false })
  .limit(5);
```

No new API routes needed — the dashboard is a server-rendered Astro page with direct Supabase SSR access (same pattern as the receipts list).

---

## Code References

- `src/pages/index.astro` — landing page (currently starter-kit placeholder)
- `src/pages/dashboard.astro` — stub dashboard; needs full rebuild
- `src/components/Welcome.astro` — the starter hero to replace; lines 33–52 (hero section), 57–124 (feature cards)
- `src/components/Topbar.astro` — existing nav bar; needs to be wired into the app layout
- `src/layouts/Layout.astro` — global layout; no nav slot currently
- `src/styles/global.css:113–115` — `bg-cosmic` custom utility
- `src/styles/global.css:6–73` — all CSS custom properties (the design token system)
- `src/styles/global.css:75–111` — Tailwind theme mapping
- `src/pages/api/auth/signin.ts:19` — post-signin redirect (must change from `/` to `/dashboard`)
- `src/pages/receipts/index.astro:35–43` — receipts query pattern to reuse in dashboard
- `src/pages/receipts/index.astro:45–57` — status badge color map (reuse in dashboard receipt cards)
- `src/pages/receipts/[id].astro:37–46` — category badge color map (reuse if dashboard shows categories)
- `src/components/auth/ServerError.tsx` — reusable error component
- `src/components/ui/button.tsx` — CVA button with variant system
- `src/lib/utils.ts` — `cn()` utility

---

## Historical Context (from prior changes)

- `context/changes/receipt-list-detail/plan.md` — Status badge colors (pending/processing/done/failed), category badge colors, date filter preset styling, `bg-purple-600` for active state. These are now live in production code.
- `context/changes/receipt-upload-extraction/plan.md` — Upload form max-width `max-w-md`, `px-4 py-8` page padding, success redirect pattern (`window.location.href`). Upload page already follows these conventions.
- `context/changes/natural-language-querying/plan.md` — QueryForm placed inline on `/receipts` (not a separate page), collapsible pattern, `bg-neutral-800 border-neutral-700` color scheme, `mb-6` wrapper spacing.

No research.md files exist in prior change folders — all UI evidence is from plan.md files.

---

## Open Questions

1. **Unified design language direction**: Extend the "cosmic dark" theme across all app pages (making receipts pages feel like the landing), or migrate to a cleaner "neutral dark" system across all pages (making auth pages match the app)? The landing page is the only public surface — it can stay cosmic while the app uses a refined neutral dark palette. **This needs user decision during planning.**

2. **Navigation structure**: Should the nav bar be: (a) a simple top bar with logo + links (Receipts, Upload, Sign out), or (b) a sidebar layout? Given the mobile-first PRD requirement and the current top-bar pattern in Topbar.astro, top nav seems right — but the plan should confirm.

3. **Landing page content**: The PRD has no marketing copy written. The plan must define the hero headline, value proposition text, and feature highlights to put on the landing page.

4. **Dashboard depth**: User confirmed "recent receipts only" — no spending totals, no categories, no NL query shortcut on the dashboard. This keeps the dashboard simple: a welcome message + recent receipts list + link to full receipts. Confirm during planning.

5. **Font pairing**: No custom font is loaded — using system sans-serif. A meaningful visual overhaul typically benefits from a deliberate font choice. Does the user want to introduce a web font (e.g., Inter, Geist)?
