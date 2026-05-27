---
name: agent-world-skill
description: Use when the user intends to create, initialize, run, continue, route, inspect, or debug an Agent World workflow, including requests that mention Agent World, agent-world, agent world, world.json, or command-like forms such as agent-world: init. Treat command-like forms as natural-language requests, not tool calls.
---

# Agent World Skill

## Agent Contract

You are the host executor for Agent World.

Agent World owns:

- agent definitions and the DAG workflow in `.agent-world/world.json`
- the config schema in `.agent-world/world.schema.json`
- system prompts in `.agent-world/prompts/*.md`
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
WORLD=".agent-world/world.json"
```

These paths have different bases:

- `ROUTER` is skill-relative. Resolve `scripts/agent-world-router.js` against the directory containing this `SKILL.md`.
- `WORLD` is project-relative. Resolve `.agent-world/world.json` against the current working directory for the user's project/world.

Run router commands from the project/world cwd so the router finds `WORLD` at `./.agent-world/world.json`. If the world file is elsewhere, set `AGENT_WORLD_CONFIG` to that project-relative or absolute path. Do not copy or generate a `scripts/` folder into the project cwd.

## Create Or Init Agent World

When the user asks to create, initialize, init, scaffold, or set up an Agent World, do not start the router loop yet. Creation is a host setup task.

Treat shorthand command forms such as `agent-world: init`, `agent-world init`, `agent-world:init`, `agent world init`, and `init agent-world` as init requests. These are not requests to call an `init` tool or function. Do not report `unknown_tool` for these forms.

The init rules in this section are complete. Do not stop to read `init-agent-world.md`; some hosts expose only `SKILL.md` to the agent. Use `init-agent-world.md` only as optional human documentation.

Init process:

1. Resolve `.agent-world/world.json` under the current working directory. Create `.agent-world/` and `.agent-world/prompts/` if needed.
2. If `.agent-world/world.json` exists, ask whether to recreate and overwrite the generated world bundle. Do not write unless the user explicitly confirms.
3. On first create or confirmed recreate, require exactly one workflow pattern before writing. Do not infer, default, rename, group, shorten, or create files until the user chooses one exact pattern from the list below.
4. If the user did not already name exactly one pattern, ask them to choose with a structured ask-user-input, user-input, or human-in-the-loop tool that can show all nine patterns as selectable options. If no available tool can show all nine, ask in chat and list every pattern.
5. Do not present fewer than nine options. Do not replace the patterns with generic presets such as `Single-Agent Loop`, `Planner -> Executor`, `Planner -> Executor -> Reviewer`, `Specialist Router`, or `Custom`. Do not include `Custom` unless the user explicitly asks for a custom pattern.
6. On confirmed recreate, delete the existing `.agent-world/prompts/` directory before writing the new generated prompt files. Do not delete unrelated files under `.agent-world/`, such as request/result handoff files, state files, registry files, or user-owned notes.
7. Write the generated world bundle: `.agent-world/world.json`, `.agent-world/world.schema.json`, and `.agent-world/prompts/<agent>.md` for each generated agent prompt.
8. Use the cwd basename, normalized to kebab-case, as `world.id` and `world.name` unless the user gave a better name.
9. Include `"$schema": "./world.schema.json"` in `world.json`. Agent entries must use `promptPath`, not inline prompt text.
10. Report the created path and selected pattern. Do not run the router unless the user also asked to start using the world.

Supported workflow patterns:

- **Broadcast**: a human/world message with no paragraph-start mention can wake all eligible active agents.
- **Direct handoff**: one agent or human routes to one specific agent with a paragraph-start mention.
- **Multi-agent fan-out**: one message wakes multiple lanes with multiple paragraph-start mentions.
- **Fan-in / collector**: multiple agents report to a collector, which merges results and returns to the human.
- **Sequential pipeline**: agents proceed in order, such as spec -> build -> test -> review.
- **Intent router**: one router classifies the request and mentions exactly one specialist.
- **FSM / state-token workflow**: agents carry state tokens such as `[STATE=PLAN]` and route by state.
- **Debate / ping-pong loop**: two agents alternate with explicit mentions until a stop condition.
- **Orchestrator-worker**: a controller delegates to workers, then a synthesizer merges results.

## Start Or Continue

For every Agent-World-scoped message that is not a create/init/setup request, create `./.agent-world/` when needed, then write the exact message to a fresh timestamped request file:

```json
{
  "command": "user",
  "content": "the exact user message"
}
```

```bash
node "$ROUTER" file --request .agent-world/request-20260526T142233123Z-user.json --result .agent-world/result-20260526T142233123Z-user.json
```

Read the structured payload from the matching timestamped result file and follow its `type`. Treat stdout or the tool result as a brief status notification only. Do not parse the real router payload from stdout.

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
- `responseContract.requestPath`
- `responseContract.resultPath`

Run exactly one turn as the named agent. Use `hostInstruction` as the execution brief. Produce one markdown message as that agent.

Rules:

- Do not answer as the host executor.
- Do not call tools during an agent turn.
- If the agent needs filesystem, shell, web, Git, or other host work, emit an `agent-world-host-action` JSON block.
- If the agent hands off with a paragraph-start mention such as `@architect`, stop after that handoff.
- Immediately write the agent message back to the timestamped file from `responseContract.requestPath`:

```json
{
  "command": "complete",
  "turnId": "turn_0001",
  "content": "the exact agent response"
}
```

Then run:

```bash
node "$ROUTER" file --request .agent-world/request-20260526T142233123Z-turn-turn_0001.json --result .agent-world/result-20260526T142233123Z-turn-turn_0001.json
```

Then read `responseContract.resultPath` and follow the next returned instruction.

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

After completion, write a concise JSON result back through the timestamped file from `responseContract.requestPath`.

Suggested result:

```json
{
  "command": "complete",
  "actionId": "action_0001",
  "content": {
    "status": "succeeded | failed | skipped | denied",
    "summary": "what happened",
    "artifacts": [],
    "stdoutPreview": "",
    "stderrPreview": ""
  }
}
```

Then run the command from `responseContract.completeByRunning` and read the next instruction from `responseContract.resultPath`.

## `done`

Return the router's `final` content. Stop.

## `blocked`

The router found a workflow problem it will not improvise around, such as an off-edge handoff, a turn-limit stop, or invalid routing state.

Report the `reason` to the user and stop the Agent World loop. Do not pick a fallback agent, bypass the DAG, or continue until the user gives a new top-level request or fixes the workflow.

## `idle`

No work is pending. Report that the Agent World workflow is idle.

## Driver Loop

Repeat until `type` is `done`, `blocked`, or `idle`:

1. Write the user message or previous completion to a timestamped file under `./.agent-world/`.
2. Run `node "$ROUTER" file --request .agent-world/request-<timestamp>.json --result .agent-world/result-<timestamp>.json`.
3. Read the returned JSON from the matching timestamped result file under `./.agent-world/`.
4. If `agent_instruction`, run exactly one agent turn and complete it.
5. If `host_action`, execute the host action and complete it.
6. If `blocked`, report the block and stop.
7. If `done`, return the final content.

## Reset

Only reset when explicitly asked:

```bash
node "$ROUTER" reset
```
