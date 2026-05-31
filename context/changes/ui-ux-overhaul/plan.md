# UI/UX Overhaul Implementation Plan

## Overview

Replace the starter-kit placeholder UI with a polished, branded ClearSpend product: a new design system (clean dark, Inter font, semantic tokens), a public marketing landing page, a real data-backed dashboard, and consistent styling applied across every page in the app.

## Current State Analysis

The app is fully functional but visually unfinished. The landing page (`/`) still renders the generic "10x Astro Starter" starter-kit hero. The dashboard (`/dashboard`) is a stub showing only the user's email and a sign-out button with zero data. No persistent navigation exists for authenticated app pages — `Topbar.astro` is wired only inside `Welcome.astro` and never reached app pages. The design language is split between a "cosmic dark" theme (auth pages, landing) and a "neutral dark" theme (receipts pages), producing jarring visual inconsistency. The CSS custom property system in `src/styles/global.css` is dormant — pages use hardcoded Tailwind neutral-* classes rather than the semantic token utilities.

A critical routing bug also exists: `POST /api/auth/signin` redirects to `/` (the public landing page) on success rather than `/dashboard`.

## Desired End State

At completion:

- `/` is a ClearSpend marketing page (hero + How-it-works) that correctly routes to sign-up and sign-in
- `/dashboard` shows a welcome heading, an "Upload Receipt" button, and the 5 most recent receipts in a compact list, fetched server-side
- Every page in the app — landing, auth, dashboard, receipts — uses the same clean dark palette (`#0d0d0f` background, `#1a1a1f` card surfaces, `#2a2a35` borders) with Inter font and purple-600 as the primary accent
- Authenticated app pages (`/dashboard`, `/receipts/*`) have a persistent top navigation bar: **ClearSpend** logo | **Receipts** | **Upload** | **Sign out**
- Signing in redirects to `/dashboard` instead of `/`

### Key Discoveries

- `src/pages/api/auth/signin.ts:19` — redirect target is hardcoded `/`; one-line fix
- `src/styles/global.css:41–73` — dark mode CSS vars already exist but are dormant; dark mode activates by adding `class="dark"` to `<html>` in `Layout.astro`
- `src/styles/global.css:113–115` — `@utility bg-cosmic` is the only custom CSS utility; it will be removed when no page references it
- `src/components/Topbar.astro` — correct auth-awareness pattern; will be replaced by `Navbar.astro`
- `src/components/Welcome.astro` — the entire component is the starter-kit placeholder; will be deleted
- `src/pages/receipts/index.astro:35–43` — the exact Supabase query pattern to reuse in the dashboard
- `src/pages/receipts/index.astro:45–57` and `src/pages/receipts/[id].astro:37–46` — status and category badge color maps to migrate into the new `Badge` component
- `src/components/ui/button.tsx` — CVA + `cn()` pattern is the component primitive standard; `Card` and `Badge` should follow it

## What We're NOT Doing

- No spending totals, trend charts, or NL query shortcut on the dashboard (recent receipts list only)
- No product screenshots on the landing page (text + lucide icons only)
- No sidebar navigation (top bar only)
- No shadcn/ui CLI additions — new components follow the existing CVA/cn pattern
- No multi-page landing (single-scroll marketing page only)
- No new API routes (dashboard uses direct Supabase SSR, same as receipts list)
- No changes to `QueryForm`, `UploadForm`, `SignInForm`, `SignUpForm`, or `SubmitButton` logic — restyle classes only
- No changes to auth endpoints beyond the one-line signin redirect fix

## Implementation Approach

Work in five independent, testable phases:

1. **Foundation first** — update the design token system, wire the font, add the Navbar to the layout shell, and fix the signin redirect. After Phase 1, the correct design system is in place for all subsequent phases to build on.
2. **New surfaces next** — landing page (Phase 2) and dashboard (Phase 4) are new pages; build them on the already-correct foundation.
3. **Restyle existing pages last** — auth pages (Phase 3) and receipts pages (Phase 5) use the new tokens to replace hardcoded classes.

## Critical Implementation Details

**Dark mode activation order**: The CSS custom property system in `global.css` is currently dormant because `<html>` lacks `class="dark"`. In Phase 1, the dark mode CSS variables must be updated to the new palette values **before** `class="dark"` is added to `Layout.astro` — otherwise the old dark values momentarily apply.

