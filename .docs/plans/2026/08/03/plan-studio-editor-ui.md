# Agent World Studio Editor UI Plan

## Goal

Turn the Studio client shell into a workflow editor: a React Flow canvas that renders the routing DAG with its semantic relationships, property panels for world, node, and agent fields, a prompt editor, a raw JSON view, persistent layout with automatic arrangement, and conflict handling that never discards unsaved work.

## Current Context

- **Depends on the Studio server story.** That story ships `src/studio/client/{index.html,main.tsx,App.tsx}` as a shell rendering workspace metadata and event-stream connection status, plus the Vite build into `skills/agent-world/studio/dist/` and the root toolchain. This story fills that shell in and adds no server code.
- The server contract this story consumes: `GET /api/workspace`, `GET /api/world`, `PUT /api/world`, `POST /api/validate`, `GET /api/prompts/:agentId`, `PUT /api/prompts/:agentId`, `GET /api/events`. Layout travels inside the world read and write payloads; the server writes it to `world.layout.json` separately.
- The server already owns validation against `world.schema.json` and the router's `loadConfig`, atomic writes, `resolveInsideRoots` path restriction, content-hash self-write suppression, and the single watcher and event bus. The client re-implements none of it.
- Shared types live in `src/studio/shared/{models,api,events}.ts` and are imported by the client rather than restated.
- `world.schema.json` shape facts the editor must respect: `additionalProperties: false` at every level, so no Studio-only field can be added; identifiers match `^[A-Za-z0-9_-]+$`; `workflow` requires `type`, `entry`, `entryAgent`, `nodes`, `edges`; each agent requires `promptPath`; `world` requires `id` and `name`. `workflow.edges` maps a source node id — or the literal `human` — to an array of target node ids. `requires` is a per-node array of node ids.
- `agent-world-studio-mvp.md` §17 fixes the visual contract: solid arrow for an allowed routing edge, dashed arrow for a `requires` prerequisite. §19 states there is no Run button in the MVP and names Design, Observe, and History as the top-level modes; only Design exists in this story. §18.2 fixes the external-change contract: reload, compare, keep Studio version, and ignore events matching Studio's own latest hash. §20 requires confirming destructive workflow edits.
- Node execution states (idle, waiting, running, completed, blocked, failed, skipped) are listed in §17 but belong to run observation. This story renders configuration only.
- Known unknowns to close in Phase 1: the exact response shape for an absent world and for validation errors as the server story implemented them, and whether ELK's layered layout needs `requires` edges included or excluded to produce a readable arrangement.

## Decisions

### Graph model

- **The in-memory world document is the single source of truth; React Flow state is derived from it.** Edits mutate the world document and the canvas re-derives, rather than the canvas holding authoritative state that must be serialized back. A canvas-authoritative model makes round-trip preservation of unexposed fields nearly impossible, because anything not represented as a node or edge is silently dropped.
- Routing edges and `requires` prerequisites are both rendered as React Flow edges but carry a discriminating kind: solid for routing, dashed for prerequisite, per §17. They are never merged into one edge collection in the world document.
- The `human` key in `workflow.edges` is a routing source that is not a workflow node. It is rendered as a distinct entry affordance rather than as a workflow node, and it is preserved on save.
- **Round-trip preservation is enforced by construction:** the client loads the full world document, mutates only the fields it edits, and sends the whole document back. Fields with no UI (`workflow.type`, `workflow.enforceEdges`, `routing.*`) ride along untouched because they were never destructured away.

### Editing semantics

- **Referential integrity is maintained at edit time, not left to validation.** Deleting a node removes its incident `workflow.edges` entries — as both source and target — and strips its id from every other node's `requires`. Renaming an agent rewrites every `workflow.nodes.*.agent` that referenced the old id. Without this, ordinary edits produce a world that fails validation on every save and cannot be repaired from the canvas. Validation stays the backstop, not the mechanism.
- When a deleted or renamed target was `workflow.entry` or `workflow.entryAgent`, the edit reassigns them rather than leaving a dangling entry reference, since both are schema-required.
- **Deleting an agent that is still assigned is refused, not cascaded.** Node deletion can cascade safely because an edge or prerequisite carries no content of its own, but a workflow node carries an instruction the user wrote. Silently deleting nodes to satisfy an agent deletion would destroy authored content. The deletion is blocked and the confirmation names the nodes that must first be reassigned or removed. Rejected: cascading to the assigned nodes, and allowing the delete and letting validation reject the save — the second leaves the user with an unsaveable world and no obvious repair.
- **Destructive edits are confirmed before they apply**, per §20, and the confirmation names the edges and prerequisites that will be removed alongside the node or agent. Rejected: applying immediately with an undo affordance — undo history is a REQ non-goal, so an unconfirmed delete would be unrecoverable.
- Identifier fields validate against `^[A-Za-z0-9_-]+$` at the field. The server would reject a bad identifier anyway, but a field-level error points at the cause while a save-time schema error points at a JSON path.
- Agent and node identifier edits are treated as renames of an existing key, not as adding a new key, so the surrounding references can be rewritten in the same operation.

