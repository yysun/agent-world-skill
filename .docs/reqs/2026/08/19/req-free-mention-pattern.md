# Requirement: Free-Mention Workflow Pattern

## Problem

`world.json` exposes `workflow.enforceEdges` as a boolean that appears to select between two
routing modes: DAG-enforced routing and free mention-based routing where agents choose their own
recipients. Only the enforced mode is implemented. Setting `enforceEdges: false` produces a world
that loads, validates, and runs, but cannot route:

1. **The agent is told it has nowhere to go.** `workflowHints` reads `workflow.edges` without
   consulting `enforceEdges` (`skills/agent-world/scripts/agent-world-router.js:896`). A world that
   omits edges because it does not use them renders `Allowed next workflow nodes:` as `(none)` into
   every turn prompt, instructing the model not to hand off at all.
2. **Unenforced routing loses the workflow node.** The unenforced branch calls
   `queueTurn(state, target, msg.id, 'agent_mention')` with no node id
   (`agent-world-router.js:806`), so the turn carries `workflowNode: null`. The node's `instruction`
   never reaches the prompt, and the resulting message metadata has no `workflowNode`, so every
   later hop sees `currentNode` as null.
3. **A misspelled mention silently ends the run.** The `unknown_mention_target` block is nested
   inside `if (state.workflow.enforceEdges && currentNode)` (`agent-world-router.js:759`). With
   enforcement off, `@architekt` resolves to nothing, the mention list is empty, the unenforced loop
   iterates zero targets, and the run stalls at `idle` with no error. This is the exact silent
   stall that was fixed for enforced worlds.
4. **Auto-reply is unguarded.** `autoReplyMentionTarget` returns the source message's sender
   unconditionally when enforcement is off (`agent-world-router.js:687`), so two agents can
   ping-pong until `world.turnLimit`, which becomes the only termination guarantee.
5. **The flag can silently invalidate its own pattern's contract.** `workflow.type` and
   `enforceEdges` are independent fields, so `{"type": "sequential-pipeline", "enforceEdges": false}`
   is schema-valid. `init-agent-world.md` will generate that world an eval contract asserting
   *"Each step routes to next; skipping blocks"*, an assertion that can never pass. One field
   quietly negates another field's contract with no error.

Enforcement is not an independent axis. The nine canonical patterns *are* their edges: a pipeline
with unenforced edges is not a pipeline. Free mention routing is a different pattern, not a
modifier on the existing ones, and it needs its own prompt shape, its own guardrails, and its own
eval contract.

## Requirement

Free mention routing must become a first-class workflow pattern that works end to end, and edge
enforcement must be derived from the selected pattern instead of configured beside it.

Specifically:

- A new canonical pattern id, `free-mention`, must be selectable at init alongside the existing
  patterns and accepted by `world.schema.json`.
- In a `free-mention` world, an agent's paragraph-start mention of any other agent in the world
  must route to that agent's workflow node, without an edge check.
- A turn routed by free mention must carry the target's workflow node, so the node `instruction`
  reaches the prompt and the next hop has a current node.
- In a `free-mention` world, the turn prompt's allowed-next list must name the agents the turn may
  actually mention, rather than reading an edge list the pattern does not use.
- An unresolved paragraph-start mention must produce an `unknown_mention_target` block in a
  `free-mention` world, not a silent stall.
- Each `free-mention` configuration shape that could cause a resolved mention to produce neither a turn
  nor a block must be rejected at load time. The shapes are enumerated in the acceptance criteria below
  rather than left as an open-ended property. Suppressing a duplicate of a turn that is already pending
  is not such a case, because the earlier turn is still dispatchable.
- An unresolved paragraph-start mention must block even when an auto-reply target is available.
  Today `autoReplyMentionTarget` runs before the unresolved-mention check and silently substitutes the
  previous sender. In a `free-mention` world every peer is reachable, so without this correction the
  block would almost never fire. `mention-routing-rules.md` is ambiguous on this point rather than
  contradictory, so this is authorized as an explicit exception below rather than as doc conformance.
- In a `free-mention` world, a human paragraph-start mention naming an agent in the world must
  route to that agent rather than being overridden by the workflow entry.
- A `free-mention` world must declare no workflow graph at all: no edges, no node prerequisites, and
  no agent lacking a workflow node. Each of these must be rejected at load time rather than producing
  a turn that is silently never queued.
- Edge enforcement must be determined by `workflow.type`: off for `free-mention`, on for every
  other pattern id. An explicit `workflow.enforceEdges` that contradicts the pattern must be
  rejected as a configuration error rather than silently applied.
- `free-mention` must have its own deterministic eval minimums, since it cannot test "off-edge
  mention blocks".

## Acceptance Criteria

- [x] `world.schema.json` accepts `free-mention` as a `workflow.type` value.
- [x] The config object returned by the router's `loadConfig` carries `workflow.enforceEdges === false`
      for a `free-mention` world and `true` for every other canonical pattern id, regardless of whether
      `enforceEdges` is absent from the file or present with the matching value.
- [x] Loading a world whose explicit `enforceEdges` contradicts the enforcement implied by its
      `workflow.type` fails with a configuration error naming both fields.
- [x] Loading a world whose `workflow.type` is absent or is not a canonical pattern id fails with a
      configuration error naming `workflow.type`, so enforcement is never derived from an unvalidated
      default.
- [x] In a `free-mention` world, an agent message whose paragraph-start mention names another agent
      in the world produces an `agent_instruction` for that agent whose `workflow` node is the
      mentioned agent's node, with no edge declared between them.
- [x] The `hostInstruction` for a `free-mention` turn lists the other agents in the world as the
      allowed mention targets, and the routed turn's node `instruction` appears in it.
