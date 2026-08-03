# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- Restructured the skills directory layout.
- Updated file structure for agent handoffs and improved workflow validation.
- Embedded the `init-agent-world` process directly into `SKILL.md`.
- Clarified routing instructions, path resolutions, world-recreate behavior, and canonical world schema requirements in `SKILL.md`.
- Kept the world schema definition skill-relative rather than absolute.
- Enhanced `README.md` with setup instructions for `agent-world.yaml` and workflow patterns.

### Removed

- Standalone messaging patterns file, folded into the main setup documentation.