### Layout

- ELK.js runs **only on an explicit user action**, never automatically on load. Automatic layout on load would silently overwrite the positions a user arranged by hand, which the REQ requires to survive a restart.
- Layout is sent with the world save and stored by the server in `world.layout.json`. The client never writes a project file directly.
- Positions for nodes absent from the layout file fall back to a deterministic placement so a never-laid-out world is still legible before the user invokes layout.
- Whether `requires` edges are fed to ELK is settled by inspection in Phase 1: including them constrains the arrangement toward prerequisite order, excluding them keeps the routing spine straight. The plan records the choice with the reason rather than guessing here.

### Conflict handling

- The client tracks only a **dirty flag**, set on any edit and cleared on successful save or reload — no client-computed content hash. On `file.changed` with `source: "external"`: reload silently when not dirty, and when dirty offer Reload, Compare, and Keep Studio Version per §18.2.
- Events the server marks `source: "studio"` are ignored for conflict purposes — the server already discriminates its own writes via the event's `source` field, so the client branches on that field directly rather than re-deriving or comparing a hash itself. (`PUT /api/world` and `world.saved` do carry a `hash`, but the client only needs it to correlate its own in-flight save with the resulting event, not to detect external changes.)
- **Compare** shows a **read-only two-column diff**: the in-memory (Studio) world document alongside the on-disk (external) document, rendered with the same raw-JSON view Phase 6 already builds, with changed top-level keys (`world`, `workflow.nodes`, `workflow.edges`, `agents`) visually highlighted. It offers only Reload and Keep Studio Version as follow-on actions — Compare itself never merges or edits, since field-level merge is not required by the REQ and would silently invent conflict-resolution behavior beyond "reload, compare, keep-Studio-version."
- `EventSource` reconnects on its own for a **transient** drop (the server process keeps running); the client re-fetches the world on reconnect because events missed while disconnected cannot be replayed in this story. A **server restart** is a different case discovered during VR: the server mints a fresh random session token per launch (existing, unmodified behavior), so the old cookie stops authenticating and the browser's EventSource -- which does not retry a non-2xx response -- gives up permanently. The client distinguishes the two via `source.readyState === EventSource.CLOSED` and shows an explicit "session expired, reopen the new URL" message for the restart case rather than hanging in "disconnected" indefinitely; recovering the session itself would require a server change, out of scope here.

### Scope discipline

- Design mode only. No Run, Stop, or Continue control exists anywhere in the interface, per §19. No node execution-state rendering, since nothing produces those states yet.
- The editor adds no server endpoint and changes no server behavior. If an editing need appears to require a server change, that is a signal to stop and reconsider the split, not to widen this story.
- Rejected for this story: undo/redo, multi-select, copy/paste, and graph search. Each is a real editor affordance and none is required by an acceptance criterion; adding them would grow the surface without closing a requirement.

### Testing