**Navbar replaces Topbar unconditionally**: `Navbar.astro` is rendered in `Layout.astro` for all pages (authenticated and not). It internally checks `Astro.locals.user` to show the correct links. The existing `Topbar.astro` (which lives inside `Welcome.astro`) becomes redundant once `Welcome.astro` is deleted in Phase 2.

**`client:only="react"` must be preserved**: `UploadForm` and `QueryForm` use browser APIs; their `client:only="react"` directives must not change during the Phase 5 restyle (per `context/foundation/lessons.md`).

---

## Phase 1: Design System & Foundation

### Overview

Update the CSS custom property token system to the new clean dark palette, introduce Inter variable font, create the `Navbar`, `Card`, and `Badge` UI primitives, wire the Navbar into the Layout shell, and fix the post-signin redirect.

### Changes Required

#### 1. Add Inter variable font dependency

**File**: `package.json`

**Intent**: Add `@fontsource-variable/inter` as a runtime dependency so Inter can be imported from CSS without an external CDN.

**Contract**: Add `"@fontsource-variable/inter": "^5.0.0"` under `dependencies`.

---

#### 2. Update global CSS — new palette tokens, font import, activate dark mode

**File**: `src/styles/global.css`

**Intent**: Update the dark mode CSS custom properties to the new palette, import Inter, map the font into the `@theme inline` block, and remove the now-obsolete `bg-cosmic` utility.

**Contract**:

- At the top of the file, before the `:root` block, add `@import "@fontsource-variable/inter";`
- In the `.dark { ... }` block (`global.css:41–73`), update these four properties to the new target values:
  - `--background` → near-black (`oklch(0.07 0.002 260)` ≈ `#0d0d0f`)
  - `--card` → dark surface (`oklch(0.11 0.002 260)` ≈ `#1a1a1f`)
  - `--border` → subtle divider (`oklch(0.17 0.002 260)` ≈ `#2a2a35`)
  - `--foreground` → off-white (`oklch(0.97 0 0)` ≈ `#f5f5f7`)
  - `--muted-foreground` → secondary text (`oklch(0.48 0 0)` ≈ `#6b7280`)
- In the `@theme inline { ... }` block (`global.css:75–111`), add: `--font-sans: 'Inter Variable', system-ui, sans-serif;`
- In the `@layer base { body { ... } }` block (`global.css:117–124`), add `font-family: var(--font-sans);` to the body selector
- Remove the entire `@utility bg-cosmic { ... }` block (`global.css:113–115`) — it becomes unreferenced after Phases 2 and 3

---

#### 3. Activate dark mode and wire Navbar in Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Enable the dark mode CSS variable system globally, import and render the new Navbar for all pages, and update the default page title from the starter-kit name to "ClearSpend".

**Contract**:

- Add `class="dark"` to the `<html lang="en">` element
- Change the default `title` prop value from `"10x Astro Starter"` to `"ClearSpend"`
- Import `Navbar` from `"../components/Navbar.astro"`
- Render `<Navbar />` as the first child of `<body>`, before the Banner map and before `<slot />`

---

#### 4. Create Navbar component

**File**: `src/components/Navbar.astro` (new file)

**Intent**: A single, auth-aware top navigation bar rendered on every page. Shows brand + app links when the user is authenticated; shows brand + auth links when not.

**Contract**:

- No props — reads `Astro.locals.user` directly
- When `Astro.locals.user` is truthy: render **ClearSpend** wordmark (left), then `Receipts → /receipts`, `Upload → /receipts/upload`, and a `POST /api/auth/signout` form button (right)
- When `Astro.locals.user` is falsy: render **ClearSpend** wordmark (left), then `Sign in → /auth/signin` and `Sign up → /auth/signup` links (right)
- Styling: sticky top nav (`sticky top-0 z-10`), `bg-background border-b border-border`, `px-4 py-3`, link color `text-muted-foreground hover:text-foreground`
- The active page link (determined by `Astro.url.pathname`) gets `text-foreground font-medium`

---

#### 5. Create Card primitive

**File**: `src/components/ui/card.tsx` (new file)

**Intent**: A reusable card container following the CVA/cn pattern; used for receipt rows on the dashboard and elsewhere.

