# Add Eval Requirement

## Requirement

Agent World must generate a first-class eval contract beside the world config and provide a deterministic runner that proves the generated world routes correctly.

`.agent-world/world.json` says what the world is. `.agent-world/world.eval.md` says how we prove the world works. The eval contract must stay separate from router logic and must not pretend model behavior is deterministic.

## Acceptance Criteria

- Init guidance requires generated worlds to include `.agent-world/world.eval.md` beside `.agent-world/world.json` and prompt files.
- The generated eval contract is documented as a human-readable contract, not an eval run log.
- Eval guidance exists in a skill-relative `eval-agent-world.md` reference file.
- `SKILL.md` routes eval, test, verify, validate, confirm, and check requests to the eval reference.
- A deterministic `scripts/agent-world-eval.js` runner loads the world config, validates prompt/config contracts, parses JSON routing cases from `world.eval.md`, drives the existing router through file-based handoff, writes an eval report, and exits non-zero on failures.
- The eval runner does not call a live model.
- Routing cases can validate result type, agent, workflow node, and block code.
- The eval contract and docs distinguish deterministic config/routing checks from optional semantic smoke tests.
- Tests cover the eval runner's passing path and failed routing expectations.

## Non-Goals

- Do not build a second router.
- Do not add npm dependencies.
- Do not run live model smoke tests in deterministic CI.
- Do not redesign the existing router state or host handoff protocol.
