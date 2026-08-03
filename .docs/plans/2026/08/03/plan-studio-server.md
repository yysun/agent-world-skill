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
- **Watched here: `world.json`, `world.layout.json`, `prompts/**/*.md`.** `world.eval.md` is excluded: REQ's Non-Goals reserve "any surface for the evaluation contract file," and emitting `file.changed` events for it over SSE is itself such a surface even with no `/api/eval` endpoint. §14 also lists four `.agent-world/runs/**` globs; those are deferred to the run-observation story, when something consumes the events. Watching paths whose events nothing handles adds surface without behavior.
- **Self-write suppression by content hash**, per §18.2: every server write records `path → sha256`. On a watcher event the file is hashed; a match emits `file.changed` with `source: "studio"`, a mismatch emits `source: "external"`.

### Security

- Bind `127.0.0.1` on an ephemeral port by default, `--port` overrides. Ephemeral avoids colliding with an already-running Studio.
- **Session token via cookie handshake, not a persistent query parameter.** The CLI opens `http://127.0.0.1:<port>/?token=<random>`; that one request sets an `HttpOnly; SameSite=Strict` cookie and 302s to `/`, so the token leaves the address bar immediately. Every `/api/*` request including `GET /api/events` then authenticates from the cookie. Rejected `Authorization: Bearer` — `EventSource` cannot set headers, which would force the token into the SSE query string permanently.
- A single `resolveInsideRoots(candidate)` helper resolves every filesystem path with `path.resolve` plus `fs.realpath` and rejects anything not under the project root or the installed skill directory. Realpath closes the symlink escape a string-prefix check leaves open. Agent `promptPath` values come from a user-editable file and are treated as untrusted input.
- **Non-existent write targets (e.g. a prompt file being created for the first time) cannot be `fs.realpath`'d directly — `realpath` throws `ENOENT`.** `resolveInsideRoots` walks upward from the candidate path to the nearest ancestor directory that exists, realpaths that ancestor, then rejoins the remaining (still-nonexistent) path segments before comparing the result against the allowed roots. This still rejects an escape hidden behind a symlinked intermediate directory — only the final segment is allowed to be missing — while letting a legitimate first-time prompt write through.
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

- [x] Add root `package.json` with `private: true`, **no `type` field**, the dev dependencies listed in Decisions, and scripts `build:server`, `build:client`, `build`, `pretest` (running `build`), `test`, and `typecheck`. **Correction**: `node --test tests/` (bare directory) empirically fails with `MODULE_NOT_FOUND` in this repo/Node 22.22.0 combination; the working invocation is `node --test tests/*.test.js`. The `test` script and all later Validation-table references use `node --test tests/*.test.js tests/studio/*.test.js` instead.
- [x] Run `node skills/agent-world/scripts/agent-world-router.js help` immediately after adding the manifest and confirm it still loads as CommonJS, guarding against the `"type": "module"` regression recorded in Decisions. Result: router ran and threw its own domain error (`Missing Agent World config`), not an ESM `require` error — confirms CommonJS loading is intact.
- [x] Run `node --test tests/*.test.js` and confirm the three pre-existing suites still pass at their recorded counts after the manifest is added. Result: 57/57 pass (unchanged).
- [x] Add root `tsconfig.json` targeting ES2022 with `strict: true`, plus JSX support (`jsx: react-jsx`) scoped to `src/studio` via `include`.
- [x] Add `vite.config.ts` with the React plugin, `root` at `src/studio/client`, `base: './'`, `build.outDir` at `skills/agent-world/studio/dist/`, and `emptyOutDir: true`.
- [x] Add `scripts/build-server.mjs` emitting `skills/agent-world/scripts/agent-world-studio.js` as a bundled CJS Node 22 target with a `#!/usr/bin/env node` banner.
- [x] Add `node_modules/` to `.gitignore`, then run `git check-ignore -v` against both artifact paths and confirm neither is ignored. Result: exit code 1 (not ignored) for both `skills/agent-world/scripts/agent-world-studio.js` and `skills/agent-world/studio/dist/index.html`; `node_modules/foo` confirmed ignored.
- [ ] Run `npm install && npm run build` and record that both artifacts are produced. (`npm install` done: 152 packages added; `npm run build` deferred until Phase 3-6 source files exist.)

### Phase 3 - Shared contracts, workspace, and validator

