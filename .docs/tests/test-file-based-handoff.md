# E2E Test Spec: File-Based Handoff

The router must support a host loop where `request.json` and `result.json` carry the real structured payload, while stdout carries only a short status line.

## Scenario: User Message

1. Create a temporary world and state path.
2. Write `request.json` with command `user` and a message.
3. Run the router in file mode.
4. Confirm stdout is a short status notification.
5. Confirm `result.json` contains the full `agent_instruction`.

## Scenario: Agent Turn Completion

1. Start a run through file mode.
2. Write `request.json` with command `complete`, `turnId`, and content.
3. Run the router in file mode.
4. Confirm `result.json` contains the next router instruction.

## Scenario: Host Action Completion

1. Complete an agent turn that emits an `agent-world-host-action` block.
2. Confirm `result.json` contains `host_action`.
3. Write `request.json` with command `complete`, `actionId`, and a JSON result object.
4. Confirm `result.json` routes back to the requesting agent.
