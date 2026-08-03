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

- The client tracks a dirty flag and the baseline content hash from the last successful load or save. On `file.changed` with `source: "external"`: reload silently when not dirty, and when dirty offer Reload, Compare, and Keep Studio Version per §18.2.
- Events the server marks `source: "studio"` are ignored for conflict purposes — the server already suppressed its own writes by content hash, and the client trusts that rather than re-deriving it.
- `EventSource` reconnects on its own; the client re-fetches the world on reconnect because events missed while disconnected cannot be replayed in this story.

### Scope discipline

- Design mode only. No Run, Stop, or Continue control exists anywhere in the interface, per §19. No node execution-state rendering, since nothing produces those states yet.
- The editor adds no server endpoint and changes no server behavior. If an editing need appears to require a server change, that is a signal to stop and reconsider the split, not to widen this story.
- Rejected for this story: undo/redo, multi-select, copy/paste, and graph search. Each is a real editor affordance and none is required by an acceptance criterion; adding them would grow the surface without closing a requirement.

### Testing

- Client behavior is verified by **manual scenarios scripted in the E2E spec** with explicit expected observations. Rejected Playwright: a browser-driver dependency plus a downloaded browser is out of proportion to this milestone, and no acceptance criterion requires automated browser assertions. Revisit when run observation adds live highlighting that is tedious to check by hand.
- The pure functions behind the canvas — world-document to graph derivation, and the referential-integrity operations for delete and rename — are the parts most likely to harbor silent defects and are the parts easiest to test without a browser. They are extracted into `src/studio/client/workflow/` modules with no React dependency and covered by automated tests.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [ ] Inspect the server story's implemented responses for `GET /api/world` on an absent world and for validation errors, and record the exact shapes the client must consume.
- [ ] Confirm how layout travels in the world read and write payloads so the client sends positions the server persists to `world.layout.json`.
- [ ] Decide whether `requires` edges are passed to ELK by trying both against the canonical example world, and record the choice with the resulting arrangement.
- [ ] Record from `world.schema.json` the full field inventory, marking which fields the panels expose and which must ride along untouched, so round-trip preservation has a checklist.
- [ ] Record the ownership boundary from §19 — no Run, Stop, or Continue control, no execution-state rendering — so later phases cannot drift into it.

### Phase 2 - Graph model and derivation

- [ ] Add `src/studio/client/workflow/model.ts` holding the in-memory world document as the single source of truth, with typed accessors for nodes, edges, `requires`, agents, and world settings.
- [ ] Add `src/studio/client/workflow/derive.ts` converting a world document plus a layout into React Flow nodes and edges, tagging routing edges and `requires` edges with distinct kinds and marking the entry node.
- [ ] Represent the `human` routing source as a distinct entry affordance rather than a workflow node, and preserve it unchanged through derivation and serialization.
- [ ] Apply deterministic fallback positions for nodes absent from the layout so a never-laid-out world renders legibly.
- [ ] Add `src/studio/client/workflow/mutate.ts` with the referential-integrity operations: delete node, rename node, rename agent, delete agent, connect edge, disconnect edge, and set entry.
- [ ] Implement delete-node to remove incident `workflow.edges` entries as both source and target and to strip the id from every other node's `requires`, reassigning `workflow.entry` when the deleted node was the entry.
- [ ] Implement rename-agent to rewrite every `workflow.nodes.*.agent` referencing the old id, and to reassign `workflow.entryAgent` when the renamed agent was the entry agent.
- [ ] Implement delete-agent to refuse the deletion when any workflow node is still assigned to that agent, returning the list of blocking node ids so the confirmation can name them, and to remove the agent only when nothing references it.

### Phase 3 - Canvas rendering

- [ ] Add `reactflow` to the client dependencies in the root `package.json` and render the derived graph in `src/studio/client/workflow/Canvas.tsx` inside the App shell the server story created.
- [ ] Implement the custom node renderer showing node identifier, assigned agent, agent role, and an instruction preview.
- [ ] Render routing edges as solid arrows and `requires` prerequisites as dashed arrows per §17, and mark the entry node visually.
- [ ] Render an empty, editable canvas when the server reports the world absent, with an affordance to create the first node and agent.
- [ ] Confirm the canvas renders no execution status and exposes no run, stop, or continue control.

### Phase 4 - Graph editing and confirmations

- [ ] Wire canvas interactions to `mutate.ts`: add node, delete node, connect edge, disconnect edge, and set the workflow entry.
- [ ] Add a confirmation step before node deletion that names the edges and `requires` prerequisites the deletion will also remove.
- [ ] Surface a blocked agent deletion by naming the workflow nodes still assigned to that agent and offering no destructive override, so authored node instructions cannot be lost to an agent deletion.
- [ ] Ensure every mutation flows through the world document so the canvas re-derives rather than holding independent state.
- [ ] Verify that a delete followed by a save produces a world the server accepts, with no dangling edge or prerequisite.

### Phase 5 - Property panels

- [ ] Add `src/studio/client/properties/NodePanel.tsx` editing the assigned agent, the instruction, and the `requires` prerequisites of the selected node.
- [ ] Add `src/studio/client/properties/AgentPanel.tsx` editing agent identifier, display name, role, prompt path, and context scope, routing identifier changes through the rename operation.
- [ ] Add `src/studio/client/properties/WorldPanel.tsx` editing world identifier, name, turn limit, stop token, and mode.
- [ ] Enforce the schema identifier pattern at every identifier field, reporting the error at the field rather than on save.
- [ ] Confirm no panel destructures the world document in a way that drops `workflow.type`, `workflow.enforceEdges`, or `routing.*`.

### Phase 6 - Prompts, raw view, and layout

