# Agent World Studio Server Plan

## Goal

Deliver the Studio server: a loopback-bound HTTP and SSE service that loads, validates, atomically saves, and watches an Agent World project, together with the build toolchain that compiles it into committed artifacts inside the installed skill and a minimal client shell proving the handshake and live event stream.

## Current Context

- **Depends on the skill restructure story.** This plan assumes `skills/agent-world/` already holds `SKILL.md`, `world.schema.json`, `world.example.json`, the reference documents, `prompts/`, and `scripts/`, and that `README.md`, `tests/`, and `.docs/` remain at the root. Studio source lands in `src/studio/` per `agent-world-studio-mvp.md` §8.
- `skills/agent-world/scripts/agent-world-router.js` exports `{ loadConfig, validateConfig }`. `loadConfig(configPath)` reads a world file, normalizes agent/workflow/world defaults, then calls `validateConfig`, which throws one `Error` whose message is `Invalid Agent World config:\n- <msg>\n- <msg>`. Each `<msg>` starts with a dotted path such as `workflow.nodes.<id>.agent`, `workflow.edges.<id>`, or `agents.<id>.contextScope`.
- `validateConfig` (`agent-world-router.js:161`) is the graph-reference authority: entry-node existence, node→agent references, `requires` targets, and edge source and target targets. `world.schema.json` is the shape authority, is `additionalProperties: false` at every level, and is deliberately skill-relative — never copied into a project.
- `world.schema.json` requires `world.id`, `world.name`; `workflow.type`, `workflow.entry`, `workflow.entryAgent`, `workflow.nodes`, `workflow.edges`; and `promptPath` on each agent. Identifiers match `^[A-Za-z0-9_-]+$`. Its `$schema` is draft 2020-12, so Ajv must use the 2020 dialect entry point.
- The repository is CommonJS with no package manifest. Node 22.22.0, npm 11.13.0. Tests are `node --test` suites driving scripts with `spawnSync`.
- `.gitignore` lists `.DS_Store`, `.agent-world/`, `*.log`. It does not ignore `node_modules`.
- `agent-world-studio-mvp.md` was revised to an observer architecture (§1, §3, §5, §23.3): Studio designs and observes, the agent host executes, the router routes. §16 explicitly forbids `POST /api/runs`, `POST /api/runs/:runId/stop`, `POST /api/runs/:runId/continue`, and `POST /api/shell`. §8 states Studio needs no `run-manager.ts` or `router-adapter.ts`.
- Known unknowns to close in Phase 1: whether `loadConfig`/`normalizeAgents` checks `promptPath` existence at load time or only in `readPrompt`, and exactly which normalized defaults `loadConfig` injects, so round-tripping never writes back a field the user's file omitted.

## Decisions

### Toolchain

