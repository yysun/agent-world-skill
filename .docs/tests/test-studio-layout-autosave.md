# Studio Layout Autosave E2E Specification

## Execution Evidence — 2026-08-11

- Built Studio opened a disposable six-node project with no layout file; initialization and `fitView` left the file absent.
- Editing the world name and choosing Save left the layout file absent.
- Clicking Zoom In created a version-1 layout containing only the viewport.
- Dragging `architecture` persisted its final coordinates after debounce while the semantic Save button stayed clean.
- Reload restored the same rendered node position and viewport; SHA-256 and modification time of the layout file were unchanged by restore.
- Explicit Auto layout persisted positions for all six nodes.
- Focused automated coverage passed 73/73 for rapid ordering, active-write conflicts, failure/retry, atomic replacement, malformed/stale restore, resource-scoped reload, authentication, and watcher classification; full repository coverage passed 150/150.

## Scenario: Opening Studio does not create a layout file

- Given a valid project has no `.agent-world/world.layout.json`
- When Studio opens and finishes restoring the canvas
- Then `.agent-world/world.layout.json` remains absent

## Scenario: Semantic editing and world Save do not rewrite an existing layout

- Given Studio is open with an existing `.agent-world/world.layout.json` whose bytes and modification time are recorded
- When the user edits a workflow, agent, or node property and chooses the world Save action
- Then `.agent-world/world.layout.json` has identical bytes and modification time

## Scenario: Semantic editing and world Save do not create a missing layout

- Given Studio is open on a valid project with no `.agent-world/world.layout.json`
- When the user edits a workflow, agent, or node property and chooses the world Save action
- Then `.agent-world/world.layout.json` remains absent

## Scenario: Restore and clean external reload do not rewrite layout

- Given Studio opens with a valid existing layout whose bytes and modification time are recorded
- When Studio restores it or receives an external layout change while no local canvas edit is pending
- Then Studio applies the external node positions and viewport
- And Studio does not issue a layout write or rewrite the file

## Scenario: Programmatic canvas initialization does not create layout

- Given Studio opens a valid multi-node world without `.agent-world/world.layout.json`
- When React Flow initializes, measures nodes, and runs its initial `fitView`
- Then `.agent-world/world.layout.json` remains absent

## Scenario: Canvas controls persist user-requested viewport changes

- Given Studio is open with no pending canvas edit
- When the user chooses Zoom In, Zoom Out, or Fit View from the React Flow controls
- Then the resulting viewport is persisted to `.agent-world/world.layout.json`

## Scenario: Node movement persists without saving the world

- Given Studio is open on a valid world and the world Save button is not used
- When a workflow node is dragged to a new position and the layout autosave settles
- Then `.agent-world/world.layout.json` contains the new node position
- And `.agent-world/world.json` is byte-for-byte unchanged
- And the world Save button does not become enabled solely because the node moved

## Scenario: Layout autosave preserves an unsaved workflow edit

- Given Studio has an unsaved workflow-property edit and the world Save button is enabled
- When the user moves a node and the layout autosave succeeds
- Then the workflow-property edit remains visible and unsaved
- And the world Save button remains enabled
- And `world.json` still contains the prior saved workflow value

## Scenario: Viewport and automatic layout persist across restart

- Given Studio is open on a valid world
- When the user pans or zooms the canvas and explicitly runs Auto layout
- And Studio is closed after layout autosave settles
- And Studio is reopened on the same project
- Then the saved viewport and automatically arranged node positions are restored
- And Studio does not automatically run graph layout on open

## Scenario: Rapid changes retain the newest layout

- Given Studio is open on a disposable project
- When the user rapidly moves a node several times and changes the viewport before autosave settles
- Then layout requests are not executed concurrently
- And the final persisted layout contains the newest position and viewport rather than an older snapshot

## Scenario: Closing warns until layout autosave is acknowledged

- Given Studio has queued or in-flight layout work
- When the user attempts to close the browser before autosave acknowledges the latest layout
- Then the browser warns that unsaved work remains

## Scenario: Acknowledged layout survives closing and reopening

- Given Studio reports no unsaved layout after the latest node and viewport changes
- When Studio is closed and reopened on the same project
- Then the acknowledged latest node positions and viewport are restored

