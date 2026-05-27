# Agent World Skill

Agent World is a way to run a small team of named agents without letting the chat model improvise who speaks next.

Think of it as a traffic controller:

- `.agent-world/world.json` says who the agents are and what order they should work in.
- `.agent-world/prompts/*.md` contains the agent system prompts.
- `scripts/agent-world-router.js` reads that file, remembers the conversation, and decides the next step.
- The host executor runs one returned instruction at a time.
- Agents can ask the host to do real work, such as reading files, writing files, or running tests.

The point is control. The workflow lives in a file, not in the assistant's memory.

## What This Is For

Use this skill when you want a multi-agent workflow that is explicit and repeatable.

For example, an app-building workflow might be:

1. `@pm` turns the user's request into a short brief.
2. `@architect` designs the smallest workable approach.
3. `@dev` asks the host to make code changes.
4. `@qa` and `@sec` review the result.
5. `@pm` gives the final answer.

The agents do not directly run shell commands or edit files. They request host actions, and the host decides whether to perform them.

## Files In This Skill

- `SKILL.md`: instructions for Codex when it acts as the Agent World host executor.
- `scripts/agent-world-router.js`: the router that loads the world, tracks state, and returns the next instruction.
- `world.example.json`: a sample world definition with product, architecture, implementation, QA, and security agents.
- `world.schema.json`: the JSON Schema for generated `.agent-world/world.json` files.
- `prompts/`: sample prompt files referenced by `world.example.json`.
- `init-agent-world.md`: required init reference for creating `.agent-world/world.json` from a selected messaging pattern.
- `mention-routing-rules.md`: the standalone mention-routing rule reference.
- `tests/agent-world-router.test.js`: router tests.

## How It Works

Agent World runs inside an agent app such as Codex. Codex is still the model doing the thinking and writing. The router script decides which agent prompt Codex should use next.

Example flow:

1. The human asks Codex: `Build an Electron app`.
2. This skill tells Codex to send that exact message to `scripts/agent-world-router.js`.
3. The router reads `.agent-world/world.json`, loads the referenced prompt file, sees that the workflow starts with `@pm`, and returns a dynamic instruction containing the `@pm` system prompt, workflow step, and conversation context.
4. Codex follows that instruction and writes one message as `@pm`, such as a short product brief ending with:

   ```text
   @architect
   Please design the smallest workable version.
   ```

5. Codex sends the `@pm` response back to the router.
6. The router sees the paragraph-start `@architect` mention, checks the workflow edge, loads the `@architect` system prompt, and returns a new dynamic instruction for Codex.
7. Codex now writes one message as `@architect`, usually handing off to `@dev`.
8. The same loop continues: router chooses the next agent, Codex executes that one agent turn, then the response goes back to the router.

When an agent needs real work, like file edits or tests, it does not do that work directly. It emits a host action request. The router returns `host_action`, Codex performs the approved work using normal tools, and the result goes back into the router.

The router can return five result types:

- `agent_instruction`: Codex should run one turn as the selected agent.
- `host_action`: Codex may perform real host work requested by an agent.
- `blocked`: the workflow cannot continue without user or config intervention.
- `done`: Codex should return the final answer to the human.
- `idle`: nothing is waiting.

`blocked` is deliberate. It is what happens when the router refuses to guess, for example after an off-edge handoff, a turn-limit stop, or invalid routing state. The host should report the block and stop the loop instead of choosing a fallback agent.

The important rule: Codex does not pick the next agent. Codex always sends the latest message to the router and follows the one instruction the router returns.

## File-Based Handoff

The host loop uses files for the real payload:

- `.agent-world/request-<timestamp>.json`: structured router input.
- `.agent-world/result-<timestamp>.json`: structured router output.
- stdout or the tool result: brief status notification only.
- stderr and logs: human/debug output.

Do not put the real handoff payload on stdout. That channel is too easy to pollute with logs and too visible for large protocol objects. Do not write handoff files at the project root; keep them under `./.agent-world/`.

Example user request:

```json
{
  "command": "user",
  "content": "Build an Electron app."
}
```

Run:

```bash
node "$ROUTER" file --request .agent-world/request-20260526T142233123Z-user.json --result .agent-world/result-20260526T142233123Z-user.json
```

Then read the matching timestamped result file and follow its `type`.

Example agent turn completion:

```json
{
  "command": "complete",
  "turnId": "turn_0001",
  "content": "@architect\nPlease design the smallest workable version."
}
```

Example host action completion:

```json
{
  "command": "complete",
  "actionId": "action_0001",
  "content": {
    "status": "succeeded",
    "summary": "created files",
    "artifacts": []
  }
}
```

## Mention Routing Rules

