# Plan: Deterministic Subagent Orchestration

## Goal

The router routes every documented handoff form, never fails silently, recovers from a block, and
carries enough information in `world.json` and in `agent_instruction` for a host to dispatch each
turn to an independent subagent whose only channel to its peers is an `@mention` resolved by the
router.

## Current Context

- `skills/agent-world/scripts/agent-world-router.js` (1238 lines, dependency-free CommonJS) holds
  all routing behavior. Relevant seams:
  - `normalizeWorkflow` (~line 108) contains the legacy array-edge/`join` branch that synthesizes
    `${to}_join_${N}` node ids. `world.example.json`, the repository world, every test, Studio's
    `derive.ts`, and `world.schema.json` all use object-form edges only, so the branch is unused
    by every in-repo consumer.
  - `validateConfig` (~line 152) checks scopes, entry, node agents, `requires`, and edge targets.
  - `extractMentionLabelFromLine` (~line 387) holds the greedy two-word display-name rule.
  - `hasWorldCompletionTag` (~line 413) reads raw content; `stripCodeFences` (~line 357) already
    exists and is used only by `extractParagraphMentions`.
  - `processMessageForRouting` (~line 629) holds the human-entry override (~line 668) and the
    `enforceEdges` block path (~line 703).
  - `compactContext` (~line 751) selects `agent`-scope context by message author.
  - `nextInstruction` (~line 915) returns the first pending routing error, then the first pending
    host action, then the first pending turn.
  - `buildAgentInstruction` (~line 790) builds the payload and `hostInstruction` text.
  - `CONTEXT_LIMIT = 18` is a module constant (~line 26).
- `skills/agent-world/world.schema.json` is `additionalProperties: false` at every level; the
  `agent` definition permits only `name`, `role`, `promptPath`, `contextScope`.
