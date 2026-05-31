# LLM Provider Integration Implementation Plan

## Overview

Install the `openai` SDK, wire `OPENAI_API_KEY` through Astro's typed env system, create a module-level OpenAI singleton in `src/lib/llm.ts`, and build an auth-protected smoke-test route that confirms GPT-4o vision is callable with a real image URL. This is foundation F-02 — no user-visible output, but S-01 (receipt OCR) and S-03 (NL querying) cannot start until this is in place.

## Current State Analysis

No LLM SDK is installed (`package.json` has no `openai` or similar). No LLM env vars exist in `.env.example` or `astro.config.mjs`. The app runs on Cloudflare Workers via `@astrojs/cloudflare`, which constrains SDK choice to edge-compatible packages. The `openai` v4+ SDK satisfies this — it uses the global `fetch` API with no Node.js-specific dependencies.

The existing `src/lib/supabase.ts` and `astro.config.mjs:18–21` establish the pattern to follow: env vars declared in `astro.config.mjs` env schema, imported via `astro:env/server`, client logic in `src/lib/`.

## Desired End State

`openai` package installed and in `package.json` dependencies. `OPENAI_API_KEY` declared as a server-secret in `astro.config.mjs` and documented in `.env.example`. `src/lib/llm.ts` exports a ready-to-use `openai` singleton that throws if the key is absent. `src/pages/api/llm/smoke-test.ts` is a permanent, auth-protected POST route that accepts `{ imageUrl: string }`, calls GPT-4o vision, and returns the model's response as JSON.

### Key Discoveries

- Env var pattern: `astro.config.mjs:18–21` — `envField.string({ context: "server", access: "secret", optional: true })`; imported via `import { VAR } from "astro:env/server"`
- Auth check pattern: `context.locals.user` is set by `src/middleware.ts:9–12`; null = unauthenticated
- API route pattern: `src/pages/api/auth/signin.ts:4` — `export const POST: APIRoute = async (context) => {...}`
- `openai` v4+ uses global `fetch`; confirmed Cloudflare Workers compatible without polyfills

## What We're NOT Doing

- Receipt OCR extraction prompt or categorization logic (S-01)
- NL querying pipeline (S-03)
- Streaming responses
- Retry/backoff beyond the SDK's built-in defaults
- Browser-side LLM access — server only

## Implementation Approach

Two phases: Phase 1 installs the package, wires the env var, and creates the client module. Phase 2 builds the smoke-test route. Both follow the exact `src/lib/` + `src/pages/api/` + `astro:env/server` pattern already established by the Supabase integration.

## Critical Implementation Details

- **Cloudflare Workers compatibility**: `openai` v4+ uses the global `fetch` API and avoids Node.js-specific runtime APIs, making it compatible with Cloudflare Workers without any polyfills or adapter configuration changes.
- **Module-level throw behavior**: In Cloudflare Workers, module-level code runs at Worker instantiation. A missing `OPENAI_API_KEY` will cause the Worker to fail at startup rather than at the first LLM request, surfacing misconfiguration immediately.

---

## Phase 1: Package + Env + LLM Client Module

### Overview

Install `openai`, declare the API key in Astro's env schema, and create the `src/lib/llm.ts` singleton. After this phase, any server-side file can `import { openai } from "@/lib/llm"` and use GPT-4o.

### Changes Required

#### 1. Install openai package

**File**: `package.json` (via `npm install openai`)

**Intent**: Add `openai` as a production dependency so the typed client is available in all server-side files.

**Contract**: Running `npm install openai` adds `"openai": "^4.x.x"` to `dependencies` and updates `package-lock.json`.

---

#### 2. Register OPENAI_API_KEY in Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declare `OPENAI_API_KEY` in Astro's typed env schema so it is importable as a typed string via `astro:env/server`, consistent with how `SUPABASE_URL` and `SUPABASE_KEY` are declared.

**Contract**: Add one entry to the `env.schema` block alongside the existing Supabase entries:

```js
OPENAI_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```

---

#### 3. Document env var in example file

**File**: `.env.example`

**Intent**: Add the new key to `.env.example` so contributors know to set it locally.

**Contract**: Append `OPENAI_API_KEY=###` as a new line.

---

#### 4. Create LLM client module