`@mentions` are routing signals, not free-form agent summons. The router parses them, normalizes them to configured agent ids, and then checks the workflow DAG before queueing any turn.

The practical rules:

- Only paragraph-beginning mentions route. Mid-text mentions are conversation context only.
- Mentions inside fenced code blocks do not route.
- Leading whitespace is ignored.
- Optional greeting prefixes before the mention are accepted: `hey`, `hi`, `hello`, and `to`.
- Matching is case-insensitive after normalization. Spaces and most punctuation collapse to hyphens, so `@Review Captain`, `@review_captain`, and `@Review-Captain` can resolve to the same configured agent.
- Display-name mentions can include a second TitleCase word, such as `@Madame Pedagogue`.
- Multi-target fan-out is line-oriented: put each target mention at the start of its own line or paragraph.
- Self-mentions are removed from agent-authored routing targets.

Mentions still have to fit the workflow:

- A human message with no paragraph-beginning mention enters `workflow.entry`, unless `world.mainAgent` is configured.
- If `world.mainAgent` is configured, a human no-mention message is treated like an implicit mention of that agent.
- If `workflow.edges.human` is configured, human mentions can only enter listed nodes.
- Agent-authored mentions route only across allowed `workflow.edges` from the current node.
- Nodes with `requires` do not run until their prerequisites are complete.
- With `workflow.enforceEdges: true`, an off-edge mention returns `blocked` instead of falling back to another agent.
- With `workflow.enforceEdges: false`, off-DAG agent mentions may fall back to direct agent routing.

World tags refine routing:

- `<world>TO:a,b</world>` replaces leading paragraph mentions with explicit normalized recipients.
- `<world>STOP</world>`, `<world>DONE</world>`, `<world>PASS</world>`, and the configured `world.stopToken` complete the run and suppress further routing.

The router owns all of this. Agents should mention the intended next target, but the JSON workflow decides whether that target can actually run.

## Quick Start

1. Install this skill in an agent app, such as Codex.

2. Ask Codex to create a world in your project:

   ```text
   create agent world
   ```

   Short command forms such as `agent-world: init` and `agent-world init` mean the same thing. They are not tool calls.

   Codex should ask which messaging workflow you want using a user-input or human-in-the-loop tool that can show all nine workflow patterns. If no suitable tool is available, it should ask in chat and list every pattern. It must not compress, rename, replace, or add workflow choices. After you choose, it writes `.agent-world/world.json`, `.agent-world/world.schema.json`, and `.agent-world/prompts/*.md` with sample agents and a matching workflow.

   If `.agent-world/world.json` already exists, Codex must ask whether to recreate and overwrite it. If recreating, Codex must ask for the workflow again from the nine options.

3. Ask the agent app for the work you want:

   ```text
   Build an Electron app.
   ```

The skill should route the request through the router script. Codex will then run the first selected agent, send that agent's response back to the router, and continue through the workflow.

You can still start manually by copying `world.example.json` to `.agent-world/world.json`, `world.schema.json` to `.agent-world/world.schema.json`, and `prompts/` to `.agent-world/prompts/`. The init flow is the safer default because it forces the workflow choice up front.

## Creating A World

Creation is separate from execution. When the user says something like `create agent world`, `init agent-world`, or `set up world.json`, Codex should load and follow the skill-relative `init-agent-world.md` reference instead of starting the router loop.

The init process:

1. Checks whether `.agent-world/world.json` already exists under the current working directory.
2. Asks whether to recreate and overwrite the generated world bundle if the file exists.
3. On first create or confirmed recreate, asks the user to choose one workflow pattern, using a user-input or human-in-the-loop tool that can show every option when available:
   - Broadcast
   - Direct handoff
   - Multi-agent fan-out
   - Fan-in / collector
   - Sequential pipeline
   - Intent router
   - FSM / state-token workflow
   - Debate / ping-pong loop
   - Orchestrator-worker
   If the user has not already named one of these patterns, creation stops here until they choose. Agent World should not infer or default the workflow type.
4. On confirmed recreate, removes the old `.agent-world/prompts/` directory before writing new generated prompt files, while leaving unrelated `.agent-world/` files alone.
5. Copies the skill's `world.schema.json` exactly to `.agent-world/world.schema.json`.
6. Writes a valid `.agent-world/world.json` with sample agents, prompt paths, keyed workflow nodes, keyed edges, and stop behavior for the selected pattern, plus matching `.agent-world/prompts/*.md` files.
7. Stops after creation unless the user also asks to run the world.

## The Short Version

Agent World turns a loose multi-agent conversation into a controlled workflow.

The JSON file defines the team and path. Prompt files carry the long instructions. The router remembers state and chooses the next step. The host executes only what the router returns.