**Contract**: A `Card` function component that accepts standard `React.HTMLAttributes<HTMLDivElement>`. Default classes: `rounded-lg border border-border bg-card`. Accepts an optional `className` prop merged via `cn()`. No CVA variants needed — one visual style suffices.

---

#### 6. Create Badge primitive

**File**: `src/components/ui/badge.tsx` (new file)

**Intent**: A reusable pill badge for processing status and item categories, replacing inline color class maps scattered across receipts pages.

**Contract**: Use CVA. Base classes: `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`. Variants object key `variant` with these values — preserve the existing color semantics from `src/pages/receipts/index.astro:45–57` and `src/pages/receipts/[id].astro:37–46`:

| variant | classes |
|---------|---------|
| `pending` | `bg-neutral-700/60 text-neutral-300` |
| `processing` | `bg-yellow-900/40 text-yellow-300` |
| `done` | `bg-green-900/40 text-green-300` |
| `failed` | `bg-red-900/40 text-red-300` |
| `food` | `bg-green-900/40 text-green-300` |
| `fuel` | `bg-yellow-900/40 text-yellow-300` |
| `electronics` | `bg-blue-900/40 text-blue-300` |
| `default` | `bg-neutral-700/60 text-neutral-300` |

Default variant: `default`. Export `badgeVariants` alongside the `Badge` component.

---

#### 7. Fix post-signin redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Redirect authenticated users to the dashboard after sign-in, not the public landing page.

**Contract**: Change the success redirect on line 19 from `context.redirect("/")` to `context.redirect("/dashboard")`.

---

### Success Criteria

#### Automated Verification

- `npm run build` passes without errors

#### Manual Verification

- Every page in the app loads Inter as the body font
- Signing in redirects to `/dashboard` (not the landing page)
- `/dashboard` shows the Navbar (ClearSpend | Receipts | Upload | Sign out)
- `/receipts` shows the Navbar
- `/auth/signin` shows the Navbar with Sign in | Sign up links (unauthenticated)
- The landing page `/` shows the Navbar with Sign in | Sign up links (unauthenticated)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Landing Page

### Overview

Replace the "10x Astro Starter" placeholder with a ClearSpend-specific marketing page: hero section with the product value proposition, "How it works" three-step section, and sign-up CTA. Delete `Welcome.astro` and `Topbar.astro` (both become unused).

### Changes Required

#### 1. Rewrite landing page

**File**: `src/pages/index.astro`

**Intent**: Replace the `<Welcome />` island with a direct, ClearSpend-specific single-scroll marketing page. Layout wrapper stays; all marketing content is inline in this file.

**Contract**:

Remove the `Welcome` import. Keep the `Layout` wrapper with `title="ClearSpend — Know what's in every receipt"`.

The page has three sections:

**Hero section** — centered, `py-24 sm:py-32`:
- `<h1>`: "Know what's in every receipt" — `text-4xl sm:text-5xl font-bold text-foreground`
- `<p>`: one-sentence value prop: "Upload a receipt photo. ClearSpend extracts every line item automatically and makes your expenses conversationally queryable." — `text-lg text-muted-foreground`
- Two CTA `<a>` tags: "Get started free → /auth/signup" (primary, `bg-purple-600 hover:bg-purple-500`) and "Sign in → /auth/signin" (secondary, `border border-border hover:bg-card`)

**How it works section** — `py-16`, centered heading "How it works":
Three equally spaced columns (`grid sm:grid-cols-3 gap-8`), each with:
- A step number badge (`bg-purple-600/10 text-purple-400`)
- A lucide icon (column 1: `Camera`, column 2: `Sparkles`, column 3: `MessageSquare`)
- A short heading and 1-sentence description:
  1. "Photograph your receipt" — "Take a photo with your phone and upload from your gallery."
  2. "Items extracted automatically" — "Every line item, price, shop name, and date is pulled out by AI."
  3. "Ask questions in plain English" — "Query your expense history naturally: 'How much on food last month?'"

**Footer CTA** — `py-16 text-center`:
- Heading: "Start tracking your expenses"
- Single primary CTA: "Create free account → /auth/signup"

---

#### 2. Delete Welcome component

**File**: `src/components/Welcome.astro`

**Intent**: Remove the now-unused starter-kit hero component to keep the codebase clean.