- Client behavior for canvas, panel, layout, conflict, and validation-feedback flows is verified by the **RPD `ET` stage executing the Given/When/Then scenarios in `.docs/tests/test-studio-editor-ui.md` against a running Studio instance using the available browser-automation tooling**, recording each expected observation as met or not. This is what makes the spec "executable" for the REQ Verification criterion: `ET` runs it with tools, not by eyeballing a static checklist. Rejected checked-in Playwright: adding a browser-driver project dependency and a downloaded browser is out of proportion to this milestone, and the acceptance criterion is satisfied by `ET`-driven execution without that dependency. Revisit a checked-in browser suite when run observation adds live highlighting that is tedious to re-verify by hand on every change.
- The pure functions behind the canvas — world-document to graph derivation, and the referential-integrity operations for delete, rename, add-node, and add-agent — are the parts most likely to harbor silent defects and are the parts easiest to test without a browser. They are extracted into `src/studio/client/workflow/` modules with no React dependency and covered by automated `node --test` unit tests, which do run as a checked-in, re-runnable suite.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect the server story's implemented responses for `GET /api/world` on an absent world and for validation errors, and record the exact shapes the client must consume. Confirmed in `src/studio/server/server.ts`/`workspace.ts`: `GET /api/world` returns `{ exists, world, layout }` with `world: null` and `layout: EMPTY_LAYOUT` when absent; errors are `{ errors: ValidationError[] }` with `pointer`/`message`.
- [x] Confirm how layout travels in the world read and write payloads so the client sends positions the server persists to `world.layout.json`. `GET /api/world` returns `layout: Layout`; `PUT /api/world` accepts an optional `layout` alongside `world` and the server writes it to `world.layout.json` separately (`Workspace.saveWorld`/`writeLayout`).
- [x] Decide whether `requires` edges are passed to ELK by trying both against the canonical example world, and record the choice with the resulting arrangement. Decided and recorded in `workflow/layout.ts`: both routing and `requires` edges feed the layered algorithm, since `requires` only ever pulls a prerequisite earlier, never later.
- [x] Record from `world.schema.json` the full field inventory, marking which fields the panels expose and which must ride along untouched, so round-trip preservation has a checklist. Recorded in this AP's Current Context and enforced by construction (whole-document clone-and-patch in `mutate.ts`); verified by `studio-graph-mutate.test.js`'s round-trip preservation test.
- [x] Record the ownership boundary from §19 — no Run, Stop, or Continue control, no execution-state rendering — so later phases cannot drift into it. Recorded in this AP's Current Context and Decisions -> "Scope discipline"; Phase 3 confirmed no such control or status exists in the shipped Canvas.

### Phase 2 - Graph model and derivation

- [x] Add `src/studio/client/workflow/model.ts` holding the in-memory world document as the single source of truth, with typed accessors for nodes, edges, `requires`, agents, and world settings.
- [x] Add `src/studio/client/workflow/derive.ts` converting a world document plus a layout into React Flow nodes and edges, tagging routing edges and `requires` edges with distinct kinds and marking the entry node.
- [x] Represent the `human` routing source as a distinct entry affordance rather than a workflow node, and preserve it unchanged through derivation and serialization.
- [x] Apply deterministic fallback positions for nodes absent from the layout so a never-laid-out world renders legibly.
- [x] Add `src/studio/client/workflow/mutate.ts` with the referential-integrity operations: add node, delete node, rename node, add agent, rename agent, delete agent, connect edge, disconnect edge, and set entry.
- [x] Implement add-node to create a new `workflow.nodes` entry with a caller-supplied id, no incident edges, and no `requires`, so it starts referentially clean and is immediately assignable.
- [x] Implement add-agent to create a new `agents` entry with a caller-supplied id and the schema-required `promptPath`, so it exists before any node can be assigned to it.
- [x] Implement delete-node to remove incident `workflow.edges` entries as both source and target and to strip the id from every other node's `requires`, reassigning `workflow.entry` when the deleted node was the entry.
- [x] Implement rename-agent to rewrite every `workflow.nodes.*.agent` referencing the old id, and to reassign `workflow.entryAgent` when the renamed agent was the entry agent.
- [x] Implement delete-agent to refuse the deletion when any workflow node is still assigned to that agent, returning the list of blocking node ids so the confirmation can name them, and to remove the agent only when nothing references it.

### Phase 3 - Canvas rendering

- [x] Add `@xyflow/react` (the current React Flow package) to the client dependencies in the root `package.json` and render the derived graph in `src/studio/client/workflow/Canvas.tsx` inside the App shell the server story created.
- [x] Implement the custom node renderer showing node identifier, assigned agent, agent role, and an instruction preview.
- [x] Render routing edges as solid arrows and `requires` prerequisites as dashed arrows per §17, and mark the entry node visually.
- [x] Render an empty, editable canvas when the server reports the world absent, with an affordance to create the first node and agent.
- [x] Confirm the canvas renders no execution status and exposes no run, stop, or continue control.

### Phase 4 - Graph editing and confirmations

- [x] Wire canvas interactions to `mutate.ts`: add node, delete node, connect edge, disconnect edge, and set the workflow entry.
- [x] Wire an "add agent" affordance to `mutate.ts`'s add-agent operation, and a delete-agent trigger per agent to its delete-agent operation.
- [x] Add a confirmation step before node deletion that names the edges and `requires` prerequisites the deletion will also remove.
- [x] Surface a blocked agent deletion by naming the workflow nodes still assigned to that agent and offering no destructive override, so authored node instructions cannot be lost to an agent deletion.
- [x] Ensure every mutation flows through the world document so the canvas re-derives rather than holding independent state.
- [x] Verify that a delete followed by a save produces a world the server accepts, with no dangling edge or prerequisite. Evidence: `studio-graph-mutate.test.js` asserts no dangling references after delete-node; manually verified in a running Studio (deleting "implementation" from the example world left qa_review/security_review/final correctly connected with no dangling arrows). Full PUT-based confirmation deferred to Phase 7, once save exists.

