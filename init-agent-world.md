# Init Agent World

Use this when the user asks to create, initialize, scaffold, or set up an Agent World. Command-shaped input such as `agent-world init` or `agent-world: init` means this process, not a tool call.

Creation is host setup. Do not start the router loop until `.agent-world/world.json` exists and the user asks to use it.

## Process

1. Resolve `.agent-world/world.json` under the current working directory. Create `.agent-world/` and `.agent-world/prompts/` if needed.
2. If `.agent-world/world.json` already exists, ask the user whether to recreate and overwrite the generated world bundle. Do not write unless they explicitly confirm.
3. On first create or confirmed recreate, require exactly one workflow pattern before writing. The default choices are the nine canonical ids under "Workflow Patterns" below. `custom-dag` is not a tenth default pattern; it is only for a customized user-defined workflow, and is valid only when the user explicitly asks for a custom workflow or provides a custom graph. Do not infer, default, rename, group, shorten, or create `.agent-world/world.json` until the user chooses one exact supported pattern.
4. If the user did not already name exactly one pattern, ask them to choose using a structured ask-user-input, user-input, or human-in-the-loop tool.
   - Use a tool that can show all workflow patterns as selectable options.
   - Include every pattern listed below.
   - Include short descriptions when the tool supports descriptions.
   - Do not present fewer than nine options.
   - Do not replace the patterns with generic presets such as `Single-Agent Loop`, `Planner -> Executor`, `Planner -> Executor -> Reviewer`, `Specialist Router`, or `Custom`.
   - Do not include `custom-dag` unless the user explicitly asks for a customized workflow or provides a custom graph.
   - If a tool is limited to fewer than nine options, it is not suitable for this choice.
   - Do not use plain chat if a suitable structured user-input or human-in-the-loop tool is available.
   - If no available tool can show all options, ask in chat and list every pattern.
5. On confirmed recreate, delete the existing `.agent-world/prompts/` directory before writing the new generated prompt files. This prevents stale prompt files from surviving after agents are renamed, removed, or replaced. Do not delete unrelated files under `.agent-world/`, such as request/result handoff files, state files, registry files, or user-owned notes.
6. After the user chooses, write a complete generated world bundle:
   - `.agent-world/world.json`
   - `.agent-world/world.eval.md`
   - `.agent-world/prompts/<agent>.md` for each generated agent prompt
7. The generated `world.eval.md` is the world contract. It must contain deterministic routing tests and optional semantic smoke tests for the selected workflow pattern.
8. Do not copy, generate, simplify, or rewrite `world.schema.json` into `.agent-world/`. The canonical schema stays skill-relative at `world.schema.json`; hosts and clients that validate worlds should load that skill schema directly.
9. Use the cwd basename, normalized to kebab-case, as `world.id` and `world.name` unless the user gave a better name.
10. Use this complete canonical JSON shape as the generation model. Substitute the selected workflow pattern's agents, nodes, edges, prompts, and instructions, but keep the same top-level structure and allowed field names:

   ```json
   {
     "world": {
       "id": "example-world",
       "name": "example-world",
       "stopToken": "<world>pass</world>",
       "turnLimit": 16,
       "mode": "host_delegated"
     },
     "workflow": {
       "type": "broadcast",
       "entry": "broadcaster",
       "entryAgent": "broadcaster",
       "enforceEdges": true,
       "nodes": {
         "broadcaster": {
           "agent": "broadcaster",
           "instruction": "Broadcast the user request to the work lanes."
         },
         "collector": {
           "agent": "collector",
           "requires": ["broadcaster"],
           "instruction": "Synthesize required inputs and end with the stop token."
         }
       },
       "edges": {
         "human": ["broadcaster"],
         "broadcaster": ["collector"],
         "collector": []
       }
     },
     "agents": {
       "broadcaster": {
         "role": "broadcaster",
         "promptPath": "prompts/broadcaster.md"
       },
       "collector": {
         "role": "collector",
         "promptPath": "prompts/collector.md"
       }
     }
   }
   ```

11. Use the canonical object shape from `world.schema.json` and `world.example.json`:
   - `agents` is an object keyed by agent id, not an array.
   - `workflow.nodes` is an object keyed by workflow node id, not an array.
   - `workflow.edges` is an object whose keys are source node ids or `human`, and whose values are arrays of target node ids.
   - Do not write `id` inside each agent or node object; the object key is the id.
   - Do not write edge objects such as `{ "from": "a", "to": "b" }`.
   - Workflow node objects may contain only `agent`, `instruction`, and `requires`.
   - Do not add semantic fields such as `type`, `kind`, `mode`, `join`, `state`, or `role` inside workflow nodes.
12. Set `workflow.type` to the canonical kebab-case pattern id from "Workflow Patterns", such as `broadcast` or `sequential-pipeline`. Use `custom-dag` only for a customized user-defined workflow when the user explicitly asked for custom routing/workflow design or provided a custom graph. Do not write display labels such as `Broadcast`, `Sequential pipeline`, or implementation labels such as `dag` or `mention_graph` into generated worlds.
13. Prefer `workflow.enforceEdges: true`. For loop-shaped patterns, keep `turnLimit` conservative and make the stop condition explicit in prompts.
14. Agent entries in `world.json` must use `promptPath`, not inline prompt text. Do not include `"$schema": "./world.schema.json"` in generated worlds unless a specific host/client owns that schema reference strategy.
15. Agent prompts must tell agents to use paragraph-start `@mentions`, stay inside the workflow, never run tools directly, request host work with an `agent-world-host-action` JSON block, and end final responses with `<world>pass</world>`.
16. After writing `world.json`, validate it against `world.schema.json` before reporting success. If validation fails, fix `world.json` and rerun validation.
17. After schema validation passes, run the deterministic eval script against the generated `world.json` and `world.eval.md`. If eval fails, fix the generated bundle and rerun eval before reporting success.
18. Report the created path, selected pattern, generated eval contract path, schema validation result, and eval result. Do not run the router unless the user also asked to start using the world.

