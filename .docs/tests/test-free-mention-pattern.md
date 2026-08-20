# E2E Test Spec: Free-Mention Workflow Pattern

Each scenario creates a temporary world under a scratch directory, drives
`skills/agent-world/scripts/agent-world-router.js` as a process, and verifies the returned JSON
instruction. Scenarios may use either the `reset` / `user` / `complete --turn` CLI used by
`tests/mention-routing.e2e.test.js` or the timestamped file handoff interface used by
`tests/agent-world-router.test.js`, whichever the case is implemented against. No live model is
involved; agent turns are completed with fixed text.

The base free-mention world used below declares `workflow.type: "free-mention"`, three agents
(`coordinator`, `researcher`, `critic`), exactly one workflow node per agent with each node id equal
to its agent id (so an allowed-next line renders as `- researcher: @researcher`), `workflow.entry: "coordinator"`,
and `workflow.edges` present as an empty object `{}` (the schema requires the key).

## Scenario: Agent Hop With No Declared Edge

- Given a free-mention world whose `workflow.edges` declares no target for the `coordinator` node
- And the run has been started by a human message with no paragraph-start mention
- When the `coordinator` turn is completed with a message beginning `@researcher Please gather the prior art.`
- Then the router returns `agent_instruction` for the `researcher` agent
- And the returned `workflow` node is the `researcher` node rather than `null`
- And the turn's routing `reason` is `agent_mention`, not `workflow_edge`
- And no `blocked` result is produced

## Scenario: Free-Mention Prompt Names Reachable Peers

- Given the same free-mention world with an `instruction` set on the `researcher` node
- When the router returns the `agent_instruction` for `researcher`
- Then the `hostInstruction` allowed-next section names `coordinator` and `critic`
- And it does not render the allowed-next section as `(none)`
- And the allowed-next section does not name `researcher` itself
- And the `researcher` node's `instruction` text appears in the `hostInstruction`

## Scenario: Unresolved Mention Blocks Instead Of Stalling

- Given a free-mention world and a pending `coordinator` turn routed directly from the human message
- When the turn is completed with a message whose only paragraph-start mention is `@architekt Please review.`, naming no agent in the world
- Then the router returns `blocked` with code `unknown_mention_target`
- And the returned `blocked` payload carries an `unresolvedMentions` field containing the unresolved token
- And the router does not return `idle`

## Scenario: Unresolved Mention Blocks Even When An Auto-Reply Target Exists

- Given a free-mention world where the human woke `coordinator`, and `coordinator` handed off with `@researcher Please gather the prior art.`
- And the resulting `researcher` turn is therefore sourced from another agent's message
- When the `researcher` turn is completed with a message beginning `@architekt Please review.`
- Then the router returns `blocked` with code `unknown_mention_target`
- And it does not queue a turn for `coordinator` as an auto-reply
- And the same block is returned for a free-mention turn that carries no workflow node, a state reachable only by hand-writing the state file, so it is exercised as its own case rather than through this scenario's peer-routed handoff
- And the same holds in a `sequential-pipeline` world **whose graph declares a return edge from the acting node back to its sender's node**, so an auto-reply target genuinely resolves: the agent-sourced turn completing with an unresolved paragraph-start mention blocks rather than auto-replying to its sender
- And a world with no such return edge is not sufficient evidence for this scenario, because it blocks identically before and after the change

## Scenario: Human Mention Wins Over Workflow Entry

- Given a free-mention world whose `workflow.entry` is the `coordinator` node
- When a human message begins with `@critic Take a look at this draft.`
- Then the router returns `agent_instruction` for the `critic` agent
- And the returned `workflow` node is the `critic` node
- And `ignoredMentions` is emitted as an empty array

## Scenario: Enforced Terminal Nodes Still Idle On An Unresolved Mention

- Given a `sequential-pipeline` world whose final node declares no outgoing edges
- When the final node's turn is completed with a message beginning `@architekt Please review.` and no stop token
- Then the router returns `idle`, not `blocked`
- And this matches the behavior before the free-mention pattern was added, because the block's allowed-next precondition is retained for enforced worlds

## Scenario: Enforced Patterns Keep The Entry Override

- Given a `sequential-pipeline` world whose entry node is `intake`
- And `workflow.edges.human` lists only the entry node, so human mentions may not enter elsewhere
- When a human message begins with a paragraph-start mention of a later node's agent
- Then the router returns `agent_instruction` for the entry node's agent
- And `ignoredMentions` names the overridden mention
- And this case is asserted by a test that existed before the free-mention pattern was added, or by
  one added alongside it that pins the same output