## Scenario: Layout save failure preserves the latest in-memory state

- Given Studio is open on a disposable project whose layout directory is temporarily made unwritable
- When the user moves a node and autosave settles
- Then Studio displays a layout-specific save failure
- And the node remains at its latest in-memory position

## Scenario: Failed layout can be retried

- Given Studio retains the latest in-memory layout after a failed autosave
- And write permission has been restored on the disposable project
- When the user chooses Retry
- Then the same latest layout is persisted and the failure clears

## Scenario: Malformed or stale layout does not block Studio

- Given `.agent-world/world.layout.json` is malformed, incompatible, or contains both valid current-node positions and malformed or stale node entries
- When Studio opens the project
- Then the world remains editable
- And malformed or incompatible layout falls back to a usable empty layout
- And a valid version-1 layout drops only malformed or stale entries while retaining valid current-node positions

## Scenario: Studio-authored layout changes do not conflict

- Given Studio is connected to the project event stream
- When Studio autosaves a layout change
- Then the watcher classifies the matching file event as Studio-authored and no conflict prompt appears

## Scenario: External layout conflict can be compared

- Given Studio has queued, in-flight, failed, or unsaved layout state
- When a different process changes the layout file while Studio has queued, in-flight, failed, or unsaved layout state and the user chooses Compare
- Then Studio uses the existing external-change conflict prompt instead of silently replacing the in-memory layout
- And an autosave whose raw revision no longer matches is rejected before replacement
- And Compare shows the in-memory and on-disk node positions and viewport rather than an identical workflow-only comparison

## Scenario: Dirty world does not turn a clean external layout change into a write

- Given Studio has an unsaved semantic world edit but no local canvas edit
- When a different process changes `.agent-world/world.layout.json`
- Then Studio restores the external layout independently and preserves the unsaved semantic edit
- And Studio does not show a layout conflict or rewrite `.agent-world/world.layout.json`

## Scenario: Dirty layout does not block a clean external world reload

- Given Studio has a pending local canvas edit but no unsaved semantic world edit
- When a different process changes `.agent-world/world.json`
- Then Studio restores the external semantic world independently and preserves the pending canvas edit
- And Studio does not show a world conflict or discard the pending layout autosave

## Scenario: World and layout conflicts accumulate only when both are dirty

- Given Studio has an unsaved semantic edit and a pending local canvas edit and displays a conflict for an external world change
- When an external layout change arrives before the first conflict is resolved
- Then Studio retains both conflict sources
- And Compare shows both semantic world differences and layout node/viewport differences

## Scenario: Reconnect with only dirty world refreshes clean layout

- Given Studio has an unsaved semantic edit but no local canvas edit when the event stream reconnects after missed file events
- When the reconnect conflict prompt is opened and the user chooses Compare
- Then Studio shows only the semantic world comparison
- And the clean layout is refreshed independently without being written

## Scenario: Reconnect with only dirty layout refreshes clean world

- Given Studio has a pending local canvas edit but no unsaved semantic edit when the event stream reconnects after missed file events
- When the reconnect conflict prompt is opened and the user chooses Compare
- Then Studio shows only the layout comparison
- And the clean world is refreshed independently without discarding the pending canvas edit

## Scenario: Reconnect with both resources dirty compares both

- Given Studio has an unsaved semantic edit and a pending local canvas edit when the event stream reconnects after missed file events
- When the reconnect conflict prompt is opened and the user chooses Compare
- Then Studio shows both semantic world and layout comparisons

## Scenario: Reload resolves an external layout conflict from disk

- Given Studio displays an external layout conflict while retaining a queued local layout
- When the user chooses Reload
- Then queued Studio layout is discarded
- And the external node positions and viewport are applied

## Scenario: Keep resolves an external layout conflict with the Studio version

- Given Studio displays an external layout conflict while retaining a queued local layout
- When the user chooses Keep Studio Version
- Then Studio refreshes the external layout revision token
- And the retained latest Studio layout replaces the external layout only after that explicit choice

## Scenario: World-only Keep never writes layout

- Given Studio has an unsaved semantic edit, no local canvas edit, and a world-only external conflict
- When the user chooses Keep Studio Version
- Then Studio preserves the semantic edit
- And `.agent-world/world.layout.json` is neither created nor rewritten
