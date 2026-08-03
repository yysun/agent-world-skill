# Agent World Skill Restructure Plan

## Goal

Move the installable Agent World skill from the repository root into `skills/agent-world/` so it is a self-contained installable unit, with every reference resolving to the new location and the router, eval runner, and existing test suites behaving exactly as before.

## Current Context

- Root currently holds both skill and scaffolding: `SKILL.md`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, `eval-agent-world.md`, `mention-routing-rules.md`, `prompts/`, `scripts/`, plus `README.md`, `tests/`, `.docs/`, `.gitignore`, and `agent-world-studio-mvp.md`.
- `scripts/agent-world-router.js` (1238 lines) and `scripts/agent-world-eval.js` (513 lines) are CommonJS. `scripts/agent-world-eval.js:21` resolves the router with `path.join(__dirname, 'agent-world-router.js')`, so the two must stay siblings.
- The router has no `__dirname`-based reference to the schema or reference documents; it validates graph references in code and takes its world path from `.agent-world/world.json` or `AGENT_WORLD_CONFIG`. Nothing inside the scripts hard-codes a repository-root path.
- All three suites compute `const skillRoot = path.resolve(__dirname, '..')`: `tests/agent-world-router.test.js:20`, `tests/agent-world-eval.test.js:17`, `tests/mention-routing.e2e.test.js:16`. From it they join `scripts/agent-world-router.js`, `scripts/agent-world-eval.js`, `world.schema.json` (`:322`), `init-agent-world.md` (`:351`), and `world.example.json` (`:369`). This is the only code-level breakage the move causes.
- `SKILL.md` already defines `ROUTER`, `EVAL_REF`, and `world.schema.json` as **skill-relative** — "Resolve … against the directory containing this `SKILL.md`." Those references survive the move untouched and must not be rewritten.
- `README.md` describes paths from the repository root (`scripts/agent-world-router.js`, `world.schema.json`, `prompts/`, `tests/…`) and does not survive the move.
- `init-agent-world.md` and `eval-agent-world.md` reference sibling skill files; because they move together, their relative references stay valid.
- `world.example.json` references `prompts/*.md` as world-config `promptPath` values resolved against a project's `.agent-world/`, not against the skill root — these are project-relative and unaffected.
- Node 22.22.0, npm 11.13.0. Tests run as `node --test` with no package manifest.
- Known unknown to close in Phase 1: the exact baseline test count per suite, captured before the move so the after-count is a real comparison rather than an assertion that it "still passes".

## Decisions

- Target layout is `agent-world-studio-mvp.md` §8 exactly: `skills/agent-world/` receives `SKILL.md`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, `eval-agent-world.md`, `mention-routing-rules.md`, `prompts/`, and `scripts/`. `README.md`, `tests/`, `.docs/`, `.gitignore`, and `agent-world-studio-mvp.md` stay at the root.
- Use `git mv` so history follows each file. Rejected: delete-and-recreate, which loses blame on a 1238-line router for no benefit.
- **Test files change exactly one functional line each** — the `skillRoot` expression. Every assertion, fixture, and expectation stays byte-identical. Unchanged assertions passing at the same count is the entire proof that this move changed no behavior; editing a test to make it pass would destroy that proof. The Phase 3 `git diff tests/` check verifies this one-line change immediately, before Phase 4 adds the file comment block update each suite requires under the RPD file-comment-block convention; that later comment-only edit is expected and does not reopen the one-line proof already captured in Phase 3.
- **Skill-relative references in `SKILL.md` are left alone.** They already resolve against the manifest's own directory, which is the property that makes the skill relocatable. Rewriting them to repository-root paths would break the skill exactly when it is installed elsewhere.
- **Self-containment is verified by copying the skill directory somewhere else and running it there**, not by inspection. A missing sibling only shows up when the surrounding repository is gone.
- Clean cut, no compatibility surface. Rejected: root shims, symlinks back to the old paths, and an `AGENT_WORLD_SKILL_ROOT` override. Each would preserve a second supported layout forever to spare a one-time re-install, and the REQ names it a non-goal.
- This story is committed on its own so it can be reverted independently of any Studio work.
- **No E2E spec beyond the relocation contract.** This story changes no runtime behavior and adds no API. The consumer contract it *does* change is skill installability, so `.docs/tests/test-skill-restructure.md` covers exactly that and nothing else.

