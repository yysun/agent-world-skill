# Plan: Free-Mention Workflow Pattern

## Goal

Make `free-mention` a first-class canonical workflow pattern that routes, blocks, and terminates
correctly, and make edge enforcement a property derived from `workflow.type` rather than an
independent boolean that can contradict it.

## Current Context

Router (`skills/agent-world/scripts/agent-world-router.js`):

- `normalizeWorkflow` (:145) sets `enforceEdges: raw.enforceEdges !== false` (:152) with no reference
  to `raw.type`. It builds its object literal before calling `assertSupportedWorkflowShape(raw)`
  (:158), which throws the aggregated `Invalid Agent World config:` message plus `LEGACY_EDGE_HELP`.
- `validateConfig` (:170-232) raises the aggregated `Invalid Agent World config:` list without the
  legacy help, and is the natural home for graph-level rules.
- `nodesForMentionTargets` (:586) intersects `edges[sourceNode]` with the mention list and applies
  `nodePrereqsMet`. It is the only mention-to-node resolver.
- `allowedNextNodes` (:592) returns `edges[sourceNode] || []` and feeds the block message.
- `workflowHints` (:894) independently re-reads `edges[turn.workflowNode]` (:896) to build the
  prompt's allowed-next list. It never consults `enforceEdges`, which is defect 1 in the REQ.
- The agent branch of `processMessageForRouting` (:746-808) has three exits: node-resolved mentions
  via `queueWorkflowNode`; an error branch guarded by `if (state.workflow.enforceEdges && currentNode)`
  (:759); and a fallback loop calling `queueTurn` with no node id (:804-806). That fallback is reached in
  **two** cases, not one: enforcement off, and enforcement on with `currentNode === null`. The
  host-action path is not a source of null nodes - :538 and :1156 only propagate a node the completing
  turn already had - so the sole origin is a state file written under an older config.
- The human branch (:712-743) filters mention candidates by `edges.human` when present, otherwise by
  `nodeId === workflow.entry || nodePrereqsMet(nodeId)`, and only falls back to `workflow.entry` with
  `ignoredMentions` when no candidate survives.
- `autoReplyMentionTarget` (:680) short-circuits at :687 on `!currentNode || enforceEdges === false`.
  These are two independent conditions sharing one expression.
- **Auto-reply runs before mention resolution** (:746-749): when `mentions` is empty it substitutes the
  previous sender, so the `unknown_mention_target` check at :763 is only reached when no auto-reply
  target exists. The existing test at `tests/agent-world-router.test.js:976-987` uses `turn_0001`,
  whose source is the human, so `state.agents['human']` is undefined and the block fires; an
  agent-sourced turn would silently reply to its sender instead. `mention-routing-rules.md` already
  describes the blocking behavior in its Facts list while describing the `@sender` prepend
  unconditionally in its Auto-Mention section; the two are ambiguous rather than contradictory, and the
  Facts bullet additionally conditions the block on the node having outgoing edges.
- `loadConfig` never validates `workflow.type`; `normalizeWorkflow` defaults it to `'Unspecified'`
  (:149) and only `agent-world-eval.js:362` checks the canonical list.
- `buildAgentInstruction` (:917, `ignoredMentions` near :972) always emits `ignoredMentions`, as `[]` when empty.
- `src/studio/server/validator.ts` `parseGraphError` derives its Studio field pointer from
  `line.split(' ')[0]`, so a new error message must begin with the field path token to render usefully.
- `buildBlockedInstruction` (:1033) emits an explicit field list and **drops** `unresolvedMentions`,
  even though `queueRoutingError` stores it and `SKILL.md:241` promises the host will receive it.
- Mentions resolve against `state.agents` (`agentMentionAliases`, :384-394), never against
  `workflow.nodes`, and `validateConfig` never requires an agent to have a node.

Eval (`skills/agent-world/scripts/agent-world-eval.js`): `SUPPORTED_WORKFLOW_TYPES` (:23) is a second
hard-coded copy of the pattern id list, checked at :362. `finalWorkflowNodes` (:120) treats every node
with no outgoing edges as final, so with `edges: {}` **every** free-mention node is final and the
stop-token prompt check applies to every generated prompt.

Schema (`skills/agent-world/world.schema.json`): `workflow.type` is an enum of ten ids;
`enforceEdges` is an independent boolean defaulting to `true`; `workflow` sets
`additionalProperties: false` and requires `type`, `entry`, `entryAgent`, `nodes`, `edges`, so a
generated free-mention world must still carry `edges` — as `{}`.

Tests: the seven `assertInvalidConfig` fixtures in `tests/agent-world-router.test.js` omit
`workflow.type` entirely and will gain a new aggregated error once the type is validated. They survive
only because `assertInvalidConfig` (:291-299) uses `assert.match` against the joined message rather
than equality - load-bearing and worth preserving deliberately.
`tests/mention-routing.e2e.test.js:469-479` asserts the behavior this story removes — a
`sequential-pipeline` world (fixture :50) built with `enforceEdges: false` returning an
`agent_mention` turn whose `workflow.node` is `null`. `.docs/tests/test-mention-routing-rules.md:44`
documents the same removed behavior. Both must be replaced, so "existing suites pass unchanged" is
not an available form of evidence.