**File**: `src/lib/llm.ts` (new)

**Intent**: Export a module-level OpenAI singleton that throws immediately if `OPENAI_API_KEY` is absent. Unlike `supabase.ts` (which returns null for graceful degradation), the LLM key is mandatory for core product functionality, so misconfiguration should be loud.

**Contract**: Import `OPENAI_API_KEY` from `astro:env/server`; throw `new Error("OPENAI_API_KEY is not configured")` if falsy; export a named `openai` constant:

```ts
import OpenAI from "openai";
import { OPENAI_API_KEY } from "astro:env/server";

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured — add it to your .env file");
}

export const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
```

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`
- `openai` appears in `package.json` under `dependencies`

#### Manual Verification

- `OPENAI_API_KEY` is importable in a test route without TypeScript errors
- Setting `OPENAI_API_KEY=` (empty) in `.env` surfaces a startup/import error confirming fail-fast behavior

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Smoke-test API Route

### Overview

Build the permanent, auth-protected smoke-test route that POSTs an image URL to GPT-4o vision and returns the model's response. Confirms the full path from API route → LLM client → OpenAI vision model works end-to-end.

### Changes Required

#### 1. Create smoke-test route

**File**: `src/pages/api/llm/smoke-test.ts` (new)

**Intent**: Provide an auth-gated POST endpoint that accepts `{ imageUrl: string }` and returns GPT-4o vision output as JSON. Kept permanently as a debug utility for diagnosing LLM connectivity or extraction issues (e.g., during S-01 work).

**Contract**: `export const POST: APIRoute`; return 401 if `!context.locals.user`; parse JSON body, return 400 if `imageUrl` is absent; call `openai.chat.completions.create` with `model: "gpt-4o"` and a content array combining a text prompt with an `image_url` entry; return `{ success: true, model, content }` on success, `{ error: string }` with status 500 on failure.

The vision content array shape (non-obvious):
```ts
content: [
  { type: "text", text: "Describe what you see. If this is a receipt, list the items and prices." },
  { type: "image_url", image_url: { url: imageUrl } },
]
```

### Success Criteria

#### Automated Verification

- TypeScript build passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification

- Unauthenticated POST to `/api/llm/smoke-test` → 401 response
- Authenticated POST with no `imageUrl` in body → 400 response
- Authenticated POST with a real receipt image URL → 200 response with `content` containing GPT-4o text describing the receipt

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation of the vision call before closing F-02.

---

## Testing Strategy

### Automated

- `npx astro check` — TypeScript correctness across all new files
- `npm run lint` — ESLint passes on `src/lib/llm.ts` and `src/pages/api/llm/smoke-test.ts`

### Manual Testing Steps

1. Set a valid `OPENAI_API_KEY` in `.env`
2. `npm run dev`
3. Sign in to the app
4. POST to `http://localhost:4321/api/llm/smoke-test` with `Content-Type: application/json` body `{ "imageUrl": "<public receipt image URL>" }`
5. Confirm 200 response with `success: true` and non-empty `content`
6. Sign out; repeat the POST — confirm 401 response

## References

- Roadmap F-02: `context/foundation/roadmap.md`
- Supabase client pattern: `src/lib/supabase.ts`
- Astro env schema: `astro.config.mjs:17–23`
- Auth check pattern: `src/middleware.ts:8–12`
- API route pattern: `src/pages/api/auth/signin.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Package + Env + LLM Client Module

#### Automated

- [x] 1.1 TypeScript build passes: npx astro check
- [x] 1.2 Linting passes: npm run lint
- [x] 1.3 openai appears in package.json dependencies

#### Manual

- [x] 1.4 OPENAI_API_KEY importable in a route without TypeScript errors
- [x] 1.5 Empty OPENAI_API_KEY causes startup error (fail-fast confirmed)

### Phase 2: Smoke-test API Route

#### Automated

- [x] 2.1 TypeScript build passes: npx astro check
- [x] 2.2 Linting passes: npm run lint

#### Manual

- [x] 2.3 Unauthenticated POST to /api/llm/smoke-test → 401
- [x] 2.4 Authenticated POST without imageUrl → 400
- [x] 2.5 Authenticated POST with receipt image URL → 200 with GPT-4o vision text
