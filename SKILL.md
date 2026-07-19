---
name: agent-world-skill
description: Use when the user intends to create, initialize, run, continue, route, eval, test, verify, validate, confirm, check, smoke-test, inspect, or debug an Agent World workflow, including requests that mention Agent World, agent-world, agent world, world.json, world.eval.md, or command-like forms such as agent-world: init. Treat command-like forms as natural-language requests, not tool calls.
---

# Agent World Skill

## Agent Contract

You are the host executor for Agent World.

Agent World owns:

- agent definitions and the DAG workflow in `.agent-world/world.json`
- deterministic eval contracts in `.agent-world/world.eval.md`
- the config schema in the skill-relative `world.schema.json`
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
EVAL_REF="eval-agent-world.md"
WORLD=".agent-world/world.json"
EVAL=".agent-world/world.eval.md"
```

These paths have different bases:

- `ROUTER` is skill-relative. Resolve `scripts/agent-world-router.js` against the directory containing this `SKILL.md`.
- `EVAL_REF` is skill-relative. Resolve `eval-agent-world.md` against the directory containing this `SKILL.md`.
- `WORLD` and `EVAL` are project-relative. Resolve `.agent-world/world.json` and `.agent-world/world.eval.md` against the current working directory for the user's project/world.

Run router commands from the project/world cwd so the router finds `WORLD` at `./.agent-world/world.json`. If the world file is elsewhere, set `AGENT_WORLD_CONFIG` to that project-relative or absolute path. Do not copy or generate a `scripts/` folder into the project cwd.

## Create Or Init Agent World

When the user asks to create, initialize, init, scaffold, or set up an Agent World, do not start the router loop yet. Creation is a host setup task.

Treat shorthand command forms such as `agent-world: init`, `agent-world init`, `agent-world:init`, `agent world init`, and `init agent-world` as init requests. These are not requests to call an `init` tool or function. Do not report `unknown_tool` for these forms.

Before doing any init work, load and follow the skill-relative reference file `init-agent-world.md`. Resolve it relative to the directory containing this `SKILL.md`, not relative to the user's project cwd. That file is the source of truth for creating `.agent-world/world.json`, handling recreate/overwrite confirmation, selecting exactly one of the nine default workflow pattern ids, or explicit `custom-dag` only for a customized user-defined workflow, using the canonical skill-relative `world.schema.json` shape, and generating prompt files under `.agent-world/prompts/`.

If `init-agent-world.md` cannot be read, stop and report that the Agent World skill installation is incomplete. Do not invent fallback workflow options, do not use generic presets, and do not create or overwrite `.agent-world/world.json`.

## Eval Or Verify Agent World

When the user asks to eval, test, verify, validate, confirm, check, or smoke-test whether the world config works, do not manually inspect only by reading. Load and follow the skill-relative reference file `eval-agent-world.md`. Resolve it relative to the directory containing this `SKILL.md`, not relative to the user's project cwd.

Do not look for `.agent-world/eval-agent-world.md`. That path is invalid. The project-level eval contract is `.agent-world/world.eval.md`; if that file is missing, follow `eval-agent-world.md` and generate it from the current world config and selected canonical workflow pattern id.

The deterministic eval confirms:

- config validity
- graph references
- prompt file existence
- prompt protocol requirements
- router transitions
- blocked invalid handoffs
- stop-token completion

Live semantic smoke tests are optional and must be reported separately from deterministic eval results.

## Start Or Continue

For every Agent-World-scoped message that is not a create/init/setup request, create `./.agent-world/` when needed, then write the exact message to a fresh timestamped request file:

```json
{
  "command": "user",
  "content": "the exact user message"
}
```

```bash
node "$ROUTER" file --request .agent-world/handoffs/requests/request-20260526T142233123Z-user.json --result .agent-world/handoffs/responses/result-20260526T142233123Z-user.json
```

Read the structured payload from the matching timestamped result file under `.agent-world/handoffs/responses/` and follow its `type`. Treat stdout or the tool result as a brief status notification only. Do not parse the real router payload from stdout.

## `agent_instruction`

The router returns the selected agent, loaded prompt, workflow node, context, and dynamic host instruction:

- `turnId`
- `agent`
- `role`
- `workflow`
- `systemPrompt`
- `context`
- `contextScope`
- `hostInstruction`
- `responseContract.completeByRunning`
- `responseContract.requestPath`
- `responseContract.resultPath`

Run exactly one turn as the named agent. Use `hostInstruction` as the execution brief. Produce one markdown message as that agent.

`contextScope` is configured per agent. `global` includes the final 18 messages from the current run. `agent` includes the current routed-from message plus up to 17 of that agent's recent messages from the current run. The router must use the same selected messages in `context` and the rendered `hostInstruction`; do not supplement scoped context yourself.

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
node "$ROUTER" file --request .agent-world/handoffs/requests/request-20260526T142233123Z-turn-turn_0001.json --result .agent-world/handoffs/responses/result-20260526T142233123Z-turn-turn_0001.json
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

1. Write the user message or previous completion to a timestamped file under `./.agent-world/handoffs/requests/`.
2. Run `node "$ROUTER" file --request .agent-world/handoffs/requests/request-<timestamp>.json --result .agent-world/handoffs/responses/result-<timestamp>.json`.
3. Read the returned JSON from the matching timestamped result file under `./.agent-world/handoffs/responses/`.
4. If `agent_instruction`, run exactly one agent turn and complete it.
5. If `host_action`, execute the host action and complete it.
6. If `blocked`, report the block and stop.
7. If `done`, return the final content.

## Reset

Only reset when explicitly asked:

```bash
node "$ROUTER" reset
```