**Contract**: Delete the file. Verify no other file imports it before deleting (only `src/pages/index.astro` imported it, and that import is removed in the step above).

---

#### 3. Delete Topbar component

**File**: `src/components/Topbar.astro`

**Intent**: Remove the auth-aware nav bar that was only used inside `Welcome.astro`. Its functionality is now covered by `Navbar.astro`.

**Contract**: Delete the file. It was imported only in `Welcome.astro`, which no longer exists.

---

### Success Criteria

#### Automated Verification

- `npm run build` passes (no broken imports from deleted files)

#### Manual Verification

- `/` shows "Know what's in every receipt" as the page heading (not "10x Astro Starter")
- The three "How it works" steps are visible with icons
- "Get started free" CTA links to `/auth/signup`
- "Sign in" CTA links to `/auth/signin`
- Page is responsive on mobile (single column on small screens)
- No references to `Welcome.astro` or `Topbar.astro` remain in the codebase

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Auth Pages Restyle

### Overview

Remove the cosmic dark theme from auth pages and apply the new clean dark design system. This means replacing `bg-cosmic`, `bg-white/5 backdrop-blur-xl`, `border-white/10`, and `text-blue-100/*` classes with semantic tokens and plain dark surface classes. Component logic and form behavior are unchanged.

### Changes Required

#### 1. Restyle sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Remove the cosmic page wrapper and replace with the new dark palette using semantic tokens.

**Contract**: Replace the page's outer container classes (currently `min-h-screen bg-cosmic flex items-center justify-center`) with `min-h-screen bg-background flex items-center justify-center`. Replace the inner card container (currently `bg-white/5 backdrop-blur-xl border-white/10 rounded-2xl p-8`) with `bg-card border border-border rounded-xl p-8`. Update heading/subheading text from `text-white` / `text-blue-100/70` to `text-foreground` / `text-muted-foreground`.

---

#### 2. Restyle sign-up page

**File**: `src/pages/auth/signup.astro`

**Intent**: Same treatment as signin — remove cosmic classes, apply new palette.

**Contract**: Same class substitutions as `signin.astro` above.

---

#### 3. Restyle confirm-email page

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Remove cosmic background, update text colors to match new palette.

**Contract**: Replace `min-h-screen bg-cosmic` wrapper with `min-h-screen bg-background`. Replace the card container's `bg-white/5 backdrop-blur-xl border-white/10` classes with `bg-card border border-border`. Update text colors from `text-white` / `text-blue-100/70` to `text-foreground` / `text-muted-foreground`.

---

#### 4. Update FormField input colors

**File**: `src/components/auth/FormField.tsx`

**Intent**: Replace white-opacity input styling (designed for the cosmic glass-card background) with the new palette-appropriate classes.

**Contract**: Replace `bg-white/10` → `bg-background`, `border-white/20` → `border-border`, `placeholder-white/40` → `placeholder:text-muted-foreground`, `text-white` → `text-foreground`. Replace label `text-blue-100/80` → `text-muted-foreground`. Keep the error state classes (`border-red-400/60 focus:ring-red-400`, `text-red-300`) unchanged — they are semantic and palette-independent.

---

### Success Criteria

#### Automated Verification

- `npm run build` passes
- No TypeScript errors: `npm run typecheck` passes (if script exists)

#### Manual Verification

- `/auth/signin` renders with the new dark background (no gradient, no blurred orbs)
- Input fields are visible against the new background (no white-on-white issue)
- Error display renders correctly (red error text/border on invalid input)
- Form submission still works: signing in redirects to `/dashboard`
- `/auth/signup` and `/auth/confirm-email` are visually consistent with signin

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Dashboard Rebuild

### Overview

Replace the stub dashboard with a real, data-backed page. The page fetches the 5 most recent receipts server-side from Supabase, displays them in a compact list, and provides an Upload Receipt CTA and a "View all receipts" link.

### Changes Required

#### 1. Rebuild dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Turn the stub dashboard into a functional page with a Supabase SSR data fetch and a compact receipt list.

**Contract**:

