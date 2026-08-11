# Studio Layout Autosave Plan

## Goal

Make layout persistence automatic and independent: Studio restores safe layout state on load and durably saves the latest node positions and viewport after canvas edits, without treating presentation changes as unsaved workflow edits or touching the layout file for semantic-only work.

## Current Context

- `src/studio/client/state/useWorldState.ts` loads `world` and `layout` together from `GET /api/world`, but node moves currently mark the world dirty and layout is written only by the manual `PUT /api/world` path. Viewport changes ride along with a later world save.
- `src/studio/client/App.tsx` uses `world.dirty` for both the Save button and external-change conflict decision. It has no layout-specific saving or failure status.
- `src/studio/server/server.ts` exposes no layout-only write route. `PUT /api/world` accepts an optional layout and calls `Workspace.saveWorld`.
- `src/studio/server/workspace.ts` reads layout JSON without error isolation and writes it directly rather than through the atomic temp-file/fsync/rename discipline used for `world.json`.
- `src/studio/server/watcher.ts` already watches `world.layout.json` and classifies matching Studio write hashes as self-writes, so a layout-only endpoint can preserve the current SSE conflict model.
- `src/studio/shared/api.ts` and `src/studio/shared/models.ts` define the transport and persisted layout shapes. Layout input currently has no runtime validation.
- Tests use Node's built-in runner and loopback Studio process helpers. `npm run typecheck`, `npm run build`, and `npm test` are the authoritative verification commands.
- The worktree contains regenerated committed Studio artifacts from the immediately preceding dynamic-anchor host action. Source edits for this story must stay scoped, while the final generated bundle must represent the complete current source tree.

## Decisions

- Add authenticated `GET /api/layout` and `PUT /api/layout` endpoints dedicated to presentation state. Manual `GET /api/world` and `PUT /api/world` will carry semantic world data only; retaining optional layout input there would preserve the exact coupling this story removes, so that compatibility path will be removed.
- Return a raw-file revision token with every layout read/write and require `PUT /api/layout` to carry the token of the file snapshot it replaces. The token is SHA-256 of the exact on-disk bytes before parsing or reconciliation; a missing file uses JSON `null`. After validating and syncing its temp file, the server re-reads the current token immediately before atomic rename. A detected mismatch returns HTTP 409 and does not write, including when two malformed/stale files normalize identically. After the existing conflict UI's explicit Keep choice, the client refreshes the external token and retries its retained latest layout. Reload fetches disk state successfully before discarding retained layout work; a failed or stale fetch preserves the local snapshot and conflict prompt. Portable filesystem rename has no conditional-replace primitive, so an external write in the final check-to-rename instruction window is an explicit best-effort boundary rather than a claimed cross-process transaction.
- Validate layout input at the server boundary. Accept layout version 1, finite node coordinates, and an optional finite viewport with positive zoom. Normal autosave uses merge mode: every syntactically valid disk position absent from the candidate survives, regardless of whether the matching world node arrived before or after capture, and the authoritative merged result is folded back into client memory. Explicit Keep Studio Version uses replace mode so the retained Studio snapshot actually replaces conflicting external positions. Reads filter entries against the current world, retaining the synthetic Human entry only when the world has a Human routing source; a successful clean world reload is followed by a clean layout reload to reveal newly current positions. Deleted-node positions may remain dormant on disk and are never rendered unless that node id becomes current again.
- Treat a missing, invalid-JSON, incompatible-version, or invalid-root layout file as empty layout during load. For a valid version-1 root, drop only malformed positions, stale node IDs, or a malformed viewport while retaining other valid entries. An existing file that cannot be read is a real I/O failure and is surfaced rather than misrepresented with the missing-file `null` revision token.
- Persist layout atomically with a unique temporary file, file sync, rename, and write-hash recording. Do not add a migration, backup file, flag, environment variable, or alternate storage path.
- Introduce a small client autosave controller independent of React. It will debounce changes, permit only one normal request at a time, retain only the latest pending snapshot, carry the latest server hash, pause queued work during an external conflict, ignore stale completions after discard/reload, avoid automatic infinite retries after failure, and expose explicit retry, keep, discard, and shutdown-drain paths. Browser close warns while work remains; forced termination before acknowledgement is not represented as durable success.
- Keep workflow and layout revisions separate in `useWorldState`. Node moves, explicit automatic-layout results, and viewport changes are the only operations that schedule layout persistence; restore/load, semantic mutations, manual world Save, Compare, Reload, and world-only Keep never schedule a layout write. World mutations alone control the manual Save button and semantic conflict dirty flag.
- Gate persistence at the React Flow event source rather than inferring intent from changed values. `Canvas.tsx` reports persisted node positions from user drag-stop callbacks, not generic `onNodesChange` position notifications. A viewport change persists when `onMoveEnd` carries a user input event or when a preceding React Flow Controls callback marks the null-event move as user-requested (Zoom In, Zoom Out, or Fit View); unmarked null-event initialization/restore/automatic `fitView` movement is ignored. The explicit toolbar Auto layout action remains the only programmatic caller allowed to persist positions.
- Load world and layout independently after startup as well as external changes. A clean layout reloads from disk even while the semantic world is dirty, and a clean world reloads even while a canvas edit is pending. Only the resource with unsaved local state enters the conflict flow, so resource-scoped reload cannot discard unrelated edits.
- Treat queued, in-flight, failed, or hash-conflicted layout state as unsaved for layout external-change decisions. On an external layout event with local canvas work, pause queued autosave immediately; Reload discards it and remounts the canvas from disk, while Keep resumes only after the external hash is known. If no local canvas work exists, restore the external layout without prompting or writing. Successful Studio writes remain ignored through the existing watcher self-write hash.
- Increment a layout-load generation on every restore and use it to remount the React Flow canvas, because its existing `defaultViewport` is initial-only and cannot otherwise apply a viewport changed externally.
- Guard asynchronous Auto layout with a synchronous operation generation. Any later node drag, semantic graph edit, world reload, or layout reload invalidates the older calculation before it can schedule persistence.
- Track whether conflicts came from `world.json`, `world.layout.json`, or both. Extend `CompareView.tsx` to show Studio versus disk layout JSON for layout conflicts, including node positions and viewport. After reconnect, refresh each clean resource independently and classify conflicts only for dirty resources; show both only when both resources have local unsaved state. Reuse the existing world comparison for semantic-only conflicts.
- Surface layout status separately from schema/graph validation errors so a layout I/O failure cannot masquerade as an invalid world.
- Add an executable server integration path plus a human-readable E2E spec because this is a user-facing persistence flow and changes the authenticated HTTP contract.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `useWorldState.ts`, `App.tsx`, `server.ts`, `workspace.ts`, `watcher.ts`, shared API/models, Studio file/world/event tests, package scripts, and current documentation to confirm the existing coupled save and restore paths.
- [x] Identify the optional layout body on `PUT /api/world`, direct layout file write, and shared `dirty` state as the coupling that must be removed.
- [x] Record automatic workflow saves, automatic graph layout, history, migrations, feature flags, and router changes as explicit non-goals.