Docs: `init-agent-world.md` states "nine" at :11, :16, :19, :127; **hard-codes `"enforceEdges": true`
in the canonical generation JSON at :45** and instructs "Prefer `workflow.enforceEdges: true`" at
:89; and carries the pattern list, pattern-to-sample mapping, the fenced `context-scope-defaults`
block, and an eval minimums table. `eval-agent-world.md` carries a second copy of that table.
`SKILL.md:66` says "nine default workflow pattern ids". `README.md` carries the pattern list
(:223-231), the `custom-dag` prose at :232, the init narrative (:200, :202), and two `enforceEdges`
bullets (:177-178). `world.example.json:13` sets `enforceEdges: true` with an enforced pattern id and stays valid.
`.agent-world/` is gitignored, so `world.example.json` is the only world committed to the repo.
**Revised during review:** the field was ultimately removed from `world.example.json` too, since rule
11 points generators at that file as the shape to copy and rule 13 forbids writing the field. The
declared-and-consistent case is still covered, by the `makeWorld` test fixture.

Studio: `src/studio/server/validator.ts:86` calls the router's `loadConfig`, so new configuration
errors reach Studio with no client change. `src/studio/client/workflow/mutate.ts` `addAgent` can
insert an agent with no workflow node, which makes an agent-without-node world reachable in practice.

## Decisions

- **Enforcement is derived from `workflow.type`.** A single `enforcementForType(type)` predicate
  returns `false` for `free-mention` and `true` for every other id, including `custom-dag`.
- **`enforceEdges` is retained, not removed.** Removing it would fail every existing generated world
  under `additionalProperties: false`. It stays optional; when present it must equal the derived
  value. Rejected: silently ignoring the field (a silent behavior change), and a deprecation warning
  channel (the router has no warning channel and stdout is reserved for status).
- **A non-canonical `workflow.type` is reported on its own.** `normalizeWorkflow` still derives
  enforcement from the `'Unspecified'` default before `validateConfig` runs - the derivation order
  cannot change without giving up the one-error-surface decision - so `validateConfig` suppresses the
  enforcement-mismatch error whenever the type error fires. Otherwise a world that omits
  `workflow.type` and sets `enforceEdges: false` would be told about a mismatch against a field it
  does not contain.
- **One error surface.** `normalizeWorkflow` derives `workflow.enforceEdges` from the type and
  `loadConfig` passes the raw declared value to `validateConfig` as an argument rather than hanging it
  on the workflow object - `newState`/`hydrateState` copy `config.workflow` wholesale into the state
  file, so an extra field would leak into persisted state and the `state` command's output, and any
  caller validating a raw parsed document would silently skip the rule. Every new
  configuration rule — the `workflow.type` check, the enforcement mismatch, and the free-mention shape
  rules below — is
  raised from `validateConfig` so they aggregate into one `Invalid Agent World config:` list, share
  one format, and reach Studio identically. Rejected: throwing from `normalizeWorkflow`, which would
  preempt legacy-dialect errors and append irrelevant `LEGACY_EDGE_HELP`.
- **A `free-mention` world is defined by having no graph at all.** `validateConfig` rejects, for
  `workflow.type: "free-mention"`: any key at all in `workflow.edges` (including `human` and including
  keys mapped to empty arrays), any node
  `requires`, any agent with no workflow node, any agent referenced by more than one node, and a world
  with fewer than two agents. Each rule closes a concrete silent-stall or ambiguity:
  - `requires` would let `nodePrereqsMet` filter out a resolved mention, leaving no unresolved token
    to report and no turn queued - a silent stall.
  - `edges.human` would filter a human mention out of the candidate list, sending it to the entry
    override and contradicting the REQ's human-mention requirement.
  - an agent with no node resolves as a mention but maps to no node, again queueing nothing and
    reporting nothing.
  - an agent referenced by two nodes fans a single mention into two turns.
  Accepted hole: `agentMentionAliases` (:384-394) also registers each agent's display `name`, so two
  agents whose names normalize to the same alias still collapse to one target. Pre-existing and shared
  with every pattern; not closed here.
  - a single-agent world can never produce a routable mention at all, because
    `extractParagraphMentions` strips self-mentions, so the agent has no reachable peer and the run can
    only ever end at the turn limit or the stop token.
  Rejected: inventing new block codes at routing time for configurations that have no coherent
  meaning in a pattern with no graph.
- **The human branch is left untouched.** With no `edges.human` and no `requires`, the existing
  candidate filter at :719-731 already resolves a human `@critic` mention to the critic node and
  returns before the entry override. The REQ's human-mention behavior therefore falls out of the
  shape rules above, with zero blast radius on the branch shared by all ten enforced patterns.