- [x] Create `src/studio/shared/models.ts` with the world, agent, workflow-node, layout, and validation-error types, and `src/studio/shared/api.ts` with the request and response shapes for the workspace, world, validate, prompt, and event endpoints of §16 implemented here.
- [x] Create `src/studio/shared/events.ts` with the `workspace.loaded`, `file.changed`, `world.saved`, and `validation.completed` members of the §13 event union, transport-neutral and containing no run event.
- [x] Implement `src/studio/server/workspace.ts`: resolve the project root, ensure `.agent-world/` exists, read `world.json` and `world.layout.json`, report the world absent rather than throwing when `world.json` does not exist, and maintain the `path → sha256` map of the server's own writes.
- [x] Implement `resolveInsideRoots` in `workspace.ts` using `path.resolve` plus `fs.realpath` against the project root and the installed skill directory, rejecting escapes by `..` and by symbolic link, and handling a non-existent candidate by realpathing the nearest existing ancestor and rejoining the missing segments before the root check.
- [x] Implement `src/studio/server/validator.ts`: read `world.schema.json` from the skill directory, compile it with the Ajv 2020-12 dialect, load `agent-world-router.js` through `createRequire`, and expose `validatePath(candidatePath)` returning `{ valid, errors: { pointer, message }[] }` from Ajv output and from splitting `loadConfig`'s thrown message on `\n- `. (Named `validatePath` rather than `validateWorld` since it always validates a file already on disk, matching the save-path temp-file requirement; `validateCandidate` in `workspace.ts` wraps it for in-memory candidates via a scratch temp file.)
- [x] Implement the atomic save in `workspace.ts`: write `world.json.tmp` in the same directory, run `validatePath` against the temp path, `fsync`, `rename`, record the hash, and unlink the temp file on any failure so no partial write survives.
- [x] Implement layout read and write against `world.layout.json`, keeping every layout field out of `world.json`.
- [x] Implement prompt read and write resolving `promptPath` from the world through `resolveInsideRoots`.

### Phase 4 - Watcher and event stream

- [x] Implement `src/studio/server/watcher.ts`: one chokidar instance over `world.json`, `world.layout.json`, and `prompts/**/*.md` only (excluding `world.eval.md`, reserved by the REQ Non-Goals), hashing each changed file and emitting `file.changed` with `source: "studio"` on a hash match and `source: "external"` otherwise. Empirically, chokidar 5 no longer expands glob strings to a directory watch (verified in Phase 1/4 spikes), so the three targets are watched as concrete paths (two files plus the `prompts/` directory watched recursively) with `.md`-only filtering applied in the change handler; this reaches the same watched-file set the Decisions section specifies.
- [x] Implement `src/studio/server/sse.ts`: one event bus, an incrementing event id, per-client response registration with cleanup on close, and a heartbeat comment line every 20 seconds.
- [x] Wire the watcher and the save path into the single shared event bus so every connected client receives the same events. (Watcher takes the shared `EventBus` in its constructor; the HTTP layer's save path publishes `world.saved` to the same bus -- wired in Phase 5's `server.ts`.)
- [ ] Confirm no `run-manager.ts`, `router-adapter.ts`, `event-reader.ts`, or `run-history.ts` was created, and that `loadConfig` is the only router entry point referenced anywhere in the server. (Deferred to end of Phase 6, once all server source files exist.)

### Phase 5 - HTTP surface and security

- [x] Implement `src/studio/server/server.ts` with Express: `GET /` performing the `?token=` to `HttpOnly; SameSite=Strict` cookie handshake and 302 to `/`, plus static serving of `skills/agent-world/studio/dist/`.
- [x] Implement `GET /api/workspace`, `GET /api/world`, `PUT /api/world`, `POST /api/validate`, `GET /api/prompts/:agentId`, `PUT /api/prompts/:agentId`, and `GET /api/events`, carrying layout in the world read and write payloads.
- [x] Add token middleware so every `/api/*` route including `/api/events` returns 401 without a valid session cookie, leaving the static assets and the `/` handshake as the only unauthenticated routes.
- [x] Validate every `PUT` and `POST` world body against the schema and graph rules before the real file is touched, returning 400 with `{ pointer, message }` errors and performing no write. Per Decisions -> "Validation and saving", the world save path writes a scratch/temp file first and validates those exact bytes (so the validated content is the content that would land); on any failure the temp file is unlinked and the real `world.json` is never opened for writing. Prompt bodies are validated for shape (`content` must be a string) since they carry plain Markdown, not schema-governed JSON.
- [x] Return 400 for a `promptPath` that escapes the project root by `..` or through a symbolic link, reading and writing nothing.
- [x] Confirm the server registers no route matching `POST /api/runs`, `POST /api/runs/:runId/stop`, `POST /api/runs/:runId/continue`, or `POST /api/shell`, and no endpoint accepting a client-supplied filesystem path, command name, or shell string. Verified against the running built server with curl (both routes 404) and by grepping the built bundle for `/api/runs` and `/api/shell` (no matches) and for `cmd === 'user'|'next'|'complete'|'file'|'reset'` (no matches; `loadConfig` is referenced, nothing else).

