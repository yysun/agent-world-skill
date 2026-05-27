# Init Agent World

Use this when the user asks to create, initialize, scaffold, or set up an Agent World. Command-shaped input such as `agent-world init` or `agent-world: init` means this process, not a tool call.

Creation is host setup. Do not start the router loop until `agent-world.yaml` exists and the user asks to use it.

## Process

1. Resolve `agent-world.yaml` in the current working directory.
2. If it already exists, ask for explicit overwrite confirmation before writing.
3. Require exactly one workflow pattern before writing. The only valid choices are the nine names under "Workflow Patterns" below. Do not infer, default, rename, group, shorten, or create `agent-world.yaml` until the user chooses one of those exact patterns.
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
5. After the user chooses, write a complete `agent-world.yaml` with sample agents, prompts, and workflow edges matching the selected pattern.
6. Use the cwd basename, normalized to kebab-case, as `world.id` and `world.name` unless the user gave a better name.
7. Include these baseline settings unless the user requested different ones:

   ```yaml
   world:
     id: example-world
     name: example-world
     stopToken: "<world>pass</world>"
     turnLimit: 16
     mode: host_delegated
   ```

8. Prefer `workflow.type: dag` and `workflow.enforceEdges: true`. For loop-shaped patterns, keep `turnLimit` conservative and make the stop condition explicit in prompts.
9. Agent prompts must tell agents to use paragraph-start `@mentions`, stay inside the workflow, never run tools directly, request host work with an `agent-world-host-action` JSON block, and end final responses with `<world>pass</world>`.
10. Report the created path and selected pattern. Do not run the router unless the user also asked to start using the world.

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

## YAML Requirements

- every workflow node references an existing agent
- every edge source and target exists, except `human`
- `workflow.entry` exists
- `workflow.entryAgent` matches the entry node's agent
- nodes with `requires` reference existing workflow nodes
- final nodes tell the agent to end with `<world>pass</world>`
