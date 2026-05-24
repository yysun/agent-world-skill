# Init Agent World Process

Use this process when the user asks to create, initialize, init, scaffold, or set up an Agent World.

Creation is a host setup task. Do not start the router loop until an `agent-world.yaml` exists and the user asks to use it.

## Trigger Examples

- `create agent world`
- `init agent-world`
- `set up agent-world.yaml`
- `make an agent world for this project`

## Process

1. Resolve `agent-world.yaml` in the current working directory.
2. If `agent-world.yaml` already exists, tell the user it exists and ask for explicit overwrite confirmation before writing. Do not overwrite silently.
3. Ask the user which messaging workflow they want, using the skill-relative `messaging-patterns.md` as the source list. Offer the pattern names, not a generic open-ended question:
   - Broadcast
   - Direct handoff
   - Multi-agent fan-out
   - Fan-in / collector
   - Sequential pipeline
   - Intent router
   - FSM / state-token workflow
   - Debate / ping-pong loop
   - Orchestrator-worker
4. After the user chooses, create a complete `agent-world.yaml` in the current working directory with sample agents, system prompts, and a workflow matching the selected pattern.
5. Keep the sample useful but small. Use the cwd basename, normalized to kebab-case, as `world.id` and `world.name` unless the user gave a better name.
6. Include these baseline world settings unless the user requested different ones:

   ```yaml
   world:
     id: example-world
     name: example-world
     stopToken: "<world>pass</world>"
     turnLimit: 16
     mode: host_delegated
   ```

7. Prefer `workflow.type: dag` and `workflow.enforceEdges: true`. For loop-shaped patterns such as debate, keep a conservative `turnLimit` and make the stop condition explicit in agent prompts.
8. Add agent prompts that tell agents to:
   - use paragraph-start `@mentions` for handoffs
   - stay inside the configured workflow
   - never run tools directly
   - emit an `agent-world-host-action` JSON block when host work is needed
   - end the final response with `<world>pass</world>`
9. After writing, report the created path and the selected pattern. Do not run the router unless the user also asks to start using the world.

## Pattern-To-Sample Mapping

- **Broadcast**: create an entry `broadcaster` agent plus peer agents such as `researcher`, `critic`, and `planner`; the broadcaster immediately mentions all peer agents on separate paragraph-start lines; give each peer a terminal edge to `collector`.
- **Direct handoff**: create `sender` and `receiver`; entry is `sender`; edge `sender -> receiver`; `receiver` finishes.
- **Multi-agent fan-out**: create `lead`, `qa`, `security`, and `collector`; `lead` mentions both reviewers on separate paragraph-start lines; both reviewers require or route to `collector`.
- **Fan-in / collector**: create `researcher`, `analyst`, and `collector`; human can start multiple lanes; `collector.requires` waits for the lanes before synthesizing.
- **Sequential pipeline**: create `intake`, `architect`, `builder`, `reviewer`, and `final`; edges run in order.
- **Intent router**: create `router`, `docs`, `code`, and `ops`; `router` classifies the request and mentions exactly one specialist; specialists finish or return to `router`.
- **FSM / state-token workflow**: create `state_router`, `planner`, `executor`, and `reviewer`; prompts must carry `[STATE=...]` tokens and route according to state.
- **Debate / ping-pong loop**: create `pro`, `con`, and `judge`; allow bounded alternation between `pro` and `con`; `judge` synthesizes and stops. Keep `turnLimit` low enough to prevent runaway loops.
- **Orchestrator-worker**: create `orchestrator`, `worker_a`, `worker_b`, and `synthesizer`; orchestrator delegates to workers and synthesizer merges results.

## YAML Requirements

The generated YAML must be valid for `scripts/agent-world-router.js`:

- every workflow node references an existing agent
- every edge source and target exists, except the special `human` source
- `workflow.entry` exists
- `workflow.entryAgent` matches the entry node's agent
- nodes with `requires` reference existing workflow nodes
- final nodes tell the agent to end with `<world>pass</world>`