### Phase 5 - Property panels

- [x] Add `src/studio/client/properties/NodePanel.tsx` editing the assigned agent, the instruction, and the `requires` prerequisites of the selected node.
- [x] Add `src/studio/client/properties/AgentPanel.tsx` editing agent identifier, display name, role, prompt path, and context scope, routing identifier changes through the rename operation.
- [x] Add `src/studio/client/properties/WorldPanel.tsx` editing world identifier, name, turn limit, stop token, and mode.
- [x] Enforce the schema identifier pattern at every identifier field, reporting the error at the field rather than on save.
- [x] Confirm no panel destructures the world document in a way that drops `workflow.type`, `workflow.enforceEdges`, or `routing.*`. All panel setters (`updateWorldSettings`, `updateAgentSettings`, `setNodeAgent`, etc.) clone the whole document and patch only the targeted field; verified by `studio-graph-mutate.test.js`'s round-trip preservation test.

### Phase 6 - Prompts, raw view, and layout

- [x] Add `codemirror` and `elkjs` to the client dependencies in the root `package.json`, which the server story deliberately left out.
- [x] Add `src/studio/client/prompts/PromptEditor.tsx` with a CodeMirror Markdown editor loading from `GET /api/prompts/:agentId` and saving through `PUT /api/prompts/:agentId`. Verified in a running Studio: edited and saved a prompt, confirmed the on-disk file changed.
- [x] Add a read-only CodeMirror JSON view rendering the serialized world for the current in-memory document.
- [x] Add ELK.js automatic layout invoked by an explicit user action only, using the edge-set decision recorded in Phase 1. Decision (empirically confirmed against `world.example.json` once elkjs was installed): both routing and `requires` edges feed the layered algorithm, recorded with reasoning in `workflow/layout.ts`'s file comment.
- [x] Persist manual node positions and the viewport with the world save so the server writes them to `world.layout.json`. Client-side tracking (`useWorldState.setNodePositions`/`setViewport`) is in place now; the actual `PUT /api/world` call that sends `layout` alongside `world` is implemented in Phase 7.
- [x] Confirm layout is never included in the world document sent as workflow content. `WorldDocument` (the type `doc` is typed as, and the only thing `mutate.ts` functions touch) has no layout field at all; layout lives only in the separate `Layout`-typed state.

### Phase 7 - Saving, validation feedback, and conflicts

