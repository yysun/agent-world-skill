# E2E Test Spec: Agent World Studio Server

Covers the Studio HTTP and event-stream contract, a public consumer contract.

Scenarios run against the **built** artifact `skills/agent-world/scripts/agent-world-studio.js` from `tests/studio/`, each against a temporary project directory. Each scenario starts the server on an ephemeral loopback port, performs the token handshake, and terminates the server on completion.

The scenario marked **(manual)** is performed by a human in a browser and its expected observations recorded.

---

## Scenario: Server starts on loopback and serves the workspace

- Given a temporary project directory containing a valid `.agent-world/world.json` and its prompt files
- When the Studio server is launched with `--project <tmp> --no-open`
- Then it prints a URL of the form `http://127.0.0.1:<port>/?token=<token>`
- And the listening address is `127.0.0.1`, not `0.0.0.0` or any external interface
- And `GET /api/workspace` after the token handshake returns the resolved project root and Studio metadata

## Scenario: The token handshake establishes a session

- Given a running Studio server that printed a session token
- When `GET /` is requested with the correct `?token=` query parameter
- Then the response sets an `HttpOnly; SameSite=Strict` session cookie
- And the response redirects to `/` so the token does not remain in the address bar
- And a subsequent `GET /api/world` carrying that cookie returns 200

## Scenario: API requests without a valid session are rejected

- Given a running Studio server
- When `GET /api/world` is requested with no session cookie, and again with a cookie whose value is not the generated token
- Then both responses return 401
- And no world content is returned in either response

## Scenario: Only static assets and the handshake are unauthenticated

- Given a running Studio server
- When every implemented `/api/*` route is requested without a session cookie, including `GET /api/events`
- Then every one of those routes returns 401
- And requests for the client's static assets succeed without a cookie

## Scenario: No run-control endpoint exists

- Given a running Studio server
- When `POST /api/runs`, `POST /api/runs/:runId/stop`, and `POST /api/runs/:runId/continue` are requested with a valid session
- Then none of them is a registered route
- And no run is created, started, stopped, or continued by any request

## Scenario: No arbitrary command endpoint exists

- Given a running Studio server
- When `POST /api/shell` is requested with a valid session
- Then it is not a registered route
- And no implemented endpoint accepts a client-supplied filesystem path, command name, or shell string

## Scenario: The server never invokes the router as an execution host

- Given the built Studio server bundle
- When the bundle is inspected for invocations of the router's `user`, `next`, `complete`, and `file` commands
- Then none is present
- And the only router capability the server uses is configuration loading and validation

## Scenario: Reading a world returns graph, agents, settings, and layout

- Given a project whose `world.json` declares multiple nodes, routing edges, at least one `requires` prerequisite, and multiple agents, and whose `.agent-world/world.layout.json` holds saved positions
- When `GET /api/world` is requested
- Then the response contains every workflow node with its agent, instruction, and `requires`
- And it contains every routing edge and every agent with its name, role, `promptPath`, and `contextScope`
- And it contains the world `id`, `name`, `turnLimit`, `stopToken`, and `mode`
- And it contains the persisted layout positions and viewport

## Scenario: A project with no world file reports the world absent

- Given a temporary project directory containing no `.agent-world/world.json`
- When the Studio server is launched against it and `GET /api/world` is requested
- Then the server starts normally and the response returns 200
- And the response reports the world as absent rather than returning an error
- And the layout is reported as empty

## Scenario: Schema violations are reported with a pointer

- Given a running Studio server
- When `POST /api/validate` is sent a world whose `world.turnLimit` is a string instead of an integer
- Then the response reports the world invalid
- And the errors identify the offending field rather than only stating that the document is invalid

## Scenario: A missing edge target is reported against the edge

- Given a running Studio server
- When `POST /api/validate` is sent a world containing an edge whose target node does not exist
- Then the response reports the world invalid
- And the errors name the offending edge and the missing target node

## Scenario: An undefined node agent is reported against the node

- Given a running Studio server
- When `POST /api/validate` is sent a world whose node references an agent that is not defined
- Then the response reports the world invalid
- And the errors name the offending node and the undefined agent

## Scenario: A missing prerequisite is reported against the node

- Given a running Studio server
- When `POST /api/validate` is sent a world whose node `requires` a node that does not exist
- Then the response reports the world invalid
- And the errors name the offending node and the missing prerequisite

## Scenario: Saving a valid world is atomic and router-loadable

- Given a project with an existing valid `world.json` and a connected event-stream client
- When `PUT /api/world` saves a modified but valid world
- Then the response succeeds and records a content hash
- And no `world.json.tmp` remains in `.agent-world/`
- And the router's `loadConfig` accepts the written file without throwing
- And a `world.saved` event carrying the content hash is delivered on the event stream

## Scenario: A schema-invalid save leaves the project untouched

