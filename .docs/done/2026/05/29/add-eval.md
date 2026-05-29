# Add Eval Done

## Summary

- Added `eval-agent-world.md` as the skill reference for deterministic Agent World evals.
- Updated `SKILL.md` so eval, verify, validate, confirm, test, and check requests follow the eval reference instead of manual inspection.
- Updated init guidance so generated world bundles include `.agent-world/world.eval.md` beside `world.json` and prompt files.
- Added `scripts/agent-world-eval.js`, an executable router-backed harness that validates config/prompt contracts, parses fenced JSON routing cases, writes eval reports, and exits non-zero on failure.
- Added eval runner tests for passing routing contracts and failed expectation reporting.
- Updated README and sample review prompts so the eval contract is visible and prompt protocol checks are satisfied.

## Verification

- `node --check scripts/agent-world-eval.js` passed.
- `node --test tests/agent-world-router.test.js tests/mention-routing.e2e.test.js tests/agent-world-eval.test.js` passed: 51/51.
- `git diff --check` passed.
- Checked new untracked files for trailing whitespace with `perl -ne ...`; no issues found.
- CR passed: no blocking architecture, maintainability, or contract issues found.

## Notes

- No npm dependency was added.
- No live model smoke test was run; semantic smoke tests remain optional and separate from deterministic eval.
- `add-evel.md` was used as the source request and left unmodified.
