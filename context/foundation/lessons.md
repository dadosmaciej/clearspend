# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Use client:only="react" for browser-API React islands

**Context:** `src/pages/receipts/upload.astro`, `src/pages/receipts/index.astro`

**Problem:** Plan specified `client:load` for `UploadForm`. Implementation
correctly used `client:only="react"` instead. `client:load` performs
SSR + hydration, which fails silently for components that use browser-only
APIs (Canvas, `useRef`, `window`). The plan directive was wrong.

**Rule:** Always use `client:only="react"` for React islands that depend on
browser APIs (canvas, useRef, window, document, fetch-on-mount). Reserve
`client:load` only for components that are fully SSR-safe. Update plans that
specify `client:load` for browser-API components before implementation begins.

**Applies to:** All React island planning and implementation in this project.
