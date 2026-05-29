# Eval Agent World

Use this when the user asks to eval, test, verify, validate, confirm, check, or smoke-test an Agent World.

This file is a skill-relative reference file. Resolve it beside `SKILL.md`, not under the user's project `.agent-world/` directory.

Do not look for `.agent-world/eval-agent-world.md`; that path is invalid. The project-level eval contract is `.agent-world/world.eval.md`.

## Process

1. Resolve `.agent-world/world.json`.
2. Resolve `.agent-world/world.eval.md`.
3. If `world.eval.md` is missing, generate it from the current world config and selected workflow pattern. Do not run a generic, hand-written eval that ignores the configured workflow.
4. Run the deterministic eval script:

   ```bash
   node "$SKILL_DIR/scripts/agent-world-eval.js" \
     --config .agent-world/world.json \
     --eval .agent-world/world.eval.md \
     --out .agent-world/eval-runs
   ```

5. Read the generated eval report.
6. Report:
   - pass/fail
   - failed case names
   - exact reason
   - whether the failure is config, routing, prompt contract, or semantic/model behavior
7. Do not fix the world unless the user asks.
8. Do not run a live model smoke test unless the user asks.

## Deterministic Eval Scope

The deterministic eval confirms:

- config validity
- graph references
- prompt file existence
- prompt protocol requirements
- router transitions
- blocked invalid handoffs
- stop-token completion

The deterministic eval must not call a live model. It uses mock completions from `.agent-world/world.eval.md` to test router behavior.

## Contract Shape

`world.eval.md` is a contract, not a log. It should describe the target world, deterministic checks, routing cases, and optional semantic smoke cases.

Routing cases are fenced `json` objects. Each case may provide:

- `input`: one router input, usually `{ "command": "user", "content": "..." }`
- `given`: setup steps run before the main assertion
- `complete`: a mocked agent completion for the currently pending turn
- `expect`: expected router result fields

Example:

```json
{
  "name": "entry agent hands off to next node",
  "given": [
    {
      "command": "user",
      "content": "Build a small todo app"
    }
  ],
  "complete": {
    "agent": "intake",
    "content": "@architect\nPlease design the app."
  },
  "expect": {
    "type": "agent_instruction",
    "agent": "architect",
    "workflowNode": "architect"
  }
}
```

## Generated Eval Requirements

Every generated `world.eval.md` should include:

- `world.json` is valid JSON.
- all agents use `promptPath`.
- every `promptPath` exists.
- `workflow.entry` exists.
- `workflow.entryAgent` matches the entry node agent.
- every edge source exists, except `human`.
- every edge target exists.
- every `requires` node exists.
- prompts mention paragraph-start `@mentions`.
- prompts tell agents not to call tools directly.
- final prompts tell agents to end with `<world>pass</world>` or the configured stop token.

## Pattern Minimums

The generated routing cases should follow the selected workflow pattern:

| Pattern | Must test |
| --- | --- |
| Broadcast | Human message wakes intended agents; collector waits for required lanes. |
| Direct handoff | Sender routes only to receiver; off-edge mention blocks. |
| Multi-agent fan-out | One message queues multiple lanes. |
| Fan-in / collector | Collector only runs after required nodes complete. |
| Sequential pipeline | Each step routes to next; skipping blocks. |
| Intent router | Router can only mention one valid specialist. |
| FSM / state-token workflow | State token routes to the correct next node. |
| Debate / ping-pong loop | Pro/con alternate; judge can stop; turn limit blocks runaway routing. |
| Orchestrator-worker | Orchestrator delegates; synthesizer merges after workers. |

## Semantic Smoke Tests

Semantic smoke tests are advisory. They can describe what a real model should do, but they are not deterministic CI gates.

Report semantic smoke results separately from deterministic eval results. Do not claim deterministic success from a live model conversation, and do not claim model behavior is frozen by the routing harness.
