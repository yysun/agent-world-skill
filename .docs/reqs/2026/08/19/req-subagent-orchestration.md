# Requirement: Deterministic Subagent Orchestration

## Problem

The Agent World skill is meant to provide deterministic subagent orchestration where agents
communicate by `@mention` and the workflow is defined in `.agent-world/world.json`. Five gaps
block that today:

1. **Handoffs are silently dropped.** `extractMentionLabelFromLine` greedily consumes a second
   TitleCase word (a rule that exists for display names such as `@Madame Pedagogue`). A normal
   handoff like `@architect Please design the app.` resolves to the label `architect Please`,
   matches no agent, routes nowhere, and produces no block. The run ends at `idle` and the user
   receives nothing with no error.
2. **A blocked run cannot be recovered.** Pending routing errors are never cleared, and a new
   human message does not start a fresh run while sibling turns are still pending, so a fan-out
   run that hits one off-edge mention is permanently stuck behind `blocked` and starves the
   still-pending lanes. `SKILL.md` promises recovery on a new top-level request; that promise
   does not hold.
3. **A stop token inside a fenced code block ends the run.** An agent quoting the protocol
   terminates the whole world and its quoted snippet becomes the user's final answer.
4. **There are no subagents.** `SKILL.md` instructs the host model to role-play every agent turn
   inline, so `contextScope` isolation is not enforced at generation time, and mention-based
   communication between agents is simulated rather than orchestrated.
5. **Parts of the graph are not defined in `world.json`.** The router accepts a second,
   schema-invalid config dialect (`workflow.edges` as an array of `{from,to,join}` objects) and
   synthesizes workflow node ids at load time that appear in no file, in Studio, or in the eval
   contract.

Additionally, `contextScope: "agent"` selects context by message *author*, so an agent at a
fan-in node can be handed only the last contributing lane's message. Today the host model has
already read the missing message in its own context and papers over the loss; a real subagent
has no other memory, so the same defect becomes silent data loss.

## Requirement

The router must route every documented handoff form correctly, refuse to fail silently, recover
from a block, and expose enough information in `world.json` and in the `agent_instruction`
payload for a host to dispatch each turn to an independent subagent that communicates only by
`@mention`.

Specifically:

- A paragraph-start mention of a known agent must resolve regardless of the capitalization of the
  word that follows it, while multi-word display-name mentions continue to resolve.
- A handoff that names no known agent must surface as a `blocked` result, never as a silent stall.
- A new human message must clear a run's outstanding routing errors so pending work resumes.
- Stop-token detection must ignore fenced code blocks.
- A human mention that workflow edges do not permit must be reported to the host rather than
  silently replaced by the entry node.
- `contextScope: "agent"` must deliver every message addressed to that agent and, for a node with
  `requires`, the latest message from each required node.
- `world.json` must be able to express per-agent subagent dispatch settings, and the router must
  surface them on the instruction.
- `world.json` must be able to request parallel dispatch of independent pending turns, and the
  router must return them together when it does.
- The router must reject config shapes that `world.schema.json` rejects, so the graph the router
  runs is the graph the file declares.
- `SKILL.md` must direct the host to dispatch each turn to an independent subagent and to treat a
  mention as a routing directive to the router rather than as peer-to-peer delivery.

## Acceptance Criteria

- [x] A paragraph-start handoff whose mention is followed by a capitalized word routes to the
      mentioned agent, and multi-word display-name mentions still resolve to their agent.
- [x] An agent message at a node with outgoing edges that contains a paragraph-start `@token`
      matching no agent, and no other resolved mention, host action, or completion tag, returns
      `type: "blocked"` with a distinct machine-readable code for an unknown mention target.
- [x] After a run is blocked, a new human message supersedes the outstanding routing errors and
      the router returns pending work instead of the same block.
- [x] A stop token appearing only inside a fenced code block does not complete the run; a stop
      token in ordinary prose still does, and the recorded final content is unchanged.
- [x] When a human's paragraph-start mention names a known agent that workflow edges do not allow
      as a human entry target, the returned instruction reports the overridden mentions in a
      dedicated field.
- [x] An agent whose `contextScope` is `agent` receives the routed-from message and the latest
      message from each node listed in its workflow node's `requires` unconditionally, plus, up to
      its context limit, every current-run message whose paragraph-start mentions resolve to it and
      the agent's own messages.
- [x] `world.schema.json` accepts per-agent subagent dispatch settings, the router surfaces the
      configured values on `agent_instruction`, and a per-agent context limit overrides the
      default when set.
- [x] When `world.json` enables parallel dispatch and more than one independent turn is pending,
      the router returns a batch result carrying a complete instruction payload for each pending
      turn; with the setting absent or disabled the router returns a single instruction.
- [x] A turn already returned inside a batch is not offered again for dispatch while it remains
      pending, and when every pending turn has been dispatched the router reports that it is
      awaiting those completions rather than re-offering them.
- [x] The router fails with a clear configuration error on a `workflow.edges` array or a
      `join` key rather than synthesizing workflow nodes, and no generated workflow node id is
      absent from `world.json`.
- [x] `SKILL.md` instructs the host to dispatch each `agent_instruction` to an independent
      subagent using the payload's system prompt and context, states that a mention enqueues work
      through the router rather than delivering peer-to-peer, and documents the batch result and
      the router error case where no result file is written.
- [x] The repository test suite covers the same-line capitalized handoff, the multi-word display
      name, the unknown mention target, block recovery, fenced stop tokens, addressee-based context
      at a `requires` node, parallel dispatch on and off, dispatch passthrough, per-agent context
      limit, and the rejected legacy dialect, and the full suite passes.
- [x] The deterministic eval contract for the repository world exercises at least one handoff in the
      same-line `@agent Capitalized` form, and the deterministic eval reports PASS.

## Constraints

- The router is a dependency-free CommonJS script run with plain `node`; it must stay that way.
- `world.schema.json` uses `additionalProperties: false`; every new config key must be added there
  and must remain optional so existing worlds validate unchanged.
- Existing worlds that use the documented object-form `workflow.edges` must keep working, and the
  existing repository test suite must continue to pass except where a test encodes a behavior this
  requirement deliberately changes.
- New router result fields must be additive so a host reading only `type` and the documented
  fields keeps working.
- Parallel dispatch must be opt-in from `world.json` so single-dispatch remains the default.
- Studio reads and validates the same `world.json` and must not need changes to keep working.

## Non-Goals

- A slash command or plugin manifest for explicit skill activation; the activation surface is a
  separate decision about the host, not a router change.
- Deciding whether dispatched subagents may use tools directly instead of the
  `agent-world-host-action` protocol. The schema will carry a `tools` field so the choice can be
  expressed per agent, but the protocol itself is unchanged here.
- Restricting stop-token completion to terminal workflow nodes. Existing tests and the
  early-exit case show that a non-terminal agent ending a run is intended behavior.
- Changing the ordering between a stop token and an `agent-world-host-action` block in the same
  message. `.docs/tests/test-mention-routing-rules.md` documents "Completion Tags Precede Host
  Actions" as intended behavior, so a message carrying both still completes the run.
- Collapsing the four overlapping entry declarations (`workflow.entry`, `workflow.entryAgent`,
  `world.entryAgent`, `routing.noMentionFromHumanGoesTo`) into one.
- Node-level routing conditions that would move edge *selection* out of prompt text and into
  `world.json`.
- Changing Studio.
