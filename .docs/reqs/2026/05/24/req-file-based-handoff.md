# Requirement: File-Based Handoff

## Problem

The router currently puts the real instruction payload on stdout. That makes the tool result carry protocol data, human status, and debugging noise through the same channel. The contract is brittle: a log line can corrupt JSON, and large structured results become chat-visible output instead of an explicit artifact.

Agent World needs a cleaner boundary. Structured payloads belong in files. stdout is only a status notification. stderr and logs are for people debugging the script.

## Requirements

- The router must support timestamped `.agent-world/request-<timestamp>.json` files as the structured input handoff.
- The router must support timestamped `.agent-world/result-<timestamp>.json` files as the structured output handoff.
- The request file must carry the real command payload, including command name, message content, turn id, action id, and optional config/state paths.
- The result file must carry the same structured router result currently returned by stdout.
- stdout must be a brief status notification only, not the real payload.
- stderr must be reserved for errors and debug-facing output.
- The skill instructions must tell the host executor to use the file-based contract, not stdin/stdout JSON.
- Host-action result completion must use the same file-based path.
- Existing command behavior can remain as compatibility surface, but it must no longer be the documented Agent World host contract.

## Acceptance Criteria

- Tests prove a `user` request can be read from a timestamped `.agent-world/request-*.json`, write a full `agent_instruction` to a timestamped `.agent-world/result-*.json`, and keep stdout to a short status.
- Tests prove a `complete --turn` request can be read from a timestamped request file and write the next instruction to a timestamped result file.
- Tests prove a host-action result can be completed through timestamped `.agent-world` request/result files.
- Router docs and skill instructions show timestamped `.agent-world` request/result files as the primary host loop.
- `node --test tests/agent-world-router.test.js tests/mention-routing.e2e.test.js` passes.