- **Free-mention routing resolves to workflow nodes, never to bare agents**, so every free-mention
  turn carries a `workflowNode` and the node `instruction` and next-hop `currentNode` survive.
- **The node-less fallback is narrowed, not deleted.** It survives only for an *enforced* world with
  `currentNode === null`, an existing path reachable from a state file written under an older config.
  In a free-mention world it is unreachable, because `allowedNextNodes` resolves against every node
  when the source node is null - which is what makes "every free-mention turn carries a node" true
  without exception.
- **Auto-reply is suppressed when the message carries unresolved paragraph-start mention tokens**, in
  both modes. Without this, a free-mention agent whose turn was routed from a peer always has an
  auto-reply target, `allowedNextNodes` always resolves it, and the unresolved mention is swallowed
  before the block can fire - leaving the story's headline defect unfixed for the majority of hops.
  Applying it to enforced worlds too is a deliberate behavior change, recorded in the REQ as the one
  intentional exception to the no-enforced-change non-goal and marked breaking in the changelog.
  `mention-routing-rules.md` is ambiguous here rather than contradictory - :20-23 describes the block
  while :29-31 describes host-side auto-mention - so the authorization for this change is the REQ's
  explicit exception, not doc conformance. Rejected: suppressing it only when enforcement is off,
  which would leave two different unresolved-mention semantics in one router.
- **`autoReplyMentionTarget` keeps its `!currentNode` disjunct** and loses only
  `|| state.workflow.enforceEdges === false`. Note this disjunct removal is a no-op for free-mention
  routing on its own - the sender resolves either way - so it is a tidy-up, not the guardrail.
- **One resolver, one hint source.** `nodesForMentionTargets` and `allowedNextNodes` become
  enforcement-aware, and `workflowHints` calls `allowedNextNodes` instead of re-reading `edges`.
- **`buildBlockedInstruction` gains `unresolvedMentions`**, which `queueRoutingError` already stores
  and `SKILL.md:241` already promises. In scope because this story's blocking behavior is the first
  to make the field load-bearing for a pattern with no edge check.
- **`free-mention` becomes a tenth default init option**, not a `custom-dag`-style opt-in. Rejected:
  gating it behind explicit user request, which would reproduce today's situation where free routing
  exists but is not really offered.
- **A free-mention message either hands off or stops, never both.** `hasWorldCompletionTag` is
  evaluated first in `processMessageForRouting` (:697-701), before mentions are extracted, so a message
  containing both `@researcher ...` and the stop token ends the run on its first hop and never routes.
  Generated prompts must state the exclusive choice explicitly. Deterministic eval uses fixed
  completion text and cannot surface this, so it is generation guidance backed by a risk entry rather
  than a test.
- **Every generated free-mention prompt carries the stop token.** With `edges: {}` the eval harness
  treats every node as final, and semantically any agent may end a free-mention run. This is stated
  as generation guidance rather than worked around.
- **The prompt's `Allowed next workflow nodes:` header is left as is.** In a free-mention world it
  labels peers as workflow nodes in a world with no edges, which reads oddly but is accurate - the
  nodes exist, only the edges do not - and rewording it per pattern would fork the prompt template.
- **No feature flag, env var, fallback mode, or compatibility shim.** The pattern id is the only
  switch.
- Non-goals restated: no Studio client change, no schema removal, no change to the enforced
  patterns, no additional pattern ids.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Confirm by grep every read of `state.workflow.enforceEdges` and `state.workflow.edges` in
      `agent-world-router.js`, so no enforcement-dependent path is missed beyond those recorded above.
- [x] Confirm how a turn can carry a null `workflowNode` in an enforced world. The host-action path
      propagates a non-null node whenever the completing turn had one (:538, :1156) and the human
      branch's bare `queueTurn` at :741 is unreachable because `loadConfig` always fills
      `workflow.entry`, so the only surviving source is a state file written under an older config.
      Record that as the justification for retaining the branch. Retention is already settled in
      Decisions and assumed by Phase 3 and Phase 4; this task confirms the reason, it does not reopen
      the choice.
- [x] Confirm the committed world `skills/agent-world/world.example.json` carries a canonical
      `workflow.type` with a consistent `enforceEdges`, so the Phase 4 test that loads it is a
      meaningful guard. `.agent-world/` is gitignored and is not a committed world. The declared field
      was later removed from that file (see Current Context); the test asserts the derived value, and
      the `makeWorld` fixture keeps the declared-and-consistent case covered.

### Phase 2 - Foundation changes

- [x] Add `free-mention` to the `workflow.type` enum in `skills/agent-world/world.schema.json` and
      document on the `enforceEdges` property that it is derived from `workflow.type` and may only be
      stated when it matches.
