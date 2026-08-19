# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Subagent dispatch contract: `agent_instruction` now carries `dispatch` (`model`, `subagentType`,
  `tools`, `contextLimit`) and `SKILL.md` directs the host to run each turn in an independent
  subagent instead of role-playing it inline.
- Opt-in parallel dispatch via `workflow.parallelDispatch`, returning an `agent_instruction_batch`
  of every independent pending turn, with dispatched turns reported as `awaitingTurns` rather than
  offered twice.
- Per-agent `contextLimit` overriding the default context budget of 18 messages.
- `unknown_mention_target` routing block for a paragraph-start mention that names no agent.
- `ignoredMentions` on `agent_instruction`, reporting human mentions the workflow entry overrode.

### Fixed

- A handoff such as `@architect Please design the app.` no longer fails to resolve. Mention labels
  now resolve longest-match-first, so two-word display names still work while a capitalized word
  after the mention no longer swallows the target. Previously this ended the run silently at `idle`.
- A blocked run can now be recovered: a new human message supersedes the run's outstanding routing
  errors so still-pending lanes resume, instead of the run staying blocked until `reset`.
- A stop token inside a fenced code block no longer completes the run.
- `contextScope: "agent"` is now addressee-based and guarantees the latest message from each node in
  a workflow node's `requires`, so a fan-in agent no longer silently loses a lane's report.

### Changed

- **Breaking:** the router rejects the legacy `workflow.edges` array dialect and edge-level `join`
  keys, and requires `workflow.nodes`. These were already invalid under `world.schema.json` and made
  the router synthesize workflow node ids that appeared in no file. Use object-form edges and
  node-level `requires`.

- Agent World Studio workflow editor: a visual "Design surface" for building and inspecting agent workflows.
- Studio server for running Agent World Studio locally.
- Agent World eval runner for testing agent workflows.
- Per-agent context scopes, allowing agents to be given scoped rather than global context.
- File-based agent handoff mechanism, using timestamped `.agent-world` files to pass state between agents.
- JSON-based world configuration (`agent-world.json`) replacing the earlier YAML-based setup.
- End-to-end tests covering mention routing rules.
- RPD (requirements/planning/design) docs for the Studio workflow.
- Run management and error handling in `agent-world-router`.
- Mention normalization and routing enhancements in `agent-world-router`.
- Configuration validation and new result types in `agent-world-router`.

### Changed

- Agent World Studio now restores layout automatically and autosaves only after canvas edits, independently of manual workflow saves, with atomic revision-checked writes and resource-scoped conflict recovery.
- Restructured the skills directory layout.
- Updated file structure for agent handoffs and improved workflow validation.
- Embedded the `init-agent-world` process directly into `SKILL.md`.
- Clarified routing instructions, path resolutions, world-recreate behavior, and canonical world schema requirements in `SKILL.md`.
- Kept the world schema definition skill-relative rather than absolute.
- Enhanced `README.md` with setup instructions for `agent-world.yaml` and workflow patterns.

### Removed

- Standalone messaging patterns file, folded into the main setup documentation.
