# Agent World Skill Restructure Requirement

## Problem

The repository root *is* the installed Agent World skill. `SKILL.md`, `world.schema.json`, `world.example.json`, `init-agent-world.md`, `eval-agent-world.md`, `mention-routing-rules.md`, `prompts/`, and `scripts/` sit at the top level next to `README.md`, `tests/`, and `.docs/`. Nothing marks where the installable artifact ends and repository scaffolding begins.

Agent World Studio adds development source, a build toolchain, `node_modules`, and generated bundles to this repository. Layered on the current layout, those would sit beside the skill's own files with no boundary between what a user installs and what a contributor builds with, and the generated Studio artifacts would have no defined home.

`agent-world-studio-mvp.md` §8 resolves this by placing the installable skill under `skills/agent-world/` and development source under `src/`. That move must happen before any Studio work lands, and it must not change how the router or eval runner behave.

## Requirement

Relocate the installable Agent World skill into its own directory so it is a self-contained installable unit, distinct from repository scaffolding and from future development source.

Every reference to a relocated file — in documentation, in code, and in tests — must resolve to the new location. The router, the eval runner, and their existing tests must keep their current behavior exactly; this is a move, not a change.

## Acceptance Criteria

- [x] The installable skill directory contains the skill manifest, its reference documents, the canonical schema, the canonical example, the sample prompts, and the router and eval scripts.
- [x] The repository root no longer holds a copy of any relocated file, and `README.md`, `tests/`, and `.docs/` remain at the root.
- [x] The router and eval scripts remain siblings within the skill directory, preserving the sibling resolution the eval runner depends on.
- [x] The existing router, eval, and mention-routing test suites resolve the relocated skill files and pass with the same test count and the same assertions as before the move.
- [x] Every documentation and code reference to a relocated file points at its new path, and no reference resolves to a path that no longer exists.
- [x] References that are already defined as skill-relative continue to resolve correctly without being rewritten to absolute or repository-root paths.
- [x] The skill directory is self-contained: copied on its own to another location, the router and eval runner still load their schema, reference documents, and prompts and still run.
- [x] No compatibility shim, symbolic link, environment-variable override, or fallback path preserves the old repository-root locations.

## Constraints

- The router and eval runner keep their current behavior, command-line surface, file-based handoff protocol, and persisted state format. No source change beyond what relocation itself requires.
- Test files change only where they compute the skill directory. Assertions, fixtures, and expectations stay byte-identical, since unchanged assertions passing is the evidence that behavior is unchanged.
- File history must be preserved through the move rather than recreated as deletions and additions.
- The layout must match `agent-world-studio-mvp.md` §8 so later Studio stories have the directory contract they build against.

## Non-Goals

- Any Studio source, server, client, toolchain, build configuration, or dependency. Those belong to the Studio stories that follow.
- Adding a package manifest, TypeScript configuration, or `node_modules` to the repository.
- Changing router or eval behavior, features, or command surface.
- Reorganizing `tests/`, `.docs/`, or the contents of the skill directory beyond moving it.
- Backward compatibility with the old repository-root layout. Existing installs re-install.
- Release packaging, versioning, or publishing.
