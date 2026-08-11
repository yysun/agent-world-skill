# Studio Layout Autosave — Done

## Outcome

Agent World Studio now restores `.agent-world/world.layout.json` on open and debounces persistence of the latest node positions and viewport after actual canvas edits. A node drag-stop, user viewport pan/zoom (including Zoom In, Zoom Out, and Fit View), or explicit Auto layout is the write boundary. Startup, restore, semantic field edits, and manual world Save do not create or rewrite the layout file.

## Delivered

- Dedicated authenticated layout read/write API, separate from semantic world saving.
- Atomic serialized writes with raw-file revision checks, visible failure, retained latest state, and Retry.
- User-origin canvas gating that suppresses React Flow initialization, measurement, restore, and automatic `fitView` notifications.
- Independent world/layout dirty state, reload, conflict comparison, and Keep/Reload behavior.
- Tolerant restore for missing, malformed, incompatible, partial-invalid, and stale layout data.
- Updated committed Studio server/client artifacts and product documentation.

## Verification

- AR passed: no blocking architecture flaws.
- CR passed: no major findings.
- VR passed: all acceptance criteria complete.
- `npm run typecheck`: passed.
- Focused six-file Studio suite: 73/73 passed.
- `npm test`: 150/150 passed, including production rebuild.
- `git diff --check`: passed.
- Built-browser E2E proved no file on startup or semantic Save; viewport control and node drag persistence; restore without file rewrite; and explicit Auto layout persistence.

## Boundaries

- Workflow, agent, prompt, and raw JSON edits remain manually saved.
- Studio does not run automatic graph layout on open.
- A forced browser/process termination before an outstanding autosave is acknowledged is not crash-proof.
