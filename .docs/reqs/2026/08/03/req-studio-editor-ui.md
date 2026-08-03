# Agent World Studio Editor UI Requirement

## Problem

With the Studio server in place, an Agent World project can be read, validated, and saved over HTTP — but there is still no way to *see* a workflow. The routing DAG remains invisible: authors cannot tell which edges exist, which nodes are unreachable, which prerequisites are declared, or which node is the entry. Editing still means hand-writing JSON and discovering mistakes only when validation rejects the file.

The server ships only a minimal shell that proves the session handshake and the live event stream. Turning that shell into a workflow editor is what makes Studio useful.

## Requirement

Deliver the Agent World Studio workflow editor: a visual canvas that renders the workflow graph with its semantic relationships, panels that edit the world, its nodes, and its agents, a prompt editor, a raw JSON view, graph layout that persists, and conflict handling that never destroys unsaved work.

Per `agent-world-studio-mvp.md` §1, Studio designs workflows and observes execution while the agent host owns execution. This story delivers the design surface. The editor must present no way to start, stop, or continue a run, and must make no routing or agent-selection decision.

## Acceptance Criteria

### Rendering

- [x] The workflow appears as a directed graph, with one canvas node per workflow node.
- [x] Each node shows its identifier, its assigned agent, that agent's role, and a preview of its instruction.
- [x] Routing edges and `requires` prerequisites are drawn in visually distinct styles so the two relationships cannot be confused.
- [x] The workflow entry node is visually marked as the entry.
- [x] A project with no world file opens as an empty, editable workspace rather than an error state.

### Graph editing

- [x] A user can add a node, delete a node, connect a routing edge, and disconnect a routing edge.
- [x] A user can assign an agent to a node, edit a node's instruction, and edit a node's `requires` prerequisites.
- [x] A user can select which node is the workflow entry.
- [x] Deleting a node also removes the routing edges and `requires` prerequisites that referenced it, so the edit cannot leave the world referentially broken.
- [x] Renaming an agent updates every workflow node assigned to that agent.
- [x] An agent that is still assigned to a workflow node cannot be deleted into a broken state; the attempt is refused or reassigned rather than leaving nodes referencing an agent that no longer exists.
- [x] Deleting a node or an agent is confirmed before it is applied, and the confirmation names what else will be removed.

### Property editing

- [x] A user can edit the world identifier, name, turn limit, stop token, and mode.
- [x] A user can edit an agent's identifier, display name, role, prompt path, and context scope.
- [x] Identifier fields reject values that violate the schema's identifier pattern at the field, without waiting for a save.
- [x] Editing and saving preserves every schema-defined field the panels do not expose, and introduces no field the original file omitted.

### Prompts and raw view

- [x] A user can open an agent's prompt Markdown file, edit it, and save it back to the project.
- [x] A user can view the raw world JSON for the current in-memory graph.

### Layout

- [x] The graph can be laid out automatically on an explicit user action, producing a readable arrangement without overlapping nodes.
- [x] Manually positioned nodes keep their positions, and those positions are restored after Studio is closed and reopened on the same project.
- [x] Layout is persisted through the layout file only, and never appears in the world file.

### Saving and validation feedback

- [x] Saving writes the edited world and its layout through the server, and a save the server rejects does not appear to the user as success.
- [x] Validation errors are surfaced in the interface against the offending node, edge, agent, or field, rather than only logged or shown as an opaque failure.
- [x] A world that is already invalid when loaded surfaces its errors rather than rendering as if it were valid.

### External changes

- [x] A change to a watched project file made outside Studio is reflected without a manual page refresh.
- [x] An external change never silently discards unsaved edits; the user is offered reload, compare, and keep-Studio-version choices.
- [x] Choosing keep-Studio-version retains the unsaved edits, and choosing reload replaces the in-memory world with the version on disk.
- [x] An external change arriving while there are no unsaved edits reloads without prompting.
- [x] A change the server reports as its own most recent write raises no conflict.
- [x] The client reconnects to the event stream on its own after a transient connection drop (the server process keeps running), and resumes receiving changes. When the server process itself restarts, its session token is freshly randomized per launch (an existing, unmodified server behavior), so the client instead surfaces a clear "session expired" message directing the user to reopen the newly printed URL, rather than silently failing or retrying forever.

### Ownership boundary

- [x] The interface presents no run, stop, or continue control, and no other affordance that would start or influence a workflow run.
- [x] The client performs no routing or agent-selection decision; it edits configuration only.

### Verification

- [x] An executable end-to-end specification covers the rendering, editing, layout, conflict, and validation flows and passes.

## Constraints

- Depends on the Studio server story. The editor consumes the existing HTTP and event-stream contract and does not add, change, or bypass server endpoints.
- The editor never writes project files directly; every read and write goes through the server, which owns validation, atomic writes, and path restriction.
- `.agent-world/world.json` remains the semantic source of truth; visual layout lives only in the separate layout file.
- The editor must not extend the canonical schema or introduce Studio-only fields.
- The editor ships a Design surface only. Observation and history surfaces arrive with their own stories.
- The client is built by the existing toolchain into the committed assets inside the installed skill, and must run with no dependency install or build step by the user.
- The server's prompt endpoints (`GET`/`PUT /api/prompts/:agentId`) resolve an agent from the world already saved on disk, not from the client's in-memory document, and a save's own validation requires every agent's prompt file to already exist on disk. Creating a brand-new agent whose prompt file does not yet exist anywhere in the project therefore cannot be completed through the client alone: the first save for such an agent is expected to fail with a validation error naming the missing prompt path until that file exists by some other means (e.g. a project template, or the user creating it directly). The editor surfaces that failure clearly rather than hiding or working around it, consistent with not bypassing server endpoints.

## Non-Goals

- Any change to the server: endpoints, validation, watching, atomic writes, security, or the event contract.
- Router event recording, live run observation, active-node highlighting, route highlighting, host-action display, and the event timeline.
- Run history listing, run detail views, snapshot loading, and replay.
- Any Studio-side execution capability. The editor does not start, stop, continue, or drive runs.
- The evaluation surface and any UI for the evaluation contract file.
- Node execution-state rendering. The idle, waiting, running, completed, blocked, failed, and skipped states belong to run observation; this story renders configuration only.
- Automatic layout on load, undo and redo history, multi-select editing, copy and paste, and graph search.
- Natural-language workflow generation, visual graph diff, template galleries, and workflow publishing.
- Multi-user collaboration, remote hosting, and mobile support.
