# Add Eval Plan

## Story

`add-eval`

## Plan

- [x] Inspect relevant files
- [x] Make focused changes
- [x] Run validation
- [x] Update docs/status

## Implementation Notes

- Update init guidance so generated world bundles include `.agent-world/world.eval.md`.
- Add `eval-agent-world.md` as the skill reference for deterministic eval flow and reporting.
- Update `SKILL.md` so eval-like user requests load the eval reference instead of manual inspection.
- Add `scripts/agent-world-eval.js` as a harness around `scripts/agent-world-router.js` file mode.
- Keep deterministic checks limited to config shape, graph/prompt references, prompt protocol requirements, router transitions, invalid handoff blocking, and stop-token completion.
- Parse fenced `json` objects from `world.eval.md`; use `given` steps and `complete` mocks to drive the router without a model.
- Write reports under `.agent-world/eval-runs/`, including pass/fail checks and case-level failure reasons.
- Add router/eval tests using temporary generated worlds and eval contracts.

## E2E Coverage

No browser or live model E2E spec is needed. The feature is a deterministic CLI harness and documentation contract. Subprocess tests against the router and eval runner are the correct coverage boundary.

## Architecture Review

AR passed: no blocking architecture flaws. The eval runner stays outside router ownership, drives the router through the existing file protocol, and treats model behavior as optional semantic smoke coverage instead of a deterministic CI contract.