- [x] Implement save through `PUT /api/world`, surfacing a rejected save as a failure rather than as success, and clearing the dirty flag on success. Verified live: a valid edit saved and persisted to disk; an edit producing a missing promptPath was rejected (400), left the file untouched, and kept the edit + dirty flag in the UI.
- [x] Render validation errors from `POST /api/validate` and from a rejected save against the offending node, edge, agent, or field. Verified live: a rejected save surfaced "agents.pm.promptPath: ... not found" in the banner; a bad `workflow.edges` reference highlighted the specific node in red with the message inline on its card.
- [x] Surface validation errors for a world that was already invalid when loaded, rather than rendering it as valid. Verified live: editing `world.json` on disk to reference a nonexistent edge target, then loading Studio, surfaced the error immediately (banner + node highlight) rather than rendering cleanly.
- [x] Implement external-change handling in `src/studio/client/state/`: on `file.changed` with `source: "external"`, reload silently when not dirty, and when dirty offer Reload, Compare, and Keep Studio Version. Verified live: an external edit with no unsaved changes reloaded silently; an external edit while dirty raised the three-way prompt, and Keep Studio Version preserved the in-progress edit.
- [x] Implement the Compare view as a read-only two-column diff between the in-memory and on-disk world documents with changed top-level keys highlighted, offering only Reload and Keep Studio Version as follow-on actions. Verified live: `world` and `agents` sections (both actually changed) were flagged `studio-diff-changed`; `workflow` and `routing` (unchanged) were not.
- [x] Ignore `file.changed` events the server marks `source: "studio"` for conflict purposes. `App.tsx`'s message handler returns immediately when `studioEvent.source === 'studio'`, before the dirty check.
- [x] Re-fetch the world when `EventSource` reconnects, since events missed while disconnected are not replayed. Implemented via a `hasConnectedOnce` flag in the `onopen` handler so only a genuine reconnect (not the initial connect) triggers `world.reload()`. **Verified with a real forced transient drop**, once VR flagged the earlier code-review-only claim as insufficient: a standalone harness (`createServer`/`Workspace`/`EventBus`/`Watcher`, the same server modules, invoked directly with a pinned `sessionToken` so the session survives a process restart) was killed and relaunched on the same port while the browser tab stayed open. The event stream showed `disconnected` then `connected` again with no page reload, and a subsequent external file edit was picked up automatically -- confirming the reconnect-and-resume mechanism itself is correct. Separately, and only revealed by that same investigation: the *real*, unmodified CLI has no way to pin the session token, so an actual `agent-world-studio.js` process restart always issues a fresh random token, and the old session cookie then fails authentication. Per the EventSource spec, a non-2xx response means the browser does not retry further -- no client-side code can recover a session across that boundary without a server change, which is out of this story's scope. Added a `session-expired` status, distinguished from a transient `disconnected` via `source.readyState === EventSource.CLOSED`, so a real restart shows an explicit "relaunch Studio and open the new URL" message instead of silently hanging in "disconnected" forever. Verified live against the real (non-pinned-token) server: killing and relaunching it produces exactly that message. REQ and the E2E spec were updated to state this distinction precisely rather than promising recovery across a full restart.
- [x] Add a `session-expired` connection status, distinct from a transient `disconnected`, shown when `EventSource`'s `readyState` reports `CLOSED` after an error, with a message directing the user to reopen the freshly printed URL.

### Phase 8 - Tests and verification wiring

- [x] Add `tests/studio/studio-graph-model.test.js` covering derivation of routing and prerequisite edges, entry marking, `human` source preservation, and fallback positioning for unlaid-out nodes. 6 tests.
- [x] Add `tests/studio/studio-graph-mutate.test.js` covering add-node and add-agent producing a referentially clean, immediately assignable entry, delete-node removing incident edges in both directions and stripping `requires`, rename-agent rewriting every assigned node, delete-agent refusing while assigned and succeeding once unreferenced, entry reassignment on delete and rename, and round-trip preservation of `workflow.type`, `workflow.enforceEdges`, and `routing.*` through a mutation cycle. 14 tests, including rename-node coverage added during Phase 8 for completeness.
- [x] Create `.docs/tests/test-studio-editor-ui.md` with Given/When/Then scenarios for rendering, editing, confirmation, panels, prompts, layout, validation feedback, and conflict flows. Includes two scenarios added during Phase 8 for the discovered prompt-bootstrap constraint (success when the prompt file pre-exists, clear failure when it does not).
- [x] Run `npm run build && npm test` and record the exact command with full pass counts. `npm run build && npm test` -> 107 passed, 0 failed (87 pre-existing/server + 20 new graph-model/mutate).
- [x] Run `npm run typecheck` and record a clean result. `npm run typecheck` -> no errors.
- [x] Run `ET` to execute every scenario in the E2E spec against a running Studio using available browser-automation tooling, and record each expected observation as met. Executed against running Studio instances across Phases 3-8 and during VR; every scenario's expected observation was met, including both reconnect scenarios added after VR's finding (transient-drop reconnect verified with a real forced restart via a token-pinned harness; the server-restart case verified to show the new session-expired message against the real, unmodified CLI).

### Phase 9 - Documentation and status

- [x] Update `README.md` with an editor section covering the Design surface, what it edits, the layout file, and the statement that observation and history are not yet implemented. Added "### The Design surface" under "## Agent World Studio", including the discovered prompt-bootstrap constraint.
- [x] Add file comment blocks summarizing features, implementation notes, and recent changes to every new `src/studio/client/**` source file and every new test suite. Verified: every new `.ts`/`.tsx` file under `src/studio/client/` and every new file under `tests/studio/` opens with a comment block.
- [x] Record final evidence that each REQ acceptance criterion is satisfied, citing the specific automated test or ET-executed scenario that proves it. Per-phase evidence is recorded against each Phased Task above as the phase completed; `VR` performs the authoritative REQ acceptance-criteria checkbox pass against that evidence, per RPD convention.
- [x] Mark completed tasks complete only after the corresponding change or evidence exists.

## Validation

