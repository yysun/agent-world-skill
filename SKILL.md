---
name: agent-world-skill
description: Host-driven Agent World skill. The host executor routes every scoped message through scripts/agent-world-router.js and runs exactly one returned agent instruction at a time.
---

# Agent World Skill

## Agent Contract

You are the host executor for Agent World.

Agent World owns:

- agent definitions and system prompts in `agent-world.yaml`
- the DAG workflow in `agent-world.yaml`
- message persistence
- paragraph-start `@mention` routing
- pending agent turns
- pending host actions
- stop signal detection using `<world>pass</world>`

The host executor owns:

- sending every scoped message to the router
- executing exactly one returned `agent_instruction`
- executing native tools only when the router returns `host_action`
- passing each result back to the router
- returning the final answer only when the router returns `done`

Do not route `@mentions` yourself. Do not choose the next agent yourself. Do not merge multiple agents into one assistant response. The router is the source of truth.

## Files

```bash
ROUTER="scripts/agent-world-router.js"
WORLD="agent-world.yaml"
```

Run router commands with the project/world cwd preserved. Resolve `ROUTER` relative to this skill folder; the router reads `agent-world.yaml` from the process cwd unless `AGENT_WORLD_CONFIG` is set. Do not copy or generate a `scripts/` folder into the project cwd.

## Start Or Continue

For every Agent-World-scoped message, pipe the exact message to the router:

```bash
printf '%s' "$USER_MESSAGE" | node "$ROUTER" user --stdin
```

Read the JSON response and follow its `type`.

## `agent_instruction`

The router returns the selected agent, loaded prompt, workflow node, context, and dynamic host instruction:

- `turnId`
- `agent`
- `role`
- `workflow`
- `systemPrompt`
- `context`
- `hostInstruction`
- `responseContract.completeByRunning`

Run exactly one turn as the named agent. Use `hostInstruction` as the execution brief. Produce one markdown message as that agent.

Rules:

- Do not answer as the host executor.
- Do not call tools during an agent turn.
- If the agent needs filesystem, shell, web, Git, or other host work, emit an `agent-world-host-action` JSON block.
- If the agent hands off with a paragraph-start mention such as `@architect`, stop after that handoff.
- Immediately pipe the agent message back to the router:

```bash
printf '%s' "$AGENT_RESPONSE" | node "$ROUTER" complete --turn "$TURN_ID" --stdin
```

Then follow the next returned JSON instruction.

## `host_action`

The router returns:

- `actionId`
- `requestedBy`
- `workflowNode`
- `kind`
- `reason`
- `approval`
- `payload`

Now the host executor may use native tools, if the action is safe and approved. Execute the requested host work honestly; do not invent success.

After completion, pipe a concise JSON result back:

```bash
printf '%s' "$HOST_ACTION_RESULT_JSON" | node "$ROUTER" complete --action "$ACTION_ID" --stdin
```

Suggested result:

```json
{
  "status": "succeeded | failed | skipped | denied",
  "summary": "what happened",
  "artifacts": [],
  "stdoutPreview": "",
  "stderrPreview": ""
}
```

## `done`

Return the router's `final` content. Stop.

## `idle`

No work is pending. Report that the Agent World workflow is idle.

## Driver Loop

Repeat until `type` is `done` or `idle`:

1. Send the user message or previous completion to the router.
2. Read the returned JSON.
3. If `agent_instruction`, run exactly one agent turn and complete it.
4. If `host_action`, execute the host action and complete it.
5. If `done`, return the final content.

## Reset

Only reset when explicitly asked:

```bash
node "$ROUTER" reset
```
