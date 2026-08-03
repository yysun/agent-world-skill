# E2E Test Spec: Agent World Studio Editor UI

Covers the user-facing workflow design surface: rendering, graph editing, property panels, prompts, layout, validation feedback, and external-change conflicts.

Scenarios marked **(automated)** run in `tests/studio/` against the pure graph-model and mutation modules, with no browser, as part of the checked-in `npm test` suite. All others are executed during the RPD `ET` stage against a running Studio instance using available browser-automation tooling, with each expected observation recorded as met or not.

---

## Scenario: Routing edges and prerequisites derive distinctly (automated)

- Given a world document with routing edges and at least one node declaring a `requires` prerequisite
- When the graph is derived from that document and a layout
- Then each routing edge derives as a routing-kind edge and each prerequisite derives as a prerequisite-kind edge
- And no prerequisite is merged into the routing edge collection

## Scenario: The entry node and the human source derive correctly (automated)

- Given a world document declaring a workflow entry and a `human` key in its routing edges
- When the graph is derived
- Then the entry node is marked as the entry
- And the `human` source is represented as an entry affordance rather than as a workflow node
- And the `human` key survives serialization back to a world document unchanged

## Scenario: Nodes absent from the layout still receive positions (automated)

- Given a world document whose layout omits positions for some nodes
- When the graph is derived
- Then every node receives a position
- And the fallback positions are deterministic for the same input

## Scenario: A new node starts referentially clean (automated)

- Given a world document with existing nodes, edges, and `requires`
- When a new node is added through the mutation module
- Then the new node appears in `workflow.nodes` with no incident routing edges and no `requires`
- And no existing node, edge, or `requires` entry is changed

## Scenario: A new agent starts unassigned (automated)

- Given a world document with existing agents
- When a new agent is added through the mutation module with a `promptPath`
- Then the new agent appears in `agents` with the supplied `promptPath`
- And no existing workflow node is assigned to it
- And no existing agent is changed

## Scenario: Deleting a node removes every reference to it (automated)

- Given a world document where a node is an edge target, an edge source, and another node's `requires` prerequisite
- When that node is deleted through the mutation module
- Then the node is gone from `workflow.nodes`
- And it is removed from the routing edges both as a source and as a target
- And its id no longer appears in any other node's `requires`

## Scenario: Deleting the entry node reassigns the entry (automated)

- Given a world document whose `workflow.entry` names the node about to be deleted
- When that node is deleted through the mutation module
- Then `workflow.entry` names a node that still exists
- And the resulting document satisfies the schema's requirement that an entry be present

## Scenario: Renaming an agent rewrites every assignment (automated)

- Given a world document where one agent is assigned to two workflow nodes and is also the workflow entry agent
- When that agent is renamed through the mutation module
- Then both nodes reference the new agent identifier
- And `workflow.entryAgent` names the new identifier
- And no node still references the old identifier

## Scenario: Deleting an assigned agent is refused (automated)

- Given a world document where an agent is still assigned to two workflow nodes
- When that agent is deleted through the mutation module
- Then the deletion is refused and the agent remains in the document
- And the refusal names both workflow nodes still assigned to it
- And no workflow node was removed

## Scenario: Deleting an unreferenced agent succeeds (automated)

- Given a world document containing an agent that no workflow node is assigned to and that is not the entry agent
- When that agent is deleted through the mutation module
- Then the agent is gone from `agents`
- And every workflow node is unchanged

## Scenario: Mutations preserve fields the panels do not expose (automated)

- Given a world document setting `workflow.type`, `workflow.enforceEdges`, and `routing.noMentionFromHumanGoesTo`
- When a node is added, an edge is connected, and an agent is renamed through the mutation module
- Then all three fields are present in the resulting document with their original values
- And no field the original document omitted has been introduced

## Scenario: The graph renders semantic relationships

- Given Studio open on a project with routing edges, a `requires` prerequisite, and a declared entry node
- When the Design canvas is viewed
- Then each node shows its identifier, assigned agent, agent role, and an instruction preview
- And routing edges render as solid arrows while `requires` prerequisites render as dashed arrows
- And the entry node is visually marked as the entry

## Scenario: The canvas exposes no execution surface

- Given Studio open on any project
- When the whole interface is inspected
- Then no run, stop, or continue control is present
- And no node displays an execution status such as running, completed, blocked, or skipped

## Scenario: An empty project opens as an editable workspace

- Given a project directory containing no world file
- When Studio is opened on it
- Then an empty editable canvas is shown rather than an error state
- And an affordance to create the first node and agent is available

## Scenario: The first save from an empty workspace succeeds

- Given Studio open on a project that had no world file, whose `.agent-world/prompts/` already contains the file the new agent's prompt path will point to (REQ Constraints: the server cannot create that file through the client alone)
- When a node and an agent are created, the entry is set, and the world is saved
- Then the save succeeds

## Scenario: The first save fails clearly when the new agent's prompt file does not exist

- Given Studio open on a project that had no world file and no existing prompt files
- When a node and an agent are created, the entry is set, and the world is saved
- Then the save fails and the validation banner names the missing prompt path
- And the created node and agent remain in the canvas, editable, rather than being discarded
- And reopening Studio on that project shows the saved workflow

