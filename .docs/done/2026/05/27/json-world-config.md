# JSON World Config Done

## Summary

- Replaced YAML world loading with strict native JSON loading from `.agent-world/world.json`.
- Removed the router's homemade YAML parser and parser export.
- Made prompt files mandatory through `promptPath`, with explicit config errors for missing or unreadable prompts.
- Replaced the YAML sample with `world.example.json` and reusable Markdown prompt files.
- Added skill-relative `world.schema.json` for host/client/editor validation.
- Clarified recreate semantics: rewrite the generated config/prompt bundle and clean `.agent-world/prompts/` before regenerating prompts.
- Clarified schema semantics: validate against the skill schema and generate keyed objects for agents, nodes, and edges.
- Updated host instructions, init guidance, README, unit tests, and e2e tests to use JSON config plus prompt files.

## Verification

- `node --test tests/agent-world-router.test.js tests/mention-routing.e2e.test.js` passed: 49/49.
- `node -e "JSON.parse(require('fs').readFileSync('world.schema.json','utf8')); JSON.parse(require('fs').readFileSync('world.example.json','utf8'));"` passed.
- `node scripts/agent-world-router.js reset --config world.example.json` passed and loaded the sample prompt paths.
- `git diff --check` passed.
- Stale-reference checks for YAML parser/config wording returned no matches.

## Notes

- No `js-yaml` or npm dependency was added.
- No YAML compatibility path remains.