- Given a project with an existing valid `world.json` whose bytes are recorded
- When `PUT /api/world` is sent a world that fails schema validation
- Then the response status is 400 and carries actionable errors
- And `world.json` is byte-identical to the recorded content
- And no `world.json.tmp` remains in `.agent-world/`

## Scenario: A graph-invalid save leaves the project untouched

- Given a project with an existing valid `world.json` whose bytes are recorded
- When `PUT /api/world` is sent a world that passes the schema but references a node that does not exist
- Then the response status is 400 and carries actionable errors
- And `world.json` is byte-identical to the recorded content
- And no `world.json.tmp` remains in `.agent-world/`

## Scenario: The first save into an empty project is router-loadable

- Given a running Studio server on a project that had no world file
- When `PUT /api/world` saves a world containing `workflow.type`, `workflow.entry`, `workflow.entryAgent`, one node, and one agent
- Then the save succeeds and `.agent-world/world.json` is created
- And the router's `loadConfig` accepts the written file without throwing

## Scenario: Layout persists separately from workflow semantics

- Given a running Studio server on a project with an existing world
- When a world is saved together with node positions and a viewport
- Then `.agent-world/world.layout.json` contains those positions and that viewport
- And `.agent-world/world.json` contains no layout, position, or viewport field

## Scenario: Layout survives a server restart

- Given a project whose layout was saved through the server, and a server that has since been stopped
- When the server is relaunched against the same project and `GET /api/world` is requested
- Then the response returns the previously saved positions and viewport unchanged

## Scenario: Round-tripping preserves fields no editor exposes

- Given a `world.json` that sets `workflow.type`, `workflow.enforceEdges`, `routing.noMentionFromHumanGoesTo`, and a per-agent `contextScope`
- When that world is read through `GET /api/world` and written back unmodified through `PUT /api/world`
- Then every one of those fields is present in the written file with its original value
- And no field the original file omitted has been introduced with an injected default

## Scenario: Prompt files are read and written by agent id

- Given a project whose agents declare `promptPath` values under `.agent-world/prompts/`, and a connected event-stream client
- When `GET /api/prompts/:agentId` is requested for a defined agent and `PUT /api/prompts/:agentId` then writes new content for that agent
- Then the read returns that agent's prompt Markdown content
- And the file on disk contains the new content
- And a `file.changed` event for that prompt path is delivered on the event stream

## Scenario: Path traversal through a relative prompt path is rejected

- Given a project whose `world.json` declares an agent with a `promptPath` of `../../escape.md`
- When `GET /api/prompts/:agentId` and `PUT /api/prompts/:agentId` are requested for that agent
- Then both responses return 400
- And no file outside the project root is read or written

## Scenario: Path traversal through a symbolic link is rejected

- Given a project whose `promptPath` resolves through a symbolic link pointing outside the project root
- When `GET /api/prompts/:agentId` and `PUT /api/prompts/:agentId` are requested for that agent
- Then both responses return 400
- And no file outside the project root is read or written

## Scenario: Invalid write payloads have no filesystem effect

- Given a project whose `.agent-world/` contents are recorded
- When `PUT /api/world` is sent a body that is not a valid world document
- Then the response status is 400 with `{ pointer, message }` errors
- And every file under `.agent-world/` is unchanged

## Scenario: The event stream stays open and heartbeats

- Given a running Studio server and one connected event-stream client
- When the client stays connected through an idle period longer than the heartbeat interval
- Then the client receives at least one heartbeat comment line
- And the connection is still open afterward

## Scenario: External changes are pushed to connected clients

- Given a running Studio server with a connected event-stream client
- When `world.json` is modified directly on disk outside Studio
- Then the client receives a `file.changed` event for that path with `source: "external"`

## Scenario: The server's own writes do not raise a conflict

- Given a running Studio server with a connected event-stream client
- When the server saves `world.json` through `PUT /api/world`
- Then the resulting `file.changed` event carries `source: "studio"` because the content hash matches the most recent write
- And no external-change conflict is raised for that save

## Scenario: One watcher and one event bus serve all clients

- Given a running Studio server with two concurrent event-stream clients
- When a single external file change occurs
- Then both clients receive the corresponding `file.changed` event
- And the server has created exactly one file watcher regardless of the number of connected clients

## Scenario: Clean shutdown releases every resource

- Given a running Studio server with a connected event-stream client
- When the server process receives `SIGTERM`
- Then the process exits without hanging
- And the HTTP port is released, the watcher is closed, and the client connection is ended
- And no child process started by the server remains alive

## Scenario: The client shell loads from committed artifacts (manual)

- Given a clean checkout with no `node_modules` present and a temporary Agent World project
- When `node skills/agent-world/scripts/agent-world-studio.js --project <tmp>` is run and the browser opens the printed URL
- Then the shell loads from the committed assets with no dependency install or build step
- And it displays the resolved workspace metadata and a live event-stream connection status
- And it presents no run, stop, or continue control
