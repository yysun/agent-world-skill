# Agent Context Scope Plan

## Goal

Add deterministic per-agent transcript scoping while preserving current worlds, then make every generated out-of-box workflow choose an explicit scope suited to each role.

## Current Context

- `scripts/agent-world-router.js` normalizes agents, persists all messages in shared state, and currently builds context by taking the final 18 messages from the current run.
- `buildAgentInstruction` exposes both `routedFrom` and the compact shared context.
- Agent messages already record `metadata.sourceMessageId`; a host-action result is already the direct source message for its resumed agent turn.
- `world.schema.json` is the canonical config shape, while `init-agent-world.md` is the generation source of truth for nine built-in workflow patterns.
- `world.example.json` is the checked-in canonical example. Tests use temporary JSON worlds and Node's built-in test runner.
- This is an internal router/config change, so no separate E2E specification is needed; subprocess router tests provide end-to-end coverage.

## Decisions

- Add `contextScope` to each agent with exactly two values: `global` and `agent`.
- Default omission to `global` for existing-world compatibility. Do not introduce a world-level override, environment variable, or secondary feature flag.
- Keep `routedFrom` outside scoped context and always expose it.
- Define `agent` as the current run's messages authored by the selected agent plus the current source message.
- Do not add causal traversal: joins and multiple host actions make a single-parent ancestry contract misleading without a larger message-model redesign.
- Use `global` for collectors, judges, final synthesizers, and stateful controllers that must merge independent messages; use `agent` for entry agents, sequential specialists, and isolated parallel workers.
- Preserve the existing limit of 18 messages. For `agent`, reserve one slot for `turn.sourceMessageId`, select up to 17 latest current-run messages authored by the agent, de-duplicate by message id, and restore chronological order.
- Render both the structured `context` and the `hostInstruction` conversation text from the same selected message array; no second global context read is allowed.
- In `world.example.json`, set `pm: global` because the same agent owns the final fan-in node; set `architect`, `dev`, `qa`, and `sec` to `agent`. The final synthesis requirement outweighs the entry node's otherwise-isolated role.

Exact built-in assignments:

| Pattern | `agent` scope | `global` scope |
| --- | --- | --- |
| `broadcast` | `broadcaster`, `researcher`, `critic`, `planner` | `collector` |
| `direct-handoff` | `sender`, `receiver` | none |
| `multi-agent-fan-out` | `lead`, `qa`, `security` | `collector` |
| `fan-in-collector` | `researcher`, `analyst` | `collector` |
| `sequential-pipeline` | `intake`, `architect`, `builder`, `reviewer` | `final` |
| `intent-router` | `router`, `docs`, `code`, `ops` | none |
| `fsm-state-token` | `planner`, `executor` | `state_router`, `reviewer` |
| `debate-ping-pong-loop` | `pro`, `con` | `judge` |
| `orchestrator-worker` | `worker_a`, `worker_b` | `orchestrator`, `synthesizer` |

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `scripts/agent-world-router.js`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, and existing router/eval tests to confirm context construction and generation boundaries.
- [x] Identify shared-state persistence, `sourceMessageId`, and host-action metadata behavior that must be preserved or extended.
- [x] Record native subagents, per-agent inbox files, scheduling changes, and user-world migration as non-goals.

### Phase 2 - Foundation changes

- [x] Update `world.schema.json` and router config normalization/validation so `contextScope` is represented, defaults to `global`, and invalid values fail clearly.
- [x] Update router source comments to document the new context-selection behavior.
- [x] Preserve host-action resumption behavior and verify the direct result message remains included under `agent` scope.

### Phase 3 - Feature implementation

- [x] Replace the single global `compactContext` path in `scripts/agent-world-router.js` with deterministic global and agent selectors tied to the pending turn.
- [x] Wire the selected scope into `buildAgentInstruction` while keeping `routedFrom` unconditional, reserving its `agent`-scope context slot, and rendering `hostInstruction` from that same selected context.
- [x] Confirm no world-level fallback flag, environment variable, per-agent inbox, or scheduling behavior is introduced.

