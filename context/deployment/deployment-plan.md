---
project: clearspend
planned_at: 2026-05-25
platform: Cloudflare Workers (Workers + Assets model)
stack: Astro 6 + React 19 + TypeScript + Supabase
infra_source: context/foundation/infrastructure.md
tech_stack_source: context/foundation/tech-stack.md
status: deployed
production_url: https://clearspend.dadosmaciej.workers.dev
deployed_at: 2026-05-25
---

# ClearSpend — First Deploy Plan

Target: Cloudflare Workers + Assets (free tier)  
Deploy command: `wrangler deploy` — uses `wrangler.jsonc` at project root  

**Lessons learned during this deploy (all wired into steps below):**
- `@astrojs/cloudflare` v13+ generates a Workers + Assets build, NOT a Pages build. `wrangler pages deploy dist/` uploads static files only and returns 404 on all SSR routes — do not use it.
- `disable_nodejs_process_v2` is NOT required with v13.5.0. The underlying `[object Object]` middleware bug was fixed in the adapter. Removing the flag allows `nodejs_process_v2` to run, which makes Worker **vars** accessible via `process.env`. Worker **secrets** are still NOT accessible via `process.env` — use `vars` for Supabase credentials (anon key + URL are public by design).
- `Astro.locals.runtime.env` was removed in Astro v6. `import { env } from "cloudflare:workers"` is the documented replacement but does NOT expose Worker secrets in the current adapter setup. Use `vars` in `wrangler.jsonc` instead.
- `astro:env/server` reads from `process.env`, which contains only `vars` (not secrets) when `nodejs_compat` is enabled.

---

## Phases

### Phase 0 — Local Pre-flight Fixes
> No external accounts or mutations. Fix the repo before touching any remote system.

- [x] **0.1 — Fix `wrangler.jsonc` name**  
  Change `"name": "10x-astro-starter"` → `"name": "clearspend"`.  
  The Worker script name must match what gets created on first deploy.  
  ✓ Already set correctly (2026-05-25)

- [x] **0.2 — Verify `nodejs_compat` flag — do NOT add `disable_nodejs_process_v2`**  
  `wrangler.jsonc` should have `"compatibility_flags": ["nodejs_compat"]` only.  
  `disable_nodejs_process_v2` was originally added as a workaround for a `[object Object]` middleware
  bug but is NOT required with `@astrojs/cloudflare` v13.5.0 — the bug is fixed. Adding it would
  prevent Worker vars from appearing in `process.env`, breaking `astro:env/server`.

  Result:
  ```jsonc
  {
    "name": "clearspend",
    "compatibility_date": "2026-05-08",
    "compatibility_flags": ["nodejs_compat"],
    "vars": {
      "SUPABASE_URL": "...",
      "SUPABASE_KEY": "..."
    }
  }
  ```
  ✓ Confirmed correct (2026-05-25)

- [x] **0.3 — Verify local build passes**  
  ```bash
  npm run build
  ```  
  Expected: `dist/client/` (static assets) + `dist/server/` (SSR chunks). No `_worker.js` at root —
  that's the Pages format. Workers format uses `dist/server/entry.mjs` as the worker entrypoint.  
  ✓ Build completed in 25s, no errors. Non-blocking warning: sitemap skipped (`site` URL not set in
  `astro.config.mjs` — add `site: "https://clearspend.dadosmaciej.workers.dev"` post-deploy). (2026-05-25)

- [ ] **0.4 — Verify local dev environment (optional smoke)**  
  ```bash
  npm run dev
  ```  
  Hit `/auth/signin` and `/dashboard`. If `/dashboard` redirects to `/auth/signin`, middleware is
  working correctly before deploy.

---

### Phase 1 — External Account Gates
> Manual steps only. No agent execution. Complete all before proceeding to Phase 2.

- [x] **1.1 — Cloudflare account**  
  Create a free account at `cloudflare.com` if you don't have one.  
  No credit card required for the free tier (100k requests/day on Workers).  
  ✓ Confirmed: logged in as dadosmaciej@icloud.com (wrangler whoami 2026-05-25)

- [ ] **1.2 — Generate a scoped Cloudflare API token** *(needed only for Phase 4 CI/CD, not for local deploy)*  
  Dashboard → My Profile → API Tokens → Create Token.  
  Use the **"Edit Cloudflare Workers"** template, then restrict scope:  
  - Account: your account  
  - Zone: not required  
  - Permissions: `Workers Scripts — Edit`  
  Do NOT use a Global API Key — unlimited blast radius.  
  Save the token value — it is shown only once.  
  The local wrangler OAuth session is sufficient for Phases 2 and 3.