### Phase 6 - CLI, client shell, and launch integration

- [x] Implement `src/studio/server/cli.ts`: parse `--project`, `--port`, `--no-open`; resolve the project directory; ensure `.agent-world/` exists; start the watcher and server on `127.0.0.1`; print the Studio URL carrying the token; and open the default browser through the platform command.
- [x] Register `SIGINT`, `SIGTERM`, and `exit` handlers closing the HTTP listener, the watcher, and every SSE response, and killing the browser child if still alive. (`exit` is necessarily synchronous/best-effort only -- Node does not allow awaiting async work in an `exit` handler -- so it closes the event bus and browser child synchronously; the full async close of the watcher and HTTP listener runs via the `SIGINT`/`SIGTERM` handlers, verified below.)
- [x] Create `src/studio/client/index.html`, `main.tsx`, and `App.tsx` rendering workspace metadata from `GET /api/workspace` and live connection status from `GET /api/events`, with no canvas, no property panel, and no run, stop, or continue affordance.
- [x] Add a Studio section to `skills/agent-world/SKILL.md` describing the `studio` request form and the launch command `node "$SKILL_DIR/scripts/agent-world-studio.js" --project "$PWD"`, stating that launching Studio is not the same as launching a workflow.
- [x] Extend the `description` frontmatter in `skills/agent-world/SKILL.md` so a Studio request triggers the skill.
- [x] Verify the launch path from a temporary project directory using only committed artifacts, with `node_modules` absent from resolution. Manually verified end-to-end against `/tmp/studio-smoke` (outside the repo, so no `node_modules` resolution was possible): handshake, `GET /api/workspace`, `GET /api/world`, `POST /api/validate` (both valid and schema/graph-invalid cases), prompt read/write, atomic save with rejected-save cleanup (including catching a real bug -- see below), layout round-trip and separation from `world.json`, `..`-traversal rejection, symlink-escape rejection, external-change and self-write-suppression SSE events, and clean `SIGTERM` shutdown (process exits, port released). **Found and fixed a real defect during this verification**: `validator.ts`'s `validateSchema` originally read Ajv errors off the `Ajv` instance (`ajvInstance.errors`), which Ajv never populates for a compiled-function call -- only the compiled `ValidateFunction` itself carries `.errors` after each call. This silently made every schema-invalid save appear valid and write successfully. Fixed by holding the compiled `ValidateFunction` (typed via `ajv`'s own `ValidateFunction`/`ErrorObject` types) and reading `.errors` from it; reverified with the same schema-invalid save, which now correctly returns 400 and leaves the file untouched.

### Phase 7 - Tests and verification wiring

- [x] Add `tests/studio/studio-server.test.js` covering startup on an ephemeral loopback port, the listening address being `127.0.0.1`, the token handshake, 401 for a missing or wrong token, static assets reachable without a cookie, and `SIGTERM` shutdown closing listener, watcher, and SSE responses. Each suite spawns the built bundle as a real child process (via `tests/studio/_helpers.js`) rather than requiring it in-process, so per-test `process.on('SIGINT'/'SIGTERM')` registrations in `cli.ts` never accumulate on the shared test-runner process.
- [x] Add `tests/studio/studio-boundary.test.js` asserting `POST /api/runs`, `POST /api/runs/:runId/stop`, `POST /api/runs/:runId/continue`, and `POST /api/shell` are all absent, and that the built bundle contains no invocation of the router's `user`, `next`, `complete`, or `file` commands.
- [x] Add `tests/studio/studio-world.test.js` covering world read on a valid project, world read reporting absence when no world file exists, schema-violation validation, graph-reference validation for a missing edge target, an undefined node agent, and a missing prerequisite, atomic save leaving the original byte-identical and no `.tmp` behind on failure, unmodified round-trip preserving `workflow.enforceEdges`, `routing.*`, and `agents.*.contextScope`, and a saved world that `loadConfig` accepts.
- [x] Add `tests/studio/studio-files.test.js` covering layout round-trip across a server restart, layout absent from `world.json`, prompt read and write, `promptPath` traversal rejection by `..` and by symbolic link, and an invalid write payload having no filesystem effect.
- [x] Add `tests/studio/studio-events.test.js` covering SSE connection, heartbeat emission, `file.changed` with `source: "external"` for an outside edit, hash-matched suppression to `source: "studio"` after a server save, `world.saved` carrying the content hash, and two concurrent clients sharing one watcher. **Found and fixed a real defect while writing these**: tests that left an SSE connection open before shutdown took ~3.2s each because `server.close()` waits for existing keep-alive sockets to end on their own, which a still-open SSE response does not do quickly. Fixed `cli.ts`'s `close()` to call `server.closeAllConnections()` immediately after `bus.close()`'s `res.end()` calls, so shutdown is prompt and deterministic regardless of client-side cooperation; full `tests/studio/*.test.js` runtime dropped from ~11.3s to ~4.3s with the same 28/28 pass count.
- [x] Create `.docs/tests/test-studio-server.md` with Given/When/Then scenarios for the HTTP and event-stream contract. (Already created during AP; content reviewed against the final implementation during Phase 7 and found accurate, no changes needed.)
- [x] Run `npm run build && npm test` and record the exact command with full pass counts for the pre-existing and new suites. `npm run build` produces both artifacts cleanly (no warnings). `node --test tests/*.test.js tests/studio/*.test.js`: **85/85 pass** (57 pre-existing + 28 new Studio tests), 0 fail, ~4.4s total.
- [x] Run `npm run typecheck` and record a clean result. Result: `tsc --noEmit` exits clean, no errors.