## Scenario: Editing the graph and saving produces a valid world

- Given Studio open on an existing project
- When a node is added, an agent is assigned to it, its instruction and `requires` are edited, an edge is connected to it, another edge is disconnected, the entry node is changed, and the world is saved
- Then the save succeeds
- And the raw JSON view reflects every edit

## Scenario: Deleting a node is confirmed and stays valid

- Given Studio open on a project where a node is both an edge target and another node's `requires` prerequisite
- When that node is deleted
- Then a confirmation appears naming the edges and the prerequisite that will also be removed
- And after confirming, the node and every reference to it are gone and a save succeeds with no validation errors

## Scenario: Cancelling a destructive edit changes nothing

- Given Studio open on a project with a node that has incident edges
- When deletion of that node is started and then cancelled at the confirmation
- Then the node and all of its edges remain
- And the world is unchanged

## Scenario: Renaming an assigned agent keeps the world valid

- Given Studio open on a project where an agent is assigned to two workflow nodes
- When that agent's identifier is renamed and the world is saved
- Then both nodes reference the new agent identifier
- And the save succeeds with no validation errors

## Scenario: Deleting an agent in use is blocked with an explanation

- Given Studio open on a project where an agent is assigned to two workflow nodes
- When deletion of that agent is attempted
- Then the deletion is blocked and the blocking workflow nodes are named
- And no destructive override is offered
- And after reassigning those nodes to another agent, the deletion succeeds

## Scenario: World and agent properties are editable

- Given Studio open on an existing project
- When the world identifier, name, turn limit, stop token, and mode are edited, and an agent's display name, role, prompt path, and context scope are edited, and the world is saved
- Then the save succeeds
- And reopening Studio on that project shows every edited value

## Scenario: Identifier fields reject invalid characters

- Given Studio open on a project
- When a space is typed into the world identifier field and into an agent identifier field
- Then each field reports the invalid identifier at the field itself
- And the error appears without waiting for a save attempt

## Scenario: Prompt files are editable

- Given Studio open on a project whose agents declare prompt paths
- When an agent's prompt is opened, edited, and saved
- Then the save succeeds
- And reopening that prompt shows the edited content

## Scenario: The raw JSON view reflects the in-memory graph

- Given Studio open on a project with unsaved edits to a node instruction
- When the raw JSON view is opened
- Then it shows the edited instruction rather than the version on disk
- And the view is read-only

## Scenario: Automatic layout arranges the graph

- Given Studio open on a project with no saved layout
- When automatic layout is invoked
- Then the nodes are arranged without overlap and the routing direction is legible
- And layout runs only on that explicit action, not automatically on load

## Scenario: Manual positions survive a restart

- Given Studio open on a project with an arranged graph
- When individual nodes are dragged to chosen positions, the world is saved, and Studio is closed and reopened on the same project
- Then those manual positions are restored
- And the world file contains no layout or position field

## Scenario: A rejected save is reported as a failure

- Given Studio open on a project where an edit has produced a world the server will reject
- When a save is attempted
- Then the failure is reported to the user rather than presented as success
- And the unsaved edits are retained

## Scenario: Validation errors point at the offending element

- Given a project whose world file was made invalid outside Studio by pointing an edge at a node that does not exist
- When Studio is opened on that project
- Then the error is surfaced against the offending edge rather than only logged
- And the error text names the missing target node

## Scenario: External change with unsaved work offers a choice

- Given Studio open with unsaved edits to the workflow
- When the world file is modified outside Studio
- Then Studio presents Reload, Compare, and Keep Studio Version
- And choosing Keep Studio Version retains the unsaved edits
- And choosing Reload replaces the in-memory world with the version on disk

## Scenario: Compare shows a read-only diff without discarding edits

- Given Studio open with unsaved edits to the workflow, and the world file modified outside Studio while those edits are unsaved
- When Compare is chosen from the conflict prompt
- Then a read-only two-column diff appears showing the in-memory Studio version alongside the on-disk external version
- And the changed top-level sections are visually highlighted
- And no edit control in the diff view can change either side
- And after closing Compare, the unsaved edits are still present and no reload has happened

## Scenario: External change without unsaved work reloads silently

- Given Studio open with no unsaved edits
- When the world file is modified outside Studio
- Then Studio reflects the change without a manual page refresh
- And no conflict prompt appears

## Scenario: Studio's own save raises no conflict

- Given Studio open on a project
- When the world is saved from Studio
- Then no external-change conflict prompt appears
- And the workspace remains in a clean, non-dirty state

## Scenario: The client reconnects after a transient stream drop

- Given Studio open and connected, with the same server process still running
- When the event stream connection drops and the server becomes reachable again (a transient network interruption)
- Then the client reconnects on its own without a manual page refresh
- And a subsequent external file change is reflected in the interface

## Scenario: A server restart surfaces a clear session-expired message

- Given Studio open and connected
- When the Studio server process is restarted (its session token is freshly randomized per launch, an existing server behavior this story does not change)
- Then the client does not silently fail or retry forever
- And the interface shows a session-expired message directing the user to reopen the newly printed URL