- [x] **1.3 — Get your Cloudflare Account ID** *(needed only for Phase 4 CI/CD)*  
  ✓ Already known: `518aa77b8b07e154557f270f269e3297` (from wrangler whoami 2026-05-25).  
  Save alongside the Phase 1.2 token when wiring GitHub Secrets.

- [x] **1.4 — Supabase project**  
  Provision at `supabase.com` → New project.  
  - Region: closest to primary users (EU: `eu-central-1` Frankfurt; US: `us-east-1`).  
    See risk register: Supabase ↔ Cloudflare PoP distance adds 80–150 ms per request.  
  - Save the **Project URL** and **anon public key** — these become `SUPABASE_URL` and `SUPABASE_KEY`.  
  ✓ Confirmed: Supabase project created (2026-05-25).

- [x] **1.5 — Note Supabase Site URL for auth redirects**  
  Authentication → URL Configuration → Site URL.  
  After first deploy, update to: `https://clearspend.dadosmaciej.workers.dev`  
  ✓ Updated in Phase 3.3 (2026-05-25)

---

### Phase 2 — Cloudflare Worker Setup
> First-time CLI setup. Uses local wrangler OAuth — no API token needed yet.

- [x] **2.1 — Install and authenticate Wrangler**  
  ```bash
  npm install -g wrangler
  wrangler login
  ```  
  ✓ Confirmed: wrangler 4.90.0, OAuth as dadosmaciej@icloud.com,
  account ID 518aa77b8b07e154557f270f269e3297 (2026-05-25)

- [x] **2.2 — Add Supabase credentials as `vars` in `wrangler.jsonc`**  
  Worker **secrets** (`wrangler secret put`) are NOT accessible via `process.env` with `nodejs_compat`.
  Only plain-text **vars** reach `process.env`. Since `SUPABASE_KEY` is the anon/public key (designed
  to be public, already shipped in client-side JS) and `SUPABASE_URL` is a non-sensitive URL, both are
  safe as vars:
  ```bash
  # Edit wrangler.jsonc directly, or via wrangler deploy --var (v4+)
  ```
  ```jsonc
  "vars": {
    "SUPABASE_URL": "https://<ref>.supabase.co",
    "SUPABASE_KEY": "<anon public key>"
  }
  ```
  ✓ Added to `wrangler.jsonc` (2026-05-25). Confirmed visible in deploy output as Environment Variables.

- [x] **2.3 — (Informational) Cloudflare Pages project created but unused**  
  A Pages project named `clearspend` was created during initial deploy exploration
  (`wrangler pages project create clearspend --production-branch master`). It is unused —
  the actual deployment target is the Workers script. The Pages project can be deleted from the
  Cloudflare dashboard if desired.  
  ✓ Documented (2026-05-25)

---

### Phase 3 — First Manual Deploy
> Validates the full build → deploy → smoke test path before wiring CI.

- [x] **3.1 — Build the project**  
  ```bash
  npm run build
  ```  
  ✓ Build completed. Output: `dist/client/` (static assets) + `dist/server/` (SSR worker chunks). (2026-05-25)

- [x] **3.2 — Deploy to Cloudflare Workers**  
  ```bash
  wrangler deploy
  ```  
  Uses `wrangler.jsonc` at project root. Wrangler auto-selects `dist/server/wrangler.json` as the
  redirected config. On first deploy, auto-provisions KV namespace `clearspend-session` for the
  SESSION binding.  
  ✓ Deployed: https://clearspend.dadosmaciej.workers.dev  
  Current Version ID: 2acbeae4-795f-41c4-add2-9f0d27c2353e (2026-05-25)

- [x] **3.3 — Update Supabase Site URL**  
  Supabase Dashboard → Authentication → URL Configuration:  
  - Site URL: `https://clearspend.dadosmaciej.workers.dev`  
  - Redirect URLs: `https://clearspend.dadosmaciej.workers.dev/**`  
  ✓ Updated (2026-05-25)

- [x] **3.4 — Smoke test: middleware returns structured response (not `[object Object]`)**  
  ```bash
  curl -I https://clearspend.dadosmaciej.workers.dev/dashboard
  ```  
  ✓ HTTP 302 → `/auth/signin` (correct). `/auth/signin` returns 200 OK with proper HTML.
  No `[object Object]`. (2026-05-25)

- [x] **3.5 — Smoke test: Supabase connectivity**  
  ```bash
  curl -s https://clearspend.dadosmaciej.workers.dev/auth/signin | grep "Sign in"
  ```  
  ✓ Page renders sign-in form without "Supabase is not configured" banner. (2026-05-25)

- [ ] **3.6 — Smoke test: full auth flow**  
  In a browser:
  1. Navigate to `https://clearspend.dadosmaciej.workers.dev/auth/signup` → complete sign-up
  2. Confirm email (check inbox; Supabase sends confirmation by default)
  3. Navigate to `https://clearspend.dadosmaciej.workers.dev/dashboard` → should render, not redirect
  4. Sign out; verify redirect back to `/auth/signin`

