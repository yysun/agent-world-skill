# Agent World Studio — MVP Specification

## 1. Product Principle

> **Studio designs the workflow and observes execution. The agent host owns execution.**

Agent World Studio is a local visual editor and execution observer for Agent World workflows.

Studio does not start, stop, pause, continue, or control workflow runs. An agent host such as Codex owns the execution loop and decides when to invoke the Agent World router, execute an agent turn, perform an approved host action, and complete the workflow.

The existing Agent World router remains the source of truth for routing decisions and workflow state transitions.

---

## 2. MVP Product Statement

> Visually design Agent World workflows and observe agent-host execution live without Studio participating in execution.

---

## 3. Responsibility Boundaries

### 3.1 Agent World Studio owns

- Editing `.agent-world/world.json`
- Editing `.agent-world/prompts/*.md`
- Editing visual layout metadata
- Validating workflow configuration
- Detecting external file changes
- Reading run artifacts
- Visualizing active runs
- Replaying completed runs
- Showing routing, node, host-action, blocked, and completion events

### 3.2 Agent host owns

Examples include Codex or another compatible agent application.

The agent host owns:

- Deciding when to start a workflow
- Sending user messages to the router
- Executing each returned `agent_instruction`
- Executing approved `host_action` requests
- Returning completion results to the router
- Continuing the driver loop
- Stopping when the router returns `done`, `blocked`, or `idle`
- Returning the final answer to the user

### 3.3 Agent World router owns

- Reading workflow configuration
- Selecting the next agent
- Enforcing workflow edges
- Checking prerequisites
- Detecting stop signals
- Returning `agent_instruction`
- Returning `host_action`
- Returning `blocked`, `done`, or `idle`
- Recording normalized run events as a side effect of normal router execution

### 3.4 Studio must never

- Select the next agent
- Call an agent model
- Execute host actions
- Invoke arbitrary CLI commands
- Start or stop a workflow run
- Modify router state
- Continue a blocked workflow
- Become a second agent host

---

## 4. MVP Scope

### 4.1 Workflow editing

Studio must support:

- Loading `.agent-world/world.json`
- Displaying workflow nodes and routing edges
- Adding and removing workflow nodes
- Connecting and disconnecting routing edges
- Assigning an agent to a workflow node
- Editing node instructions
- Editing `requires` prerequisites
- Selecting the workflow entry node
- Editing world settings:
  - `world.id`
  - `world.name`
  - `world.turnLimit`
  - `world.stopToken`
  - `world.mode`
- Editing agent settings:
  - agent ID
  - display name
  - role
  - prompt path
- Editing agent prompt Markdown files
- Validating against `world.schema.json`
- Showing graph-reference validation errors
- Showing the raw JSON representation
- Automatically laying out the graph
- Preserving manual node positions
- Saving changes back to project files

### 4.2 Run observation

Studio must support:

- Detecting when an agent host begins a run
- Showing the active workflow snapshot
- Showing the active node
- Showing the active agent
- Showing completed nodes
- Showing waiting nodes
- Showing blocked or failed nodes
- Highlighting routes taken
- Showing current turn count and turn limit
- Showing agent response previews
- Showing parsed handoff targets
- Showing host-action requests
- Showing host-action results
- Showing blocked reasons
- Showing final workflow output
- Showing a chronological event timeline
- Reopening and replaying completed runs

Studio observes runs from persisted artifacts and live filesystem events. It does not participate in the host execution loop.

---

## 5. Explicit Non-Goals

The MVP will not include:

- Starting runs from Studio
- Stopping or pausing runs from Studio
- Executing agent turns
- Executing host actions
- Calling the router as an execution host
- Multi-user collaboration
- Remote Studio hosting
- Workflow publishing
- Natural-language workflow generation
- Interactive terminal access
- Arbitrary shell execution
- Breakpoints or step debugging
- Manual router-state editing
- WebSocket transport
- Electron packaging
- Mobile support

---

## 6. Architecture

