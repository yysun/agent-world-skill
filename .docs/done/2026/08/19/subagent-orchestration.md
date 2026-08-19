# Subagent Orchestration

## Summary

- Fixed the mention parser: labels now resolve longest-match-first, so `@architect Please design.`
  routes to `architect` while `@Madame Pedagogue` still resolves. Previously any capitalized word
  after a mention swallowed the target and ended the run silently at `idle`.
- A paragraph-start mention naming no agent now returns `blocked` with `unknown_mention_target`
  instead of stalling; a new human message supersedes a run's outstanding routing errors so pending
  lanes resume, which is the recovery path `SKILL.md` already promised but did not deliver.
- Stop-token detection ignores fenced code blocks, so an agent quoting the protocol no longer ends
  the world and returns its own snippet as the final answer.
- `contextScope: "agent"` is now addressee-based and guarantees the latest message from each node in
  a workflow node's `requires`. A fan-in collector previously received only the last contributing
  lane, silently losing the others - harmless while turns were role-played inline, data loss once
  they are real subagents.
- Added the subagent dispatch surface: per-agent `model`, `subagentType`, `tools`, and
  `contextLimit` in `world.json`, surfaced as `dispatch` on `agent_instruction`; opt-in
  `workflow.parallelDispatch` returning `agent_instruction_batch` with dispatched turns tracked so
  they are never dispatched twice.
- Human mentions the workflow entry overrides are now reported as `ignoredMentions` rather than
  discarded silently.
- **Breaking:** the router rejects the legacy `workflow.edges` array dialect and edge-level `join`
  keys. That path synthesized workflow node ids (`collector_join_1`) present in no file, in Studio,
  or in the eval contract, and was already invalid under `world.schema.json`.
- Rewrote `SKILL.md` to dispatch each turn to an independent subagent, and documented that an
  `@mention` enqueues work through the router rather than delivering peer-to-peer.

## Verification

- `npm test` - 166 tests, 166 pass, 0 fail (router, eval, mention E2E, Studio).
- `npm run typecheck` - clean.
- `node skills/agent-world/scripts/agent-world-eval.js --config .agent-world/world.json --eval .agent-world/world.eval.md --out .agent-world/eval-runs` - PASS.
- E2E: all 13 scenarios in `.docs/tests/test-subagent-orchestration.md` executed through the file
  handoff protocol - 32 assertions, 32 pass.
- Ajv-validated a world using every new config key against `world.schema.json` (valid), and
  confirmed the repository world and `world.example.json` still validate.
- Manually re-ran the three original reproductions: the same-line handoff now routes, the fenced
  stop token no longer completes the run, and a blocked fan-out run resumes its pending lane.
- Manually drove a `parallelDispatch` fan-in world: batch of two lanes with distinct handoff paths,
  out-of-order completion reported the remaining lane as awaited, and the collector received both
  lanes' findings.

## Notes

- AR, CR, and VR ran in the primary agent, not an independent subagent: this session's harness
  instructs against spawning subagents unless the user asks. RPD's documented fallback applies, with
  the same checklists and pass criteria.
- One existing test changed expectation rather than being fixed: agent-scope context for a host-action
  round trip now includes the message that routed work to that agent. That is the behavior change in
  acceptance criterion 6, not a weakened assertion - the test was strengthened alongside it.
- `.agent-world/` is gitignored, so the repository world's eval-contract update to the same-line
  handoff form is local-only. The equivalent change to the skill's own example in
  `eval-agent-world.md` is committed.
- Deliberately out of scope, all recorded as REQ non-goals: a slash command for explicit skill
  activation, whether dispatched subagents may use tools instead of the `agent-world-host-action`
  protocol, restricting stop-token completion to terminal nodes, the documented
  completion-tag-precedes-host-action ordering, and collapsing the four overlapping entry
  declarations.
