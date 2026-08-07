# Dynamic Edge Anchors

## Problem

Agent World Studio draws workflow connections only from the top and bottom of node cards. Horizontally arranged or manually moved nodes therefore produce long, crossing routes that make small workflows look denser than they are.

## Requirement

Studio must offer connection anchors on all four borders of graph nodes and must route each displayed edge through the closest available source and target anchors as node positions change. This visual behavior must not change the workflow's directed source/target semantics or persisted world configuration.

## Acceptance Criteria

- [x] Workflow node cards and the Human entry node expose connection anchors on their top, right, bottom, and left borders.
- [x] Routing and prerequisite edges select the shortest source/target anchor pair from the four border anchors.
- [x] Moving either endpoint causes its connected edges to reevaluate anchor selection without requiring a reload or explicit layout action.
- [x] Dynamic anchor selection preserves directed workflow source/target identity, connection creation, disconnection, and the persisted world document.
- [x] The installable Studio build artifacts contain the new behavior and focused automated coverage verifies horizontal, vertical, movement, and Human-entry anchor selection.

## Constraints

- Preserve the existing React Flow canvas and world-document data model.
- Anchor selection is presentation state; it must not add fields to `world.json` or layout persistence.
- Node content and validation errors may change rendered card height, so selection must use measured node geometry when available.
- Existing routing-edge and prerequisite-edge visual distinctions must remain intact.

## Non-Goals

- Changing the workflow graph, automatic layout algorithm, or execution router.
- Adding user-configurable anchor preferences, feature flags, environment variables, or compatibility modes.
- Replacing React Flow edge routing or redesigning node cards and edge controls.
