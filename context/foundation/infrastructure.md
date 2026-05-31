---
project: clearspend
researched_at: 2026-05-21
updated_at: 2026-05-25
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (Workers + Assets model, via @astrojs/cloudflare v13+)
  database: Supabase (PostgreSQL + RLS + Storage, external)
---

## Recommendation

**Deploy on Cloudflare Workers (Workers + Assets model).**

`@astrojs/cloudflare` v13+ generates a Workers + Assets build — not a Pages Functions build. `wrangler pages deploy dist/` uploads only static files and returns 404 on all SSR routes; `wrangler deploy` is required. This was confirmed during the first deploy (2026-05-25): the Workers model is the actual runtime and the Pages project created during exploration is unused. Cloudflare Workers scores Pass on all five agent-friendly criteria, covers 100k requests per day on the free tier with no credit card required, and ships a first-class Claude Code integration guide from Cloudflare themselves.

**Deployed**: `https://clearspend.dadosmaciej.workers.dev` (2026-05-25)

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Cost (MVP) | Total |
|---|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | Free (100k req/day, no card) | **5/5 + cost bonus** |
| Vercel | Partial | Pass | Pass | Pass | Pass | Free (hard cap = offline) | 4.5/5 |
| Netlify | Partial | Pass | Pass | Pass | Pass | Free (300 credits/mo, hard cap = paused) | 4.5/5 |
| Render | Partial | Pass | Pass | Pass | Pass | Free SSR = 30–60s cold starts; $7/mo to fix | 4/5 |
| Railway | Partial | Partial | Pass | Pass | Pass | $5 trial (30d), then $5/mo | 3.5/5 |
| Fly.io | Partial | Partial | **Fail** | Pass | Pass | No free tier (removed Oct 2024), CC required | 2.5/5 |

**Scoring notes per criterion:**

- **CLI-first** — Cloudflare: `wrangler deploy / rollback / tail` all fully documented and scriptable (Pass). Vercel/Netlify/Render/Railway: rollback either limited (Hobby plan only = previous deploy) or UI-only (Fail on that axis). Fly.io: no rollback command — manual image re-deploy only.
- **Managed/Serverless** — Cloudflare, Vercel, Netlify: fully managed serverless edge (Pass). Render: managed containers, minimal ops (Pass). Railway, Fly.io: containers you configure and maintain (Partial).
- **Agent-readable docs** — Cloudflare: `developers.cloudflare.com/llms.txt`, per-product llms.txt files, any page fetchable as markdown via `Accept: text/markdown` (Pass, best in class). Vercel: `vercel.com/llms.txt` + `llms-full.txt` (Pass). Netlify: `docs.netlify.com/llms.txt` (Pass). Render: `render.com/llms.txt` + `llms-full.txt` + markdown pages (Pass). Railway: `railway.com/llms.txt` + `.md` page suffixes (Pass). Fly.io: no llms.txt, no bulk markdown export, copy-per-page only (Fail).
- **Stable deploy API** — All six platforms score Pass. Wrangler, Vercel CLI, Netlify CLI, Render CLI, Railway CLI, and flyctl all have predictable exit codes and no interactive prompts in CI mode.
- **MCP / Integration** — All six platforms ship an official MCP server (GA). Cloudflare additionally publishes a Claude Code + Cloudflare integration guide at `developers.cloudflare.com/agent-setup/claude-code/`.

**Soft-weight adjustments (interview Q2 = "minimize cost", Q3 = "no familiarity", Q4 = "single region", Q5 = "external providers fine"):**
- Cost sensitivity elevated Cloudflare Workers (truly free at MVP scale, no card) and penalized Fly.io (no free tier), Railway (paid after 30d trial), and Render (SSR needs $7/mo to avoid cold starts).
- No familiarity preference → no tie-breaker applied between Vercel and Netlify.
- Single-region preference → edge-native advantage for Cloudflare not credited (would apply for global reach).
- External providers fine → Supabase already chosen; platform-co-located DB irrelevant for all platforms.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Full Pass across all five criteria; free tier covers 100k requests per day with no card required; only platform with a dedicated Claude Code integration guide from the vendor; `wrangler tail` streams logs in real time with structured JSON output; MCP Code Mode server (launched April 2026) exposes 2,500+ API endpoints for multi-API agent orchestration. The dev environment already runs `workerd` via the Cloudflare Vite plugin in Astro 6, eliminating dev/prod divergence. `@astrojs/cloudflare` v13+ targets Workers + Assets natively.

