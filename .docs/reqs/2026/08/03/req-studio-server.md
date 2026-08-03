# Agent World Studio Server Requirement

## Problem

Agent World workflows are authored today by hand-editing `.agent-world/world.json` and `.agent-world/prompts/*.md`. There is no programmatic surface for reading, validating, or safely writing those files, so every tool that wants to work with a world re-derives the schema rules, the graph-reference rules, and the safe-write behavior for itself — and risks disagreeing with the router about what a valid world is.

Agent World Studio needs that surface before it can have a user interface. Per `agent-world-studio-mvp.md` §1 and §3, Studio designs workflows and observes execution while the agent host owns execution, so what is needed is a local read-and-edit service over project files — not a run driver.

## Requirement

Deliver the Agent World Studio server: a local, loopback-bound HTTP service that resolves an Agent World project, loads its world and layout, validates candidate worlds against both the canonical schema and the router's graph rules, writes changes atomically, watches project files, and pushes workspace events to connected clients over Server-Sent Events.

The story also establishes the build toolchain that compiles Studio into committed artifacts inside the installed skill, and a minimal client shell that proves static serving, the session handshake, and the live event stream end to end.

### Ownership boundary

Studio must never select the next agent, call an agent model, execute a host action, invoke an arbitrary command, start or stop a run, modify router state, or become a second agent host. The server's only use of router code is configuration loading and validation. This boundary must be a property of the shipped surface, not a convention.

## Acceptance Criteria

### Toolchain and packaging

- [x] Building from source produces the Studio server bundle and the client assets inside the installed skill directory, and the documented build command reproduces both.
- [ ] The built artifacts are committed and are not excluded by version control ignore rules. **Incomplete**: `git check-ignore -v` confirms neither artifact path is ignored, but nothing from this story has been `git commit`-ed yet (`git status --short` shows it all untracked/modified) -- committing is deliberately deferred pending an explicit user request (GC), per this repository's "never commit without being asked" rule. Re-check after GC runs.
- [x] The server bundle runs on the Node.js version the existing scripts and tests target, with no dependency install, no build step, and no transpiler at load time.
- [x] Adding the package manifest does not change the module system under which the existing router, eval runner, or test suites load.
- [x] Development dependencies are confined to the source tree and are not required at skill runtime.

### Launch and lifecycle

- [x] The skill recognizes a `studio` request and launches the server against the current project directory using only committed artifacts.
- [x] Launching resolves the project directory, ensures the Agent World project directory exists, loads the world when present, starts exactly one file watcher, starts one HTTP server bound to the loopback interface, and reports the Studio URL.
- [x] Launching against a project that has no world file starts normally and reports the world as absent rather than failing.
- [x] The server creates exactly one watcher and one event bus regardless of how many clients connect.
- [x] Stopping the server closes the HTTP listener, the file watcher, and every open event-stream response, and leaves no process it started still running.

### Ownership boundary

- [x] The server exposes no endpoint that starts, stops, continues, or otherwise controls a workflow run, and no endpoint that accepts an arbitrary command, path, or shell string from the client.
- [x] The server never invokes the router as an execution host; the only router capability it uses is configuration loading and validation.

### Security

- [x] Every API request, including the event stream, is rejected unless it carries the session token generated at server start; only the static client assets and the single token-handshake entry point are reachable without it.
- [x] The session token is not left in the browser address bar after the handshake completes.
- [x] Any request resolving to a path outside the project directory or the installed skill directory is rejected rather than read or written, including paths that escape through a symbolic link.
- [x] Every write payload is validated before it reaches the filesystem, and an invalid payload is rejected with an actionable error instead of a partial write.
- [x] The server binds only to the loopback interface and to no external interface.

### World reading, validation, and writing

- [x] Reading a world returns its workflow nodes with their agent, instruction, and prerequisites, its routing edges, its agents with their display name, role, prompt path, and context scope, its world settings, and its persisted visual layout.
- [x] Validation reports a world invalid when it violates the canonical schema and when it violates the router's graph rules, covering a missing edge target, a node assigned to an undefined agent, and a prerequisite naming a node that does not exist.
- [x] Validation errors identify the offending node, edge, agent, or field, and preserve the underlying message rather than reducing it to a generic failure.
- [x] Studio and the router agree on validity: a world the server accepts is a world the existing router loads without error.
- [x] A saved world is validated against the schema and against graph references before writing, and is written atomically so a watcher cannot observe a partially written file.
- [x] A rejected save leaves the existing world byte-identical and leaves no temporary file behind.
- [x] Saving records the written content hash, publishes a save event, and writes visual layout to a separate layout file so no layout metadata appears in the world file.
- [x] Reading a world and writing it back unmodified preserves every schema-defined field, including those no editor exposes, and introduces no field the original file omitted.
- [x] Prompt content can be read and written for a defined agent, addressed by agent identifier, with the filesystem path resolved from the world rather than supplied by the client.

### Change detection and event stream

- [x] A change to a watched workflow or prompt file made outside Studio is delivered to connected clients over the event stream without polling, marked as externally sourced.
- [x] A change whose content matches the server's own most recent write is marked as Studio-sourced so it raises no conflict.
- [x] The event stream stays open across idle periods and emits a periodic heartbeat.
- [x] Multiple concurrent clients each receive the same events from the single shared watcher and event bus.

### Verification

- [x] Automated tests cover startup and shutdown, loopback binding, token enforcement, path-traversal rejection, absence of every forbidden run-control and shell endpoint, world reading including the absent-world case, schema and graph-reference validation, atomic save and rejected-save cleanup, round-trip field preservation, layout round-trip, prompt reading and writing, event delivery for external changes, self-write suppression, heartbeat, and single-watcher sharing across clients.
- [x] An executable end-to-end specification drives the HTTP and event-stream contract against a temporary project and passes.
- [x] A minimal client shell is served from the built assets and demonstrates the session handshake and a live event-stream connection.

## Constraints

- Depends on the skill restructure story; the server is built into the relocated skill directory and loads the schema and router from it.
- The existing router and eval runner keep their current behavior, command-line surface, handoff protocol, and persisted state format. They are not modified.
- `.agent-world/world.json` remains the semantic source of truth. Visual layout lives only in the separate layout file.
- The canonical schema in the installed skill directory remains the single schema. The server validates against it rather than embedding or copying it.
- Graph-reference validation must agree with the router by construction, not by a parallel reimplementation that can drift.
- Transport is HTTP for reads and edits and Server-Sent Events for push. No WebSockets.
- Because Studio does not execute workflows, it must not require permission to run arbitrary project commands.
- The watcher covers workflow and prompt files. Run artifact paths are watched when run observation is built.

## Non-Goals

- The workflow editor user interface: the graph canvas, property panels, prompt editing UI, raw JSON view, automatic layout, conflict resolution UI, and edit confirmations. Those are the editor story. This story ships only the minimal shell that proves the server surface works.
- Router event recording: run identifiers, run directories, workflow snapshots, normalized event logs, and persisted final output. That is later work on the router, not on Studio.
- Live run observation, active-node highlighting, route highlighting, host-action display, and the event timeline.
- Run history listing, run detail and event reads, snapshot loading, and replay.
- Any Studio-side execution capability. No executor, run manager, or router execution adapter is designed or stubbed.
- The evaluation endpoint and any surface for the evaluation contract file.
- Release packaging, versioning, and publishing beyond committing the artifacts the skill needs to run.
- Authentication beyond the local session token, multi-user access, remote hosting, and any non-loopback binding.
- Editing fields the canonical schema does not define, and any Studio-only extension to the schema.