- [x] Add an `enforcementForType(type)` helper and a `FREE_MENTION_TYPE` constant to
      `agent-world-router.js`; set `workflow.enforceEdges` from it in `normalizeWorkflow`, and pass the
      raw declared `enforceEdges` from `loadConfig` into `validateConfig` as a second options argument
      so it never becomes part of the normalized workflow object or the persisted state. No Studio
      change is needed: `src/studio/server/validator.ts:47` obtains the module through an unchecked
      `as RouterModule` assertion, so a second optional parameter cannot produce a type error, and
      Studio never calls `validateConfig` directly. Note in the router that calling the exported
      `validateConfig` without the options argument checks graph rules only.
- [x] In `validateConfig`, push an error when `declaredEnforceEdges` is defined and does not equal
      the derived `enforceEdges`, naming `workflow.type`, `workflow.enforceEdges`, and the required
      value.
- [x] In `validateConfig`, when `workflow.type` is `free-mention`, push an error for any key present
      in `workflow.edges` at all, including `human` and including keys mapped to empty arrays, naming
      the offending source key. `edges` must be exactly `{}` so a free-mention world never carries the
      visual shape of a graph that the router ignores.
- [x] In `validateConfig`, when `workflow.type` is `free-mention`, push an error for any node
      declaring `requires`, naming the node.
- [x] Add the canonical pattern id list to `agent-world-router.js` as a module-level constant.
      `enforcementForType` needs it anyway, so validating `workflow.type` reuses it rather than adding
      a list. **Revised during review:** the constant is exported after all. The drift test that
      compares it against the schema enum is a real consumer, and without the export that test can
      only compare the schema against a third hand-copied list - which is the drift it exists to
      catch.
- [x] In `validateConfig`, push an error when `workflow.type` is absent or is not a canonical pattern
      id, so enforcement is never derived from the `'Unspecified'` default. Skip the enforcement
      mismatch check when this error fires, so the aggregated message names `workflow.type` alone.
- [x] In `validateConfig`, when `workflow.type` is `free-mention`, push an error for any agent id in
      `agents` that no workflow node references, any agent referenced by more than one node, and for a
      world declaring fewer than two agents, naming the agent or the pattern.
- [x] Ensure every new `validateConfig` message begins with its field path token (for example
      `workflow.edges.human ...`), because `src/studio/server/validator.ts` `parseGraphError` derives
      the Studio field pointer from the first whitespace-delimited token. Lead the enforcement-mismatch
      message with `workflow.enforceEdges`, so Studio highlights the field the author must remove
      rather than the pattern selector.
- [x] Delete `SUPPORTED_WORKFLOW_TYPES` (`agent-world-eval.js:23-33`) and its sole consumer, the
      `workflow.type is a canonical workflow pattern id` check at :361-366. `config` is only assigned
      when `loadConfig` succeeds (:450-456), so once the router rejects a non-canonical type that named
      check can never fail; the failure surfaces through `router config loads and graph references
      validate` instead. This leaves exactly two pattern id lists in the repository - the schema enum
      and the router constant - down from three.

### Phase 3 - Feature implementation

- [x] Make `allowedNextNodes(state, sourceNode)` return every workflow node except `sourceNode` when
      `state.workflow.enforceEdges` is false - including when `sourceNode` is null, in which case no
      node is excluded - and the source node's edge list otherwise. Removing the `!sourceNode` early
      return for the unenforced branch is what guarantees a free-mention turn always carries a node,
      even when completed from a legacy null-node turn. Accepted consequence: on that legacy path only,
      the rendered allowed-next list includes the acting agent's own node. It cannot misroute, because
      `extractParagraphMentions` strips self-mentions, and the path is unreachable except from a state
      file written under an older config.
- [x] Make `nodesForMentionTargets(state, sourceNode, mentions)` resolve mentions against
      `allowedNextNodes` in both modes, preserving the `nodePrereqsMet` filter, so free-mention
      routing yields workflow node ids. Remove its own `!sourceNode` early return at :587 for the
      unenforced branch as well, otherwise it bails before `allowedNextNodes` is ever consulted and the
      null-source behavior above never takes effect.
- [x] Change `workflowHints` to build its `next` list from `allowedNextNodes` instead of re-reading
      `state.workflow.edges` at :896.
- [x] Compute `extractUnresolvedMentions(msg.content, state)` once at the top of the agent branch and
      suppress the auto-reply substitution at :746-749 when it is non-empty **and the unresolved-mention
      block would actually fire for this message** - that is, when enforcement is off, or when
      `currentNode` is set and has allowed next nodes. Compute this once as a single `blockWouldFire`
      value and consume it at both :746-749 and :764 - restating the predicate at the two sites lets
      them drift apart, which is exactly how the silent stall returns. Suppressing it unconditionally
      would strand an
      enforced null-node turn: no auto-reply, no block (the enforced gate needs a non-empty
      `allowedNext`), and an empty fallback loop, which is a new silent stall on the one legacy path
      this story preserves. Reuse the same token list at :764.
- [x] Lift the `unknown_mention_target` check out of the `:759` guard so it fires whenever `mentions`
      is empty and unresolved tokens are present. Keep the `allowedNext.length > 0` condition **for
      enforced worlds only**, so an enforced terminal node still returns `idle` exactly as it does
      today; drop it when enforcement is off, so a free-mention turn blocks even with a null
      `currentNode`. Relaxing the condition for enforced worlds would change every generated pattern's
      final node from `idle` to `blocked`, which the REQ does not authorize.