## Phased Tasks

### Phase 1 - Baseline capture

- [x] Run `node --test tests/*.test.js` and record the exact per-suite and total pass counts as the pre-move baseline (bare `node --test tests/` fails with `MODULE_NOT_FOUND` on this repo, since `node --test` requires an explicit file glob rather than a directory here). Baseline: eval=2, router=30, mention-routing=25, total=57, all passing.
- [x] Record the complete inventory of root entries, classifying each as skill content, repository scaffolding, or generated/ignored, so nothing is moved or left behind by accident. Skill content: `SKILL.md`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, `eval-agent-world.md`, `mention-routing-rules.md`, `prompts/`, `scripts/`. Scaffolding: `README.md`, `tests/`, `.docs/`, `.gitignore`, `agent-world-studio-mvp.md`. Generated/ignored: `.agent-world/`, `.claude/`.
- [x] Grep the repository for `scripts/agent-world`, `world.schema.json`, `init-agent-world.md`, `eval-agent-world.md`, `mention-routing-rules.md`, `world.example.json`, and `prompts/`, and classify each hit as skill-relative (leave alone), repository-root-relative (must update), or project-relative (unaffected). Root-relative hits: README.md lines 10, 32-40, 51, 196 (updated in Phase 3). Skill-relative: SKILL.md's `ROUTER`/`EVAL_REF` definitions and README's own "skill-relative" prose (left unchanged). Project-relative: `.agent-world/prompts/*`, `.agent-world/world.eval.md` references (unaffected).
- [x] Confirm `scripts/agent-world-eval.js:21` is the only cross-script path dependency inside `scripts/`, so sibling placement is the only structural constraint the move must honor. Confirmed via grep for `__dirname` in both scripts.

### Phase 2 - Move

- [x] Create `skills/agent-world/` and `git mv` `SKILL.md`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, `eval-agent-world.md`, and `mention-routing-rules.md` into it.
- [x] `git mv` `prompts/` and `scripts/` into `skills/agent-world/`, keeping `agent-world-router.js` and `agent-world-eval.js` as siblings.
- [x] Run `git status` and confirm every moved path is staged as a rename rather than as a delete plus an add. Confirmed: all 13 paths reported as "renamed".
- [x] Confirm `README.md`, `tests/`, `.docs/`, `.gitignore`, and `agent-world-studio-mvp.md` remain at the repository root. Confirmed via `ls`.

### Phase 3 - Reference updates

- [x] Change `skillRoot` in `tests/agent-world-router.test.js:20` to `path.resolve(__dirname, '..', 'skills', 'agent-world')`, changing nothing else in the file.
- [x] Apply the same single-line change to `tests/agent-world-eval.test.js:17` and `tests/mention-routing.e2e.test.js:16`.
- [x] Run `git diff tests/` and confirm exactly three changed lines across the three suites. Confirmed before Phase 4 comment-block updates.
- [x] Update the file-map, command, and quick-start sections of `README.md` so every relocated path names its `skills/agent-world/...` location.
- [x] Re-run the Phase 1 grep and confirm every repository-root-relative hit now resolves, every skill-relative hit is unchanged, and no hit points at a path that no longer exists. Confirmed: README.md fully updated; `agent-world-studio-mvp.md` already referenced the target layout; `.docs/` historical docs are out of scope per REQ Non-Goals.

### Phase 4 - Verification

