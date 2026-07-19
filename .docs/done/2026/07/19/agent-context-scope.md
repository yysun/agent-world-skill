# Agent Context Scope

## Summary

- Added per-agent `contextScope` with `global` and `agent` modes; omitted values remain backward-compatible as `global`.
- `agent` scope reserves the current routed-from message plus up to 17 recent messages authored by that agent in the current run.
- Structured context and rendered host instructions now use the same selected messages, preventing branch context from leaking through the prompt.
- The canonical example and all nine built-in workflows now assign explicit role-appropriate scopes.

## Verification

- `node --test tests/*.test.js`: 57 passed, 0 failed.
- `git diff --check`, router syntax checking, and JSON parsing passed.
- Independent architecture review, code review, and acceptance verification passed with no remaining material findings.

## Notes

- Native subagent execution, per-agent inbox files, causal history, and scheduling changes remain out of scope.
