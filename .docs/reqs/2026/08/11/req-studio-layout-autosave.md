# Studio Layout Autosave

## Problem

Agent World Studio restores layout only after the user has explicitly saved the world. Moving nodes or changing the viewport feels immediately applied, but closing Studio before pressing Save loses that visual work. The Save button also conflates semantic workflow edits with presentation-only state even though the files have different ownership and failure modes.

## Requirement

Studio must automatically restore and persist visual layout state independently of workflow configuration. Node positions and the viewport must survive closing and reopening Studio without an explicit world save, while workflow changes remain controlled by the existing manual save action. `world.layout.json` may be written only in response to a canvas edit: a node move, a viewport pan/zoom, or the user explicitly choosing Auto layout.

## Acceptance Criteria

- [x] Opening Studio automatically restores valid saved node positions and viewport state from the layout file.
- [x] Moving nodes, running automatic layout, or changing the viewport automatically persists the latest layout without requiring the world Save action.
- [x] Opening or reloading Studio, editing semantic world/agent/node fields, manually saving the world, or resolving an external change when no local canvas edit is pending never creates or rewrites `.agent-world/world.layout.json`.
- [x] Rapid or overlapping layout changes during an active Studio session cannot allow an older save to overwrite a newer in-memory layout.
- [x] Layout persistence remains isolated to `.agent-world/world.layout.json`; layout-only changes never rewrite `.agent-world/world.json` or clear unsaved workflow edits.
- [x] Layout writes are atomic, and a failed write is visible in Studio while the latest layout remains in memory for a later retry.
- [x] Missing, malformed, or incompatible layout files do not prevent Studio from opening; structurally invalid or stale entries inside an otherwise valid layout are ignored while valid current-node entries remain available.
- [x] External changes are resolved per file: a clean resource reloads independently without discarding dirty state in the other resource; only a locally edited layout can raise a layout conflict or be written by Keep Studio Version; Studio-authored autosaves do not raise false conflicts.
- [x] Focused automated tests and the built Studio artifacts verify restore, independent persistence, write ordering, failure behavior, and malformed/stale layout handling.

## Constraints

- `.agent-world/world.json` remains the semantic source of truth and must never contain layout metadata.
- `.agent-world/world.layout.json` remains the only persisted layout file; no migration or compatibility file is introduced.
- Autosave must use the authenticated Studio HTTP surface rather than direct browser filesystem access.
- Existing workflow validation, manual world saving, file watching, and conflict protection must remain intact.
- A canvas edit means only a node drag, a viewport pan/zoom, or the user's explicit Auto layout action. Restore, load, semantic editing, manual world Save, Compare, Reload, and world-only Keep are not canvas edits and must not schedule a layout write.
- Autosave must compare the last observed raw-file revision immediately before atomic replacement; a detected external change must pause autosave until the user explicitly chooses Reload or Keep Studio Version.
- Studio must warn before the browser closes while layout work is queued or in flight. Once autosave reports no unsaved layout, closing and reopening must restore the acknowledged state.
- The installable committed Studio build must run without an install or build step in the user's project.

## Non-Goals

- Automatically saving workflow, agent, prompt, or raw JSON edits.
- Automatically running graph layout when Studio opens.
- Adding layout history, undo/redo, multi-user collaboration, feature flags, environment variables, or compatibility modes.
- Changing router execution, workflow semantics, or the world schema.
- Crash-proof recovery after the user forces a browser/process to terminate before an outstanding autosave is acknowledged.
- A cross-process transactional lock for external editors that do not participate in Studio's revision protocol; the revision check is intentionally best-effort across the final filesystem replacement boundary.