Server-side setup (frontmatter):
- Import `createClient` from `../../lib/supabase`
- Access `Astro.locals.user` (already guaranteed by middleware)
- Create a Supabase client from `Astro.request` and `Astro.cookies`
- Query: `.from("receipts").select("id, shop_name, purchase_date, total_amount, processing_status, created_at").order("created_at", { ascending: false }).limit(5)` — reuse the pattern from `src/pages/receipts/index.astro:35–43`
- Define a `statusLabel` map (same keys as `receipts/index.astro:45–57`: pending/processing/done/failed → label string)
- Define a `statusClass` map (same color classes as receipts list)

Page structure (body):
- Outer wrapper: `mx-auto max-w-3xl px-4 py-8`
- Welcome heading `<h1>`: "Welcome back" — `text-2xl font-bold text-foreground mb-1`
- Subheading: user's email — `text-sm text-muted-foreground mb-8`
- Upload CTA: `<a href="/receipts/upload">` styled as the primary button (`bg-purple-600 hover:bg-purple-500 …`) with `Upload icon` from lucide-react and label "Upload receipt"
- Section heading "Recent receipts" — `text-lg font-semibold text-foreground mt-10 mb-4`
- If `recentReceipts` is empty: an empty-state paragraph "No receipts yet." with a link "Upload your first receipt →" to `/receipts/upload` — `text-muted-foreground`
- If receipts exist: an `<ul>` of compact rows, each row (`<li>` as a `<a href="/receipts/{id}">` link):
  - Left: shop name (`text-foreground text-sm font-medium`) or "Unknown shop" in `text-muted-foreground`; below it: purchase date or created_at slice — `text-xs text-muted-foreground`
  - Right: `€{total_amount.toFixed(2)}` if not null — `text-sm text-foreground`; status badge using `statusClass` map
  - Row styling: `flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 hover:bg-card/80 transition-colors`
- Footer link "View all receipts →" to `/receipts` — `text-purple-400 hover:text-purple-300 text-sm mt-6`

Note: The `Upload` lucide icon is used inline in the CTA link but the CTA is an `<a>` tag, not a React component — render the SVG path directly or use the Astro `<svg>` approach (no React island needed for a static icon in an Astro file).

---

### Success Criteria

#### Automated Verification

- `npm run build` passes
- TypeScript types are correct (Supabase returns typed rows from `Database["public"]["Tables"]["receipts"]["Row"]`)

#### Manual Verification

- `/dashboard` shows the Navbar at top
- The page title is "Welcome back" with the user's email below
- "Upload receipt" button is visible and navigates to `/receipts/upload`
- With real receipts in the database: the list shows up to 5 rows with correct shop name, date, amount, and status badge
- With no receipts: the empty-state message and "Upload your first receipt" link are shown
- "View all receipts" link navigates to `/receipts`
- Row links navigate to the correct `/receipts/{id}` detail page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 5.

---

## Phase 5: App Pages Restyle

### Overview

Apply the new design system to all four authenticated receipt surfaces: the receipts list, upload page, receipt detail, and the two React islands (`QueryForm`, `UploadForm`). The goal is visual consistency with the rest of the redesigned app — component logic and API calls are unchanged.

### Changes Required

#### 1. Restyle receipts list page

**File**: `src/pages/receipts/index.astro`

**Intent**: Migrate hardcoded `bg-neutral-*` and `border-neutral-*` classes to the new semantic tokens; preserve all filter, list, and query UI structure.

**Contract**:

- Page wrapper: keep `mx-auto max-w-2xl px-4 py-8`
- Filter preset buttons (active): `bg-purple-600 text-white` — unchanged (already correct)
- Filter preset buttons (inactive): replace `bg-neutral-700 text-neutral-300` → `bg-card text-muted-foreground hover:bg-card/80 border border-border`
- Custom date inputs: replace `bg-neutral-800 border-neutral-600 text-neutral-100` → `bg-background border-border text-foreground`
- Receipt list rows: replace `border-neutral-700 bg-neutral-800 hover:bg-neutral-700` → `border-border bg-card hover:bg-card/80`
- Status badge spans: replace inline class maps (`bg-neutral-700 text-neutral-300` etc.) with the new `Badge` component imported from `../../components/ui/badge`. Map `processing_status` values to the Badge `variant` prop directly
- The `QueryForm` island (`client:only="react"`) is restyled in step 4 — do not change its directive

---

#### 2. Restyle upload page

**File**: `src/pages/receipts/upload.astro`

**Intent**: Apply new dark palette to the upload page's minimal wrapper.

