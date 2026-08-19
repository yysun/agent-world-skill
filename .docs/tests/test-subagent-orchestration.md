# E2E Test Spec: Deterministic Subagent Orchestration

Each scenario creates a temporary world directory, drives
`skills/agent-world/scripts/agent-world-router.js` through the file handoff protocol
(`file --request ... --result ...`), and asserts on the JSON written to the result file. No live
model is involved; agent turns are completed with fixed text.

## Scenario: Same-line capitalized handoff routes instead of stalling

- Given a sequential-pipeline world with `intake -> architect -> builder` and `enforceEdges: true`
- Given a human message has queued the `intake` turn
- When the `intake` turn is completed with `Requirements captured.\n\n@architect Please design the app.`
- Then the next result is `agent_instruction` for the `architect` agent at the `architect` node
- Then the result is not `idle` and not `blocked`

## Scenario: Multi-word display-name mention still resolves

- Given a world with an agent whose `name` is a two-word display name
- Given that agent is an allowed next target from the current node
- When the current turn is completed with a paragraph-start mention of the full two-word display name
- Then the next result is `agent_instruction` for that agent

## Scenario: Unknown mention target blocks instead of stalling silently

- Given a world where the current node has at least one outgoing edge
- When that node's turn is completed with a paragraph-start mention of a name matching no agent, and
  the message contains no other resolved mention, no host action, and no completion tag
- Then the next result is `blocked` with a machine-readable code identifying an unknown mention target
- Then the reported reason names the unresolved token

## Scenario: Partially resolvable fan-out does not block

- Given a world whose current node may route to two review lanes
- When the turn is completed with a `world TO` tag naming one unknown target and one known target
- Then the router routes to the known target and does not report an unknown-mention block

## Scenario: A new human message recovers a blocked run

- Given a fan-out world where one lane's turn is still pending
- Given the other lane completed with an off-edge mention, so the run is blocked
- When a new human message is ingested
- Then the next result is an `agent_instruction` for the still-pending lane rather than the same block
- Then the previously pending routing error is no longer returned for that run

## Scenario: A stop token inside a fenced code block does not end the run

- Given a world whose entry node may route onward
- When the entry turn is completed with the stop token appearing only inside a fenced code block,
  followed by a valid paragraph-start handoff
- Then the router routes to the mentioned agent and the run is not done
- When a later turn is completed with the stop token in ordinary prose
- Then the router returns `done` and the recorded final content still contains the stop token verbatim

## Scenario: An overridden human mention is reported

- Given a world whose `workflow.edges.human` allows only the entry node
- When a human message contains a paragraph-start mention of a known agent that is not an allowed
  human entry target
- Then the router still routes to the entry node
- Then the returned instruction reports the overridden mention in a dedicated field
- Then the host instruction text states that the mention was overridden

## Scenario: Agent-scope context delivers every addressed lane at a fan-in node

- Given a fan-in world where a collector node lists two review nodes in `requires`
- Given the collector agent is configured with `contextScope: agent`
- When both review lanes complete with distinct findings and each mentions the collector
- Then the collector's `agent_instruction` context contains both lanes' latest messages
- Then the rendered host instruction contains both findings

## Scenario: Parallel dispatch returns every independent pending turn

- Given a fan-out world with `workflow.parallelDispatch` enabled
- When the lead turn is completed with paragraph-start mentions of both review lanes
- Then the next result is a batch result whose turns array contains one complete instruction payload
  per pending lane
- Then each batched turn carries its own distinct request and result handoff paths
- When each batched turn is completed in reverse order
- Then both completions are accepted and the collector is queued once

## Scenario: Parallel dispatch stays off by default

- Given the same fan-out world without `workflow.parallelDispatch`
- When the lead turn is completed with mentions of both review lanes
- Then the next result is a single `agent_instruction` for one lane, and the other lane remains pending

## Scenario: Per-agent subagent dispatch settings reach the host

- Given a world whose agent entries configure subagent dispatch settings and a per-agent context limit
- When that agent's turn is dispatched
- Then the instruction carries the configured dispatch settings
- Then the delivered context honors the per-agent context limit rather than the default

## Scenario: The legacy array-edge dialect is rejected

- Given a `world.json` whose `workflow.edges` is an array of from/to objects, or whose edges carry a
  `join` key
- When any router command loads that config
- Then the router fails with a configuration error naming the object form
- Then no synthesized workflow node id is produced

## Scenario: A dispatched batch turn is not offered twice

- Given a fan-out world with `workflow.parallelDispatch` enabled and two lanes pending in a batch
- When the router is asked for the next instruction before either lane completes
- Then the already-dispatched lanes are not returned again for dispatch
- Then the router reports that it is awaiting the dispatched turns, naming their turn ids
- When one lane completes out of order
- Then the router still reports the other lane as awaited rather than dispatching it a second time
- When the remaining lane completes
- Then the router returns the node those lanes unblock