- [x] Reduce the remaining `:759` guard to `state.workflow.enforceEdges && currentNode` around the
      `workflow_edge_blocked` invalid-mention check only. Keep the `enforceEdges` condition even though
      free-mention can no longer reach it - it is what keeps the `workflow_edge_blocked` report a
      strictly enforced-mode concept, matching the reason selection above, rather than speculative
      defensiveness. Do
      not add a second `if (!currentNode)` wrapper around the fallback at :804. In a free-mention world
      that line is unreachable for a different reason than the guard: the completing node's agent is
      the sender, `extractParagraphMentions` strips self-mentions, and the Phase 2 shape rules give
      each agent exactly one node, so `routedNodes` is empty only when `mentions` is empty and the loop
      iterates zero times. That reachability argument depends on the shape rules, not on the guard.
- [x] Remove only the `|| state.workflow.enforceEdges === false` disjunct from
      `autoReplyMentionTarget` at :687, keeping `!currentNode`, and let the sender resolve through
      `nodesForMentionTargets` in both modes.
- [x] Add `unresolvedMentions` to the object returned by `buildBlockedInstruction` at :1033, defaulting
      to an empty array.
- [x] At :755, select the queue reason by enforcement: keep `workflow_edge` when enforcement is on and
      use `agent_mention` only when it is off, so a pattern that forbids edges does not report an edge
      as the routing reason. Line 755 serves both modes, so a blanket change would break
      `tests/mention-routing.e2e.test.js:503` and `tests/agent-world-router.test.js:791`, neither of
      which this story authorizes changing.

### Phase 4 - Tests and verification wiring

- [x] Land the `skills/agent-world/init-agent-world.md` free-mention pattern definition first - the
      pattern-to-sample mapping, the `context-scope-defaults` entry, the `turnLimit`, and the prompt
      guidance - because the generation-policy test and the world-generation task below both read it.
      The same task must also delete `"enforceEdges": true` from the canonical generation JSON at
      `init-agent-world.md:45`, replace the "Prefer `workflow.enforceEdges: true`" instruction at :89,
      and add the `free-mention` eval-minimums row, since a generator following the unedited document
      emits a world with a contradicting `enforceEdges` that Phase 2 now rejects at load, and the
      generated `world.eval.md` needs the minimums row. Only the remaining `init-agent-world.md` edits
      stay in Phase 5.

- [x] Replace `tests/mention-routing.e2e.test.js:469-479` (`enforceEdges false allows fallback agent
      mention routing outside the DAG`) with a free-mention equivalent asserting the routed turn
      carries the target's workflow node, and update the corresponding line in
      `.docs/tests/test-mention-routing-rules.md:44`.
- [x] Add router tests in `tests/agent-world-router.test.js` covering: a free-mention agent hop with
      no declared edge returning `agent_instruction` whose `workflow` node is the target's node; the
      `hostInstruction` allowed-next section listing peer agents and the target node's `instruction`
      appearing in it; an unresolved mention returning `blocked` with `unknown_mention_target` and a
      populated `unresolvedMentions`, asserted both for a turn routed from the human and for a turn
      routed from another agent so an available auto-reply target cannot mask the block; the same
      agent-sourced assertion in an enforced world **built with a return edge from the current node
      back to the sender's node**, so `autoReplyMentionTarget` actually resolves and the assertion can
      distinguish old behavior from new - the default fixtures have no return edge and would pass
      identically before and after the change (`tests/mention-routing.e2e.test.js:493` is the existing
      case that establishes the return-edge precondition); a human
      paragraph-start mention routing to the mentioned node rather than the entry node with
      `ignoredMentions` emitted as an empty array; and a runaway exchange terminating with
      `turn_limit_reached`.
- [x] Add router tests asserting each new configuration rule fails to load with an error naming the
      offending field: `{type: "sequential-pipeline", enforceEdges: false}`; an absent or non-canonical
      `workflow.type`; a free-mention world with a non-empty `edges` entry; one declaring only a
      `human` edge; one with a node declaring `requires`; one with an agent that no node references;
      one with an agent referenced by two nodes; and a single-agent one.
- [x] Add router tests asserting that omitting `enforceEdges`, or setting it to the value implied by
      the type, loads and routes for both a free-mention and an enforced world.
- [x] Add a router test asserting an enforced world still routes an agent message whose turn carries
      a null `workflowNode`, proving the narrowed fallback preserved that path. A null-node turn is not
      reachable through the router's public commands, so construct it by hand-writing the state file,
      following the existing pattern at `tests/agent-world-router.test.js:440-454`.
- [x] Add a case to `tests/studio/studio-world.test.js` asserting Studio's validator surfaces one of
      the new configuration errors, proving the REQ's Studio constraint without Studio-specific code.
