# Agent World Skill Restructure

## Summary

- Relocated the installable Agent World skill (`SKILL.md`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, `eval-agent-world.md`, `mention-routing-rules.md`, `prompts/`, `scripts/`) from the repository root into `skills/agent-world/` via `git mv`, preserving file history as renames.
- This matches the target layout in `agent-world-studio-mvp.md` §8, giving the skill a self-contained installable directory distinct from repository scaffolding (`README.md`, `tests/`, `.docs/`), which future Agent World Studio work depends on.
- Router and eval runner logic is completely untouched — this is a pure move, not a behavior change.
- Updated the `skillRoot` computation in the three test suites (`tests/agent-world-router.test.js`, `tests/agent-world-eval.test.js`, `tests/mention-routing.e2e.test.js`) to point at `skills/agent-world/`, changing exactly one functional line per file.
- Updated `README.md`'s file map, quick-start, and command references to the new `skills/agent-world/...` paths, and added a short repository-layout section distinguishing the installable skill from scaffolding.
- No compatibility shim, symlink, or environment-variable fallback was introduced for the old root-level paths — old installs must re-install, per the REQ's explicit non-goal.

## Verification

- `node --test tests/*.test.js`: 57/57 passing both before and after the move (eval=2, router=30, mention-routing=25) — bare `node --test tests/` was found to fail with `MODULE_NOT_FOUND` on this repo/Node version, so the plan and E2E spec were corrected to the glob form.
- `git diff --cached -M --stat`: all 13 relocated paths reported as renames with 0 content-line diffs; test-file diffs limited to the single `skillRoot` line each (plus later file-comment-block additions).
- Standalone self-containment: copied `skills/agent-world/` alone to a scratch directory outside the repo and ran the router's `help` command and the eval runner against temporary fixture worlds — both completed successfully with no reach-back into the original repository.
- Independent AR (Plan subagent, read-only): first pass found two doc-only defects (a comment-block/diff-count contradiction in Phase 4, and the incorrect `node --test tests/` command); both were fixed in the plan and E2E spec, and a rerun of AR passed with no blocking flaws.
- Independent CR (Plan subagent, read-only) on the staged diff: passed with no major findings.
- Independent VR (Plan subagent, read-only): built the full 8-item acceptance-criteria evidence matrix against the REQ, independently reran tests and the standalone-copy checks; passed with all criteria complete. REQ acceptance-criteria checkboxes updated accordingly.
- E2E spec (`.docs/tests/test-skill-restructure.md`) scenarios executed manually: skill directory contents, root cleanliness, rename detection, standalone router/eval runs, skill-relative reference resolution, and absence of compatibility shims all confirmed.

## Notes

- Changes are staged but not yet committed (`git add -A` was run to stage the rename + edits for review; no commit was made as part of this session unless a separate GC step is run).
- `.docs/` historical requirement/plan/done docs that reference the old root-level paths were left unchanged — they are point-in-time records of past work, explicitly out of scope per the REQ's non-goals ("Reorganizing `tests/`, `.docs/`, or the contents of the skill directory beyond moving it").
- `agent-world-studio-mvp.md` needed no changes; it already described the `skills/agent-world/` target layout this story implements.
- No unrelated or pre-existing test failures were encountered.