- Add a root `package.json`, `private`, npm scripts only. No workspaces, no monorepo tooling.
- **The root `package.json` must not set `"type": "module"`.** With no nearer manifest, that field reclassifies every `.js` file in the repository — including `agent-world-router.js` and all three test suites — as ESM. Verified empirically: the router then fails at its first `require` with `ReferenceError: require is not defined in ES module scope`, while the same file under a manifest without the field loads normally. The repository stays CommonJS; build scripts use `.mjs`, and `vite.config.ts` / `tsconfig.json` are unaffected because Vite and esbuild compile them.
- Server bundle: esbuild → `skills/agent-world/scripts/agent-world-studio.js`, `platform: node`, `format: cjs`, `target: node22`, fully bundled so the installed skill needs no `npm install`.
- Client bundle: Vite → `skills/agent-world/studio/dist/`, `base: './'` so assets resolve under any mount path, `emptyOutDir: true` set explicitly because the output directory lies outside the Vite root.
- Both outputs are committed. `node_modules/` is added to `.gitignore`; the two artifact paths are explicitly verified as **not** ignored.
- Dev dependencies: `typescript`, `esbuild`, `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `express`, `chokidar`, `ajv`. React Flow, ELK, and CodeMirror belong to the editor story and are not added here.
- HTTP framework: **Express**, per §7. Rejected hand-rolled `node:http` routing — it saves roughly 200 KB of committed bundle and buys hand-written body parsing and route matching on a small security-sensitive surface.

### Ownership boundary is enforced, not assumed

- The four endpoints forbidden by §16 are asserted absent by an automated test rather than left to code review, because "we did not build it" is exactly the kind of claim that quietly stops being true.
- The server loads the router module for `loadConfig` only. It never invokes the router's `user`, `next`, `complete`, or `file` commands and never spawns the router as a process. That is the whole line between a validator and a second agent host, so a test asserts the built bundle contains no such invocation.
- `run-manager.ts` and `router-adapter.ts` are never created. `event-reader.ts` and `run-history.ts` are named in §8 but belong to run observation and history, so they are not created here either.

### Validation and saving

- **Validation reuses the router; it does not reimplement it.** `validator.ts` loads `agent-world-router.js` at runtime through `createRequire` and calls `loadConfig`. A parallel graph-validation implementation could drift and declare valid a world the router refuses — the exact defect this service exists to prevent. The thrown message is split on `\n- `, each line's leading dotted path becomes a `{ pointer, message }` pair, and the raw message is always preserved as the human-readable text.
- **Save order: serialize → write `world.json.tmp` → Ajv-validate the raw JSON against `world.schema.json` → `loadConfig(tmpPath)` for graph references → `fsync` → `rename` → record hash → emit `world.saved`.** Validating the temp file rather than an in-memory object means the bytes validated are the bytes that land, and keeping the temp file in the same directory makes `loadConfig`'s `promptPath` resolution identical to the real file's. Any failure unlinks the temp file and returns errors with no partial write.
- The schema is read from the skill directory at runtime, never inlined or copied.
- **Round-trip preservation is mandatory.** The server must not drop schema-defined fields no editor exposes (`workflow.type`, `workflow.enforceEdges`, `routing.*`, `agents.*.contextScope`) and must not write back defaults `loadConfig` injects that the user's file omitted. Phase 1 records exactly which defaults those are.
- **An absent world file is a supported state**, per §9 step 3. The server reports the world absent rather than erroring, so the editor story can open an empty workspace.
- Layout lives only in `.agent-world/world.layout.json` as `{ version, nodes: { id: { x, y } }, viewport }`. The world schema is `additionalProperties: false`, so layout physically cannot go in `world.json` — enforced by the schema, not by convention.

### Watching

- One `chokidar` watcher and one event bus per server process, shared by all SSE clients, per §15.
- **Watched here: `world.json`, `world.layout.json`, `world.eval.md`, `prompts/**/*.md`.** §14 also lists four `.agent-world/runs/**` globs; those are deferred to the run-observation story, when something consumes the events. Watching paths whose events nothing handles adds surface without behavior.
- **Self-write suppression by content hash**, per §18.2: every server write records `path → sha256`. On a watcher event the file is hashed; a match emits `file.changed` with `source: "studio"`, a mismatch emits `source: "external"`.

### Security

- Bind `127.0.0.1` on an ephemeral port by default, `--port` overrides. Ephemeral avoids colliding with an already-running Studio.
- **Session token via cookie handshake, not a persistent query parameter.** The CLI opens `http://127.0.0.1:<port>/?token=<random>`; that one request sets an `HttpOnly; SameSite=Strict` cookie and 302s to `/`, so the token leaves the address bar immediately. Every `/api/*` request including `GET /api/events` then authenticates from the cookie. Rejected `Authorization: Bearer` — `EventSource` cannot set headers, which would force the token into the SSE query string permanently.
- A single `resolveInsideRoots(candidate)` helper resolves every filesystem path with `path.resolve` plus `fs.realpath` and rejects anything not under the project root or the installed skill directory. Realpath closes the symlink escape a string-prefix check leaves open. Agent `promptPath` values come from a user-editable file and are treated as untrusted input.
- No endpoint accepts a command, path, or shell string chosen by the client. Prompt endpoints address agents by `agentId` and resolve the path from the world.
- `SIGINT`/`SIGTERM`/`exit` close the HTTP server, the watcher, and all SSE responses, and kill the browser-open child if alive. §20 calls out closing the watcher specifically; the browser opener is the only child Studio ever creates.

### Client shell

- This story ships `index.html`, `main.tsx`, and an `App.tsx` that fetches `/api/workspace`, subscribes to `/api/events`, and renders workspace metadata plus connection status. It is the real application shell the editor story builds into, not a throwaway — but it contains no canvas, no panels, and no run affordance of any kind.

### Testing

- Automated tests run against the **built** `skills/agent-world/scripts/agent-world-studio.js`, not the TypeScript source. No TS loader is needed in the runner, `node --test` stays the single runner, and the artifact the skill actually ships is what gets verified.
- An E2E spec **is** required: the HTTP API is a public consumer contract.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [ ] Inspect `loadConfig` and `normalizeAgents` in `skills/agent-world/scripts/agent-world-router.js` to determine whether `promptPath` existence is checked at load time or only in `readPrompt`, and record which defaults (`world.turnLimit`, `world.mode`, `world.stopToken`, `workflow.entry`, `workflow.entryAgent`, `agents.*.contextScope`) are injected rather than read from the file.
- [ ] Derive from `world.schema.json` the exact set of fields the server must round-trip untouched, so the save path cannot silently drop `workflow.type`, `workflow.enforceEdges`, or `routing.*`.
- [ ] Run the router against a deliberately broken world and record the concrete thrown-message strings the `{ pointer, message }` parser must handle.
- [ ] Verify `express`, `chokidar`, and `ajv` bundle cleanly under esbuild `platform: node, format: cjs` with no dynamic-require warnings, before any server code depends on them.
- [ ] Record the forbidden list from §3.4, §5, §16, and §23.3 — no run-control endpoint, no shell endpoint, no router execution invocation — so later phases cannot drift into it.

### Phase 2 - Toolchain and build pipeline

- [ ] Add root `package.json` with `private: true`, **no `type` field**, the dev dependencies listed in Decisions, and scripts `build:server`, `build:client`, `build`, `pretest` (running `build`), `test` (`node --test tests/`), and `typecheck`.
- [ ] Run `node skills/agent-world/scripts/agent-world-router.js help` immediately after adding the manifest and confirm it still loads as CommonJS, guarding against the `"type": "module"` regression recorded in Decisions.
- [ ] Run `node --test tests/` and confirm the three pre-existing suites still pass at their recorded counts after the manifest is added.
- [ ] Add root `tsconfig.json` targeting ES2022 with `strict: true`, plus a client-scoped configuration for JSX under `src/studio/client/`.
- [ ] Add `vite.config.ts` with the React plugin, `root` at `src/studio/client`, `base: './'`, `build.outDir` at `skills/agent-world/studio/dist/`, and `emptyOutDir: true`.
- [ ] Add `scripts/build-server.mjs` emitting `skills/agent-world/scripts/agent-world-studio.js` as a bundled CJS Node 22 target with a `#!/usr/bin/env node` banner.
- [ ] Add `node_modules/` and build scratch paths to `.gitignore`, then run `git check-ignore -v` against both artifact paths and confirm neither is ignored.
- [ ] Run `npm install && npm run build` and record that both artifacts are produced.

### Phase 3 - Shared contracts, workspace, and validator

- [ ] Create `src/studio/shared/models.ts` with the world, agent, workflow-node, layout, and validation-error types, and `src/studio/shared/api.ts` with the request and response shapes for the workspace, world, validate, prompt, and event endpoints of §16 implemented here.
- [ ] Create `src/studio/shared/events.ts` with the `workspace.loaded`, `file.changed`, `world.saved`, and `validation.completed` members of the §13 event union, transport-neutral and containing no run event.
- [ ] Implement `src/studio/server/workspace.ts`: resolve the project root, ensure `.agent-world/` exists, read `world.json` and `world.layout.json`, report the world absent rather than throwing when `world.json` does not exist, and maintain the `path → sha256` map of the server's own writes.
- [ ] Implement `resolveInsideRoots` in `workspace.ts` using `path.resolve` plus `fs.realpath` against the project root and the installed skill directory, rejecting escapes by `..` and by symbolic link.
- [ ] Implement `src/studio/server/validator.ts`: read `world.schema.json` from the skill directory, compile it with the Ajv 2020-12 dialect, load `agent-world-router.js` through `createRequire`, and expose `validateWorld(candidatePath)` returning `{ valid, errors: { pointer, message }[] }` from Ajv output and from splitting `loadConfig`'s thrown message on `\n- `.
- [ ] Implement the atomic save in `workspace.ts`: write `world.json.tmp` in the same directory, run `validateWorld` against the temp path, `fsync`, `rename`, record the hash, and unlink the temp file on any failure so no partial write survives.
- [ ] Implement layout read and write against `world.layout.json`, keeping every layout field out of `world.json`.
- [ ] Implement prompt read and write resolving `promptPath` from the world through `resolveInsideRoots`.

### Phase 4 - Watcher and event stream

- [ ] Implement `src/studio/server/watcher.ts`: one chokidar instance over `world.json`, `world.layout.json`, `world.eval.md`, and `prompts/**/*.md`, hashing each changed file and emitting `file.changed` with `source: "studio"` on a hash match and `source: "external"` otherwise.
- [ ] Implement `src/studio/server/sse.ts`: one event bus, an incrementing event id, per-client response registration with cleanup on close, and a heartbeat comment line every 20 seconds.
- [ ] Wire the watcher and the save path into the single shared event bus so every connected client receives the same events.
- [ ] Confirm no `run-manager.ts`, `router-adapter.ts`, `event-reader.ts`, or `run-history.ts` was created, and that `loadConfig` is the only router entry point referenced anywhere in the server.

### Phase 5 - HTTP surface and security

- [ ] Implement `src/studio/server/server.ts` with Express: `GET /` performing the `?token=` to `HttpOnly; SameSite=Strict` cookie handshake and 302 to `/`, plus static serving of `skills/agent-world/studio/dist/`.
- [ ] Implement `GET /api/workspace`, `GET /api/world`, `PUT /api/world`, `POST /api/validate`, `GET /api/prompts/:agentId`, `PUT /api/prompts/:agentId`, and `GET /api/events`, carrying layout in the world read and write payloads.
- [ ] Add token middleware so every `/api/*` route including `/api/events` returns 401 without a valid session cookie, leaving the static assets and the `/` handshake as the only unauthenticated routes.
- [ ] Validate every `PUT` and `POST` body with Ajv before any filesystem call, returning 400 with `{ pointer, message }` errors and performing no write.
- [ ] Return 400 for a `promptPath` that escapes the project root by `..` or through a symbolic link, reading and writing nothing.
- [ ] Confirm the server registers no route matching `POST /api/runs`, `POST /api/runs/:runId/stop`, `POST /api/runs/:runId/continue`, or `POST /api/shell`, and no endpoint accepting a client-supplied filesystem path, command name, or shell string.

### Phase 6 - CLI, client shell, and launch integration

- [ ] Implement `src/studio/server/cli.ts`: parse `--project`, `--port`, `--no-open`; resolve the project directory; ensure `.agent-world/` exists; start the watcher and server on `127.0.0.1`; print the Studio URL carrying the token; and open the default browser through the platform command.
- [ ] Register `SIGINT`, `SIGTERM`, and `exit` handlers closing the HTTP listener, the watcher, and every SSE response, and killing the browser child if still alive.
- [ ] Create `src/studio/client/index.html`, `main.tsx`, and `App.tsx` rendering workspace metadata from `GET /api/workspace` and live connection status from `GET /api/events`, with no canvas, no property panel, and no run, stop, or continue affordance.
- [ ] Add a Studio section to `skills/agent-world/SKILL.md` describing the `studio` request form and the launch command `node "$SKILL_DIR/scripts/agent-world-studio.js" --project "$PWD"`, stating that launching Studio is not the same as launching a workflow.
- [ ] Extend the `description` frontmatter in `skills/agent-world/SKILL.md` so a Studio request triggers the skill.
- [ ] Verify the launch path from a temporary project directory using only committed artifacts, with `node_modules` absent from resolution.

### Phase 7 - Tests and verification wiring

- [ ] Add `tests/studio/studio-server.test.js` covering startup on an ephemeral loopback port, the listening address being `127.0.0.1`, the token handshake, 401 for a missing or wrong token, static assets reachable without a cookie, and `SIGTERM` shutdown closing listener, watcher, and SSE responses.
- [ ] Add `tests/studio/studio-boundary.test.js` asserting `POST /api/runs`, `POST /api/runs/:runId/stop`, `POST /api/runs/:runId/continue`, and `POST /api/shell` are all absent, and that the built bundle contains no invocation of the router's `user`, `next`, `complete`, or `file` commands.
- [ ] Add `tests/studio/studio-world.test.js` covering world read on a valid project, world read reporting absence when no world file exists, schema-violation validation, graph-reference validation for a missing edge target, an undefined node agent, and a missing prerequisite, atomic save leaving the original byte-identical and no `.tmp` behind on failure, unmodified round-trip preserving `workflow.type`, `workflow.enforceEdges`, `routing.*`, and `agents.*.contextScope`, and a saved world that `loadConfig` accepts.
- [ ] Add `tests/studio/studio-files.test.js` covering layout round-trip across a server restart, layout absent from `world.json`, prompt read and write, `promptPath` traversal rejection by `..` and by symbolic link, and an invalid write payload having no filesystem effect.
- [ ] Add `tests/studio/studio-events.test.js` covering SSE connection, heartbeat emission, `file.changed` with `source: "external"` for an outside edit, hash-matched suppression to `source: "studio"` after a server save, `world.saved` carrying the content hash, and two concurrent clients sharing one watcher.
- [ ] Create `.docs/tests/test-studio-server.md` with Given/When/Then scenarios for the HTTP and event-stream contract.
- [ ] Run `npm run build && npm test` and record the exact command with full pass counts for the pre-existing and new suites.
- [ ] Run `npm run typecheck` and record a clean result.

### Phase 8 - Documentation and status

- [ ] Update `README.md` with a Studio server section covering the launch command, the implemented endpoints, the layout file, and the statement that Studio designs and observes while the agent host owns execution.
- [ ] Add file comment blocks summarizing features, implementation notes, and recent changes to every new `src/studio/**` source file and every new test suite.
- [ ] Record final evidence that each REQ acceptance criterion is satisfied, citing the specific test or command output that proves it.
- [ ] Mark completed tasks complete only after the corresponding change or evidence exists.

## Validation

| Check | Command | Expected evidence |
| --- | --- | --- |
| Module system unchanged | `node skills/agent-world/scripts/agent-world-router.js help` after adding the manifest | Router loads as CommonJS; no ESM `require` error |
| Existing suites unaffected | `node --test tests/` | Pre-existing suites pass at their recorded counts |
| Types | `npm run typecheck` | No errors |
| Build | `npm run build` | Server bundle and `studio/dist/index.html` both produced |
| Artifacts committed | `git check-ignore -v` on both artifact paths | Exit code 1 for both (not ignored) |
| No-install launch | `node skills/agent-world/scripts/agent-world-studio.js --project <tmp> --no-open` | Prints `http://127.0.0.1:<port>/?token=...` with `node_modules` absent from resolution |
| Full suite | `npm test` | All suites pass; counts recorded |
| Loopback only | `tests/studio/studio-server.test.js` | Listening address is `127.0.0.1`; no external interface bound |
| Token enforcement | `tests/studio/studio-server.test.js` | Every `/api/*` route including `/api/events` returns 401 without the cookie; static assets serve without one |
| No run-control or shell endpoint | `tests/studio/studio-boundary.test.js` | All four forbidden routes absent; no router execution command in the bundle |
| Traversal rejection | `tests/studio/studio-files.test.js` | `..` and symlinked escapes both return 400 and touch nothing |
| Atomic save | `tests/studio/studio-world.test.js` | Rejected save leaves the original byte-identical with no `.tmp` remaining |
| Router agreement | `tests/studio/studio-world.test.js` | `loadConfig` accepts every world the server accepted |
| Absent world | `tests/studio/studio-world.test.js` | World read returns success reporting absence rather than an error |
| Round-trip preservation | `tests/studio/studio-world.test.js` | Unexposed schema fields survive read-then-write unchanged; no injected default appears |
| Layout separation | `tests/studio/studio-files.test.js` | Layout persists across restart; `world.json` contains no layout field |
| Self-write suppression | `tests/studio/studio-events.test.js` | Server save yields `source: "studio"`; outside write yields `source: "external"` |
| One watcher per server | `tests/studio/studio-events.test.js` | Two clients receive the same event; one chokidar instance exists |
| Client shell | Manual scenario in `.docs/tests/test-studio-server.md` | Shell loads from built assets, completes the handshake, shows a live connection |

## Rollback / Risk

- **Bundling risk is front-loaded.** If `express`, `chokidar`, or `ajv` resists esbuild bundling, the no-install constraint breaks. Phase 1 verifies bundling before any code depends on it; the fallback is `node:http` and `fs.watch`, both dependency-free.
- **The package manifest can silently break the router.** Adding `"type": "module"` would convert every `.js` file in the repository to ESM and break the router and all three suites at once. Mitigated by the explicit Decision, a Phase 2 guard task run immediately after the manifest is added, and re-running the pre-existing suites in the same phase.
- **Parsing `loadConfig`'s thrown message is a string contract.** If the router's wording changes, pointer extraction degrades. Mitigated by always preserving the raw message, so the worst case is a less precise pointer rather than a lost error; Phase 1 records the concrete strings and Phase 7 asserts against them.
- **`promptPath` is untrusted input from a user-editable file** and reaches the filesystem on every prompt read and write. Mitigated by `resolveInsideRoots` with `fs.realpath`, asserted by traversal tests covering both `..` and symlinks.
- **Ownership-boundary drift** is the risk the architecture revision introduced: a later change could add a convenience endpoint that starts a run. Mitigated by `studio-boundary.test.js` asserting both the absent routes and the absent router execution invocations, so the boundary fails loudly rather than eroding.
- **Committed artifacts can drift from source.** Nothing here forces a rebuild before commit. Accepted for this milestone; a build-freshness check belongs with release packaging, a REQ non-goal. Flagged as a follow-up.
- **Deferred watcher globs.** The four `.agent-world/runs/**` patterns in §14 are not watched here. The run-observation story must add them; recorded so the omission is a decision rather than an oversight.
- Rollback is reverting this story's commits. It adds dependencies and generated artifacts but no migration and no change to existing runtime behavior, so reverting restores the prior state exactly.
