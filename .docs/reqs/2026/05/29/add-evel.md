Yes. Add eval as a **first-class generated artifact** beside the world config:

```txt
.agent-world/
  world.json
  world.eval.md
  prompts/
    architect.md
    builder.md
    reviewer.md
  eval-runs/
    20260529T....md
```

The important distinction:

> `world.json` says what the world is.
> `world.eval.md` says how we prove this world works.

Right now your skill already has the correct separation: init creates `.agent-world/world.json` and prompt files, while the router stays generic and validates graph references / prompt paths at runtime. `init-agent-world.md` explicitly says init should generate `.agent-world/world.json` and `.agent-world/prompts/<agent>.md`, not run the router yet.  The router is also intentionally generic: it loads the world, persists messages, parses mentions and host actions, then returns the next host instruction.  So eval should be added as a **separate generated contract + runner**, not baked into case-specific router logic.

## Recommended design

Add three things:

```txt
eval-agent-world.md
scripts/agent-world-eval.js
.agent-world/world.eval.md
```

### 1. Update init flow

After `.agent-world/world.json` and prompt files are generated, also generate:

```txt
.agent-world/world.eval.md
```

So update `init-agent-world.md` step 6 from:

```md
write a complete generated world bundle:
- .agent-world/world.json
- .agent-world/prompts/<agent>.md
```

to:

```md
write a complete generated world bundle:
- .agent-world/world.json
- .agent-world/world.eval.md
- .agent-world/prompts/<agent>.md
```

Then add:

```md
The generated world.eval.md is the world contract. It must contain deterministic routing tests and optional semantic smoke tests for the selected workflow pattern.
```

This matters because the skill already requires the user to choose exactly one workflow pattern during init.  That selected pattern should directly determine the generated eval cases.

---

### 2. Add `world.eval.md` as a contract, not a log

Example:

````md
# Agent World Eval

## Target

- config: `.agent-world/world.json`
- state: `.agent-world/eval-state.json`
- pattern: `Sequential pipeline`
- goal: confirm that the generated world routes correctly, blocks invalid handoffs, and reaches completion.

## Deterministic Checks

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
- final agent prompt tells the agent to end with `<world>pass</world>`.

## Routing Cases

### Case 1: Human enters world

```json
{
  "name": "human message routes to entry node",
  "input": {
    "command": "user",
    "content": "Build a small todo app"
  },
  "expect": {
    "type": "agent_instruction",
    "agent": "intake",
    "workflowNode": "intake"
  }
}
```

### Case 2: Entry agent hands off to next allowed node

```json
{
  "name": "intake routes to architect",
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

### Case 3: Invalid edge is blocked

```json
{
  "name": "architect cannot skip to final",
  "given": [
    {
      "command": "user",
      "content": "Build a small todo app"
    },
    {
      "completeAgent": "intake",
      "content": "@architect\nPlease design the app."
    }
  ],
  "complete": {
    "agent": "architect",
    "content": "@final\nDone."
  },
  "expect": {
    "type": "blocked",
    "code": "workflow_edge_blocked"
  }
}
```

### Case 4: Final stop token completes world

```json
{
  "name": "final response ends world",
  "given": [
    {
      "command": "user",
      "content": "Build a small todo app"
    }
  ],
  "complete": {
    "agent": "final",
    "content": "Here is the final result.\n\n<world>pass</world>"
  },
  "expect": {
    "type": "done"
  }
}
```

## Semantic Smoke Cases

These require a real model/host, so they are advisory, not deterministic CI gates.

### Smoke 1

User request:

```txt
Build a small todo app.
```

Expected behavior:

- intake clarifies or frames the request.
- architect designs.
- builder implements or requests host work.
- reviewer checks.
- final returns user-facing answer and stops with `<world>pass</world>`.

Failure signs:

- host answers directly instead of executing selected agent.
- agent calls tools directly during `agent_instruction`.
- agent mentions an off-edge target.
- workflow stops without `done`, `blocked`, or `idle`.
````

This gives you two eval layers:

| Layer                |                         What it proves | Deterministic? | CI-safe? |
| -------------------- | -------------------------------------: | -------------: | -------: |
| Config checks        |  world shape, references, prompt files |            yes |      yes |
| Routing cases        | router behavior using mock completions |            yes |      yes |
| Semantic smoke cases |           actual model follows prompts |             no | optional |

That’s the right architecture. Don’t pretend model behavior is frozen by unit tests. Freeze the **contract**, then test deterministic boundaries hard.

---

### 3. Add `scripts/agent-world-eval.js`

This should not be a second router. It should be a **test harness around the router**.

The current router already supports file-based request/result handoff. The skill tells the host to write a request file, run the router, read the result file, then execute exactly one returned instruction.  The router also already has `reset`, `user`, `complete`, `state`, and `transcript` commands.  Use those.

The eval runner should:

```txt
agent-world-eval.js
  1. Load .agent-world/world.json.
  2. Validate config using router loadConfig / validateConfig.
  3. Parse JSON cases from world.eval.md.
  4. For each case:
     - create isolated eval state path
     - reset router state
     - send mocked user messages
     - complete mocked agent turns
     - compare returned result to expected type / agent / workflow node / block code
  5. Write .agent-world/eval-runs/<timestamp>.md
  6. Exit 0 on pass, 1 on fail.