**Contract**: Page wrapper `mx-auto max-w-md px-4 py-8` stays. Update heading `text-2xl font-bold` color from `text-white` or `text-neutral-100` → `text-foreground`. The `UploadForm` island (`client:only="react"`) styling is handled in step 5.

---

#### 3. Restyle receipt detail page

**File**: `src/pages/receipts/[id].astro`

**Intent**: Migrate neutral-* classes to semantic tokens; use the new `Badge` component for status and category pills.

**Contract**:

- Page wrapper: `mx-auto max-w-2xl px-4 py-8`
- Back link: `text-muted-foreground hover:text-foreground` (replace `text-neutral-400 hover:text-neutral-200`)
- Receipt header card (`rounded-xl border`): replace `border-neutral-700 bg-neutral-800` → `border-border bg-card`
- Status banner rows: replace inline yellow/red/neutral-colored divs with semantic equivalents — `bg-yellow-900/30 border border-yellow-700/40` for processing, `bg-red-900/30 border border-red-700/40` for failed
- Receipt image container: replace `bg-neutral-800 border-neutral-700` → `bg-card border-border`
- Line items heading: `text-foreground` instead of `text-neutral-100`
- Line item rows: replace `border-neutral-700 bg-neutral-800` → `border-border bg-card`
- Category badge spans: replace the inline color map (`categoryClass`) with the `Badge` component from `../../components/ui/badge`, passing the category value as the `variant` prop
- Remove the inline `categoryClass` constant after migration

---

#### 4. Restyle QueryForm React island

**File**: `src/components/receipts/QueryForm.tsx`

**Intent**: Migrate neutral-* color classes to the new palette equivalents so the inline query UI is visually consistent with its parent page.

**Contract**: Do NOT change the `client:only="react"` directive. Replace:
- Container `bg-neutral-800 border-neutral-700` → `bg-card border-border`
- Header button `hover:bg-neutral-700` → `hover:bg-card/80`
- Textarea `bg-neutral-900 border-neutral-600 text-neutral-100 placeholder-neutral-500` → `bg-background border-border text-foreground placeholder:text-muted-foreground`
- Source link cards `border-neutral-700 bg-neutral-900 hover:border-neutral-600 hover:bg-neutral-800` → `border-border bg-background hover:bg-card`
- Text colors `text-neutral-100`, `text-neutral-400` → `text-foreground`, `text-muted-foreground`

---

#### 5. Restyle UploadForm React island

**File**: `src/components/receipts/UploadForm.tsx`

**Intent**: Update color classes to the new palette so the upload form matches the redesigned upload page.

**Contract**: Do NOT change the `client:only="react"` directive. Replace:
- File input `bg-neutral-800 border-neutral-700 text-neutral-100` → `bg-background border-border text-foreground`
- Label text `text-neutral-300` → `text-muted-foreground`
- Keep `file:bg-purple-600 file:text-white` — unchanged

---

### Success Criteria

#### Automated Verification

- `npm run build` passes

#### Manual Verification

- `/receipts` renders with the new dark palette (no neutral-800/900 patches visible)
- Filter buttons use the correct active (purple) and inactive (card surface) styling
- Receipt list rows use the new border/card styling; status badges render via the `Badge` component
- `/receipts/upload` heading and form match the new palette
- `/receipts/{id}` detail page uses card surfaces and semantic text colors; category badges render via `Badge`
- The NL query section (QueryForm) blends seamlessly with the receipts list background
- UploadForm styling matches the upload page
- No visual regressions on interactive states (hover, focus rings, disabled)
- App functions end-to-end: upload a receipt, see it in list, open detail, use NL query

**Implementation Note**: After completing this phase and all automated verification passes, confirm with manual end-to-end testing before closing the change.

---

## Testing Strategy

### Automated Tests

No unit test changes needed — this overhaul is purely visual. TypeScript type safety is validated by `npm run build` (Astro performs type checking at build time).

### Manual Testing Steps

