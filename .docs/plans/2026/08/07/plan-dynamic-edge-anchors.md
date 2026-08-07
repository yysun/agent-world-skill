# Dynamic Edge Anchors Plan

## Goal

Make Studio connections attach to the nearest of four node-border anchors throughout node movement while preserving the underlying directed workflow graph and editing behavior.

## Current Context

- `src/studio/client/workflow/WorkflowNodeCard.tsx` currently renders one top target handle and one bottom source handle.
- `src/studio/client/workflow/HumanEntryNode.tsx` currently renders one right source handle.
- `src/studio/client/workflow/Canvas.tsx` derives controlled React Flow nodes and edges from `WorldDocument` plus persisted layout and forwards drag changes to the owner.
- `src/studio/client/workflow/RoutingEdge.tsx` consumes React Flow's resolved source/target positions and retains the routing-edge disconnect action.
- `src/studio/client/workflow/layout.ts` models workflow nodes as 200 by 90 pixels for ELK, while actual rendered height can grow with card content or validation errors.
- `tests/studio/_workflow.js` bundles pure workflow helpers for Node's built-in test runner. The project provides `npm run typecheck`, `npm run build`, and `npm test`.
- The initial draft patch introduced four loose-mode handles and a pure nearest-pair helper, but it still assumes fixed node geometry. Implementation must replace that assumption with measured geometry when React Flow reports it.

## Decisions

- Render four named handles (`top`, `right`, `bottom`, `left`) per node and use React Flow loose connection mode so each visible anchor can participate as either endpoint without overlapping duplicate source/target controls.
- Keep edge source and target node identifiers authoritative. Assign only `sourceHandle` and `targetHandle` as derived presentation values.
- Calculate all 16 border-midpoint combinations and choose the shortest squared Euclidean distance. Stable side iteration provides deterministic tie behavior.
- Capture React Flow dimension changes as ephemeral canvas measurements. Use existing layout dimensions only as startup fallbacks before measurement; never persist dimensions or handle choices.
- Apply the same derived handles to routing and prerequisite edges so both visual edge kinds avoid avoidable crossings.
- Preserve the existing React Flow edge components, disconnect callback, world mutations, and layout persistence. Reject feature flags, configuration fields, manual anchor locking, and a new routing engine as unnecessary.
- Add a Markdown E2E specification because this is a user-facing drag-and-route interaction. Execute it manually against the built Studio after automated verification.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Inspect `Canvas.tsx`, `WorkflowNodeCard.tsx`, `HumanEntryNode.tsx`, `RoutingEdge.tsx`, `derive.ts`, `layout.ts`, Studio CSS, and graph tests to confirm current handle, geometry, drag, and edge-editing behavior.
- [x] Confirm `WorldDocument` and persisted `Layout` remain authoritative while handle sides and rendered measurements stay ephemeral presentation state.
- [x] Record that automatic-layout changes, manual anchor preferences, routing-engine replacement, and workflow-schema changes are non-goals.

### Phase 2 - Anchor model and node handles

- [x] Update `src/studio/client/workflow/anchors.ts` with four named sides, fallback dimensions, measured-geometry support, and deterministic closest-pair selection.
- [x] Update `WorkflowNodeCard.tsx` and `HumanEntryNode.tsx` to render one visible loose-mode handle on each border while preserving existing node content and entry/error styling.
- [x] Update the top comment blocks in every edited source file to describe four-sided handles and dynamic geometry behavior.

### Phase 3 - Dynamic canvas integration

- [x] Update `Canvas.tsx` to retain React Flow dimension observations as non-authoritative visual state, echo measurements into controlled node projections, and recompute edge handle IDs from current positions and measured sizes.
- [x] Preserve routing and prerequisite edge types, arrow direction, Human-source translation, connect/disconnect callbacks, selection behavior, drag persistence, and viewport persistence.
- [x] Keep handle choice out of `WorldDocument`, `Layout`, server APIs, and saved JSON.

### Phase 4 - Tests and verification wiring

- [x] Extend `tests/studio/studio-graph-model.test.js` with horizontal, reverse-horizontal, vertical, moved-node, Human-entry, measured-height, controlled-projection, Human-source translation, four-side availability, and deterministic tie coverage.
- [x] Run `npm run typecheck` and record a clean result.
- [x] Run `npm run build` and confirm the committed server/client Studio artifacts are regenerated.
- [x] Run `node --test tests/studio/studio-graph-model.test.js` and then `npm test`, recording passing results after code-review fixes.
- [x] Execute `.docs/tests/test-dynamic-edge-anchors.md` against the built Studio and record the observed anchor switching and preserved edge semantics.

### Phase 5 - Documentation and status

- [x] Confirm the diff contains no workflow-schema, router, automatic-layout, or manual-anchor-preference changes.
- [x] Record the exact successful automated commands and manual E2E observations in this plan's validation evidence.

## Validation

- `npm run typecheck` must exit successfully with no TypeScript diagnostics.
- `npm run build` must exit successfully and update `skills/agent-world/scripts/agent-world-studio.js` plus `skills/agent-world/studio/dist/`.
- `node --test tests/studio/studio-graph-model.test.js` must pass focused pure geometry tests.
- `npm test` must pass the complete repository suite after its build pretest.
- Manual E2E scenarios in `.docs/tests/test-dynamic-edge-anchors.md` must show left/right use for horizontal nodes, top/bottom use for vertical nodes, live switching during movement, and unchanged directed connection/disconnection behavior.

### Validation Evidence

- `npm run typecheck` passed with no TypeScript diagnostics.
- `npm run build` passed and regenerated the installable client asset manifest and hashed bundles; the server bundle rebuilt without a content change.
- `node --test tests/studio/studio-graph-model.test.js` passed 14/14 focused tests.
- `npm test` passed 116/116 repository tests with temporary loopback binding allowed for Studio integration tests.
- Manual E2E against the built Studio confirmed four handles per node, right/left horizontal routing, live bottom/top switching after vertical movement, Human side switching and target rejection, disconnect/reconnect restoration of `con → judge`, preserved solid/dashed edge behavior, and no handle/anchor metadata in `world.json`.
- `git diff --check` passed; inspection found no schema, router, execution, automatic-layout algorithm, or manual-anchor-preference changes.

## Rollback / Risk

- Loose connection mode could reverse or broaden connection gestures if React Flow treats endpoint handles differently; manual E2E must confirm source/target semantics and the existing Human-target guard.
- Measurements arrive after initial render, so fallback geometry must produce a valid path before React Flow reports dimensions and then converge without persistence changes.
- Fixed-width CSS aligns cards with ELK's width assumption, but rendered height remains content-dependent and must come from React Flow measurements.
- Rollback is limited to the four-side handle renderer, anchor helper, canvas measurement/handle derivation, focused tests, CSS alignment, and regenerated build artifacts; no stored data migration is involved.
