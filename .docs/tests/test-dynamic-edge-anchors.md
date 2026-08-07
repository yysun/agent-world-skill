# Dynamic Edge Anchors E2E Specification

## Scenario: Horizontal nodes use facing side anchors

- Given Studio is open on a world containing a directed edge between two workflow nodes
- And the source node is positioned clearly to the left of the target node
- When the canvas finishes rendering
- Then the edge leaves the source node from its right border
- And the edge enters the target node through its left border

## Scenario: Moving a node switches the closest anchor pair

- Given Studio shows two connected workflow nodes arranged horizontally
- When the target node is dragged below the source node and released
- Then the same directed edge leaves the source through its bottom border
- And the edge enters the target through its top border

## Scenario: Human entry uses all four border anchors

- Given the world has a Human routing source connected to the workflow entry node
- When the Human node is moved from the left side of the entry node to a position above it
- Then the Human edge changes from right-to-left anchors to bottom-to-top anchors
- And the Human node remains a source rather than a valid routing target

## Scenario: Disconnecting preserves directed workflow semantics

- Given Studio shows four-sided anchors and an existing directed routing edge
- When the user disconnects that edge with its existing edge control
- Then the corresponding source-to-target route is removed from the world document

## Scenario: Reconnecting preserves directed workflow semantics

- Given Studio shows four-sided anchors and a previously disconnected source and target node
- When the user reconnects the source node to the target node using a border anchor
- Then the world document records the same directed source-to-target route without storing anchor-side metadata
- And prerequisite edges remain dashed while routing edges remain solid