```

Do **not** call the LLM in this script. The deterministic eval should simulate agent outputs with mock completions.

That is the whole point of your rule:

> script deterministic, model semantic.

The script proves routing, graph, contract, and protocol. The model smoke test proves whether the chosen model can actually obey it.

---

## Add a new skill reference file

Create:

```txt
eval-agent-world.md
```

Suggested content:

````md
# Eval Agent World

Use this when the user asks to eval, test, verify, validate, confirm, check, or smoke-test an Agent World.

## Process

1. Resolve `.agent-world/world.json`.
2. Resolve `.agent-world/world.eval.md`.
3. If `world.eval.md` is missing, generate it from the current world config and selected workflow pattern.
4. Run the deterministic eval script:

   ```bash
   node "$SKILL_DIR/scripts/agent-world-eval.js" \
     --config .agent-world/world.json \
     --eval .agent-world/world.eval.md \
     --out .agent-world/eval-runs
````

5. Read the generated eval report.
6. Report:

   * pass/fail
   * failed case names
   * exact reason
   * whether failure is config, routing, prompt contract, or semantic/model behavior
7. Do not fix the world unless the user asks.
8. Do not run a live model smoke test unless the user asks.

````

Then update `SKILL.md` with a new section after init:

```md
## Eval Or Verify Agent World

When the user asks to eval, test, verify, validate, confirm, or check whether the world config works, do not manually inspect only by reading. Load and follow the skill-relative reference file `eval-agent-world.md`.

The deterministic eval confirms:
- config validity
- graph references
- prompt file existence
- prompt protocol requirements
- router transitions
- blocked invalid handoffs
- stop-token completion

Live semantic smoke tests are optional and must be reported separately from deterministic eval results.
````

This fits your current host/router contract. The host executor owns running native tools and returning final answers only when router returns `done`.  Eval should verify that contract instead of bypassing it.

---

## What the eval must catch

Minimum cases by pattern:

| Pattern                    | Must test                                                                   |
| -------------------------- | --------------------------------------------------------------------------- |
| Broadcast                  | human message wakes all intended agents; collector waits for required lanes |
| Direct handoff             | sender routes only to receiver; off-edge mention blocks                     |
| Multi-agent fan-out        | one message queues multiple lanes                                           |
| Fan-in / collector         | collector only runs after required nodes complete                           |
| Sequential pipeline        | each step routes to next; skipping blocks                                   |
| Intent router              | router can only mention one valid specialist                                |
| FSM / state-token workflow | state token routes to correct next node                                     |
| Debate / ping-pong loop    | pro/con alternate; judge can stop; turn limit blocks runaway                |
| Orchestrator-worker        | orchestrator delegates; synthesizer merges after workers                    |

The existing init doc already lists exactly nine patterns.  So each pattern should have a generated eval template. Not a hand-written custom eval every time.

---

## My opinionated recommendation

Do **not** call it `world.config`. Keep current file as:

```txt
.agent-world/world.json
```

Call the eval:

```txt
.agent-world/world.eval.md
```

Reason: `world.json` is machine-owned config. `world.eval.md` is human-readable contract. That pairing is clean.

Also, don’t overbuild eval into a full testing framework yet. Add the smallest useful loop:

```bash
node scripts/agent-world-eval.js --config .agent-world/world.json --eval .agent-world/world.eval.md
```

Output:

```txt
.agent-world/eval-runs/latest.md
```

With:

```md
# Agent World Eval Report

Result: PASS

## Checks

- PASS config loads
- PASS prompt paths exist
- PASS workflow references valid
- PASS routing case: human message routes to entry
- PASS routing case: valid handoff routes to next node
- PASS routing case: invalid handoff blocks
- PASS routing case: stop token returns done
```

That’s enough to make the generated world trustworthy.
