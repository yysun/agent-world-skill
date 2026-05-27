# JSON World Config Plan

## Story

`json-world-config`

## Plan

- [x] Inspect relevant files
- [x] Make focused changes
- [x] Run validation
- [x] Update docs/status

## Implementation Notes

- Replace the router default config path with `.agent-world/world.json`.
- Replace `parseYaml` usage with native `JSON.parse`.
- Remove the homemade YAML parser and parser export.
- Rename the sample config to `world.example.json`.
- Add `world.schema.json` so hosts, clients, editors, and LLM generation flows can validate the config shape.
- Update tests to write JSON config files and separate Markdown prompt files.
- Update SKILL, README, and init docs to require `.agent-world/world.json` plus prompt files.

## E2E Coverage

Existing router subprocess tests are sufficient. This is a CLI/config-format migration, not a browser or user-interface flow.

## Architecture Review

AR passed: no blocking architecture flaws. The strict JSON-only approach matches the requirement and avoids a half-supported compatibility path. Prompt files preserve authoring quality without importing a YAML dependency.