## Workflow Patterns

- `broadcast` - Broadcast: a human/world message with no paragraph-start mention can wake all eligible active agents.
- `direct-handoff` - Direct handoff: one agent or human routes to one specific agent with a paragraph-start mention.
- `multi-agent-fan-out` - Multi-agent fan-out: one message wakes multiple lanes with multiple paragraph-start mentions.
- `fan-in-collector` - Fan-in / collector: multiple agents report to a collector, which merges results and returns to the human.
- `sequential-pipeline` - Sequential pipeline: agents proceed in order, such as spec -> build -> test -> review.
- `intent-router` - Intent router: one router classifies the request and mentions exactly one specialist.
- `fsm-state-token` - FSM / state-token workflow: agents carry state tokens such as `[STATE=PLAN]` and route by state.
- `debate-ping-pong-loop` - Debate / ping-pong loop: two agents alternate with explicit mentions until a stop condition.
- `orchestrator-worker` - Orchestrator-worker: a controller delegates to workers, then a synthesizer merges results.

## Explicit Custom Pattern

- `custom-dag` - Custom DAG: a customized user-defined directed workflow graph. Use only when the user explicitly asks for custom routing/workflow design or provides a custom graph. Do not offer it during default init and do not use it as a fallback for unclear requirements.

## Pattern-To-Sample Mapping

- `broadcast`: create `broadcaster`, `researcher`, `critic`, `planner`, and `collector`; broadcaster mentions all peers; peers route to collector.
- `direct-handoff`: create `sender` and `receiver`; entry is sender; receiver finishes.
- `multi-agent-fan-out`: create `lead`, `qa`, `security`, and `collector`; lead mentions both reviewers; reviewers route to collector.
- `fan-in-collector`: create `researcher`, `analyst`, and `collector`; collector requires the lanes before synthesizing.
- `sequential-pipeline`: create `intake`, `architect`, `builder`, `reviewer`, and `final`; edges run in order.
- `intent-router`: create `router`, `docs`, `code`, and `ops`; router mentions exactly one specialist.
- `fsm-state-token`: create `state_router`, `planner`, `executor`, and `reviewer`; prompts carry `[STATE=...]` tokens.
- `debate-ping-pong-loop`: create `pro`, `con`, and `judge`; allow bounded alternation; judge synthesizes and stops.
- `orchestrator-worker`: create `orchestrator`, `worker_a`, `worker_b`, and `synthesizer`; orchestrator delegates; synthesizer merges.
- `custom-dag`: derive agents, nodes, edges, and `requires` from the user's customized workflow or provided graph. Keep every node schema-valid.

## JSON Requirements

- every workflow node references an existing agent
- `workflow.type` exactly matches one selected canonical pattern id, or `custom-dag` when a customized workflow is explicitly requested
- every edge source and target exists, except `human`
- `workflow.entry` exists
- `workflow.entryAgent` matches the entry node's agent
- nodes with `requires` reference existing workflow nodes
- every agent has a `promptPath` pointing to an existing Markdown prompt file
- final nodes tell the agent to end with `<world>pass</world>`
- `agents`, `workflow.nodes`, and `workflow.edges` are keyed objects, not arrays
- workflow nodes contain only `agent`, `instruction`, and `requires`; never add node-level `type`, `kind`, `mode`, `join`, `state`, or `role`

The skill-relative `world.schema.json` validates shape, required fields, primitive types, and allowed config keys. The router still validates graph references and prompt file existence because JSON Schema cannot reliably prove that every edge target, node reference, and prompt path exists.

## Eval Contract Requirements

Generated worlds must include `.agent-world/world.eval.md`. Treat it as a human-readable contract, not a log file.

Every generated eval contract must include:

- target config path
- selected workflow pattern
- deterministic config and prompt checks
- routing cases expressed as fenced `json` objects
- optional semantic smoke cases reported separately from deterministic checks

Minimum deterministic routing coverage by selected pattern:

| Pattern id | Must test |
| --- | --- |
| `broadcast` | Human message wakes intended agents; collector waits for required lanes. |
| `direct-handoff` | Sender routes only to receiver; off-edge mention blocks. |
| `multi-agent-fan-out` | One message queues multiple lanes. |
| `fan-in-collector` | Collector only runs after required nodes complete. |
| `sequential-pipeline` | Each step routes to next; skipping blocks. |
| `intent-router` | Router can only mention one valid specialist. |
| `fsm-state-token` | State token routes to the correct next node. |
| `debate-ping-pong-loop` | Pro/con alternate; judge can stop; turn limit blocks runaway routing. |
| `orchestrator-worker` | Orchestrator delegates; synthesizer merges after workers. |
| `custom-dag` | Customized workflow graph entry, edges, required joins, invalid handoffs, and stop-token completion. |