- [x] Add an eval test in `tests/agent-world-eval.test.js` proving a `free-mention` world loads and
      runs its deterministic contract, replacing any assertion tied to the removed canonical-id check.
- [x] Execute every scenario in `.docs/tests/test-free-mention-pattern.md` against the built router
      and record the observed result per scenario in the completion document's Verification section,
      naming for each scenario whether it is discharged by an automated test or by manual observation.
- [x] Generate a `free-mention` world per `init-agent-world.md` into
      a scratch directory referred to below as `<scratch>`, so the generated world is at
      `<scratch>/.agent-world/world.json`,
      validate it with
      `node -e "const Ajv=require('ajv/dist/2020');const fs=require('fs');const a=new Ajv({strict:false});const v=a.compile(JSON.parse(fs.readFileSync('skills/agent-world/world.schema.json','utf8')));console.log(v(JSON.parse(fs.readFileSync(process.argv[1],'utf8')))?'valid':v.errors)" <world path>`
      - the draft-07 `require('ajv')` entry point cannot compile this schema's 2020-12 `$schema`,
      which is why `src/studio/server/validator.ts:18` imports `ajv/dist/2020.js`,
      then run
      `node skills/agent-world/scripts/agent-world-eval.js --config <scratch>/.agent-world/world.json --eval <scratch>/.agent-world/world.eval.md --out <scratch>/.agent-world/eval-runs`
      and record both results.
- [x] Update `test('generation policy: all nine built-in patterns assign valid context scopes to every
      sample agent')` at `tests/agent-world-router.test.js:366-395`, whose hard-coded nine-key
      `expectedDefaults` object and title both break once `free-mention` joins the fenced
      `context-scope-defaults` block in `init-agent-world.md`.
- [x] Add a router test asserting `loadConfig(...).workflow.enforceEdges` is `false` for a
      `free-mention` world and `true` for an enforced one, covering the enforcement-derivation
      criterion directly rather than inferring it from routing.
- [x] Add a router test asserting a free-mention message carrying both a resolving and a
      non-resolving paragraph-start mention routes to the resolved target and drops the unresolved
      token, so "mentions non-empty" still beats "unresolved non-empty" under the new suppression.
- [x] Add a router test asserting a free-mention turn carrying a null `workflowNode` still returns
      `blocked` on an unresolved mention. Like the enforced null-node test, this state is unreachable
      through the router's public commands, so construct it by hand-writing the state file.
- [x] Add a router test asserting an enforced world's terminal node still returns `idle` when its turn
      completes with an unresolved paragraph-start mention and no stop token. No existing test covers
      this - `tests/mention-routing.e2e.test.js:458-467` uses a resolved mention gated by `requires` -
      and it is the only guard on the retained `allowedNext.length > 0` condition.
- [x] Add automated cases for the E2E scenarios that would otherwise only be checked by hand: a
      a free-mention run completing on the stop token, and the generated free-mention world passing
      deterministic eval. The two enforced human-branch scenarios are already covered by
      `tests/mention-routing.e2e.test.js:298` and `:311` plus `tests/agent-world-router.test.js:673`
      and `:1047`; cite those rather than writing new ones, . The `ignoredMentions`-under-`edges.human` assertion also already exists at
      `tests/agent-world-router.test.js:1033-1042`; cite it too and write no new case for the human
      branch.
- [x] Add a router test loading the committed world `skills/agent-world/world.example.json`,
      asserting it still loads, as the cheapest guard for the REQ's backward-compatibility constraint.
- [x] Extend the invalid-config coverage so at least one rejection is driven through the `file`
      handoff path, asserting a non-zero exit and that no result file is written - the existing
      `assertInvalidConfig` helper at `tests/agent-world-router.test.js:291-299` only drives `reset`
      over stdout/stderr.
- [x] Run `npm test` and record the pass/fail counts. Note that `pretest` runs `npm run build`, which
      rewrites the committed `skills/agent-world/scripts/agent-world-studio.js` and
      `skills/agent-world/studio/dist/*` artifacts; check `git status` afterwards and do not commit an
      incidental rebuild with this story.

### Phase 5 - Documentation and status

- [x] Update `skills/agent-world/init-agent-world.md`: add `free-mention` to "Workflow Patterns";
      change the four "nine" statements at :11, :16, :19, :127 to match the new default option count,
      including the ":11 `custom-dag` is not a tenth default pattern" phrasing that `free-mention` now
      makes wrong;
      add the pattern-to-sample mapping (`coordinator`, `researcher`, `critic`); assign
      `coordinator: "global"` (it opens the run and is the likeliest synthesizer) and
      `researcher: "agent"`, `critic: "agent"`, matching the value the Phase 4 generation-policy test
      must expect; add its entry to the
      fenced `context-scope-defaults` block; **replace the
      "Prefer `workflow.enforceEdges: true`" instruction at :89 with the type-derived rule**; **delete `"enforceEdges": true` from the canonical generation JSON at :45**, since the
      field is now fully derived and a generator copying that shape into a `free-mention` world would
      produce a world the router refuses; and state that generated free-mention worlds set `edges` to `{}`, declare no
      `requires`, give every agent a node, carry the stop token in every prompt, set
      `parallelDispatch` to `false`, and set `turnLimit` to 8 - low enough that the generated eval
      contract's turn-limit case chains a manageable number of chained `given` steps, since
      `agent-world-eval.js` `runCase` drives real router steps. Generated prompts must tell
      each agent to either open a handoff with exactly one peer mention **or** end with the stop token,
      never both in one message, and to address the user by ending with the stop token rather than by
      mentioning `@human` or `@user` - a paragraph-start mention of a non-agent now blocks the run.
