---
change_id: testing-bootstrap-critical-path
title: Bootstrap Vitest and critical-path integration tests for upload pipeline failure modes
status: implementing
created: 2026-06-03
updated: 2026-06-06

archived_at: null
---

## Notes

Phase 1 of the phased test rollout defined in `context/foundation/test-plan.md` §3.
Covers Risks #1 and #5: upload pipeline must never silently fail, must never leave a receipt stuck at 'processing'.
