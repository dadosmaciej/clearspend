# LLM Provider Integration — Plan Brief

> Full plan: `context/changes/llm-provider-integration/plan.md`

## What & Why

Install and wire the OpenAI GPT-4o client so the codebase has a callable LLM. This is foundation F-02 — no user-visible output on its own, but S-01 (receipt OCR + extraction) and S-03 (NL querying) cannot be built until a vision-capable LLM is reachable from an API route.

## Starting Point

No LLM SDK is installed; `package.json` has no `openai` or similar. No `OPENAI_API_KEY` is declared in `astro.config.mjs` or `.env.example`. The only external service client in the codebase is `src/lib/supabase.ts`, which establishes the pattern to follow.

## Desired End State

`openai` package installed, `OPENAI_API_KEY` wired through Astro's typed env system, `src/lib/llm.ts` exports a ready-to-use `openai` singleton, and a permanent auth-protected route at `POST /api/llm/smoke-test` confirms GPT-4o vision is callable with a real image URL.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| LLM provider | OpenAI GPT-4o | User preference | Plan |
| SDK vs raw fetch | openai npm SDK | Typed responses, Cloudflare Workers compatible, less manual error handling | Plan |
| Client shape | Module-level singleton | LLM client needs no request context; simpler call sites than factory | Plan |
| Missing key behavior | Throw at module init | LLM is core — fail fast; misconfiguration surfaces at Worker startup | Plan |
| Smoke-test auth | Auth-protected (context.locals.user) | Each call costs real API credits; open endpoint is a billing risk | Plan |
| Image delivery | Accept imageUrl from POST body | Flexible; any public URL works without code changes | Plan |
| Smoke-test lifetime | Keep permanently | Useful debug utility when S-01 extraction issues surface | Plan |

## Scope

**In scope:**
- `npm install openai`
- `OPENAI_API_KEY` in `astro.config.mjs` env schema + `.env.example`
- `src/lib/llm.ts` — module-level singleton, throws if key absent
- `src/pages/api/llm/smoke-test.ts` — POST, auth-gated, `{ imageUrl }` → GPT-4o vision → JSON

**Out of scope:**
- Receipt OCR extraction prompt / categorization (S-01)
- NL querying pipeline (S-03)
- Streaming responses
- Retry/backoff beyond SDK defaults
- Browser-side LLM access

## Architecture / Approach

One new lib file exports the OpenAI client; one new API route uses it to verify vision calls. Mirrors the existing `src/lib/supabase.ts` + `astro:env/server` pattern exactly. The only divergence from the Supabase pattern: `llm.ts` throws on missing key (rather than returning null) because LLM is mandatory for product function, not optional.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Package + Env + Client | openai installed, key wired, src/lib/llm.ts ready | openai v4+ needs to be confirmed compatible with Cloudflare Workers (expected: yes; verify during build) |
| 2. Smoke-test route | POST /api/llm/smoke-test confirms GPT-4o vision callable | Real API key required for manual verification — plan around having one ready |

**Prerequisites:** None (F-02 has no upstream dependencies in the roadmap)
**Estimated effort:** ~1 session across 2 phases

## Open Risks & Assumptions

- `openai` v4+ Cloudflare Workers compatibility is expected but must be verified during Phase 1 build (`npx astro check` + `wrangler deploy --dry-run` if available)
- A valid `OPENAI_API_KEY` with GPT-4o access must be available before Phase 2 manual verification

## Success Criteria (Summary)

- `npx astro check` passes after both phases with no type errors
- Unauthenticated POST to `/api/llm/smoke-test` → 401
- Authenticated POST with a real receipt image URL → 200 with non-empty GPT-4o vision text