- [x] Add the `free-mention` row to the pattern minimums tables in both
      `skills/agent-world/eval-agent-world.md` and `init-agent-world.md`, stating concrete behaviors in
      the style of the existing rows: *"Any agent can route to any peer without an edge; an unresolved
      mention blocks; the turn limit bounds a non-terminating exchange."* No row may assert off-edge
      blocking.
- [x] Update the `workflow.type` description in `skills/agent-world/world.schema.json:53` so the enum's
      only prose mentions `free-mention` alongside the `custom-dag` caveat.
- [x] Update the "JSON Requirements" list in `skills/agent-world/init-agent-world.md:188-200` so the
      edge-related items are pattern-conditional and the stop-token item reflects that every
      free-mention node is final.
- [x] Update `README.md:179` so the unresolved-mention blocking rule reflects that it now fires ahead
      of auto-reply, and document the auto-reply ordering correction in the mention-routing rules in
      both `README.md` and `skills/agent-world/mention-routing-rules.md`. In
      `mention-routing-rules.md:20-23`, state that the block now precedes auto-reply, and make the
      outgoing-edges precondition conditional on edge enforcement, since it no longer holds for
      `free-mention`.
- [x] Update `skills/agent-world/SKILL.md:66` so the stated default pattern count matches
      `init-agent-world.md`.
- [x] Update `README.md`: add `free-mention` to the init pattern list at :223-231, update the
      `custom-dag` prose at :232 and the two "nine default ids" statements at :200 and :202, including
      the ":200 not a tenth default pattern" phrasing, and
      replace the two `workflow.enforceEdges` bullets at :177-178 with the type-derived rule and the
      free-mention routing behavior, and qualify the three adjacent bullets at :174-176 (`edges.human`
      gating, agent mentions routing only across allowed edges, and `requires` gating) as applying to
      the enforced patterns only, since `free-mention` forbids all three.
- [x] Add `Added` and `Changed` entries to `CHANGELOG.md` for the `free-mention` pattern, the
      type-derived enforcement rule, the rejected contradictory and graph-bearing free-mention
      configurations, the narrowed unenforced routing path, the auto-reply ordering correction, and
      `unresolvedMentions` on `blocked`. Mark only the `enforceEdges` contradiction and the auto-reply
      ordering change and the `workflow.type` strictness `**Breaking:**` per the file's existing
      convention - the free-mention shape rules
      constrain a workflow type that did not previously exist and cannot break an existing world.
- [x] Record final evidence that each REQ acceptance criterion is satisfied, and mark plan tasks
      complete only after the change or evidence exists.

## Validation

- `npm test` - runs `node --test tests/*.test.js tests/studio/*.test.js` after the `pretest` build.
  Expected: all suites pass. Two existing test files are deliberately modified by Phase 4 -
  `tests/mention-routing.e2e.test.js` (the unenforced-fallback case) and
  `tests/agent-world-router.test.js` (the generation-policy test that machine-checks the
  context-scope-defaults block). Every other existing test passes unmodified, and those two edits are
  the audit point.
- `node --test tests/agent-world-router.test.js` - narrowest command while iterating on the router.
- `node --test tests/mention-routing.e2e.test.js` - confirms the replaced case and the untouched ones.
- `node skills/agent-world/scripts/agent-world-eval.js --config <scratch>/.agent-world/world.json
  --eval <scratch>/.agent-world/world.eval.md --out <scratch>/.agent-world/eval-runs` - expected: a
  report with all deterministic checks passing for a generated `free-mention` world.
- The `ajv/dist/2020` one-liner in Phase 4 against the generated scratch world - expected: `valid`.
- `npm run typecheck` - expected: unchanged result; the router and eval scripts are CommonJS and
  outside the TypeScript project, so this guards only the Studio sources this story does not touch.

## Changes Made During Review

Three items landed beyond the plan as written, each driven by a code-review finding and each recorded
in `CHANGELOG.md`:

- `requestedBy` on a host action is now always the emitting agent. An agent-supplied peer name paired
  the host result with the acting turn's workflow node, breaking the agent-to-node identity the
  free-mention reachability argument rests on. Applies to every pattern because the defect does.
- A `free-mention` world's declared `world.turnLimit` must be a positive integer, since
  `turnLimitReached` treats a malformed value as "no limit" and this pattern has no graph to bound it.
