# Done: Mention Routing Rules

## Summary

- Implemented normalized paragraph-start mention parsing in the router.
- Added optional greeting-prefix handling for `hey`, `hi`, `hello`, and `to`.
- Added case-insensitive agent id/display-name resolution with punctuation and spacing normalization.
- Routed `world.mainAgent`, `<world>TO:a,b</world>`, self-mention removal, and auto-reply behavior through the existing DAG checks.
- Added completion handling for `<world>STOP</world>`, `<world>DONE</world>`, and `<world>PASS</world>`.
- Added CLI-level E2E coverage for 25 mention-routing cases.
- Restored `mention-routing-rules.md` content after the earlier mistaken doc rewrite.

## Verification

- `node --test tests/mention-routing.e2e.test.js` passed: 25/25 tests.
- `node --test tests/agent-world-router.test.js tests/mention-routing.e2e.test.js` passed: 44/44 tests.
- `node --check scripts/agent-world-router.js` passed.
- `node --check tests/mention-routing.e2e.test.js` passed.
- `git diff --check` passed.
- CR passed after separating E2E coverage from focused router regression tests.

## Notes

- Added `.docs/tests/test-mention-routing-rules.md` for the E2E scenarios.