## Scenario: Enforced Patterns Without Human Edges Still Honor The Mention

- Given a `sequential-pipeline` world that declares no `workflow.edges.human`
- When a human message begins with a paragraph-start mention of a node whose prerequisites are met
- Then the router returns `agent_instruction` for the mentioned node's agent
- And `ignoredMentions` is emitted as an empty array
- And this case is asserted by a test that existed before the free-mention pattern was added, or by
  one added alongside it that pins the same output

## Scenario: Runaway Exchange Stops At The Turn Limit

- Given a free-mention world with a small `world.turnLimit`
- When `coordinator` and `critic` are completed alternately, each mentioning the other, and no message contains the stop token
- Then the router returns `blocked` with code `turn_limit_reached` once the limit is reached
- And the reported limit matches the configured `world.turnLimit`

## Scenario: A Handoff Mention And The Stop Token Cannot Share One Message

- Given a free-mention world with a pending agent turn
- When that turn is completed with a message that begins `@critic Please review.` and also contains the configured stop token
- Then the router returns `done` and never queues a turn for `critic`
- And the generated prompts for this pattern therefore instruct agents to either hand off or stop, never both in one message

## Scenario: A Non-Agent Mention Blocks Rather Than Addressing The User

- Given a free-mention world with a pending agent turn
- When that turn is completed with a message beginning `@human Here is the summary.`
- Then the router returns `blocked` with code `unknown_mention_target`
- And the generated prompts for this pattern therefore instruct agents to end with the stop token instead of mentioning a non-agent

## Scenario: Free-Mention Run Completes On The Stop Token

- Given a free-mention world with a pending agent turn
- When that turn is completed with a message ending in the configured stop token
- Then the router returns `done`
- And the `final` content is the completed message with every line that begins with a resolvable mention removed, not only the first - the existing `stripLeadingMentionLines` filters the whole body, so a free-mention message thanking a peer mid-body loses that line

## Scenario: Contradictory Enforcement Configuration Is Rejected

- Given a world declaring `workflow.type: "sequential-pipeline"` together with `workflow.enforceEdges: false`
- When the router is invoked against that world
- Then the process exits non-zero and writes no result file
- And the printed error names both `workflow.type` and `workflow.enforceEdges`
- And it states the value required for that pattern

## Scenario: A Graph-Bearing Free-Mention World Is Rejected

- Given a `free-mention` world whose `workflow.edges` declares any key, whether mapped to targets or to an empty array
- When the router is invoked against that world
- Then the process exits non-zero and writes no result file
- And the printed error names the offending edge source
- And the same holds for a `free-mention` world declaring only a `human` key

## Scenario: An Agent With No Workflow Node Is Rejected

- Given a `free-mention` world whose `agents` contains an agent that no workflow node references
- When the router is invoked against that world
- Then the process exits non-zero and writes no result file
- And the printed error names that agent
- And the same holds for a `free-mention` world where two workflow nodes reference the same agent
- And for a `free-mention` world declaring only one agent, which would leave that agent no peer to mention

## Scenario: An Absent Or Unknown Workflow Type Is Rejected

- Given a world whose `workflow.type` is absent, and a second whose `workflow.type` is not a canonical pattern id
- When the router is invoked against each world
- Then each invocation exits non-zero and writes no result file
- And the printed error names `workflow.type` rather than reporting an enforcement mismatch

## Scenario: Prerequisites Are Rejected In A Free-Mention World

- Given a `free-mention` world whose `critic` node declares `requires: ["researcher"]`
- When the router is invoked against that world
- Then the process exits non-zero and writes no result file
- And the printed error names the `critic` node and the `free-mention` pattern

## Scenario: Consistent And Absent Enforcement Configurations Load

- Given a free-mention world that omits `workflow.enforceEdges`, and a second that sets it to `false`
- And a `sequential-pipeline` world that omits it, and a second that sets it to `true`
- When the router is invoked against each world in turn
- Then every world loads and routes its first turn successfully
- And no configuration error is raised for any of them

## Scenario: Generated Free-Mention World Passes Deterministic Eval

- Given a `free-mention` world generated per `init-agent-world.md`, with its generated `world.eval.md`
- When `agent-world-eval.js` is run against that config and eval contract
- Then the world loads, so the router's own canonical-pattern-id validation has accepted `free-mention`
- And every deterministic check and routing case in the generated contract passes
- And the report contains no `workflow.type is a canonical workflow pattern id` row, that check having
  moved into the router where it can fail at load time
- And the generated contract contains no routing case expecting a `workflow_edge_blocked` result