- [x] Run `node --test tests/*.test.js` and confirm the pass counts match the Phase 1 baseline exactly. Result: eval=2, router=30, mention-routing=25, total=57, all passing — matches baseline.
- [x] Copy `skills/agent-world/` alone to a temporary directory, run the router's `help` command from that copy, and confirm it resolves without reaching back into the repository. Ran from a standalone scratch copy with its own `.agent-world/world.json`; exited 0 with no reference to the original repo path.
- [x] From that same standalone copy, run the eval runner against a temporary project world and confirm it loads the router, the schema, and its prompts. Ran against a temporary fixture world; result: `Agent World eval PASS`, report written under the temp project's `.agent-world/eval-runs/`.
- [x] Confirm no symlink, shim file, or wrapper script was left at the repository root, and that `git status` shows no untracked leftovers from the move. Confirmed: no symlinks (`find . -maxdepth 1 -type l` empty); `git status` shows only the expected renames and edits.
- [x] Add file comment blocks to the three modified test suites recording that `skillRoot` now resolves into `skills/agent-world/`.

### Phase 5 - Documentation

- [x] Update `README.md` with a short repository-layout section distinguishing the installable skill directory from repository scaffolding, so the boundary the Studio stories rely on is documented.
- [x] Record final evidence for each REQ acceptance criterion, citing the baseline-versus-after test counts, the grep result, and the standalone-copy run. See VR evidence matrix.
- [x] Mark completed tasks complete only after the corresponding change or evidence exists.

## Validation

| Check | Command | Expected evidence |
| --- | --- | --- |
| Baseline captured | `node --test tests/*.test.js` before the move | Per-suite and total pass counts recorded |
| Behavior unchanged | `node --test tests/*.test.js` after the move | Counts identical to the baseline; no assertion edited |
| Minimal test delta | `git diff tests/` run at the end of Phase 3, before Phase 4 comment-block updates | Exactly three changed lines, one per suite, all the `skillRoot` expression |
| Move preserved history | `git status` / `git diff --cached -M --stat` | Every moved path reported as a rename |
| Root is clean | `ls` at the repository root | No relocated file remains; `README.md`, `tests/`, `.docs/`, `.gitignore`, `agent-world-studio-mvp.md` present |
| Skill is self-contained | `cp -R skills/agent-world <tmp> && node <tmp>/scripts/agent-world-router.js help` | Router runs from the standalone copy |
| Eval is self-contained | Eval runner invoked from the standalone copy against a temporary world | Loads router, schema, and prompts and completes |
| References resolve | Phase 1 grep re-run | No hit resolves to a path that no longer exists |
| No compatibility surface | Inspection of the repository root | No shim, symlink, wrapper, or environment-variable fallback |

## Rollback / Risk

- **Installed-skill breakage is the accepted cost.** Anyone with the old root layout installed must re-install. This is deliberate: the REQ names a compatibility shim a non-goal, and `agent-world-studio-mvp.md` §8 fixes the target layout. There is no partial-migration mode.
- **A path reference could be missed.** Documentation references fail silently — nothing errors, the reader just follows a dead path. Mitigated by classifying every hit in Phase 1 and re-running the identical grep in Phase 3, so the check is a comparison rather than a fresh judgment call.
- **A test could be "fixed" rather than repointed.** Editing an assertion to make a suite pass would erase the only evidence that behavior is unchanged. Mitigated by the `git diff tests/` gate asserting exactly three changed lines.
- **Rename detection can degrade** if a move is staged as delete-plus-add, losing history on the router. Mitigated by the Phase 2 `git status` check immediately after the move, while it is still trivial to redo.
- **Hidden coupling to the repository root** would not surface inside the repository, where the files happen to be reachable anyway. Mitigated by running the standalone copy outside the repository in Phase 4.
- Rollback is a single `git revert` of this commit; the story is committed alone precisely so that is true, and it carries no dependencies, generated artifacts, or migrations.