- [ ] **3.7 — Smoke test: response body assertion after sign-in**  
  After signing in, `curl` the dashboard with a session cookie and assert the response body
  contains user-specific content (not a static fallback):
  ```bash
  # Browser DevTools → Network → Copy as cURL for an authenticated request
  curl '<dashboard-url>' -H 'Cookie: <auth-cookie>' | grep -v 'object Object'
  ```

---

### Phase 4 — GitHub Actions CI/CD Wiring
> Auto-deploy on merge to `master`. GitHub repo `clearspend` and GitHub CLI already in place.

- [ ] **4.1 — Add secrets to GitHub repository**  
  Repository → Settings → Secrets and Variables → Actions → New repository secret:  

  | Secret name | Value |
  |---|---|
  | `CLOUDFLARE_API_TOKEN` | scoped token from Phase 1.2 |
  | `CLOUDFLARE_ACCOUNT_ID` | `518aa77b8b07e154557f270f269e3297` |

  Note: `SUPABASE_URL` and `SUPABASE_KEY` live in `wrangler.jsonc` vars — no need to pass them
  as GitHub Secrets for the deploy step. The `wrangler deploy` command reads them from the file.

- [ ] **4.2 — Add deploy step to `.github/workflows/ci.yml`**  
  Append after the build step:
  ```yaml
  - name: Deploy to Cloudflare Workers
    if: github.ref == 'refs/heads/master' && github.event_name == 'push'
    run: npx wrangler deploy
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  ```
  The `if:` condition ensures deploy only runs on push to `master`, not on PRs.

- [ ] **4.3 — Push the workflow change and verify the Actions run**  
  Merge (or push directly to `master`) and watch the Actions run in the GitHub UI.  
  Deploy step should complete in under 60 seconds.

- [ ] **4.4 — Verify post-CI deploy matches smoke tests from Phase 3**  
  Re-run Phase 3.4 and 3.6 smoke tests against the deployment URL from Actions output.

---

### Phase 5 — Post-Deploy Operability Checks
> One-time setup for ongoing observability.

- [ ] **5.1 — Confirm `wrangler tail` works for live error monitoring**  
  ```bash
  wrangler tail --format json --status error
  ```  
  Trigger a deliberate 404 and confirm it appears in the stream.

- [ ] **5.2 — Verify SSR routes are not CDN-cached**  
  ```bash
  curl -si https://clearspend.dadosmaciej.workers.dev/ | grep -i 'cf-cache-status'
  ```  
  `MISS` or `DYNAMIC` is correct. `HIT` on an SSR route means stale CDN cache.

- [ ] **5.3 — Document the Supabase region choice**  
  Record which region was provisioned in `infrastructure.md` and why.

---

## Known Risks Active in This Deploy

| Risk | Mitigation |
|---|---|
| Worker secrets not in `process.env` — use vars for public credentials | Implemented: `SUPABASE_URL` + `SUPABASE_KEY` in `wrangler.jsonc` vars |
| `astro:env/server` only reads from `process.env` (vars, not secrets) | Implemented: credentials stored as vars, not secrets |
| `wrangler pages deploy` vs `wrangler deploy` confusion | Documented: only `wrangler deploy` is used in this project |
| Supabase ↔ Cloudflare PoP regional latency (80–150ms) | Phase 1.4 (region selection) + Phase 5.3 (doc) |
| `wrangler tail` sampling drops errors at high traffic | Phase 5.1 (live validation) |
| Supabase auth redirects broken after domain change | Phase 3.3 ✓ |

Risks deferred to post-MVP:
- SSR streaming disabled (client polling required for long operations)
- Durable Objects for WebSocket push ($5/mo)

---

## Rollback

```bash
# List recent deployments
wrangler deployments list

# Roll back to a specific deployment ID
wrangler rollback <DEPLOYMENT_ID>
```

Time-to-revert: under 60 seconds (atomic edge swap).  
**Database migrations do NOT roll back automatically.**

---

## Credentials Inventory

| Credential | Stored in | Notes |
|---|---|---|
| `SUPABASE_URL` | `wrangler.jsonc` vars | Non-sensitive URL; safe in config file |
| `SUPABASE_KEY` | `wrangler.jsonc` vars | Anon/public key; safe in config (already in client-side JS) |
| `CLOUDFLARE_API_TOKEN` | GitHub Secrets only | Rotate in Cloudflare dashboard → update GitHub secret |

`SUPABASE_KEY` here is the **anon/public key**, not the service role key. The service role key
(full DB access) must never be used in this Worker and must never appear in any config file.