### Phase 2 - Layout persistence foundation

- [x] Update `src/studio/shared/api.ts` with dedicated raw-revision-token layout read/write contracts (`null` for a missing file) and semantic-only world contracts while preserving the persisted layout shape in `models.ts`.
- [x] Update `src/studio/server/workspace.ts` to hash readable raw layout bytes before parsing, validate layout writes, partially reconcile layout reads, retain valid unsaved-node positions on disk, tolerate malformed root data, surface unreadable-file I/O failures distinctly, enforce expected-token conflicts, and atomically persist accepted snapshots.
- [x] Update `src/studio/server/server.ts` to register authenticated `GET /api/layout` and `PUT /api/layout`, return clear 400 errors for invalid input and 409 for hash conflicts, and stop coupling layout to world routes.
- [x] Update the top comment blocks in each edited source file to describe the new independent layout ownership and recent change.

### Phase 3 - Client autosave integration

- [x] Add `src/studio/client/state/layoutAutosave.ts` with a debounced, serialized latest-snapshot controller, expected-hash writes, conflict pause/resolution, stale-completion invalidation, retry support after failure, shutdown drain/keepalive sequencing, disposal cleanup, and status callbacks.
- [x] Update `src/studio/client/state/useWorldState.ts` to restore world and layout independently, keep their dirty/revision state separate, schedule autosave only for node/viewport changes and explicit Auto layout results, retain failed in-memory layout, expose resource-scoped dirty/reload plus retry/keep/discard/status operations, drain on shutdown, install a `beforeunload` warning while layout remains unsaved, and send only semantic data through manual world save.
- [x] Update `src/studio/client/App.tsx` so the world Save button reflects only semantic edits, layout failures and retries are visible, external changes reload clean resources independently, dirty resources alone enter conflict handling, layout Keep is unavailable unless a canvas edit is pending, and Reload discards only the conflicted resource before restoring disk state.
- [x] Update `src/studio/client/state/CompareView.tsx` and conflict state in `App.tsx` to accumulate world/layout conflict kinds, render Studio/disk layout JSON for layout conflicts, render both after reconnect or multi-file conflicts, and retain semantic-only comparison for world conflicts.
- [x] Update `src/studio/client/workflow/Canvas.tsx` integration so a restored layout generation remounts React Flow and applies an externally changed viewport as well as node positions, while only user drag-stop callbacks persist node positions. Persist viewport for direct user-event `onMoveEnd` or a null-event move explicitly armed by the Controls Zoom In/Zoom Out/Fit View callbacks; suppress unarmed programmatic remount and automatic `fitView` notifications.
- [x] Confirm automatic layout still runs only on explicit user action and that canvas, router, prompt, and world-schema behavior remain unchanged.

### Phase 4 - Tests and verification wiring