- `CANONICAL_WORKFLOW_TYPES` is exported, reversing a Phase 2 decision, so the schema/router drift
  test can compare the real lists rather than a copy.

## Rollback / Risk

- **A world whose `workflow.type` is absent or is a display label now fails to load.**
  `init-agent-world.md:88` warns against `Broadcast`, `dag`, and `mention_graph`, which implies such
  hand-written files exist. Breaking, and recorded as such alongside the `enforceEdges` contradiction.
- **Highest risk: worlds that set `enforceEdges: false` on an enforced pattern now fail to load**
  instead of running degraded. Intentional and recorded as breaking in `CHANGELOG.md`, but it is the
  one change that stops an existing world rather than fixing it. Mitigation: the error names both
  fields and the required value, so the fix is mechanical.
- **The regression evidence for enforced patterns is two modified suites, not unmodified ones.**
  One existing test asserts removed routing behavior and one machine-checks the pattern set; both are
  updated by Phase 4, and those two edits are the audit point. Every other existing router, eval, mention-routing, and studio test must pass
  untouched, and a new test covers the preserved `currentNode === null` path.
- **Shared helper blast radius.** `allowedNextNodes` and `nodesForMentionTargets` serve enforced
  routing, block messages, auto-reply, and now prompt hints. Their enforced branches must be
  behavior-identical; the tests left unmodified are the proof.
- **A free-mention message carrying both a handoff mention and the stop token terminates the run
  silently.** The completion tag is checked before routing, so the mention is never read. Every
  free-mention prompt is required to carry the stop token, which makes the collision easy for a live
  model to produce and impossible for deterministic eval to catch. Mitigated only by explicit prompt
  guidance; accepted, because moving the completion check after mention extraction would change
  termination semantics for all ten enforced patterns.
- **A free-mention agent that answers in prose with neither a mention nor the stop token reaches
  `idle` silently.** The entry turn is human-sourced, so no auto-reply target exists, and an empty
  mention list with no unresolved token fires no block. This matches enforced behavior and is not a
  regression, but answering the user directly is the likeliest live-model behavior in a pattern built
  for open conversation. Mitigated only by prompt guidance; accepted.
- **A paragraph-start mention of a non-agent stops a free-mention run.** `@human`, `@user`, and
  `@everyone` resolve to no agent, and every free-mention hop now reaches the unresolved-mention block,
  so an agent addressing the user by name halts the world. Mitigated only by generation guidance in
  Phase 5; accepted, because the alternative is a mention allowlist that free-mention has no graph to
  derive.
- **A resolved self-mention bounces backward.** `extractParagraphMentions` strips self-mentions and
  they leave no unresolved token, so an agent opening a paragraph with its own name yields no mention
  and no unresolved token: the suppression does not fire and auto-reply routes the turn back to the
  previous sender. Accepted as existing behavior shared with the enforced patterns, not introduced
  here, and not worth a new rule.
- **Free-mention runs are unbounded by construction.** Only `world.turnLimit` stops them. Mitigation:
  conservative generated `turnLimit`, an explicit test that the limit fires, and documentation stating
  the limit is the sole structural guarantee.
- **An existing Studio project whose world sets `enforceEdges: false` will 400 on every save.**
  `tests/studio/studio-world.test.js:263-296` shows Studio round-trips the field verbatim, so the
  editor cannot self-heal it; the author must fix the file on disk. Same root cause as the highest-risk
  bullet, reached through a surface the plan otherwise says needs no change.
- **Studio can author unsavable free-mention worlds.** Once the shape rules exist, a Studio user who
  adds an agent (`src/studio/client/workflow/mutate.ts` `addAgent` inserts with no node) or draws any
  edge on a `free-mention` world produces a document the server rejects with a 400, and the editor
  offers no in-canvas route back to a valid state. Two of these are invisible rather than loud:
  `disconnectEdge` leaves `edges[source] = []`, so drawing an edge and deleting it again leaves an
  apparently empty canvas that can never be saved; and `deleteAgent` refuses while a node is assigned,
  so removing an agent means deleting its node first, which immediately trips the agent-without-node
  rule. Accepted, not mitigated: Studio client work is an
  explicit non-goal, and the rejection is loud rather than silent.
- **The auto-reply ordering correction touches every pattern.** It is the one change in this story
  that intentionally alters enforced-world behavior. Mitigation: the REQ records it as an explicit
  exception, it aligns the router with `mention-routing-rules.md` rather than diverging from it, and
  a dedicated enforced-world test covers it.
- **Doc drift across seven doc surfaces** (`init-agent-world.md`, `eval-agent-world.md`, `SKILL.md`,
  `README.md`, `CHANGELOG.md`, `world.schema.json`, `mention-routing-rules.md`) **plus two pattern id
  lists** (the schema enum and the router constant), reduced from three by Phase 2. Mitigation: Phase 5 names each
  location with a line reference.
- Rollback is a single revert; no schema migration, persisted state change, or generated-world
  rewrite is involved.