### Phase 8 - Documentation and status

- [x] Update `README.md` with a Studio server section covering the launch command, the implemented endpoints, the layout file, and the statement that Studio designs and observes while the agent host owns execution.
- [x] Add file comment blocks summarizing features, implementation notes, and recent changes to every new `src/studio/**` source file and every new test suite.
- [x] Record final evidence that each REQ acceptance criterion is satisfied, citing the specific test or command output that proves it. See the evidence table below.
- [x] Mark completed tasks complete only after the corresponding change or evidence exists.

### Phase 8 evidence table (per REQ acceptance-criteria group)

| REQ group | Evidence |
| --- | --- |
| Toolchain and packaging | `package.json` builds both artifacts (`npm run build`, no warnings); `git check-ignore -v` exits 1 for both artifact paths (not ignored); router/tests still load as CommonJS after adding the manifest (`node --test tests/*.test.js` 57/57); dev dependencies are devDependencies only, never required at runtime (bundle is self-contained, verified by launching from `/tmp/studio-*` project dirs with no `node_modules` in scope). |
| Launch and lifecycle | `tests/studio/studio-server.test.js` (loopback address, workspace load, SIGTERM releases the port); manual verification against `/tmp/studio-ui-smoke` and `/tmp/studio-smoke` (absent-world start, single watcher/bus per process by construction in `cli.ts`). |
| Ownership boundary | `tests/studio/studio-boundary.test.js` (forbidden routes 404; bundle grep finds no `user`/`next`/`complete`/`file` router command invocation, only `loadConfig`). |
| Security | `tests/studio/studio-server.test.js` (401 without/with-wrong session on every `/api/*` route including `/api/events`; static assets and `/` handshake unauthenticated); handshake redirect drops the token from the address bar (manual + `studio-server.test.js`); `tests/studio/studio-files.test.js` (`..` and symlink `promptPath` escapes both rejected with no filesystem effect); `tests/studio/studio-world.test.js` (invalid payload rejected with actionable `{pointer,message}` errors, no partial write); loopback-only binding (`new URL(handle.origin).hostname === '127.0.0.1'`, asserted in `studio-server.test.js`). |
| World reading, validation, and writing | `tests/studio/studio-world.test.js` (full read shape; schema violation with field-identifying pointer; missing edge target, undefined node agent, missing prerequisite all named; atomic save + router-loadable; rejected save leaves the file byte-identical with no `.tmp`; round-trip preserves `enforceEdges`/`routing.*`/`contextScope` with no injected default); `tests/studio/studio-files.test.js` (prompt read/write by agent id, path resolved from the world). |
| Change detection and event stream | `tests/studio/studio-events.test.js` (external change delivered without polling and marked `external`; self-write matched by hash marked `studio`; heartbeat comment on a short test interval; two concurrent clients share one watcher/bus). |
| Verification | The five `tests/studio/*.test.js` suites above (28 tests); `.docs/tests/test-studio-server.md`'s HTTP/SSE scenarios executed manually via curl during Phase 6 plus the client-shell scenario verified live in a browser during Phase 7 (workspace metadata rendered, `Event stream: connected`, no console errors). |

## Validation

| Check | Command | Expected evidence |
| --- | --- | --- |
| Module system unchanged | `node skills/agent-world/scripts/agent-world-router.js help` after adding the manifest | Router loads as CommonJS; no ESM `require` error |
| Existing suites unaffected | `node --test tests/*.test.js` | Pre-existing suites pass at their recorded counts |
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