- [x] Add `tests/studio/studio-layout-autosave.test.js` with focused pure controller/client-state coverage for debounce, serialization, newest-snapshot retention, shutdown drain, hash conflicts, pause/discard, failure retention, retry, resource-scoped conflict classification, proof that no retained canvas edit means Keep cannot schedule a layout write, and canvas event-origin helpers that reject unarmed programmatic notifications while accepting drag-stop, direct pan/zoom, and Controls zoom/fit actions.
- [x] Extend `tests/studio/studio-files.test.js` and `tests/studio/studio-world.test.js` for layout-only persistence, no layout creation/rewrite before a canvas edit, atomic cleanup, unchanged `world.json`, malformed/incompatible root fallback, partial-invalid/stale filtering, unsaved-node retention, invalid request rejection, raw revision tokens for missing/malformed/partial/external states, expected-token conflicts, and server restart restore.
- [x] Update `tests/studio/studio-server.test.js` and `tests/studio/studio-events.test.js` for layout-route authentication and Studio self-write classification; retain the existing boundary assertions in `studio-boundary.test.js`.
- [x] Run `npm run typecheck`, then `npm run build` before integration tests so the spawned committed server contains the new routes, then run `node --test tests/studio/studio-layout-autosave.test.js tests/studio/studio-files.test.js tests/studio/studio-world.test.js tests/studio/studio-events.test.js tests/studio/studio-boundary.test.js tests/studio/studio-graph-model.test.js` and `npm test`; record exact pass counts and non-blocking warnings.

### Phase 5 - Documentation and status

- [x] Update `README.md` and relevant Studio specification text so layout autosave, the dedicated endpoint, restore fallback, and manual world-save boundary are accurate.
- [x] Execute the user-interaction scenarios from `.docs/tests/test-studio-layout-autosave.md` against the built Studio and a disposable project, recording no-write initialization/semantic Save, viewport and drag persistence, restore without rewrite, and explicit Auto layout. Map failure/retry, shutdown, ordering, and external-conflict scenarios to focused automated coverage rather than claiming they were manually exercised in the browser.
- [x] Inspect the final diff and run `git diff --check` to confirm no schema, router, workflow-autosave, automatic-layout-on-open, or alternate storage mechanism was introduced.
- [x] Record validation evidence here and mark tasks complete only after the corresponding code, test, documentation, or command evidence exists.

## Validation

- `npm run typecheck`: passed with no diagnostics.
- `npm run build`: passed; regenerated committed server/client artifacts. Vite emitted only its existing CJS deprecation and large-chunk warnings.
- Focused Studio suite: 73/73 passed after the final implementation correction.
- `npm test`: 150/150 passed, including its production rebuild.
- Built-Studio E2E on a disposable project: opening and semantic Save left `world.layout.json` absent; Zoom In created a viewport-only layout; node drag persisted coordinates; reload restored coordinates/viewport without changing layout bytes or mtime; explicit Auto layout persisted all six nodes. Automated coverage supplies ordering, failure/retry, atomicity, malformed/stale restore, auth, watcher, and conflict scenarios.

- `npm run typecheck` must exit successfully without TypeScript diagnostics.
- `npm run build` must regenerate `skills/agent-world/scripts/agent-world-studio.js` and `skills/agent-world/studio/dist/` successfully.
- After `npm run build`, `node --test tests/studio/studio-layout-autosave.test.js tests/studio/studio-files.test.js tests/studio/studio-world.test.js tests/studio/studio-events.test.js tests/studio/studio-boundary.test.js tests/studio/studio-graph-model.test.js` must pass focused controller, canvas-model, and layout API coverage against the regenerated committed server.
- `npm test` must pass the complete repository suite.
- `git diff --check` must report no whitespace errors.
- The E2E scenarios in `.docs/tests/test-studio-layout-autosave.md` must demonstrate no layout write before canvas editing, persistence after canvas editing without manual Save, restart restore, latest-write ordering, visible failure/retry, and resource-scoped conflict behavior.

## Rollback / Risk

- Debounce and request ordering are the main data-loss risks. The controller must serialize writes and retain the latest pending snapshot rather than relying on response order.
- A world may change while a layout request is queued. Unknown but syntactically valid positions remain in the file so an unsaved new node can later become current; read-time reconciliation prevents those entries from rendering before the matching world exists.
- An external change to one clean resource must not force a combined reload that discards dirty state in the other. Resource-scoped loaders and dirty queries keep those lifecycles separate; this is also what prevents a semantic-only conflict decision from manufacturing a layout write.
- Reloading during an in-flight write can race with the user's explicit conflict decision. A raw-file revision check after temp-file sync catches changes before the final rename boundary even when normalization hides byte differences, request/controller generations ignore obsolete responses, and Reload must fetch successfully before discarding queued state. Portable external writers share no cross-process lock, so the final check-to-rename window remains a documented best-effort limit.
- Browser shutdown cannot await an arbitrary promise chain. Studio drains immediately and warns while layout remains unsaved; a user-forced close before acknowledgement is not reported as durable and is outside crash-proof recovery scope.
- Invalid legacy layout must not make a valid world unavailable. Invalid roots fall back to empty; partial-invalid version-1 roots retain valid entries and drop only bad or stale values.
- Rollback removes the dedicated endpoint/controller/status wiring and returns layout to manual world saves. No persisted world migration is required because the layout filename and version remain unchanged.
