# E2E Test Spec: Agent World Skill Restructure

The relocation changes one consumer contract: where an installed Agent World skill's files live and whether that directory works on its own. These scenarios cover exactly that. Router and eval behavior is covered by the three existing suites, which must pass unchanged and are not restated here.

Scenarios are executed against the repository after the move. The standalone scenarios copy `skills/agent-world/` to a temporary directory outside the repository so a hidden dependency on the surrounding tree cannot pass unnoticed.

---

## Scenario: The skill directory holds the complete installable unit

- Given the repository after the restructure
- When the contents of `skills/agent-world/` are listed
- Then it contains the skill manifest, the canonical schema, the canonical example, the init and eval reference documents, the mention-routing reference, the sample prompts directory, and the scripts directory
- And the router and eval scripts are siblings inside the scripts directory

## Scenario: The repository root keeps only scaffolding

- Given the repository after the restructure
- When the repository root is listed
- Then no relocated skill file remains at the root
- And `README.md`, `tests/`, `.docs/`, `.gitignore`, and `agent-world-studio-mvp.md` are still present

## Scenario: Existing suites pass unchanged against the new layout

- Given the pre-move per-suite pass counts recorded as a baseline
- When `node --test tests/*.test.js` is run after the move
- Then every suite passes
- And the per-suite and total counts equal the recorded baseline
- And the only functional difference in the test sources is the single `skillRoot` expression in each of the three suites, verified via `git diff tests/` immediately after the reference-update phase and before the file comment blocks required by the RPD convention are added

## Scenario: The router runs from a standalone copy of the skill

- Given `skills/agent-world/` copied on its own to a temporary directory outside the repository
- When the router's help command is run from that copy
- Then it executes successfully
- And it resolves without reading any file from the original repository

## Scenario: The eval runner runs from a standalone copy of the skill

- Given `skills/agent-world/` copied on its own to a temporary directory outside the repository, and a temporary project world with prompts and an eval contract
- When the eval runner is invoked from that copy against the temporary project
- Then it loads the router as a sibling script, loads the canonical schema, and reads its reference document
- And it completes and writes its report without reaching into the original repository

## Scenario: Skill-relative references still resolve after relocation

- Given the skill manifest inside the standalone copy, which defines the router and the eval reference as skill-relative
- When those references are resolved against the directory containing the manifest
- Then each one resolves to an existing file inside the standalone copy
- And none of them was rewritten to a repository-root or absolute path

## Scenario: No compatibility surface was left behind

- Given the repository after the restructure
- When the repository root is inspected for shims, symbolic links, wrapper scripts, and environment-variable fallbacks pointing at the old locations
- Then none exists
- And the old root paths resolve nowhere

## Scenario: File history survives the move

- Given the staged restructure
- When the staged changes are inspected with rename detection
- Then every relocated path is reported as a rename rather than as a delete plus an add
- And history for the router and eval scripts is continuous across the move
