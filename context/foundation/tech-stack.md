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

## Why this stack

ClearSpend is a solo after-hours web app with two heavy requirements: user-isolated auth and AI-powered receipt parsing (OCR + RAG). The recommended default for `(web-app, js)` is the 10x Astro Starter — Astro 6 + React 19 + TypeScript + Supabase + Cloudflare Pages — and it clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented). Supabase ships PostgreSQL, row-level security for per-user data isolation, and a storage bucket for receipt images out of the box, covering the core guardrails in the PRD without extra integration work. The AI features (receipt OCR, item categorization, and natural-language querying) connect to external LLM APIs at runtime; no AI infrastructure is baked into the starter. Cloudflare Pages is the default deployment target; GitHub Actions with auto-deploy-on-merge matches the solo-contributor workflow. Bootstrapper confidence is first-class — the CLI is registered and expected to work, with occasional manual steps possible.
