# Requirement: Mention Routing Rules

## Problem

`mention-routing-rules.md` defines routing behavior that the router does not fully implement. The mismatch is dangerous because Agent World presents the router as the source of truth, but current routing only recognizes exact lowercase-ish agent ids at paragraph start and ignores the documented normalization, main-agent fallback, and world tag controls.

## Requirements

- The router must parse paragraph-beginning mentions with optional leading whitespace.
- The router must accept optional greeting prefixes before a mention, including `hey`, `hi`, `hello`, and `to`.
- The router must resolve mentions case-insensitively after normalizing spaces and punctuation to hyphens.
- The router must support display-name mentions with a second TitleCase word, such as `@Madame Pedagogue`.
- The router must keep mentions inside fenced code blocks from routing.
- The router must keep mid-text mentions from routing.
- The router must support multi-target fan-out by reading one paragraph-beginning mention per line or paragraph.
- The router must remove self-mentions from agent-authored routing targets.
- If `world.mainAgent` is configured and a human message has no paragraph-beginning mention, the router must use it as an implicit mention.
- Agent reply auto-mention behavior and world tag controls must not bypass DAG routing. Any resulting target must still pass workflow node, edge, and prerequisite checks.
- `<world>TO:a,b</world>` must replace leading mention routing targets with explicit normalized targets.
- `<world>STOP</world>`, `<world>DONE</world>`, and `<world>PASS</world>` must suppress auto-routing and complete the run, alongside the configured `world.stopToken`.

## Acceptance Criteria

- Existing DAG routing tests continue to pass.
- New unit coverage proves normalized mention parsing, display-name mentions, main-agent fallback, world `TO`, self-mention removal, and completion tags.
- Off-edge targets remain blocked when `workflow.enforceEdges` is enabled.
- `mention-routing-rules.md` is restored to the intended rule source rather than rewritten as an implementation note.
