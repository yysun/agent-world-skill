
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
  agent-authored message has no resolved mention, its node has outgoing edges, and it contains an
  unresolved paragraph-start mention, the router returns `blocked` with code `unknown_mention_target`
  rather than letting the run stall.

## Main-Agent Fallback

If `world.mainAgent` is configured, a human message with no paragraph-beginning mention is rewritten as an implicit `@mainAgent` route before subscriber handling and queue preflight. This makes the main agent the default responder while preserving explicit mentions when the user provides them.

## Auto-Mention On Agent Replies

After generation, the runtime removes self-mentions from the start of paragraphs. If an agent is replying to another agent and the response still has no paragraph-beginning mention, the runtime prepends `@sender` automatically. World tags refine that behavior:

- `<world>STOP</world>`, `<world>DONE</world>`, and `<world>PASS</world>` suppress auto-mention and strip leading mentions.
- `<world>TO:a,b</world>` replaces leading mentions with explicit recipients.