1. **Full sign-up flow**: register with a new email → redirected to `/auth/confirm-email` (new style) → verify → sign in → redirected to `/dashboard` (not `/`)
2. **Landing page unauthenticated**: visit `/` → see ClearSpend hero, 3-step How-it-works, Sign up and Sign in CTAs
3. **Navbar state**: sign in → Navbar shows Receipts | Upload | Sign out; sign out → Navbar shows Sign in | Sign up
4. **Dashboard empty state**: sign in with a fresh account → dashboard shows "No receipts yet" empty state
5. **Dashboard with data**: sign in with an account that has receipts → see up to 5 most recent rows; click a row → goes to correct detail page
6. **Receipts list**: navigate to `/receipts` → same data as before the overhaul, filters still work
7. **Receipt upload**: upload a real receipt → processing status badge appears; wait for extraction; detail page shows line items
8. **NL query**: on `/receipts`, open the query panel → ask a question → answer and sources render
9. **Mobile check**: test all pages in mobile viewport (375px); confirm nothing overflows or is unreadable
10. **Font verification**: confirm Inter is loading in browser devtools Network tab (WOFF2 from `/fonts/`)

## Performance Considerations

The Inter variable font bundle (`@fontsource-variable/inter`) is approximately 70–100 kB (WOFF2, subsetted). Add it as a `<link rel="preload">` in `Layout.astro`'s `<head>` to avoid render-blocking.

## References

- Research: `context/changes/ui-ux-overhaul/research.md`
- Status badge color source: `src/pages/receipts/index.astro:45–57`
- Category badge color source: `src/pages/receipts/[id].astro:37–46`
- Receipts query pattern to reuse in dashboard: `src/pages/receipts/index.astro:35–43`
- Auth-aware nav pattern reference: `src/components/Topbar.astro`
- CVA button primitive to follow for Card/Badge: `src/components/ui/button.tsx`
- Lessons log: `context/foundation/lessons.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design System & Foundation

#### Automated

- [x] 1.1 `npm run build` passes — f063184

#### Manual

- [x] 1.2 Inter font loads on every page — f063184
- [x] 1.3 Signing in redirects to `/dashboard` — f063184
- [x] 1.4 Authenticated pages show the Navbar (ClearSpend | Receipts | Upload | Sign out) — f063184
- [x] 1.5 Unauthenticated pages show the Navbar (ClearSpend | Sign in | Sign up) — f063184

### Phase 2: Landing Page

#### Automated

- [x] 2.1 `npm run build` passes (no broken imports from deleted files) — e8e031c

#### Manual

- [x] 2.2 `/` shows "Know what's in every receipt" heading — e8e031c
- [x] 2.3 Three How-it-works steps visible with icons — e8e031c
- [x] 2.4 "Get started free" CTA links to `/auth/signup` — e8e031c
- [x] 2.5 Page is responsive on mobile — e8e031c

### Phase 3: Auth Pages Restyle

#### Automated

- [x] 3.1 `npm run build` passes — 9261e4b
- [x] 3.2 TypeScript type check passes — 9261e4b

#### Manual

- [x] 3.3 `/auth/signin` uses new dark background (no gradient, no blurred orbs) — 9261e4b
- [x] 3.4 Input fields visible against new background — 9261e4b
- [x] 3.5 Form submission still works (signin redirects to `/dashboard`) — 9261e4b
- [x] 3.6 `/auth/signup` and `/auth/confirm-email` visually consistent with signin — 9261e4b

### Phase 4: Dashboard Rebuild

#### Automated

- [x] 4.1 `npm run build` passes
- [x] 4.2 TypeScript types correct (Supabase typed rows)

#### Manual

- [x] 4.3 "Welcome back" heading and user email visible
- [x] 4.4 "Upload receipt" button navigates to upload page
- [x] 4.5 With receipts: list shows up to 5 rows with shop name, date, amount, status badge
- [x] 4.6 With no receipts: empty state and "Upload your first receipt" link shown
- [x] 4.7 "View all receipts" link navigates to `/receipts`
- [x] 4.8 Receipt row links navigate to correct detail page

### Phase 5: App Pages Restyle

#### Automated

- [ ] 5.1 `npm run build` passes

#### Manual

- [ ] 5.2 `/receipts` renders with new dark palette; filter buttons correct
- [ ] 5.3 Status badges render via `Badge` component
- [ ] 5.4 `/receipts/upload` form matches new palette
- [ ] 5.5 `/receipts/{id}` uses card surfaces; category badges via `Badge`
- [ ] 5.6 QueryForm and UploadForm styling consistent with parent pages
- [ ] 5.7 End-to-end: upload receipt → see in list → open detail → NL query works