```text
                     EXECUTION OWNERSHIP

┌──────────────────────────────────────────────┐
│ Agent host: Codex or another agent app       │
│                                              │
│ Starts and continues workflow execution      │
│ Executes agent turns and host actions        │
└────────────────┬─────────────────────────────┘
                 │ invokes
┌────────────────▼─────────────────────────────┐
│ Agent World router                           │
│                                              │
│ Selects next agent and enforces workflow     │
│ Writes handoff results and normalized events │
└────────────────┬─────────────────────────────┘
                 │ writes
        Project `.agent-world/`
                 │ watched by
┌────────────────▼─────────────────────────────┐
│ Local Agent World Studio server              │
│                                              │
│ Workspace service       Event reader         │
│ Chokidar watcher        Run-history reader   │
│ Schema validator        SSE broadcaster      │
│ Static UI server                             │
└────────────────┬─────────────────────────────┘
                 │
          HTTP editing + SSE events
                 │
┌────────────────▼─────────────────────────────┐
│ Agent World Studio web UI                    │
│                                              │
│ Workflow editor         Run visualization    │
│ Prompt editor           Timeline and history │
└──────────────────────────────────────────────┘
```

Studio and the agent host are independent consumers of the same project state.

Studio edits workflow files and reads execution artifacts. The agent host executes workflows through the router.

---

## 7. Technology

### 7.1 Client

- React
- TypeScript
- React Flow
- Monaco Editor or CodeMirror
- ELK.js for automatic graph layout
- Vite

### 7.2 Server

- Node.js
- TypeScript
- Express or Fastify
- Chokidar
- Ajv
- Server-Sent Events

### 7.3 Transport

- HTTP for workflow and prompt editing
- SSE for filesystem and run-observation events
- No WebSockets in the MVP

---

## 8. Repository Structure

```text
agent-world-skill/
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   └── studio/
│       ├── shared/
│       │   ├── api.ts
│       │   ├── events.ts
│       │   └── models.ts
│       │
│       ├── server/
│       │   ├── cli.ts
│       │   ├── server.ts
│       │   ├── workspace.ts
│       │   ├── watcher.ts
│       │   ├── validator.ts
│       │   ├── event-reader.ts
│       │   ├── run-history.ts
│       │   └── sse.ts
│       │
│       └── client/
│           ├── index.html
│           ├── main.tsx
│           ├── App.tsx
│           ├── workflow/
│           ├── properties/
│           ├── prompts/
│           ├── runs/
│           └── state/
│
├── tests/
│   ├── agent-world-router.test.js
│   ├── agent-world-eval.test.js
│   └── studio/
│
└── skills/
    └── agent-world/
        ├── SKILL.md
        ├── world.schema.json
        ├── world.example.json
        ├── init-agent-world.md
        ├── eval-agent-world.md
        ├── mention-routing-rules.md
        │
        ├── prompts/
        │   └── ...
        │
        ├── scripts/
        │   ├── agent-world-router.js
        │   ├── agent-world-eval.js
        │   └── agent-world-studio.js
        │
        └── studio/
            └── dist/
                ├── index.html
                └── assets/
```

Studio does not need `run-manager.ts` or `router-adapter.ts` because it does not drive execution.

---

## 9. Studio Launch

The skill may recognize:

```text
agent-world: studio
```

The host launches the Studio process:

```bash
node "$SKILL_DIR/scripts/agent-world-studio.js"   --project "$PWD"
```

Launching Studio is not the same as launching a workflow.

The Studio server must:

1. Resolve the project directory.
2. Verify or create `.agent-world/`.
3. Load `.agent-world/world.json` when present.
4. Start the Chokidar watcher.
5. Start the local HTTP server.
6. Open the Studio URL in the default browser.
7. Remain available until explicitly stopped or the parent process exits.

---

## 10. File Model

### 10.1 Current workflow

```text
.agent-world/world.json
```

This remains the semantic workflow source of truth for future runs.

### 10.2 Visual layout

```text
.agent-world/world.layout.json
```

Example:

```json
{
  "version": 1,
  "nodes": {
    "requirements": {
      "x": 120,
      "y": 80
    },
    "architecture": {
      "x": 120,
      "y": 240
    }
  },
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  }
}
```

Layout metadata must not be stored in `world.json`.

### 10.3 Agent prompts

```text
.agent-world/prompts/*.md
```

### 10.4 Evaluation contract

```text
.agent-world/world.eval.md
```

### 10.5 Run history

```text
.agent-world/runs/
└── <run-id>/
    ├── run.json
    ├── world.snapshot.json
    ├── events.jsonl
    └── final.md
```

---

## 11. Workflow Snapshot Rule

Every run must use a workflow snapshot captured when the agent host begins the run.

```text
.agent-world/runs/<run-id>/world.snapshot.json
```

This prevents Studio edits from changing the meaning of an active or historical run.

Rules:

- Studio edits `.agent-world/world.json`.
- The active run visualizes `world.snapshot.json`.
- Workflow changes apply only to future runs.
- Studio may continue editing while a run is active.
- Studio must warn when the current workflow differs from the active run snapshot.

