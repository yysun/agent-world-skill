# Init Agent World

Use this when the user asks to create, initialize, scaffold, or set up an Agent World. Command-shaped input such as `agent-world init` or `agent-world: init` means this process, not a tool call.

Creation is host setup. Do not start the router loop until `.agent-world/world.json` exists and the user asks to use it.

## Process

1. Resolve `.agent-world/world.json` under the current working directory. Create `.agent-world/` and `.agent-world/prompts/` if needed.
2. If `.agent-world/world.json` already exists, ask the user whether to recreate and overwrite the generated world bundle. Do not write unless they explicitly confirm.
3. On first create or confirmed recreate, require exactly one workflow pattern before writing. The only valid choices are the nine names under "Workflow Patterns" below. Do not infer, default, rename, group, shorten, or create `.agent-world/world.json` until the user chooses one of those exact patterns.
4. If the user did not already name exactly one pattern, ask them to choose using a structured ask-user-input, user-input, or human-in-the-loop tool.
   - Use a tool that can show all workflow patterns as selectable options.
   - Include every pattern listed below.
   - Include short descriptions when the tool supports descriptions.
   - Do not present fewer than nine options.
   - Do not replace the patterns with generic presets such as `Single-Agent Loop`, `Planner -> Executor`, `Planner -> Executor -> Reviewer`, `Specialist Router`, or `Custom`.
   - Do not include a `Custom` option unless the user explicitly asks for a custom pattern.
   - If a tool is limited to fewer than nine options, it is not suitable for this choice.
   - Do not use plain chat if a suitable structured user-input or human-in-the-loop tool is available.
   - If no available tool can show all options, ask in chat and list every pattern.
5. On confirmed recreate, delete the existing `.agent-world/prompts/` directory before writing the new generated prompt files. This prevents stale prompt files from surviving after agents are renamed, removed, or replaced. Do not delete unrelated files under `.agent-world/`, such as request/result handoff files, state files, registry files, or user-owned notes.
6. After the user chooses, write a complete generated world bundle:
   - `.agent-world/world.json`
   - `.agent-world/prompts/<agent>.md` for each generated agent prompt
7. Do not copy, generate, simplify, or rewrite `world.schema.json` into `.agent-world/`. The canonical schema stays skill-relative at `world.schema.json`; hosts and clients that validate worlds should load that skill schema directly.
8. Use the cwd basename, normalized to kebab-case, as `world.id` and `world.name` unless the user gave a better name.
9. Include these baseline settings unless the user requested different ones:

   ```json
   {
     "world": {
       "id": "example-world",
       "name": "example-world",
       "stopToken": "<world>pass</world>",
       "turnLimit": 16,
       "mode": "host_delegated"
     }
   }
   ```

10. Use the canonical object shape from `world.schema.json` and `world.example.json`:
   - `agents` is an object keyed by agent id, not an array.
   - `workflow.nodes` is an object keyed by workflow node id, not an array.
   - `workflow.edges` is an object whose keys are source node ids or `human`, and whose values are arrays of target node ids.
   - Do not write `id` inside each agent or node object; the object key is the id.
   - Do not write edge objects such as `{ "from": "a", "to": "b" }`.
11. Prefer `workflow.type: dag` and `workflow.enforceEdges: true`. For loop-shaped patterns, keep `turnLimit` conservative and make the stop condition explicit in prompts.
12. Agent entries in `world.json` must use `promptPath`, not inline prompt text. Do not include `"$schema": "./world.schema.json"` in generated worlds unless a specific host/client owns that schema reference strategy.
13. Agent prompts must tell agents to use paragraph-start `@mentions`, stay inside the workflow, never run tools directly, request host work with an `agent-world-host-action` JSON block, and end final responses with `<world>pass</world>`.
14. Report the created path and selected pattern. Do not run the router unless the user also asked to start using the world.

## Workflow Patterns

- **Broadcast**: a human/world message with no paragraph-start mention can wake all eligible active agents.
- **Direct handoff**: one agent or human routes to one specific agent with a paragraph-start mention.
- **Multi-agent fan-out**: one message wakes multiple lanes with multiple paragraph-start mentions.
- **Fan-in / collector**: multiple agents report to a collector, which merges results and returns to the human.
- **Sequential pipeline**: agents proceed in order, such as spec -> build -> test -> review.
- **Intent router**: one router classifies the request and mentions exactly one specialist.
- **FSM / state-token workflow**: agents carry state tokens such as `[STATE=PLAN]` and route by state.
- **Debate / ping-pong loop**: two agents alternate with explicit mentions until a stop condition.
- **Orchestrator-worker**: a controller delegates to workers, then a synthesizer merges results.

## Pattern-To-Sample Mapping

- **Broadcast**: create `broadcaster`, `researcher`, `critic`, `planner`, and `collector`; broadcaster mentions all peers; peers route to collector.
- **Direct handoff**: create `sender` and `receiver`; entry is sender; receiver finishes.
- **Multi-agent fan-out**: create `lead`, `qa`, `security`, and `collector`; lead mentions both reviewers; reviewers route to collector.
- **Fan-in / collector**: create `researcher`, `analyst`, and `collector`; collector requires the lanes before synthesizing.
- **Sequential pipeline**: create `intake`, `architect`, `builder`, `reviewer`, and `final`; edges run in order.
- **Intent router**: create `router`, `docs`, `code`, and `ops`; router mentions exactly one specialist.
- **FSM / state-token workflow**: create `state_router`, `planner`, `executor`, and `reviewer`; prompts carry `[STATE=...]` tokens.
- **Debate / ping-pong loop**: create `pro`, `con`, and `judge`; allow bounded alternation; judge synthesizes and stops.
- **Orchestrator-worker**: create `orchestrator`, `worker_a`, `worker_b`, and `synthesizer`; orchestrator delegates; synthesizer merges.

## JSON Requirements

- every workflow node references an existing agent
- every edge source and target exists, except `human`
- `workflow.entry` exists
- `workflow.entryAgent` matches the entry node's agent
- nodes with `requires` reference existing workflow nodes
- every agent has a `promptPath` pointing to an existing Markdown prompt file
- final nodes tell the agent to end with `<world>pass</world>`
- `agents`, `workflow.nodes`, and `workflow.edges` are keyed objects, not arrays

The skill-relative `world.schema.json` validates shape, required fields, primitive types, and allowed config keys. The router still validates graph references and prompt file existence because JSON Schema cannot reliably prove that every edge target, node reference, and prompt path exists.