- [ ] Add `codemirror` and `elkjs` to the client dependencies in the root `package.json`, which the server story deliberately left out.
- [ ] Add `src/studio/client/prompts/PromptEditor.tsx` with a CodeMirror Markdown editor loading from `GET /api/prompts/:agentId` and saving through `PUT /api/prompts/:agentId`.
- [ ] Add a read-only CodeMirror JSON view rendering the serialized world for the current in-memory document.
- [ ] Add ELK.js automatic layout invoked by an explicit user action only, using the edge-set decision recorded in Phase 1.
- [ ] Persist manual node positions and the viewport with the world save so the server writes them to `world.layout.json`.
- [ ] Confirm layout is never included in the world document sent as workflow content.

### Phase 7 - Saving, validation feedback, and conflicts

- [ ] Implement save through `PUT /api/world`, surfacing a rejected save as a failure rather than as success, and updating the baseline hash and dirty flag on success.
- [ ] Render validation errors from `POST /api/validate` and from a rejected save against the offending node, edge, agent, or field.
- [ ] Surface validation errors for a world that was already invalid when loaded, rather than rendering it as valid.
- [ ] Implement external-change handling in `src/studio/client/state/`: on `file.changed` with `source: "external"`, reload silently when not dirty, and when dirty offer Reload, Compare, and Keep Studio Version.
- [ ] Ignore `file.changed` events the server marks `source: "studio"` for conflict purposes.
- [ ] Re-fetch the world when `EventSource` reconnects, since events missed while disconnected are not replayed.

### Phase 8 - Tests and verification wiring

- [ ] Add `tests/studio/studio-graph-model.test.js` covering derivation of routing and prerequisite edges, entry marking, `human` source preservation, and fallback positioning for unlaid-out nodes.
- [ ] Add `tests/studio/studio-graph-mutate.test.js` covering delete-node removing incident edges in both directions and stripping `requires`, rename-agent rewriting every assigned node, delete-agent refusing while assigned and succeeding once unreferenced, entry reassignment on delete and rename, and round-trip preservation of `workflow.type`, `workflow.enforceEdges`, and `routing.*` through a mutation cycle.
- [ ] Create `.docs/tests/test-studio-editor-ui.md` with Given/When/Then scenarios for rendering, editing, confirmation, panels, prompts, layout, validation feedback, and conflict flows.
- [ ] Run `npm run build && npm test` and record the exact command with full pass counts.
- [ ] Run `npm run typecheck` and record a clean result.
- [ ] Execute every manual scenario in the E2E spec against a running Studio and record each expected observation as met.

### Phase 9 - Documentation and status

- [ ] Update `README.md` with an editor section covering the Design surface, what it edits, the layout file, and the statement that observation and history are not yet implemented.
- [ ] Add file comment blocks summarizing features, implementation notes, and recent changes to every new `src/studio/client/**` source file and every new test suite.
- [ ] Record final evidence that each REQ acceptance criterion is satisfied, citing the specific test or manual scenario that proves it.
- [ ] Mark completed tasks complete only after the corresponding change or evidence exists.

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
| Rendering contract | Manual scenarios in `.docs/tests/test-studio-editor-ui.md` | Node fields, solid-versus-dashed edges, and entry marking observed as specified |
| Editing and confirmation | Manual scenarios | Delete and rename confirmed before applying; resulting world saves without validation errors |
| Layout persistence | Manual scenario | Manual positions restored after closing and reopening Studio on the same project |
| Validation feedback | Manual scenario | An invalid world surfaces the error against the offending edge, not as an opaque failure |
| Conflict handling | Manual scenarios | Dirty state offers Reload, Compare, Keep Studio Version; clean state reloads silently |
| Reconnect | Manual scenario | Client reconnects on its own after the stream drops and resumes receiving changes |
| No run affordance | Manual scenario and interface inspection | No run, stop, or continue control anywhere; no execution status rendered |

## Rollback / Risk

- **Canvas-authoritative state is the defect this design exists to avoid.** If React Flow state became the source of truth, every schema field without a UI would be silently dropped on save and the loss would be invisible until the router rejected the world. Mitigated by making the world document authoritative and by asserting round-trip preservation in `studio-graph-mutate.test.js`, which runs without a browser.
- **Referential integrity is easy to implement incompletely.** Removing a node as an edge source but not as an edge target, or forgetting `requires`, yields a world that fails validation on every save. Mitigated by covering both edge directions, `requires`, and entry reassignment in automated tests rather than relying on manual clicking.
- **Manual verification can rot.** The rendering, conflict, and layout criteria have no automated coverage, so a regression can land unnoticed. Accepted deliberately: a browser-driver dependency is out of proportion here. Mitigated by extracting the logic most likely to break into pure, tested modules, leaving genuinely visual properties to manual checks. Revisit when run observation arrives.
- **Conflict handling risks data loss** — the one place in this story where a bug destroys user work. Mitigated by defaulting to preserving in-memory edits whenever the dirty flag is set, so the failure mode is a spurious prompt rather than a silent overwrite.
- **Scope pressure toward run observation.** The canvas is where active-node highlighting will eventually live, which invites building execution-state rendering now. Phase 1 records the boundary and Phase 3 ends with an explicit check that no execution status or run control exists.
- **ELK arrangement quality is a judgment call** that cannot be asserted by a test. Phase 1 settles the edge-set question by trying both against the canonical example, so the choice is evidence-based; a poor arrangement is a cosmetic follow-up, not a correctness defect.
- Rollback is reverting this story's commits. It adds client code and dependencies but changes no server behavior, no file format, and no existing runtime path, so reverting leaves the server story intact and working.
