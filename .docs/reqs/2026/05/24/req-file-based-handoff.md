# Requirement: File-Based Handoff

## Problem

The router currently puts the real instruction payload on stdout. That makes the tool result carry protocol data, human status, and debugging noise through the same channel. The contract is brittle: a log line can corrupt JSON, and large structured results become chat-visible output instead of an explicit artifact.

Agent World needs a cleaner boundary. Structured payloads belong in files. stdout is only a status notification. stderr and logs are for people debugging the script.

## Requirements

- The router must support `request.json` as the structured input handoff.
- The router must support `result.json` as the structured output handoff.
- `request.json` must carry the real command payload, including command name, message content, turn id, action id, and optional config/state paths.
- `result.json` must carry the same structured router result currently returned by stdout.
- stdout must be a brief status notification only, not the real payload.
- stderr must be reserved for errors and debug-facing output.
- The skill instructions must tell the host executor to use the file-based contract, not stdin/stdout JSON.
- Host-action result completion must use the same file-based path.
- Existing command behavior can remain as compatibility surface, but it must no longer be the documented Agent World host contract.

## Acceptance Criteria

- Tests prove a `user` request can be read from `request.json`, write a full `agent_instruction` to `result.json`, and keep stdout to a short status.
- Tests prove a `complete --turn` request can be read from `request.json` and write the next instruction to `result.json`.
- Tests prove a host-action result can be completed through `request.json` and `result.json`.
- Router docs and skill instructions show `request.json` / `result.json` as the primary host loop.
- `node --test tests/agent-world-router.test.js tests/mention-routing.e2e.test.js` passes.