Example message:

```text
This run is using the workflow snapshot captured when execution started.
Current workflow edits will apply to the next run.
```

---

## 12. Router-Generated Run Events

Studio should not infer execution state only from handoff filenames.

The router should append normalized events during normal host-driven execution:

```text
.agent-world/runs/<run-id>/events.jsonl
```

Example:

```json
{"seq":1,"type":"run.started","runId":"run-42","timestamp":"2026-08-03T15:00:00Z"}
{"seq":2,"type":"node.started","nodeId":"requirements","agentId":"pm","turnId":"turn_0001"}
{"seq":3,"type":"node.completed","nodeId":"requirements","agentId":"pm","turnId":"turn_0001"}
{"seq":4,"type":"route.selected","from":"requirements","to":"architecture"}
{"seq":5,"type":"node.started","nodeId":"architecture","agentId":"architect","turnId":"turn_0002"}
```

The router records events as a side effect of the host invoking it.

The router does not execute agents or host actions.

---

## 13. Event Contract

```typescript
type AgentWorldStudioEvent =
  | {
      id: number;
      type: "workspace.loaded";
      timestamp: string;
      payload: {
        projectRoot: string;
      };
    }
  | {
      id: number;
      type: "file.changed";
      timestamp: string;
      payload: {
        path: string;
        operation: "add" | "change" | "delete";
        source: "studio" | "external";
        hash?: string;
      };
    }
  | {
      id: number;
      type: "world.saved";
      timestamp: string;
      payload: {
        hash: string;
      };
    }
  | {
      id: number;
      type: "validation.completed";
      timestamp: string;
      payload: {
        valid: boolean;
        errors: ValidationError[];
      };
    }
  | {
      id: number;
      type: "run.discovered";
      timestamp: string;
      payload: {
        runId: string;
        host?: string;
      };
    }
  | {
      id: number;
      type: "run.started";
      timestamp: string;
      payload: {
        runId: string;
        message?: string;
        host?: string;
      };
    }
  | {
      id: number;
      type: "node.started";
      timestamp: string;
      payload: {
        runId: string;
        nodeId: string;
        agentId: string;
        turnId: string;
      };
    }
  | {
      id: number;
      type: "node.completed";
      timestamp: string;
      payload: {
        runId: string;
        nodeId: string;
        agentId: string;
        turnId: string;
        responsePreview?: string;
      };
    }
  | {
      id: number;
      type: "route.selected";
      timestamp: string;
      payload: {
        runId: string;
        from: string;
        to: string;
      };
    }
  | {
      id: number;
      type: "host_action.requested";
      timestamp: string;
      payload: {
        runId: string;
        actionId: string;
        nodeId: string;
        kind: string;
        reason?: string;
      };
    }
  | {
      id: number;
      type: "host_action.completed";
      timestamp: string;
      payload: {
        runId: string;
        actionId: string;
        status: "succeeded" | "failed" | "skipped" | "denied";
        summary?: string;
      };
    }
  | {
      id: number;
      type: "run.blocked";
      timestamp: string;
      payload: {
        runId: string;
        reason: string;
      };
    }
  | {
      id: number;
      type: "run.failed";
      timestamp: string;
      payload: {
        runId: string;
        reason: string;
      };
    }
  | {
      id: number;
      type: "run.completed";
      timestamp: string;
      payload: {
        runId: string;
        final?: string;
      };
    };
```

The event contract should remain transport-neutral.

---

## 14. Chokidar Responsibilities

Chokidar watches:

```text
.agent-world/world.json
.agent-world/world.layout.json
.agent-world/world.eval.md
.agent-world/prompts/**/*.md
.agent-world/runs/**/run.json
.agent-world/runs/**/world.snapshot.json
.agent-world/runs/**/events.jsonl
.agent-world/runs/**/final.md
```

Chokidar is responsible for:

- Detecting workflow changes made by Studio
- Detecting workflow changes made by Codex or an editor
- Detecting prompt changes
- Detecting new runs created by an agent host
- Detecting appended run events
- Detecting final output
- Triggering Studio reload, compare, or live visualization updates

Chokidar is not responsible for making execution decisions.

---

## 15. SSE Lifecycle

Studio opens one workspace-level SSE connection:

```text
GET /api/events
```

The connection remains open while the Studio tab is open.

A workflow run finishing does not close the SSE connection.