- `skills/agent-world/SKILL.md` tells the host to role-play each turn inline ("Run exactly one turn
  as the named agent").
- Tests: `tests/agent-world-router.test.js` (32 cases incl. context scope),
  `tests/mention-routing.e2e.test.js`, `tests/agent-world-eval.test.js`. Run with
  `npm test`, which has a `pretest` build; `node --test tests/*.test.js` runs the router tests alone.
- Known test couplings discovered during scope lock:
  - `tests/agent-world-router.test.js:409-413` asserts a `requires` node with `contextScope: global`
    sees both sibling results. Unaffected by the `agent`-scope change.
  - `tests/agent-world-router.test.js:416-450` asserts an `agent`-scope context of exactly 18
    messages (routed-from + 17 own). The new selection must not add messages in that case.
  - `tests/mention-routing.e2e.test.js:269, 523` and `tests/agent-world-router.test.js:457`
    complete a **non-terminal** node with a stop token and expect the run to finish.
  - `tests/mention-routing.e2e.test.js:438` uses `<world>TO:Ghost, Review Captain</world>`, where one
    target is unknown but another resolves; this must not become an unknown-mention block.

## Decisions

- **Mention parsing: longest-match-first, not regex tightening.** Try the two-word label; if it does
  not resolve to a known alias, fall back to the one-word label. This keeps `@Madame Pedagogue`
  working (the reason the rule exists) while fixing `@architect Please`. Rejected: dropping the
  two-word form (breaks display names); requiring the second word to be non-stopword (a word list is
  not deterministic).
- **Unknown-mention block is narrowly gated.** Emit `blocked` only when the message is agent-authored,
  `enforceEdges` is on, the source node has outgoing edges, there is no resolved mention, no host
  action and no completion tag, and at least one paragraph-start `@token` failed to resolve. This
  targets exactly the silent-stall case and leaves the existing auto-reply and idle paths alone.
- **Block recovery supersedes rather than resets.** A new human message marks the run's pending
  routing errors `superseded`; pending sibling turns survive. Rejected: starting a new run (loses
  pending lanes) and `reset` (destroys history).
- **Stop token: strip fences only.** Do **not** restrict completion to terminal nodes; three existing
  tests deliberately complete a run from a non-terminal node, and early exit is intended. Detection
  uses fence-stripped content; `state.final` still records the full original message.
- **`agent` scope becomes addressee-based, with a required-node guarantee.** Selection = routed-from
  message + latest message from each `requires` node + messages whose paragraph-start mentions
  resolve to this agent + the agent's own messages, newest-first fill up to the limit, emitted in
  chronological order. Rejected: making `requires` + `contextScope: agent` a validation error, which
  would break worlds that are now correct.
- **Parallel dispatch is opt-in from `world.json`** via `workflow.parallelDispatch` (default `false`),
  returning `type: "agent_instruction_batch"` with a `turns` array of full instruction payloads.
  Keeping the default off preserves every existing consumer and test.
- **Batched turns are marked dispatched to prevent double dispatch.** Returning a turn inside a batch
  marks it dispatched; later instruction requests skip dispatched turns, and when every pending turn
  is dispatched the router returns `idle` carrying an `awaitingTurns` list. This marker applies only
  to the batch path: single dispatch keeps re-offering the same pending turn on repeated `next`,
  which existing tests rely on. Rejected: a new `awaiting_completions` result type (adds a type the
  host must learn for no added information) and re-offering dispatched turns once nothing else is
  pending (non-deterministic).
- **Subagent dispatch config is per agent** (`model`, `tools`, `subagentType`, `contextLimit`),
  surfaced as a `dispatch` object on the instruction. All optional; absent means host default.
- **Legacy array-edge/`join` dialect is rejected, not migrated.** It is schema-invalid, unused by
  every in-repo consumer, and its synthesized node ids violate the requirement that the workflow is
  defined in `world.json`. It fails with a message naming the object form.
- Non-goals from the REQ are explicitly not implemented: no slash command, no tools-vs-host-action
  policy change, no terminal-node stop restriction, no stop-token/host-action reordering, no entry
  declaration collapse, no Studio change.

## Phased Tasks

### Phase 1 - Discovery and scope lock

- [x] Confirm `skills/agent-world/world.example.json`, `.agent-world/world.json`, and
      `src/studio/client/workflow/derive.ts` use only object-form `workflow.edges`, so removing the
      legacy dialect from `normalizeWorkflow` breaks no in-repo consumer.
- [x] Record the four test couplings listed in Current Context as behavioral constraints the
      implementation must satisfy, and confirm which of them encode behavior this REQ changes.
- [x] Record the rejected alternatives (terminal-node stop restriction, `requires`+`agent` scope
      validation error, dropping two-word mentions) so implementation does not reintroduce them.

### Phase 2 - Foundation changes

- [x] Update `world.schema.json` `$defs/agent` to allow optional `model` (string), `tools` (array of
      strings, unique), `subagentType` (string), and `contextLimit` (integer, minimum 1).
- [x] Update `world.schema.json` `workflow` to allow optional `parallelDispatch` (boolean, default
      `false`).
- [x] Replace the legacy array-edge/`join` branch in `normalizeWorkflow` with a configuration error
      naming the object form when `workflow.edges` is an array or any edge entry carries `join`, and
      require `workflow.nodes` to be present.
- [x] Extend `normalizeAgents` to carry `model`, `tools`, `subagentType`, and `contextLimit` onto the
      normalized agent, and `validateConfig` to reject a non-positive `contextLimit`.
- [x] Change `CONTEXT_LIMIT` from a hard-coded call-site constant to a documented default that a
      per-agent `contextLimit` overrides in `compactContext`.

### Phase 3 - Routing correctness

- [x] Rewrite `extractMentionLabelFromLine` (or its caller `resolveMentionTarget`) to attempt the
      two-word label first and fall back to the one-word label when the two-word label resolves to no
      alias, so `@architect Please design.` routes to `architect` and `@Madame Pedagogue` still routes.
- [x] Add an unresolved-paragraph-start-mention detector and, in `processMessageForRouting`, queue a
      routing error with code `unknown_mention_target` under the gate defined in Decisions, carrying
      the unresolved tokens and the allowed next nodes.
- [x] Apply `stripCodeFences` to the content `hasWorldCompletionTag` inspects, leaving `state.final`
      computed from the original message content.
- [x] In the human-entry path of `processMessageForRouting`, capture human mentions that resolved to a
      known agent but were replaced by the entry node, and record them on the queued turn.
- [x] Surface those captured mentions as `ignoredMentions` on the built `agent_instruction`, and state
      them in `hostInstruction` so the host can tell the user their mention was overridden.
- [x] Mark the current run's pending routing errors `superseded` when a human message is ingested, so
      `nextInstruction` returns pending work instead of the stale block.

### Phase 4 - Subagent dispatch surface

- [x] Rewrite `compactContext` `agent`-scope selection to the addressee-based rule in Decisions,
      preserving chronological output order and the existing routed-from priority.
- [x] Add a `dispatch` object (`model`, `tools`, `subagentType`, `contextLimit`) to the
      `agent_instruction` payload, omitting keys the world did not configure.
- [x] Add `agent_instruction_batch` to `nextInstruction`: when `workflow.parallelDispatch` is true and
      more than one pending turn in the current run has its prerequisites met, return
      `{ type: 'agent_instruction_batch', turns: [...] }` with a full instruction payload per turn;
      otherwise return the existing single instruction unchanged.
- [x] Confirm each batched turn keeps its own `responseContract` request/result paths so completions
      remain independent and order-insensitive.
- [x] Mark each turn returned inside a batch as dispatched, skip dispatched turns when selecting later
      instructions, and clear the marker when the turn completes or the run restarts.
- [x] Return `idle` with an `awaitingTurns` list naming the dispatched-but-incomplete turn ids when
      every pending turn in the current run has already been dispatched.

### Phase 5 - Tests and verification wiring

- [x] Add router tests for: same-line capitalized handoff routing; multi-word display-name mention
      still resolving; `unknown_mention_target` block; block recovery after a human message with a
      pending sibling turn; fenced stop token not completing while prose stop token still completes;
      `ignoredMentions` on an overridden human mention.
- [x] Add router tests for addressee-based `agent` scope, including a `requires` fan-in node with
      `contextScope: agent` receiving every required lane's latest message, and confirm the existing
      exactly-18 context test still holds.
- [x] Add router tests for `agent_instruction_batch` under `parallelDispatch: true`, single dispatch
      when the flag is absent, `dispatch` passthrough, per-agent `contextLimit`, and the rejected
      legacy array-edge/`join` config.
- [x] Add a router test that a batched turn is not re-offered while pending and that the router
      reports `awaitingTurns` once every pending turn has been dispatched.
- [x] Add E2E scenarios to `.docs/tests/test-subagent-orchestration.md` covering a full parallel
      fan-out and fan-in run driven by mentions through the file handoff protocol.
- [x] Extend `.agent-world/world.eval.md` routing cases so at least one mocked handoff uses the
      same-line `@agent Capitalized` form rather than the mention-on-its-own-line form.
- [x] Run `node --test tests/*.test.js` and record the result; run `npm test` and record the result.
- [x] Run the deterministic eval against the repository world and record PASS/FAIL and the report path.

### Phase 6 - Documentation and status

- [x] Rewrite the `agent_instruction` section of `SKILL.md` to dispatch the turn to an independent
      subagent using the payload's `systemPrompt`, `context`, `hostInstruction`, and `dispatch`, and to
      take the subagent's final message as the completion `content`.
- [x] Document in `SKILL.md` that an `@mention` enqueues the next turn through the router rather than
      delivering a message peer-to-peer, and that subagents never address each other directly.
- [x] Document the `agent_instruction_batch` result, the `ignoredMentions` field, the
      `unknown_mention_target` block code, and the router error case where no result file is written
      and the host must fall back to the command's stderr.
- [x] Update `skills/agent-world/mention-routing-rules.md` so the stated rule matches the implemented
      resolution order, and note that mentions are line-oriented in practice.
- [x] Update `skills/agent-world/init-agent-world.md` to forbid the array-edge/`join` dialect as a
      hard configuration error rather than a style instruction, and to document the new optional
      agent dispatch keys and `workflow.parallelDispatch`.
- [x] Update the routing-case example in `skills/agent-world/eval-agent-world.md` to the same-line
      `@agent Capitalized` handoff form so generated eval contracts exercise the realistic shape.
- [x] Update the file comment blocks of every edited source file with the new behavior.
- [x] Update `README.md` and `CHANGELOG.md` with the new router contract and config keys.

## Validation

- `node --test tests/*.test.js` - router, eval, and mention E2E suites pass; report counts.
- `npm test` - full suite including Studio tests passes; report counts.
- `npm run typecheck` - no TypeScript regressions from the schema change.
- `node skills/agent-world/scripts/agent-world-eval.js --config .agent-world/world.json --eval .agent-world/world.eval.md --out .agent-world/eval-runs`
  - reports PASS and the generated report path.
- Manual: drive a `parallelDispatch: true` fan-in world through the file handoff protocol and show
  the batch result and both lanes reaching the collector with both findings in context.
- Manual: confirm `@architect Please design the app.` routes, and that the previously reproduced
  `idle` stall no longer occurs.

## Rollback / Risk

- **Highest risk: the `agent`-scope context change.** It widens what an agent sees and is asserted by
  existing tests. Mitigation: the exactly-18 test is a hard constraint; run the router suite after
  the change before proceeding.
- **Removing the legacy dialect is a breaking change** for any out-of-repo world using array edges.
  Mitigation: it is already schema-invalid and produces phantom node ids; the error message names the
  object form. Recorded in CHANGELOG.
- **The unknown-mention block could fire on benign `@` text.** Mitigation: the narrow gate in
  Decisions; verified against the existing `TO:Ghost, Review Captain` test.
- Rollback: every change is confined to `agent-world-router.js`, `world.schema.json`, and skill
  markdown; revert the commit to restore prior behavior. No persisted state migration is involved -
  `.agent-world/agent-world-state.json` gains only a `superseded` routing-error status and a
  `dispatched` marker on pending turns, both absent-means-false on existing records.