### Phase 4 - Built-in workflow defaults and documentation

- [x] Update `world.example.json` so every sample agent declares the role-appropriate context scope.
- [x] Update `init-agent-world.md` canonical shape and add a machine-checkable mapping for all nine patterns so generated agents always declare the exact context scopes in the Decisions table.
- [x] Update `README.md` and `SKILL.md` with the context-scope contract and generation requirement.

### Phase 5 - Tests and verification wiring

- [x] Add direct schema assertions plus router tests for valid values, invalid runtime values, omitted-value defaulting, agent isolation in both structured context and rendered host instructions, global compatibility, source retention past the 18-message overflow boundary, previous-run exclusion for both scopes, and host-action continuity.
- [x] Add a deterministic test that parses the built-in mapping and proves all nine patterns and every listed sample agent have an explicit valid assignment.
- [x] Update eval fixtures to use explicit out-of-box context scopes and confirm deterministic eval remains compatible.
- [x] Run `node --test tests/*.test.js` and record the passing result: 57 tests passed, 0 failed.
- [x] Verify explicit `contextScope` assignments through the passing machine-checkable mapping test and canonical example assertions.
- [x] Assert `routedFrom` remains exact and separate in targeted `global` and `agent` scope tests.
- [x] Parse `world.example.json` in the generation-policy test and assert the exact `pm`, `architect`, `dev`, `qa`, and `sec` scope mapping.

### Phase 6 - Documentation and status

- [x] Update this plan's checkboxes only as implementation and verification evidence become complete.
- [x] Update the requirement acceptance checkboxes during verification using concrete code and test evidence.
- [x] Create `.docs/done/2026/07/19/agent-context-scope.md` with the final implementation and verification summary.

## Validation

- Run `node --test tests/*.test.js`; expect all router, mention-routing, and eval tests to pass.
- Inspect generated `agent_instruction.context`, rendered `hostInstruction`, `contextScope`, and `routedFrom` in targeted tests for both scopes.
- Run `git diff --check`; expect no whitespace errors.
- Run `rg -n "contextScope" world.example.json init-agent-world.md README.md SKILL.md world.schema.json`; expect schema, example, generation, and user documentation coverage.
- No browser or external E2E test is required because this changes a local CLI/router protocol exercised through subprocess tests.

## Rollback / Risk

- Existing worlds remain safe because omitted scope normalizes to `global`.
- The main correctness risk is dropping required fan-in input; built-in collectors therefore use `global`, and tests must prove branch isolation only for scoped workers.
- `agent` scope deliberately excludes sibling branches and older runs; tests must prove both boundaries while retaining the direct inbound message.
- Rollback is limited to removing `contextScope` handling and explicit generated fields; no persisted-state migration is required.

## Architecture Review

Preflight classification: not low-risk. The change stays in one router/config subsystem, follows the existing agent normalization pattern, adds no dependency, changes no authentication, infrastructure, deployment, concurrency, performance, or availability behavior, is reversible, and has explicit acceptance criteria. It does change the public world schema, so independent AR is required.

Independent AR found blocking ambiguity in the proposed `causal` mode, missing exact built-in assignments, and insufficient deterministic schema/generation checks. The plan now removes `causal`, defines the current-run boundary, locks the nine-pattern assignment table, and requires direct schema and mapping tests. Rerun pending.

The first rerun found three remaining precision gaps: mandatory source retention under the 18-message cap, accidental global rendering inside `hostInstruction`, and the shared `pm` role in the canonical example. The decisions and executable test tasks now specify all three, including previous-run exclusion for both scopes.

AR passed: no blocking architecture flaws. The final independent rerun confirmed the source-cap rule, scoped host instruction, canonical example mapping, nine-pattern mapping, prior-run isolation, schema checks, and generation checks are fully specified.