```text
Studio opens
    ↓
SSE connects
    ↓
Codex starts a run
    ↓
Router writes events
    ↓
Chokidar detects changes
    ↓
Studio visualizes the run
    ↓
Run completes
    ↓
SSE remains connected
    ↓
Another host run or file change occurs
```

Server lifecycle:

```text
One Studio server
One Chokidar watcher
One event bus
Zero or more SSE clients
```

Do not create one Chokidar watcher per browser tab.

Send an SSE heartbeat every 15–30 seconds.

If the connection drops, the browser should reconnect automatically.

For missed run events, Studio reloads them from `events.jsonl`.

---

## 16. HTTP API

### 16.1 Workspace

```text
GET /api/workspace
```

### 16.2 Workflow

```text
GET  /api/world
PUT  /api/world
POST /api/validate
```

### 16.3 Prompts

```text
GET /api/prompts/:agentId
PUT /api/prompts/:agentId
```

### 16.4 Evaluation

```text
POST /api/eval
```

Evaluation validates the workflow. It does not start a live workflow run.

### 16.5 Run observation

```text
GET /api/runs
GET /api/runs/:runId
GET /api/runs/:runId/events
```

### 16.6 Live event stream

```text
GET /api/events
```

The MVP must not expose:

```text
POST /api/runs
POST /api/runs/:runId/stop
POST /api/runs/:runId/continue
POST /api/shell
```

---

## 17. Visual Graph Rules

The graph must distinguish semantic relationships:

```text
Solid arrow   = allowed routing edge
Dashed arrow  = prerequisite declared through `requires`
```

Node states:

- Idle
- Waiting
- Running
- Completed
- Blocked
- Failed
- Skipped

Each node should show:

- Node ID or display label
- Assigned agent
- Agent role
- Short instruction preview
- Current execution status

The graph must highlight:

- Current active node
- Routes already taken
- Rejected or invalid routes
- Missing dependencies
- Terminal node

---

## 18. Editing Behavior

### 18.1 Save workflow and layout

When Studio saves semantic workflow edits:

1. Validate the in-memory graph.
2. Convert it to the canonical `world.json` structure.
3. Validate against `world.schema.json`.
4. Write the file atomically.
5. Publish a `world.saved` event.
6. Record the resulting content hash.

Layout is a separate automatic path. Only a canvas edit—a completed node drag, user viewport pan/zoom (including Zoom In, Zoom Out, and Fit View controls), or explicit Auto layout—schedules persistence. Studio debounces and serializes an atomic write to `world.layout.json`. Opening, restoring, semantic editing, manual world Save, and programmatic canvas initialization do not write it. Each request carries the raw-file revision from the last layout read or write; a mismatch pauses autosave and enters the external-change flow instead of overwriting the file. A failed layout write leaves the latest layout in memory and exposes Retry. Studio restores valid layout automatically on open; malformed roots fall back to an empty layout and invalid or stale entries inside a valid layout are ignored independently.

### 18.2 External changes

When a workflow, layout, or prompt file changes outside Studio:

- Reload a clean world or layout independently, even if the other resource has unsaved edits.
- Do not silently overwrite unsaved Studio edits in the changed resource.
- Offer:
  - Reload
  - Compare
  - Keep Studio Version
- Ignore watcher events matching Studio's latest saved hash.
- Pause queued layout autosave only for a layout conflict, until the user chooses Reload or Keep Studio Version.
- Never create a layout write from a world-only conflict decision.
- Compare layout conflicts using node positions and viewport, not only workflow JSON.

### 18.3 Atomic writes

Use a temporary file and rename operation where practical:

```text
world.json.tmp
    ↓
rename
    ↓
world.json
```

---

## 19. Run Visualization Layout

Recommended MVP layout:

```text
┌──────────────────────────────┬────────────────────────┐
│ Workflow Canvas              │ Run Detail             │
│                              │                        │
│ [PM] ✓ → [Architect] ✓       │ Host: Codex            │
│               ↓              │ Agent: dev             │
│            [Dev] ●           │ Node: implementation   │
│             /   \            │ Turn: 3 / 16           │
│         [QA] ○ [Sec] ○       │ Status: running        │
│             \   /            │                        │
│           [Final] ○          │ Host action requested  │
│                              │ write_file             │
├──────────────────────────────┴────────────────────────┤
│ Timeline                                              │
│ 10:42 PM completed                                    │
│ 10:42 Architect completed                             │
│ 10:43 Dev started                                     │
│ 10:43 Host action requested                           │
└───────────────────────────────────────────────────────┘
```

Suggested top-level modes:

- **Design**
- **Observe**
- **History**

There should be no **Run** button in the MVP.

When no run is active, Studio should display:

```text
No active run.

Start work from an agent host such as Codex.
Studio will visualize the workflow automatically.
```

---

## 20. Local Security Requirements

The Studio server must:

- Bind only to `127.0.0.1`
- Generate a random session token
- Restrict file access to:
  - the configured project root
  - the installed Agent World skill directory
- Reject path traversal
- Provide only predefined editing and read operations
- Never expose arbitrary shell execution
- Validate all write payloads
- Confirm destructive workflow edits
- Close the Chokidar watcher when the server exits

Because Studio does not execute workflows, it should not need permission to run arbitrary project commands.

---

## 21. Build Output

### 21.1 Studio server

```text
src/studio/server/cli.ts
    ↓ esbuild
skills/agent-world/scripts/agent-world-studio.js
```

### 21.2 Studio client

```text
src/studio/client/
    ↓ Vite
skills/agent-world/studio/dist/
```

The installed skill must not require:

```bash
npm install
npm run build
```

Compiled output must be committed or included in the release package.

---

## 22. MVP Implementation Order

### Milestone 1 — Workspace and graph loading

- Start local Studio server
- Serve static Studio UI
- Load `world.json`
- Render nodes and routing edges
- Load and autosave layout independently of workflow saves
- Add schema validation

### Milestone 2 — Workflow editing

- Add and delete nodes
- Add and delete edges
- Edit node properties
- Edit agent properties
- Edit prompt files
- Save `world.json`
- Handle external changes with Chokidar

### Milestone 3 — Router event recording

- Add run IDs
- Snapshot `world.json` at run start
- Create run directories
- Append normalized `events.jsonl`
- Persist final output
- Keep execution fully agent-host driven

### Milestone 4 — Live observation

- Detect new runs through Chokidar
- Add workspace-level SSE
- Highlight active nodes
- Highlight completed routes
- Show host actions
- Show blocked and failed states
- Add timeline

### Milestone 5 — History and replay

- List previous runs
- Load run snapshots
- Replay events on the graph
- Show final output and blocked reasons

### Milestone 6 — Packaging

- Build server bundle
- Build browser assets
- Add `agent-world: studio` launch instructions
- Test installation from `skills/agent-world`
- Add release packaging

---

## 23. Acceptance Criteria

### 23.1 Editing

- A user can open an existing Agent World project.
- The workflow appears as a visual graph.
- The user can add, remove, and reconnect nodes.
- The user can edit node and agent properties.
- The user can edit prompt files.
- The user can save a valid `world.json`.
- Invalid configurations display actionable errors.
- Visual layout survives reopening Studio without an explicit workflow save.
- External file changes are detected without losing unsaved work.

### 23.2 Observation

- Studio automatically detects a run started by an agent host.
- Studio never starts or continues the run.
- The active run uses its stored workflow snapshot.
- Active and completed nodes update live.
- Routes taken are visibly highlighted.
- Host actions appear in the timeline.
- Blocked workflows show the router's reason.
- Completed workflows show the final response.
- Runs are persisted and can be reopened.

### 23.3 Ownership

- The agent host performs every execution step.
- The router selects every next agent.
- Studio performs no execution decisions.
- Studio exposes no run-control endpoint.
- Studio exposes no arbitrary command endpoint.

### 23.4 Runtime

- One Chokidar watcher is used per Studio server.
- One SSE connection is used per open Studio tab.
- SSE remains open after a run finishes.
- The server binds only to localhost.
- The installed skill runs without a development build step.

---

## 24. Future Enhancements

After the MVP:

- Natural-language graph editing
- Visual graph diff
- Run comparison
- Approval display and deep links back to the host
- Template gallery
- Git diff and commit integration
- Electron desktop packaging
- Remote read-only observation
- Collaboration
- WebSockets for interactive multi-user sessions
- Workflow publishing
- Agent performance analytics

Run control should remain with the agent host unless Agent World intentionally introduces a separate host implementation in the future.

---

## 25. Final MVP Decision

The ownership model is:

```text
Studio designs the workflow and observes execution.
The agent host owns execution.
The router owns routing.
```

The MVP will use:

```text
Node + Chokidar + HTTP + SSE
```

Studio will provide:

```text
Visual workflow editing
Prompt editing
Validation
Live observation
Run history and replay
```

Studio will not provide:

```text
Run start
Run stop
Run pause
Run continue
Agent execution
Host-action execution
Router control
```
