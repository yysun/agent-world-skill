# Done: File-Based Handoff

## Summary

- Added a router file mode that reads structured requests from `request.json` and writes full router results to `result.json`.
- Kept stdout to a short status line in file mode, so logs or tool output no longer carry the real handoff payload.
- Updated agent and host-action response contracts to point at the file-mode completion path.
- Updated `SKILL.md` and `README.md` so the documented Agent World host loop uses file handoff instead of stdin/stdout JSON.
- Added RPD requirement, plan, and E2E spec docs for the new contract.

## Verification

- `node --check scripts/agent-world-router.js` passed.
- `node --check tests/agent-world-router.test.js` passed.
- `node --test tests/agent-world-router.test.js` passed: 21/21 tests.
- `node --test tests/agent-world-router.test.js tests/mention-routing.e2e.test.js` passed: 46/46 tests.
- `git diff --check` passed.

## Notes

- The existing stdout JSON CLI remains as compatibility surface, but it is no longer the documented Agent World host contract.
