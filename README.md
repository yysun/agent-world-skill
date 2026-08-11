# Agent World Skill

Agent World is a way to run a small team of named agents without letting the chat model improvise who speaks next.

Think of it as a traffic controller:

- `.agent-world/world.json` says who the agents are and what order they should work in.
- `.agent-world/world.eval.md` says how to prove the generated world routes correctly.
- `.agent-world/prompts/*.md` contains the agent system prompts.
- `skills/agent-world/scripts/agent-world-router.js` reads that file, remembers the conversation, and decides the next step.
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

## Repository Layout

The installable skill is self-contained under `skills/agent-world/`, separate from repository scaffolding (`README.md`, `tests/`, `.docs/`, `src/`) at the root. Copy `skills/agent-world/` on its own to install the skill elsewhere -- this includes the committed Studio build artifacts (`skills/agent-world/scripts/agent-world-studio.js` and `skills/agent-world/studio/dist/`), which need no `npm install` or build step to run. `src/studio/` holds the Studio TypeScript source that produces those artifacts via `npm run build`; it is repository scaffolding, not part of the installed skill.

## Files In This Skill

- `skills/agent-world/SKILL.md`: instructions for Codex when it acts as the Agent World host executor.
- `skills/agent-world/scripts/agent-world-router.js`: the router that loads the world, tracks state, and returns the next instruction.
- `skills/agent-world/scripts/agent-world-eval.js`: the deterministic eval harness that validates a generated world contract through the router.
- `skills/agent-world/world.example.json`: a sample world definition with product, architecture, implementation, QA, and security agents.
- `skills/agent-world/world.schema.json`: the skill-relative JSON Schema that hosts and clients can use to validate `.agent-world/world.json`.
- `skills/agent-world/prompts/`: sample prompt files referenced by `world.example.json`.
- `skills/agent-world/init-agent-world.md`: required init reference for creating `.agent-world/world.json` from a selected messaging pattern.
- `skills/agent-world/eval-agent-world.md`: required eval reference for validating `.agent-world/world.eval.md`.
- `skills/agent-world/mention-routing-rules.md`: the standalone mention-routing rule reference.
- `skills/agent-world/scripts/agent-world-studio.js`: the committed, bundled Studio server artifact (built from `src/studio/server/`); runs with plain `node`, no install or build step.
- `skills/agent-world/studio/dist/`: the committed, built Studio client assets (built from `src/studio/client/` via Vite).
- `src/studio/`: Studio's TypeScript source (`shared/`, `server/`, `client/`); not part of the installed skill, only its build inputs.
- `tests/agent-world-router.test.js`: router tests.
- `tests/agent-world-eval.test.js`: deterministic eval runner tests.
- `tests/studio/*.test.js`: Studio server tests, run against the built artifact.

## How It Works

Agent World runs inside an agent app such as Codex. Codex is still the model doing the thinking and writing. The router script decides which agent prompt Codex should use next.

Example flow:

1. The human asks Codex: `Build an Electron app`.
2. This skill tells Codex to send that exact message to `skills/agent-world/scripts/agent-world-router.js`.
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

## Agent Context Scope

Each agent may set `contextScope` in `world.json`:

- `global` receives the final 18 messages from the current run. Use it for collectors, judges, final synthesizers, and controllers that must merge independent work.
- `agent` receives the current routed-from message plus up to 17 of that agent's most recent messages from the current run. Use it for isolated workers, reviewers, routers, and sequential specialists.

The router defaults omitted values to `global` so existing worlds keep their current behavior. Both the structured `context` and rendered host instruction use the same selected messages. The exact `routedFrom` message is also exposed separately for every scope.

## File-Based Handoff

The host loop uses files for the real payload:

- `.agent-world/handoffs/requests/request-<timestamp>.json`: structured router input.
- `.agent-world/handoffs/responses/result-<timestamp>.json`: structured router output.
- stdout or the tool result: brief status notification only.
- stderr and logs: human/debug output.

Do not put the real handoff payload on stdout. That channel is too easy to pollute with logs and too visible for large protocol objects. Do not write handoff files at the project root or directly under `./.agent-world/`; keep them under `./.agent-world/handoffs/requests/` and `./.agent-world/handoffs/responses/`.

Example user request:

```json
{
  "command": "user",
  "content": "Build an Electron app."
}
```

Run:

```bash
node "$ROUTER" file --request .agent-world/handoffs/requests/request-20260526T142233123Z-user.json --result .agent-world/handoffs/responses/result-20260526T142233123Z-user.json
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

   Codex should ask which messaging workflow you want using a user-input or human-in-the-loop tool that can show all nine default workflow pattern ids. If no suitable tool is available, it should ask in chat and list every default id with its display label. It must not compress, rename, replace, or add workflow choices. `custom-dag` is not a tenth default pattern; it is only for a customized user-defined workflow, and is valid only when you explicitly ask for custom routing/workflow design or provide a custom graph. After you choose, it writes `.agent-world/world.json`, `.agent-world/world.eval.md`, and `.agent-world/prompts/*.md` with sample agents and a matching workflow.

   If `.agent-world/world.json` already exists, Codex must ask whether to recreate and overwrite it. If recreating, Codex must ask for the workflow again from the nine default ids, or `custom-dag` when a customized workflow is explicitly requested.

3. Ask the agent app for the work you want:

   ```text
   Build an Electron app.
   ```

The skill should route the request through the router script. Codex will then run the first selected agent, send that agent's response back to the router, and continue through the workflow.

You can still start manually by copying `skills/agent-world/world.example.json` to `.agent-world/world.json` and `skills/agent-world/prompts/` to `.agent-world/prompts/`. The init flow is the safer default because it forces the workflow choice up front.

## Creating A World

Creation is separate from execution. When the user says something like `create agent world`, `init agent-world`, or `set up world.json`, Codex should load and follow the skill-relative `init-agent-world.md` reference instead of starting the router loop.

The init process:

1. Checks whether `.agent-world/world.json` already exists under the current working directory.
2. Asks whether to recreate and overwrite the generated world bundle if the file exists.
3. On first create or confirmed recreate, asks the user to choose one workflow pattern, using a user-input or human-in-the-loop tool that can show every default option when available:
   - `broadcast` - Broadcast
   - `direct-handoff` - Direct handoff
   - `multi-agent-fan-out` - Multi-agent fan-out
   - `fan-in-collector` - Fan-in / collector
   - `sequential-pipeline` - Sequential pipeline
   - `intent-router` - Intent router
   - `fsm-state-token` - FSM / state-token workflow
   - `debate-ping-pong-loop` - Debate / ping-pong loop
   - `orchestrator-worker` - Orchestrator-worker
   If the user has not already named one of these ids, creation stops here until they choose. Agent World should not infer or default the workflow type. `custom-dag` is not a default choice; it is allowed only when the user explicitly asks for custom routing/workflow design or provides a custom graph.
4. On confirmed recreate, removes the old `.agent-world/prompts/` directory before writing new generated prompt files, while leaving unrelated `.agent-world/` files alone.
5. Writes a valid `.agent-world/world.json` with `workflow.type` set to the selected canonical pattern id, sample agents, prompt paths, explicit role-appropriate `contextScope` values, keyed workflow nodes, keyed edges, and stop behavior for the selected pattern, plus `.agent-world/world.eval.md` and matching `.agent-world/prompts/*.md` files.
6. Validates `.agent-world/world.json` against skill-relative `world.schema.json`, fixes validation failures, and reruns validation before reporting success.
7. Runs the deterministic eval against `.agent-world/world.json` and `.agent-world/world.eval.md`, fixes failures, and reruns eval before reporting success.
8. Leaves `world.schema.json` in the skill directory; hosts and clients validate against that canonical schema instead of copying it into every world.
9. Stops after creation unless the user also asks to run the world.

## Evaluating A World

Generated worlds include `.agent-world/world.eval.md`. That file is a contract, not a run log: it says which deterministic config, prompt, and routing behavior proves the world is wired correctly.

Do not confuse the two eval files: `eval-agent-world.md` is the skill-relative instruction file, while `.agent-world/world.eval.md` is the project-relative contract. `.agent-world/eval-agent-world.md` is not a valid path.

Run the deterministic eval with:

```bash
node "$SKILL_DIR/scripts/agent-world-eval.js" \
  --config .agent-world/world.json \
  --eval .agent-world/world.eval.md \
  --out .agent-world/eval-runs
```

The runner loads the world config, validates prompt and graph contracts, parses fenced `json` routing cases from `world.eval.md`, drives the router through file-based handoff, and writes a report under `.agent-world/eval-runs/`. It does not call a live model. Semantic smoke tests belong in the eval contract as optional advisory checks and must be reported separately.

## Agent World Studio

Studio is a local, loopback-bound service for reading, validating, and editing `.agent-world/world.json` and its prompt files, and for observing live file changes. Studio designs and observes; the agent host still owns execution. It never selects an agent, calls a model, executes a host action, or runs a workflow turn, and it exposes no endpoint that could start, stop, or continue a run.

Launch it from the project/world cwd using only the committed build artifact -- no install, no build step:

```bash
node "$SKILL_DIR/scripts/agent-world-studio.js" --project "$PWD"
```

`--project` is optional in this form: the project directory can also be given positionally (`node "$SKILL_DIR/scripts/agent-world-studio.js" ../some-project`), and defaults to the cwd.

When working on Studio itself from this repository, `npm run dev` launches it against a target project with a live client:

```bash
npm run dev -- ../test-dir
```

The client is served by a vite dev server with HMR straight from `src/studio/client/` -- no bundle and no dist -- while the API server is bundled to the gitignored `.dev/` and restarted when its sources change. Vite proxies `/api` and the `?token=` handshake to it, so the browser sees a single origin and the session cookie behaves exactly as it does in a released build. The session token is fixed for the life of the dev loop, so a server restart does not expire the browser session; the printed URL stays good.

The committed build artifacts are never written during development -- they stay as last released until `npm run build`, which is what a release run should commit. `--port` sets the browser-facing port (otherwise a free one is chosen), `--no-open` skips opening a browser, and every other argument is forwarded to the Studio CLI.

The target directory defaults to `.`, the directory the command was run from, so plain `npm run dev` opens Studio on the current project. A relative target resolves against that same directory rather than against the repository root, which is where npm itself runs the script from.

Two environment variables exist only for that dev loop and are unset in any installed use: `STUDIO_SKILL_DIR`, which points a scratch build back at the real skill directory for `world.schema.json` and the router, and `STUDIO_SESSION_TOKEN`, which pins the session token (ignored unless it is at least 48 url-safe characters).

It prints a `http://127.0.0.1:<port>/?token=<token>` URL. Opening it completes a one-time handshake (the token exchanges for an `HttpOnly; SameSite=Strict` session cookie, then the address bar drops the token) and loads the client shell, which shows the resolved workspace and a live event-stream connection.

Implemented endpoints, all requiring the session cookie except the `/` handshake and the static client assets:

- `GET /api/workspace`: the resolved project root and whether a world is loaded.
- `GET /api/world` / `PUT /api/world`: read and atomically save semantic `.agent-world/world.json`, validated against both the canonical schema and the router's own graph rules before anything is written.
- `GET /api/layout` / `PUT /api/layout`: restore `.agent-world/world.layout.json` and atomically autosave it after canvas edits. Writes carry the raw file revision returned by the last read/write, so an external edit wins a conflict instead of being silently overwritten.
- `POST /api/validate`: validate a candidate world without saving it.
- `GET /api/prompts/:agentId` / `PUT /api/prompts/:agentId`: read and write an agent's prompt file, addressed by agent id with the path resolved from the world, not supplied by the client.
- `GET /api/events`: a Server-Sent Events stream of file changes, saves, and validation results, shared by every connected client from one file watcher.

Visual layout (node positions, viewport) lives only in `.agent-world/world.layout.json`; `.agent-world/world.json` remains the semantic source of truth and never carries layout data. Studio writes the layout file only after a node drag, viewport pan/zoom (including the canvas controls), or explicit Auto layout. Opening, restoring, editing semantic fields, and manually saving the world never create or rewrite it. Missing or malformed layout falls back safely, and stale node positions are ignored until the matching node exists in the world.

### The Design surface

Opening the printed URL loads the editor: a canvas rendering the workflow as a graph, with solid arrows for allowed routing edges and dashed arrows for `requires` prerequisites, and the entry node marked. A project with no world file yet opens as an empty, editable canvas with an affordance to create the first node and agent, rather than an error.

From the canvas and its side panels, a user can:

- Add, delete, and connect or disconnect workflow nodes and routing edges.
- Assign a node's agent, edit its instruction and `requires` prerequisites, and choose the workflow entry.
- Add, rename, and delete agents, and edit an agent's display name, role, prompt path, and context scope.
- Edit world-level settings: identifier, name, turn limit, stop token, and mode.
- Open and edit an agent's prompt Markdown file, and view the current in-memory world as raw JSON.
- Run automatic layout on demand (never automatically). Manual positions, automatic-layout results, and the last viewport autosave independently and restore the next time Studio opens the same project; moving the canvas does not make the semantic world dirty.
- Save workflow edits manually through the server, which is the only path that can reject a semantic edit. A rejected save is reported as a failure and never discards the edit. Validation errors are shown against the specific node, edge, agent, or field they name, not only as a generic failure. Layout save failures have their own visible Retry action and retain the latest in-memory layout.
- Handle a file changed outside Studio per resource: a clean world or layout reloads independently without discarding dirty state in the other; only a change that collides with unsaved state of the same resource offers Reload, Compare (including node positions and viewport for a layout conflict), or Keep Studio Version.
- Reconnect the event stream on its own after a transient drop, while the server process keeps running. A restarted server process is a different case: it mints a fresh session token per launch, so the browser cannot recover the old session on its own; the client shows a clear "session expired" message telling you to reopen the newly printed URL rather than hanging silently.

Deleting a node also removes it from every routing edge and every other node's `requires`; deleting an agent still assigned to a node is refused rather than silently orphaning that node. Both node and agent deletion are confirmed first, naming what else will be removed.

One constraint carries over from the server: creating a brand-new agent whose prompt file does not exist anywhere in the project cannot be completed by the client alone, because the server's prompt endpoints resolve an agent from the world already saved on disk, and a save itself requires every agent's prompt file to already exist. The first save for such an agent fails with a validation error naming the missing prompt path until that file exists by some other means (a project template, or creating it directly); the created node and agent remain in the canvas, editable, rather than being discarded.

This Design surface is the only mode implemented so far. Run observation (live execution state, the event timeline, active-node highlighting) and run History (past runs, snapshots, replay) are separate, not-yet-built surfaces; no run, stop, or continue control exists anywhere in the current client.

## The Short Version

Agent World turns a loose multi-agent conversation into a controlled workflow.

The JSON file defines the team and path. Prompt files carry the long instructions. The router remembers state and chooses the next step. The host executes only what the router returns.