#### 2. Vercel

Scores Pass on four of five criteria (Partial on CLI-first due to Hobby-tier rollback and 1-hour log retention). The free Hobby plan covers MVP traffic comfortably. The remote MCP server at `mcp.vercel.com` is GA. First-party Vercel Postgres and KV are deprecated — not relevant since the project uses Supabase. The Hobby plan restricts use to personal/non-commercial projects; ClearSpend (personal household budget tracker) fits that definition. Main agent workflow gap: logs disappear after 1 hour on Hobby, which makes post-incident debugging harder for an agent.

#### 3. Netlify

Matches Vercel on most axes: Astro 6 SSR GA, free credit-based plan covers MVP traffic, `@netlify/mcp` is GA, `docs.netlify.com/llms.txt` present. Drops behind Vercel on CLI-first because rollback is UI-only (no CLI command). An open issue (#16103, 2026-05-21) breaks Astro Actions with `output: 'static'` + the Netlify adapter post-Astro 6 upgrade — not directly relevant to this project (uses `output: 'server'`), but signals active adapter instability in the Astro 6 cycle.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **SSR streaming is disabled on Workers/Pages and has been since 2021 (GitHub #5900, still unresolved 2026-05-25).** The PRD requires "continuous visible progress feedback" for operations exceeding 30 seconds (receipt processing). Without streaming, the server-side path cannot deliver incremental updates — client-side polling against a separate endpoint is required, adding a state machine to the architecture.

2. **Worker secrets are NOT accessible via `process.env` with `nodejs_compat` — only `vars` are (confirmed 2026-05-25).** `wrangler secret put` encrypts the secret but does NOT inject it into `process.env`. `astro:env/server` reads from `process.env` (via `let _getEnv = (key) => process.env[key]` in the compiled runtime chunk) and therefore cannot see secrets. `Astro.locals.runtime.env` was removed in Astro v6; `import { env } from "cloudflare:workers"` is the documented replacement but also did NOT expose Worker secrets in the current adapter setup. **Mitigation**: Store Supabase anon URL and anon key as plain-text `vars` in `wrangler.jsonc` — both are safe to expose (already shipped in client-side JS). The service role key must NEVER be stored in any config file.

3. **Worker memory ceiling is tight for image-heavy request paths (128 MB default; 512 MB max on Unbound).** Receipt images from phone cameras can reach 3–6 MB. When an image upload passes through the Worker before forwarding to an external LLM API, memory pressure from the Astro SSR bundle + request body + runtime state can approach the free-tier ceiling. Images should be uploaded directly from the client to Supabase Storage, with the Worker receiving only the storage URL — not the raw bytes.

4. **`wrangler tail` enters sampling mode at high traffic, silently dropping log messages.** During a debugging session involving the receipt processing pipeline, sampled tail logs may miss the specific error event being investigated. This is a free-tier limitation resolved by the paid plan.

5. **Wrangler uses "redirected configuration" — `dist/server/wrangler.json` is the actual deploy config, not `wrangler.jsonc`.** The build adapter generates its own `wrangler.json` inside `dist/server/`. Wrangler merges `wrangler.jsonc` vars and flags into `.wrangler/deploy/config.json` at deploy time. Any manual edits to `dist/server/wrangler.json` will be overwritten on next build.

### Pre-Mortem — How This Could Fail

ClearSpend deployed on Cloudflare Workers in month one. The first user-facing problem appeared not from the LLM API — which was fast and accurate — but from the progress feedback pattern. The PRD's "visible progress feedback within 30 seconds" requirement was met in the design by an SSR response that streamed partial content as the API responded. When deployed to Workers, the stream never arrived: the browser waited for a full response, the user saw a blank screen for 15–25 seconds, and some abandoned the flow before the result appeared. The team added client-side polling, which introduced a secondary state machine that needed its own error handling, its own timeout logic, and its own race conditions between poll results arriving and the SSR page unmounting.

A future Wrangler upgrade regenerates `dist/server/wrangler.json` with new defaults. If that new config removes the `vars` block or changes `compatibility_flags`, the next deploy silently ships without Supabase credentials. The "Supabase is not configured" banner appears in production but monitoring shows HTTP 200 — auth is broken with no alert fired. The failure is discovered when a user cannot sign in.

### Unknown Unknowns

- **Supabase ↔ Cloudflare PoP regional distance adds 80–150 ms to every DB-touching request.** Workers execute at the Cloudflare PoP closest to the user. Supabase instances are pinned to one region. A Polish user hitting a Frankfurt PoP while Supabase is in `us-east-1` adds a transatlantic round-trip to every receipt query. Choose Supabase's region to match Cloudflare's primary data center for the expected user base.

- **Receipt images must not flow through the Worker — upload directly to Supabase Storage.** The correct pattern: the client uploads the image directly to Supabase Storage (using the Supabase client-side SDK and a signed URL), then sends only the storage path to the Cloudflare Worker. Any design that proxies the image bytes through the Worker risks hitting the 128 MB memory ceiling or the request body limit.

- **`wrangler pages deploy` and `wrangler deploy` are not the same command and are not interchangeable.** This was realized during the first deploy (2026-05-25): `wrangler pages deploy dist/` uploaded static assets but returned 404 on all SSR routes. `@astrojs/cloudflare` v13+ generates a Workers + Assets build with no `_worker.js` at root — the Pages command cannot run it. Every CI/agent script must use `wrangler deploy` (not the Pages variant).

- **Durable Objects (required for stateful WebSockets or server-sent events from the edge) need the Workers Paid plan ($5/mo).** If a future iteration moves from client polling to server-push for receipt processing status, Durable Objects are the Cloudflare-native primitive — but they are unavailable on the free tier.

## Operational Story

- **Preview deploys**: Cloudflare Workers does not auto-generate preview URLs per branch the way Pages does. To preview a branch, run `wrangler deploy --env preview` with a separate `[env.preview]` block in `wrangler.jsonc`, or deploy manually with a different Worker name. The current setup has no preview environment — production is the only deployed environment.
- **Secrets / credentials**: Supabase anon URL and anon key are stored as plain-text `vars` in `wrangler.jsonc` (both are public by design — the anon key is already shipped in client-side JS). Worker **secrets** (`wrangler secret put`) are encrypted at rest but are NOT accessible via `process.env` with `nodejs_compat` — `astro:env/server` and all server-side code that reads `process.env` will not see them. Do not use `wrangler secret put` for credentials that the Astro SSR runtime needs to read. The service role key must never be stored anywhere in this project.
- **Rollback**: `wrangler rollback [DEPLOYMENT_ID]` reverts to a prior deployment. Time-to-revert is under 60 seconds (atomic edge swap). Database schema migrations do not roll back automatically — rollback to a prior Workers deployment while a DB migration is live creates schema/code mismatch; plan migration sequencing carefully.
- **Approval**: all production deploys triggered via `wrangler deploy` or a GitHub Actions push to the production branch may be executed by an agent unattended. Rotating the Cloudflare API token or modifying DNS/WAF rules requires a human owner action in the dashboard.
- **Logs**: `wrangler tail --format json --status error` streams live Worker logs to stdout. On the free plan, logs are sampled at high traffic — the `--search <term>` flag narrows to relevant events. The Cloudflare MCP server exposes log queries for agent-readable structured access without requiring CLI authentication in every session.

## Risk Register

| Risk | Source | Likelihood | Impact | Status | Mitigation |
|---|---|---|---|---|---|
| SSR streaming disabled causes blank-screen UX during 15–30s receipt processing | Devil's advocate | H | H | Open | Implement client-side polling against a `/api/status/:jobId` endpoint from day one; do not design the receipt flow around server-side streaming. |
| Worker secrets not in `process.env` — `astro:env/server` cannot read secrets, only vars | Devil's advocate (confirmed 2026-05-25) | — | — | **Resolved** | Store Supabase anon URL and anon key as `vars` in `wrangler.jsonc`. Vars reach `process.env` via `nodejs_process_v2`. Both values are public by design. |
| Large receipt image proxied through Worker hits 128 MB memory ceiling | Devil's advocate | M | M | Open | Upload images directly from the client to Supabase Storage using a signed URL; pass only the storage path to the Worker. |
| `wrangler tail` sampling drops error events during debugging | Devil's advocate | M | L | Open | Use Sentry or a structured logging integration alongside tail for error capture; do not rely on tail as the sole error signal. |
| `dist/server/wrangler.json` overwritten on next build, silently dropping vars | Pre-mortem | L | H | Open | Keep `wrangler.jsonc` as the source of truth for vars; `wrangler deploy` merges them at deploy time. Smoke test post-deploy. |
| Client polling + SSR page unmount race condition causes lost receipt state | Pre-mortem | M | H | Open | Store processing job state in Supabase (persisted), not in ephemeral Worker memory; polling reads from Supabase, not Worker in-memory state. |
| Supabase region far from Cloudflare PoP adds 100–150ms to every authenticated request | Unknown unknowns | H | L | Open | Select Supabase region closest to the dominant user geography before provisioning; document the choice in this file. |
| `wrangler pages deploy` vs `wrangler deploy` confusion in CI or agent scripts | Unknown unknowns (realized 2026-05-25) | — | — | **Resolved** | Confirmed: only `wrangler deploy` is used. Pages project exists but is unused. All CI scripts must use the Workers command. |
| `_routes.json` misconfiguration causes SSR routes to serve stale CDN cache | Unknown unknowns | L | H | Open | Add a smoke test after every deploy that confirms authenticated routes return dynamic content (user-specific data, not a cached response). |
| Durable Objects required for future WebSocket-based status push, costs $5/mo | Unknown unknowns | L | L | Open | Document this cost point for v2 planning; current polling architecture does not require DOs. |

## Getting Started

These steps assume `wrangler` CLI v4+ and the project already scaffolded with `@astrojs/cloudflare` v13+ (included by the 10x Astro Starter). **Do not use `wrangler pages` commands — this project targets Workers, not Pages.**

1. **Install and authenticate Wrangler:**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Configure credentials as `vars` in `wrangler.jsonc`** — Worker secrets are NOT accessible via `process.env` with `nodejs_compat`. Use plain-text vars for the Supabase anon URL and anon key (both are public by design):
   ```jsonc
   {
     "name": "clearspend",
     "compatibility_date": "2026-05-08",
     "compatibility_flags": ["nodejs_compat"],
     "vars": {
       "SUPABASE_URL": "https://<ref>.supabase.co",
       "SUPABASE_KEY": "<anon public key>"
     }
   }
   ```
   Do NOT add `disable_nodejs_process_v2` — this workaround was required for a middleware bug that is fixed in `@astrojs/cloudflare` v13.5.0. Adding it would prevent vars from appearing in `process.env`.

3. **Build the project:**
   ```bash
   npm run build
   ```
   Expected output: `dist/client/` (static assets) + `dist/server/` (SSR Worker chunks). No `_worker.js` at root — that is the Pages format. Workers format uses `dist/server/entry.mjs` as the Worker entrypoint.

4. **Deploy to Cloudflare Workers:**
   ```bash
   wrangler deploy
   ```
   On first deploy, wrangler auto-provisions any KV namespaces declared in `wrangler.jsonc`. The deploy URL is `https://<worker-name>.<account>.workers.dev`.

5. **Verify the deployment** — confirm middleware returns structured HTML (not `[object Object]`) and Supabase credentials are loaded:
   ```bash
   curl -I https://<worker-name>.<account>.workers.dev/dashboard
   # Expect: HTTP 302 → /auth/signin
   curl -s https://<worker-name>.<account>.workers.dev/auth/signin | grep "Sign in"
   # Expect: sign-in form renders without "Supabase is not configured" banner
   ```

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wiring for auto-deploy-on-merge)
- Production-scale architecture (multi-region, HA, DR)
