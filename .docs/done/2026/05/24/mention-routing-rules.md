# Done: Mention Routing Rules

## Summary

- Implemented normalized paragraph-start mention parsing in the router.
- Added optional greeting-prefix handling for `hey`, `hi`, `hello`, and `to`.
- Added case-insensitive agent id/display-name resolution with punctuation and spacing normalization.
- Routed `world.mainAgent`, `<world>TO:a,b</world>`, self-mention removal, and auto-reply behavior through the existing DAG checks.
- Added completion handling for `<world>STOP</world>`, `<world>DONE</world>`, and `<world>PASS</world>`.
- Restored `mention-routing-rules.md` content after the earlier mistaken doc rewrite.

## Verification

- `node --test tests/agent-world-router.test.js` passed: 14/14 tests.
- `node --check scripts/agent-world-router.js` passed.
- `git diff --check` passed.
- CR passed after tightening auto-reply routing so it cannot create off-edge terminal blocks.

## Notes

- No E2E spec was added because the behavior is deterministic router logic covered by CLI unit tests.
- Commit was not created yet because `mention-routing-rules.md` remains an untracked working-tree file and should not be staged without an explicit scope decision.