- [x] In a `free-mention` world, an agent message whose only paragraph-start mentions match no agent
      returns `blocked` with code `unknown_mention_target`. A message that also carries a mention which
      does resolve routes normally and drops the unresolved token, unchanged from today.
- [x] The same block is returned when the completing agent's own turn was routed from another agent's
      message, so an available auto-reply target does not swallow the unresolved mention.
- [x] In a `free-mention` world the same block is returned regardless of whether the completing turn
      carries a workflow node, so no unresolved mention can reach `idle` by any path. In an enforced
      world a terminal node with no outgoing edges still returns `idle` for an unresolved mention,
      exactly as it does today.
- [x] In a `free-mention` world, a human message with a paragraph-start mention naming an agent in
      the world routes to that agent's node rather than to the workflow entry.
- [x] Loading a `free-mention` world whose workflow node declares `requires` fails with a
      configuration error naming that node, so a prerequisite can never silently hold a turn in a
      pattern that has no edges to order it.
- [x] Loading a `free-mention` world whose `workflow.edges` contains any key at all - including a
      `human` key and including keys mapped to empty arrays - fails with a configuration error naming
      the offending source. `edges` must be exactly `{}`.
- [x] Loading a `free-mention` world containing an agent that no workflow node references, an agent
      referenced by more than one node, or fewer than two agents, fails with a configuration error
      naming the offending agent or the pattern, so every resolvable mention maps to exactly one node
      and every agent has at least one reachable peer.
- [x] A `blocked` result carrying unresolved mention tokens reports them to the host in an
      `unresolvedMentions` field, as `SKILL.md` already specifies.
- [x] `requestedBy` on a host action is the emitting agent, not a value the agent's own block can
      name. Honoring an agent-supplied peer paired the host result with the acting turn's workflow
      node, so the resumed turn's agent and node disagreed - breaking the agent-to-node identity that
      free-mention routing depends on. Found during review of this change; it applies to every
      pattern because the defect does.
- [x] Loading a `free-mention` world whose declared `world.turnLimit` is not a positive integer fails
      with a configuration error naming `world.turnLimit`. `turnLimitReached` treats a malformed value
      as "no limit", which would disable the pattern's only structural stop. Omitting the field keeps
      the existing default.
- [x] A `free-mention` run that exchanges messages without reaching a stop token terminates at
      `world.turnLimit` with code `turn_limit_reached`.
- [x] The existing canonical patterns - the nine enforced defaults and `custom-dag` - route, block,
      and complete exactly as they did before this change. Evidence: every existing router, eval,
      mention-routing, and studio test passes. Existing tests may be modified only where this story
      deliberately changes the behavior they assert: the deleted unenforced-fallback case, the
      auto-reply ordering correction, the generation-policy test that machine-checks the fenced
      context-scope-defaults block against a fixed pattern set, and the shared mention-routing e2e
      fixture, which no longer needs an `enforceEdges` option now that the case using it is gone. A new test must prove an enforced world
      still routes a turn carrying a null workflow node.
- [x] `init-agent-world.md` presents `free-mention` as a default init option, its stated minimum
      option count matches the number of canonical default patterns it lists, and it specifies the
      pattern's agents, context scopes, turn limit guidance, and prompt guidance directing each agent
      to either hand off to exactly one peer or end with the stop token, never both in one message,
      and to address the user by ending with the stop token rather than mentioning a non-agent such as
      `@human`.
- [x] `eval-agent-world.md` and `init-agent-world.md` both list deterministic eval minimums for
      `free-mention` that name concrete behaviors in the style of the existing rows - routing to a peer
      with no edge, an unresolved mention blocking, and the turn limit bounding a non-terminating
      exchange - and that assert no off-edge blocking.
- [x] A generated `free-mention` world passes `world.schema.json` validation and its own generated
      `world.eval.md` under `agent-world-eval.js`.
- [x] `README.md` and `CHANGELOG.md` describe the `free-mention` pattern and the type-derived
      enforcement rule, including the rejected contradictory-config case.

## Constraints

- Existing coherent worlds must keep loading. A world that sets `enforceEdges: true` alongside any
  of the nine enforced pattern ids, or omits the field entirely, must be unaffected.
- `workflow.nodes` stays required for `free-mention`; nodes carry each agent's instruction even
  when no edges connect them, and `workflow.edges` is still present as an empty object because the
  schema requires the key. Node `requires` has no meaning without edges to order and must not be
  silently ignored.
- The change is confined to the router's configuration and routing layers, the deterministic eval
  script where it duplicates configuration validation the router now owns, and the skill's
  reference documents. Two correctness fixes found during review of this change are in scope beyond
  that line and are recorded as acceptance criteria above: the `requestedBy` host-action fix, which
  necessarily applies to every pattern because the defect does, and the `free-mention`
  `world.turnLimit` guard. Studio validates through the router's own rules, so it must surface the new
  configuration error without Studio-specific code.
- Deterministic eval must stay model-free; every new eval case uses mocked completions.
- `free-mention` worlds have no graph constraint, so `world.turnLimit` is the only structural
  termination guarantee and generated worlds must set it conservatively.

## Non-Goals

- Removing `workflow.enforceEdges` from the schema. It stays as an optional, verified-consistent
  field rather than becoming a breaking removal for existing worlds.
- Changing the routing, blocking, or prompt behavior of the enforced patterns, including the
  human-mention override that applies to them. Two deliberate exceptions are in scope and recorded as
  breaking: the auto-reply ordering correction above, and rejecting a world whose `workflow.type` is
  absent or is not a canonical pattern id.
- A Studio canvas affordance for edge-less worlds, pattern selection UI, or any Studio client
  change.
- Making `custom-dag` unenforced, or adding any further pattern ids.
- Run observation, history, or replay surfaces.
