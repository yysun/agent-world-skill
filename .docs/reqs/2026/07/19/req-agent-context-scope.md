# Agent Context Scope Requirement

## Problem

Every Agent World agent currently receives the same recent global transcript. That leaks unrelated branch messages into specialized agents, makes fan-out behavior dependent on completion order, and prevents world authors from choosing the context boundary that matches an agent's job.

## Requirement

Agent World must support an agent-level context scope that controls which persisted messages are included in that agent's `agent_instruction`. The supported scopes must cover global run history and the agent's own current-run history plus its current inbound message. The exact routed-from message must remain available independently of transcript scope.

Generated out-of-box workflows must explicitly set the best context scope for every generated agent rather than relying on an implicit default. Existing worlds that omit the setting must keep today's global-context behavior.

## Acceptance Criteria

- [x] `world.schema.json` accepts only the documented agent-level context scope values: `global` and `agent`.
- [x] The router defaults a missing agent context scope to `global` and rejects unsupported values with an agent-specific configuration error.
- [x] `global` supplies the current run's recent shared transcript, preserving existing behavior.
- [x] `agent` supplies the message that directly triggered the current turn plus at most 17 of that agent's most recent messages from the current run, de-duplicated and returned in chronological order; this includes a host-action result when it triggers the resumed turn.
- [x] Every scope continues to expose the exact current `routedFrom` message in the instruction payload.
- [x] The canonical example and all nine out-of-box workflow patterns assign an explicit, role-appropriate context scope to every agent.
- [x] Router tests cover valid scopes, invalid configuration, backward-compatible defaulting, branch isolation, the existing 18-message limit, and host-action continuity; eval fixtures prove explicitly scoped worlds remain compatible with deterministic evaluation.
- [x] User-facing documentation explains the scope contract and the tradeoff between global synthesis and isolated work.

## Constraints

- Preserve the file-based request/result protocol and persisted state format.
- Preserve the existing 18-message context limit. Under `agent`, the direct source message is mandatory and the remaining 17 slots hold the most recent current-run messages authored by that agent.
- Do not add dependencies or a compatibility flag outside the agent configuration.
- Context selection must be deterministic from persisted router state and must not traverse or infer multi-parent causal history.

## Non-Goals

- Native host subagent execution.
- Per-agent state files or private inboxes.
- Changing mention routing, DAG edge validation, or workflow scheduling.
- Retrofitting user-owned `.agent-world/world.json` files.
