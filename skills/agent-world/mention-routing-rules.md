
# @mention Rules

Agent World only treats paragraph-beginning `@mentions` as routing signals. A mention inside normal sentence text is recorded, but it does not make an agent reply immediately.

## Facts

- A human or world message with no paragraph-beginning mention is public and all active agents may respond.
- A human message with a paragraph-beginning mention only targets the mentioned agents.
- A human message with only mid-text mentions targets nobody for immediate reply.
- An agent-authored message only targets agents whose ids match paragraph-beginning mentions.
- Mention parsing ignores leading whitespace and optional greeting prefixes such as `hey`, `hi`, `hello`, and `to`.
- Display-name mentions can span a second TitleCase word, so forms like `@Madame Pedagogue` normalize correctly.
- Resolution is longest-match-first: the two-word display name is tried first, and when it matches no
  agent the single-word id is used. This is why `@architect Please design the app.` routes to
  `architect` while `@Madame Pedagogue` still routes to that display name.
- Matching is case-insensitive after normalization; spaces and most punctuation collapse to hyphens.
- Multi-target fan-out is line-oriented: use one paragraph-beginning mention per paragraph or line.
  In practice the parser is line-oriented throughout, so a mention at the start of any line routes.
- A paragraph-beginning mention that resolves to no agent is a routing error, not a no-op. When an
  agent-authored message has no resolved mention and contains an unresolved paragraph-start mention,
  the router returns `blocked` with code `unknown_mention_target` rather than letting the run stall.
  In an edge-enforced world the agent's node must also have outgoing edges, so a terminal node still
  goes idle; a `free-mention` world has no such precondition.
- This block is checked **before** the router's auto-reply step (the `@sender` fallback described
  below), so an unresolved mention is not quietly replaced by a reply to the previous sender. One exception survives by design: an edge-enforced turn carrying no
  workflow node has no allowed-next set to check, so it still auto-replies to its sender and drops the
  unresolved token. Blocking there instead would leave that turn with neither a route nor an error.
  It is reachable only from a state file written under an older config.
- Some messages still end at `idle` rather than blocking. These depend on message content, not on
  config, so a perfectly well-formed world reaches them:
  - An agent produces no paragraph-start mention and no stop token while it has no auto-reply
    target. There is no unresolved token to report, so nothing routes and nothing blocks. An agent
    has no auto-reply target when its turn came from the human rather than from a peer; when it came
    from a host-action result, because the routed-from message's sender is `host`, which is not an
    agent; and, in an edge-enforced world, when it came from a peer but no edge allows the current
    node back to that peer's node. This is the likeliest shape in a `free-mention` world, where answering the user
    directly is natural; generated prompts tell agents to end with the stop token instead.
  - The same applies when the only paragraph-start mention is the agent's own name. Self-mentions are
    stripped from routing targets, and they resolve, so they leave no unresolved token either. A
    `<world>TO:...</world>` naming only the sender behaves the same way.
  - A `<world>TO:...</world>` tag naming only unresolvable targets. Invalid targets are dropped and
    the tag line does not begin with `@`, so no unresolved token is detected either.
  - An edge-enforced turn carrying no workflow node **and** no auto-reply target. When an auto-reply
    target does exist, that turn routes to it rather than idling, as described above.

## Main-Agent Fallback

If `world.mainAgent` is configured, a human message with no paragraph-beginning mention is rewritten as an implicit `@mainAgent` route before subscriber handling and queue preflight. This makes the main agent the default responder while preserving explicit mentions when the user provides them.

## Auto-Mention On Agent Replies

After generation, the runtime removes self-mentions from the start of paragraphs. If an agent is replying to another agent and the response still has no paragraph-beginning mention, the runtime prepends `@sender` automatically. World tags refine that behavior:

- `<world>STOP</world>`, `<world>DONE</world>`, and `<world>PASS</world>` suppress auto-mention and strip leading mentions.
- A completion tag is read before mentions are, so a message carrying both a handoff mention and the
  stop token ends the run without routing.
- `<world>TO:a,b</world>` replaces leading mentions with explicit recipients.

