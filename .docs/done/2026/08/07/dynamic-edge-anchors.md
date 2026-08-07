# Dynamic Edge Anchors

## Summary

- Added top, right, bottom, and left connection handles to workflow nodes and the Human entry node.
- Routed every routing and prerequisite edge through the shortest border-anchor pair using current positions and measured node dimensions.
- Preserved controlled React Flow measurements across drag updates so edges remain visible and switch anchors live.
- Kept handle choices out of world/layout persistence and preserved directed connect/disconnect behavior, including Human source translation and target rejection.
- Rebuilt the installable Studio client assets and added focused geometry, projection, movement, and Human-source regression coverage.

## Verification

- `npm run typecheck` passed.
- `node --test tests/studio/studio-graph-model.test.js` passed 14/14; `npm test` passed 116/116 with loopback binding allowed for Studio integration tests.
- Built-Studio E2E passed for four-side rendering, horizontal and vertical switching, Human behavior, disconnect/reconnect semantics, visual edge distinctions, and persistence isolation.
- `AR passed: no blocking architecture flaws`; `CR passed: no major findings`; `VR passed: all acceptance criteria complete`.

## Notes

- No workflow schema, router, execution, automatic-layout algorithm, feature flag, compatibility mode, or persisted anchor preference was added.
- The default sandbox blocks loopback listeners; the unchanged full integration suite passed when granted temporary loopback permission.
