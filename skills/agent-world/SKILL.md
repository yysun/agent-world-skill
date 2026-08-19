---
name: agent-world
description: >-
  Use when the user intends to create, initialize, run, continue, route, eval,
  test, verify, validate, confirm, check, smoke-test, inspect, or debug an Agent
  World workflow, or to open, launch, or start Agent World Studio (a local
  visual workflow editor and observer), including requests that mention Agent
  World, agent-world, agent world, world.json, world.eval.md, Studio,
  agent-world studio, or command-like forms such as agent-world: init or
  agent-world: studio. Treat command-like forms as natural-language requests,
  not tool calls.
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
- dispatching each returned `agent_instruction` to one independent subagent
- dispatching every turn in an `agent_instruction_batch` in parallel
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

If the router exits non-zero it writes **no result file**. That is a configuration or protocol error,
not a routing outcome. Read the error JSON the router printed on stderr, report it to the user, and
stop; do not retry the same request and do not invent a result.

## Agent Communication Model

Agents never address each other directly. An `@mention` is a routing directive to the router, not
message delivery: the router reads the mention, checks the workflow edge, queues the next turn, and
hands the mentioned agent that message as context on its own turn. Subagents cannot message peers,
and must not try to.

The consequence for you as host: never forward one agent's output to another agent yourself. Return
it to the router and dispatch whatever the router returns next.

## `agent_instruction`

The router returns the selected agent, loaded prompt, workflow node, context, subagent dispatch
settings, and dynamic host instruction:

- `turnId`
- `agent`
- `role`
- `workflow`
- `systemPrompt`
- `context`
- `contextScope`
- `contextLimit`
- `dispatch` - optional `model`, `subagentType`, `tools`, `contextLimit` from `world.json`
- `ignoredMentions` - agents the user mentioned that workflow edges did not allow
- `hostInstruction`
- `responseContract.completeByRunning`
- `responseContract.requestPath`
- `responseContract.resultPath`

Dispatch this turn to **one independent subagent**. Start it with no inherited conversation history
when the runtime supports that, so `contextScope` is enforced at generation time rather than by
request. Pass `hostInstruction` as its prompt: it already embeds `systemPrompt`, the workflow node,
the allowed next nodes, the routed-from message, and the scoped `context`. Honor `dispatch.model`,
`dispatch.subagentType`, and `dispatch.tools` when the runtime supports them. If the runtime cannot
spawn a subagent, run the turn inline as that agent and say so in your report; do not silently
present inline role-play as subagent orchestration.

Take the subagent's final message verbatim as the completion `content`.

`contextScope` is configured per agent and capped by `contextLimit` (default 18). `global` includes
the final N messages from the current run. `agent` includes the routed-from message, the latest
message from each node listed in the workflow node's `requires`, every message addressed to that
agent, and that agent's own messages. The routed-from and `requires` messages are guaranteed and are
never dropped to satisfy `contextLimit`; only the remaining fill is capped. The router uses the same selected messages in `context` and in
the rendered `hostInstruction`; do not supplement scoped context yourself.

When `ignoredMentions` is non-empty, tell the user which of their mentions the workflow overrode.

Rules:

- Do not answer as the host executor.
- Do not call tools yourself on behalf of an agent turn.
- If the agent needs filesystem, shell, web, Git, or other host work, it emits an
  `agent-world-host-action` JSON block and you return that block's turn to the router unchanged.
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

## `agent_instruction_batch`

Returned only when `world.json` sets `workflow.parallelDispatch` to `true` and more than one
independent turn is pending. The payload carries `turns`, an array of complete `agent_instruction`
objects.

Dispatch every turn in `turns` in parallel, one independent subagent per turn. Each turn carries its
own `responseContract.requestPath` and `resultPath`, so completions are independent and may be
written back in any order.

The router marks batched turns as dispatched. Until they complete, it returns `idle` with an
`awaitingTurns` list instead of offering the same turns again. Do not re-dispatch a turn named in
`awaitingTurns`.

## `done`

Return the router's `final` content. Stop.

## `blocked`

The router found a workflow problem it will not improvise around. `code` identifies which:

- `workflow_edge_blocked` - an agent mentioned a target no workflow edge allows from its node.
- `unknown_mention_target` - an agent used a paragraph-start mention naming no agent in this world.
  `unresolvedMentions` lists the tokens. This usually means the agent's prompt names an agent that
  `world.json` does not define, or misspells one.
- `turn_limit_reached` - the run hit `world.turnLimit`.

Report the `reason` to the user and stop the Agent World loop. Do not pick a fallback agent, bypass the DAG, or continue until the user gives a new top-level request or fixes the workflow.

A new top-level user message supersedes the run's outstanding routing errors, so any turns that were
still pending when the block occurred resume on the next router call.

## `idle`

No work is pending. Report that the Agent World workflow is idle.

If `awaitingTurns` is present, the listed turns were already dispatched and have not been completed
yet. Finish those turns instead of reporting idle to the user.

## Driver Loop

Repeat until `type` is `done`, `blocked`, or an `idle` with no `awaitingTurns`. An `idle` that
carries `awaitingTurns` is not a stopping point: complete those dispatched turns and continue.


1. Write the user message or previous completion to a timestamped file under `./.agent-world/handoffs/requests/`.
2. Run `node "$ROUTER" file --request .agent-world/handoffs/requests/request-<timestamp>.json --result .agent-world/handoffs/responses/result-<timestamp>.json`.
3. Read the returned JSON from the matching timestamped result file under `./.agent-world/handoffs/responses/`.
4. If `agent_instruction`, dispatch one subagent for that turn and complete it.
5. If `agent_instruction_batch`, dispatch every turn in parallel and complete each one.
6. If `host_action`, execute the host action and complete it.
7. If `blocked`, report the block and stop.
8. If `done`, return the final content.

## Reset

Only reset when explicitly asked:

```bash
node "$ROUTER" reset
```

## Studio

When the user asks to open, launch, or start Agent World Studio, do not start the router loop. Launching Studio is not the same as launching an Agent World workflow: Studio is a local, loopback-bound service that lets a person read, validate, and edit `.agent-world/world.json` and its prompt files, and observe live file changes. It never selects an agent, calls a model, executes a host action, or runs a workflow turn.

Treat shorthand command forms such as `agent-world: studio`, `agent-world studio`, `open studio`, and `start agent world studio` as Studio launch requests, not tool calls.

Launch it from the project/world cwd using only the committed build artifact (no install, no build step):

```bash
node "$SKILL_DIR/scripts/agent-world-studio.js" --project "$PWD"
```

`SKILL_DIR` resolves the same way `ROUTER` does: skill-relative, against the directory containing this `SKILL.md`. The command prints the Studio URL, including the one-time session token, to stdout. Report that URL to the user; do not open it yourself.
