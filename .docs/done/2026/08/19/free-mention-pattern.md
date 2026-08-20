# Free-Mention Workflow Pattern

## Summary

- `workflow.enforceEdges: false` was a trap, not a mode: a world set that way loaded and validated
  but could not route. The prompt rendered `Allowed next workflow nodes: (none)`, unenforced turns
  carried no workflow node, a misspelled mention stalled the run at `idle`, and
  `{"type": "sequential-pipeline", "enforceEdges": false}` silently negated the pattern's own eval
  contract. Free mention routing is now a first-class pattern instead.
- Added `free-mention` as a tenth default init pattern: no workflow graph at all, any agent hands off
  to any peer by paragraph-start mention, the routed turn still carries the target's workflow node,
  and `world.turnLimit` is the only structural stop.
- Edge enforcement is now derived from `workflow.type` rather than configured beside it.
  `enforceEdges` stays optional but may only be stated when it matches; a contradiction, and a
  `workflow.type` that is absent or non-canonical, are configuration errors.
- A `free-mention` world must declare no edges, no node `requires`, exactly one node per agent, at
  least two agents, and a positive `world.turnLimit`. Each rule closes a shape where a resolved
  mention would have queued no turn and reported no block.
- `allowedNextNodes` became the single source for mention resolution, block payloads, and the prompt's
  allowed-next list, replacing three independent reads of `workflow.edges`.
- Two defects found while reviewing this change are fixed here because the free-mention design
  depends on them: an unresolved mention is now checked before the router's auto-reply step instead of
  being silently replaced by a reply to the previous sender, and `requestedBy` on a host action is
  always the emitting agent — an agent-supplied peer name had paired the host result with the acting
  turn's node, so the resumed turn's agent and node disagreed.
- `blocked` results now carry `unresolvedMentions`, which the router already stored and `SKILL.md`
  already promised.

## Verification

- `npm test` — 197 tests, 197 pass, 0 fail. `npm run typecheck` (`tsc --noEmit`) — clean. `git status`
  confirms the committed build artifacts (`agent-world-studio.js`, `studio/dist/*`) were not rewritten.
- Generated a `free-mention` world by following `init-agent-world.md` rule 15 into a scratch
  directory, validated it against `world.schema.json` with `ajv/dist/2020` (`valid`), then ran
  `agent-world-eval.js` against it and its generated `world.eval.md`: **PASS**, with all four routing
  cases green — peer routing with no edge, unresolved mention blocks, stop token completes, and the
  turn limit bounds a non-terminating exchange. The turn-limit case needed 8 chained `given` steps at
  `turnLimit: 8`; a first attempt with 8 completions failed because the block fires on the eighth, not
  after it.
- Every scenario in `.docs/tests/test-free-mention-pattern.md` is discharged by an automated test;
  none is manual-only. Two are partially automated: the "writes no result file" clause is proven for
  the contradictory-enforcement case through the `file` handoff path but asserted only as a non-zero
  exit for the other rejections, and the free-mention world that declares `enforceEdges: false`
  explicitly is asserted through `loadConfig` without also routing a turn.
- The schema/router drift test was checked against induced drift in both directions — removing
  `free-mention` from the schema enum, and adding a router-only id — and fails in each case.
- Independent review: AR ran 8 rounds before passing, CR 4 rounds, VR 2 rounds, each in a read-only
  subagent that did not author the artifacts under review.

## Notes

- Two existing tests were deliberately replaced, plus one fixture edit: the
  `enforceEdges: false` fallback case, the generation-policy test that machine-checks the
  context-scope-defaults block against a fixed pattern set, and the shared mention-routing e2e fixture
  that no longer needs an `enforceEdges` option.
- Breaking for existing worlds: a world pairing `enforceEdges: false` with an enforced pattern, or
  omitting `workflow.type`, now fails to load rather than running degraded. The error names the field
  and the required value, so the fix is mechanical.
- Some message shapes still end at `idle` rather than blocking, all enumerated in
  `mention-routing-rules.md`: a reply with no mention and no stop token from an agent with no
  auto-reply target, a self-mention-only message, a `<world>TO:...</world>` naming only unresolvable
  targets, and an edge-enforced turn carrying no workflow node. Generated free-mention prompts steer
  around the first by requiring the stop token.
- Studio can author unsavable `free-mention` worlds: adding an agent leaves it without a node, and
  disconnecting an edge leaves `edges[source] = []`, both of which the server now rejects with no
  in-canvas route back. Accepted — Studio client work was an explicit non-goal.
- Not committed. `.agent-world/` is gitignored, so `world.example.json` is the only committed world;
  its `enforceEdges` line was removed to match the new generation guidance.
