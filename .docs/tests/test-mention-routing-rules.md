# E2E Test Spec: Mention Routing Rules

The executable E2E suite must cover at least 20 router CLI cases. Each case creates a temporary world, invokes `scripts/agent-world-router.js` as a process, and verifies the returned JSON instruction.

## Scenario: Full Mention-Routed DAG Run

1. Create a temporary `agent-world.yaml` with a DAG containing intake, architecture, implementation, QA, security, and final nodes.
2. Start the router through the CLI.
3. Route a human paragraph-start display-name mention into architecture.
4. Complete agent turns with ignored code-fence mentions, normalized greeting mentions, a host action, `world TO` fan-out, and review-lane joins.
5. Confirm the final agent only runs after both QA and security are complete.
6. End with a completion tag and confirm routing stops with `done`.

## Scenario: Main-Agent Fallback

1. Configure `world.mainAgent`.
2. Send a human message with no paragraph-start mention.
3. Confirm the router enters the matching DAG node rather than defaulting blindly to the workflow entry.

## Scenario: Off-Edge Normalized Mention Block

1. Start from a node whose allowed next edge does not include the normalized target.
2. Mention the target by display name with greeting syntax.
3. Confirm the router returns `workflow_edge_blocked`.

## Scenario: Completion Tags Precede Host Actions

1. Complete an agent turn with a completion tag and a syntactically valid host-action block.
2. Confirm the router returns `done`, not `host_action`.

## Boundary Scenarios

- Human no-mention entry falls back to the workflow entry without `world.mainAgent`.
- `workflow.edges.human` can restrict or allow direct mentioned entry.
- Leading whitespace before a paragraph mention routes.
- Greeting prefixes with punctuation route.
- Snake-case, hyphenated, and space-separated display-name mentions normalize to the same agent.
- Duplicate paragraph mentions queue one turn per target node.
- Self-only agent mentions do not create routes.
- Mid-text mentions do not route.
- Unknown human paragraph mentions fall back to workflow entry.
- `<world>TO:a,b</world>` ignores invalid targets but blocks valid off-edge targets.
- Join targets wait when `requires` are incomplete.
- `enforceEdges: false` permits fallback agent mention routing outside the DAG.
- Custom `world.stopToken` completes the run.
- Auto-reply routes only when a return edge allows it.
- `<world>STOP</world>` suppresses mention routing.
- `<world>TO:a,b</world>` replaces leading mentions instead of merging with them.
