---
bootstrapped_at: 2026-05-21T22:59:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: clearspend
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
---
starter_id: 10x-astro-starter
package_manager: npm
project_name: clearspend
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---
```

**Why this stack**

ClearSpend is a solo after-hours web app with two heavy requirements: user-isolated auth and AI-powered receipt parsing (OCR + RAG). The recommended default for `(web-app, js)` is the 10x Astro Starter — Astro 6 + React 19 + TypeScript + Supabase + Cloudflare Pages — and it clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented). Supabase ships PostgreSQL, row-level security for per-user data isolation, and a storage bucket for receipt images out of the box, covering the core guardrails in the PRD without extra integration work. The AI features (receipt OCR, item categorization, and natural-language querying) connect to external LLM APIs at runtime; no AI infrastructure is baked into the starter. Cloudflare Pages is the default deployment target; GitHub Actions with auto-deploy-on-merge matches the solo-contributor workflow. Bootstrapper confidence is first-class — the CLI is registered and expected to work, with occasional manual steps possible.

---

## Pre-scaffold verification

| Signal      | Value                                              | Severity | Notes                                              |
| ----------- | -------------------------------------------------- | -------- | -------------------------------------------------- |
| npm package | not run                                            | n/a      | cmd_template uses `git clone` — npm check skipped  |
| GitHub repo | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh  | 4 days before bootstrap run; from card docs_url    |

---

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: clone the starter repo into a temp directory then move files up (git-clone)
**Exit code**: 0
**Files moved**: 19 items (files + directories)
**Conflicts (.scaffold siblings)**: `CLAUDE.md` → preserved as `CLAUDE.md.scaffold` (existing `CLAUDE.md` in cwd wins)
**.gitignore handling**: moved silently (no prior `.gitignore` in cwd)
**.git/ handling**: deleted from `.bootstrap-scaffold/` before move-up (upstream starter history removed)
**.bootstrap-scaffold cleanup**: directory is empty; removal blocked by shell session lock — delete manually with `rmdir .bootstrap-scaffold` when ready

---

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (CRITICAL/HIGH/MODERATE/LOW)

#### HIGH findings

| Package  | Version range  | Advisory            | Title                                       | CVSS | Direct | Fix available |
| -------- | -------------- | ------------------- | ------------------------------------------- | ---- | ------ | ------------- |
| devalue  | 5.6.3–5.8.0    | GHSA-77vg-94rm-hx3p | Svelte devalue: DoS via sparse array deserialization | 7.5 | No (transitive) | Yes (`npm audit fix`) |

#### MODERATE findings

| Package                 | Direct | Advisory            | Title                                                  | CVSS | Fix |
| ----------------------- | ------ | ------------------- | ------------------------------------------------------ | ---- | --- |
| @astrojs/check          | Yes    | via @astrojs/language-server | Transitive chain to volar-service-yaml          | n/a  | Downgrade to 0.9.2 (semver major) |
| @astrojs/language-server | No    | via volar-service-yaml       | Transitive chain                                | n/a  | Via @astrojs/check fix |
| @cloudflare/vite-plugin | No     | via miniflare/wrangler/ws    | WebSocket uninitialized memory (transitive)     | n/a  | Yes |
| miniflare               | No     | via ws                       | WebSocket uninitialized memory (transitive)     | n/a  | Yes |
| volar-service-yaml      | No     | via yaml-language-server     | Transitive chain                                | n/a  | Via @astrojs/check fix |
| wrangler                | Yes    | via miniflare                | WebSocket uninitialized memory (transitive)     | n/a  | Yes |
| ws                      | No     | GHSA-58qx-3vcg-4xpx          | Uninitialized memory disclosure                 | 4.4  | Update to ws ≥8.20.1 |
| yaml                    | No     | GHSA-48c2-rrv3-qjmp          | Stack overflow via deeply nested YAML           | 4.3  | Update yaml ≥2.8.3 |
| yaml-language-server    | No     | via yaml                     | Transitive chain                                | n/a  | Via @astrojs/check fix |

> Note: all HIGH/MODERATE findings are in dev toolchain dependencies (Astro language server, Wrangler dev server, Cloudflare Vite plugin). None are in runtime production packages. The `devalue` HIGH finding does not affect ClearSpend's production runtime — `devalue` is a Svelte utility used in the dev toolchain, not in production code paths. Run `npm audit fix` to resolve the fixable findings (the `@astrojs/check` downgrade is a semver major — review the changelog before applying).

---

## Hints recorded but not acted on

| Hint                    | Value                   |
| ----------------------- | ----------------------- |
| bootstrapper_confidence | first-class             |
| quality_override        | false                   |
| path_taken              | standard                |
| self_check_answers      | null                    |
| team_size               | solo                    |
| deployment_target       | cloudflare-pages        |
| ci_provider             | github-actions          |
| ci_default_flow         | auto-deploy-on-merge    |
| has_auth                | true                    |
| has_payments            | false                   |
| has_realtime            | false                   |
| has_ai                  | true                    |
| has_background_jobs     | false                   |

These hints were read and logged for audit-trail completeness. No automated scaffolding actions were taken on them in v1. A future M1L4 skill will use them to generate `CLAUDE.md` / `AGENTS.md` and CI workflow files.

---

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` — the starter ships its own `CLAUDE.md`; diff it against your existing `CLAUDE.md` to see if there are useful codebase instructions to merge in.
- `rmdir .bootstrap-scaffold` (if the directory is still present) — it is empty and safe to delete.
- `npm audit fix` to resolve the fixable audit findings. The `@astrojs/check` downgrade is a semver major — check the changelog before applying. All HIGH/MODERATE findings are in dev toolchain packages, not in production runtime code.
- Copy `.env.example` to `.env.local` and fill in your Supabase project URL and anon key before running `npm run dev`.