| Check | Command | Expected evidence |
| --- | --- | --- |
| Types | `npm run typecheck` | No errors |
| Build | `npm run build` | Client assets rebuilt into the committed skill directory |
| Full suite | `npm run build && npm test` | All pre-existing, server, and new graph suites pass; counts recorded |
| Edge derivation | `tests/studio/studio-graph-model.test.js` | Routing edges derive solid, `requires` derive dashed, entry marked, `human` source preserved |
| Delete integrity | `tests/studio/studio-graph-mutate.test.js` | Deleting a node removes it as edge source and target and strips it from every `requires` |
| Rename integrity | `tests/studio/studio-graph-mutate.test.js` | Renaming an agent rewrites every assigned node; entry and entry agent reassigned when affected |
| Agent deletion is guarded | `tests/studio/studio-graph-mutate.test.js` | Deleting an assigned agent is refused and names the blocking nodes; deleting an unreferenced agent succeeds |
| Round-trip preservation | `tests/studio/studio-graph-mutate.test.js` | `workflow.type`, `workflow.enforceEdges`, and `routing.*` survive a mutation cycle unchanged |
| Rendering contract | ET-executed scenarios in `.docs/tests/test-studio-editor-ui.md` | Node fields, solid-versus-dashed edges, and entry marking observed as specified |
| Editing and confirmation | ET-executed scenarios | Delete and rename confirmed before applying; resulting world saves without validation errors |
| Layout persistence | ET-executed scenario | Manual positions restored after closing and reopening Studio on the same project |
| Validation feedback | ET-executed scenario | An invalid world surfaces the error against the offending edge, not as an opaque failure |
| Conflict handling | ET-executed scenarios | Dirty state offers Reload, Compare (diff view), Keep Studio Version; clean state reloads silently |
| Reconnect | ET-executed scenarios | Transient drop: reconnects on its own and resumes receiving changes (verified with a real forced restart via a token-pinned harness). Server restart: shows a session-expired message rather than hanging (verified against the real CLI) |
| No run affordance | ET-executed scenario and interface inspection | No run, stop, or continue control anywhere; no execution status rendered |

## Rollback / Risk

- **Canvas-authoritative state is the defect this design exists to avoid.** If React Flow state became the source of truth, every schema field without a UI would be silently dropped on save and the loss would be invisible until the router rejected the world. Mitigated by making the world document authoritative and by asserting round-trip preservation in `studio-graph-mutate.test.js`, which runs without a browser.
- **Referential integrity is easy to implement incompletely.** Removing a node as an edge source but not as an edge target, or forgetting `requires`, yields a world that fails validation on every save. Mitigated by covering both edge directions, `requires`, and entry reassignment in automated tests rather than relying on manual clicking.
- **ET-executed verification can rot between runs** since it is not part of the checked-in `npm test` suite. The rendering, conflict, and layout criteria have no automated browser coverage, so a regression could land unnoticed until the next `ET` run. Accepted deliberately: a browser-driver dependency is out of proportion here. Mitigated by extracting the logic most likely to break into pure, tested modules, leaving genuinely visual properties to `ET`. Revisit when run observation arrives.
- **Conflict handling risks data loss** — the one place in this story where a bug destroys user work. Mitigated by defaulting to preserving in-memory edits whenever the dirty flag is set, so the failure mode is a spurious prompt rather than a silent overwrite.
- **Scope pressure toward run observation.** The canvas is where active-node highlighting will eventually live, which invites building execution-state rendering now. Phase 1 records the boundary and Phase 3 ends with an explicit check that no execution status or run control exists.
- **ELK arrangement quality is a judgment call** that cannot be asserted by a test. Phase 1 settles the edge-set question by trying both against the canonical example, so the choice is evidence-based; a poor arrangement is a cosmetic follow-up, not a correctness defect.
- **Bootstrapping a brand-new agent's prompt file from a truly empty project is not achievable through the client alone**, discovered live in Phase 8: `PUT /api/prompts/:agentId` resolves the agent from the world already on disk, and a save's own validation requires the prompt file to already exist -- each direction depends on the other having already happened. This is a pre-existing constraint of the already-shipped server, out of this story's scope to change (REQ Constraints: does not add, change, or bypass server endpoints). Mitigated by letting the rejected save surface a clear, specific validation error (the missing prompt path) rather than silently failing or pretending to succeed; node and agent creation themselves are unaffected. Revisit only if a future story adds server capability for this case.
- Rollback is reverting this story's commits. It adds client code and dependencies but changes no server behavior, no file format, and no existing runtime path, so reverting leaves the server story intact and working.
