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

These paths have different bases:

- `ROUTER` is skill-relative. Resolve `scripts/agent-world-router.js` against the directory containing this `SKILL.md`.
- `WORLD` is project-relative. Resolve `agent-world.yaml` against the current working directory for the user's project/world.

Run router commands from the project/world cwd so the router finds `WORLD` at `./agent-world.yaml`. If the world file is elsewhere, set `AGENT_WORLD_CONFIG` to that project-relative or absolute path. Do not copy or generate a `scripts/` folder into the project cwd.

## Create Or Init Agent World

When the user asks to create, initialize, init, scaffold, or set up an Agent World, do not start the router loop yet. Creation is a host setup task.

Follow the skill-relative `init-agent-world.md` process. That process asks the user to choose a workflow from `messaging-patterns.md`, protects any existing `agent-world.yaml`, and writes the selected sample world into the current working directory.

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

## `blocked`

The router found a workflow problem it will not improvise around, such as an off-edge handoff, a turn-limit stop, or invalid routing state.

Report the `reason` to the user and stop the Agent World loop. Do not pick a fallback agent, bypass the DAG, or continue until the user gives a new top-level request or fixes the workflow.

## `idle`

No work is pending. Report that the Agent World workflow is idle.

## Driver Loop

Repeat until `type` is `done`, `blocked`, or `idle`:

1. Send the user message or previous completion to the router.
2. Read the returned JSON.
3. If `agent_instruction`, run exactly one agent turn and complete it.
4. If `host_action`, execute the host action and complete it.
5. If `blocked`, report the block and stop.
6. If `done`, return the final content.

## Reset

Only reset when explicitly asked:

```bash
node "$ROUTER" reset
```
