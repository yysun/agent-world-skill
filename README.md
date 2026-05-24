# Agent World Skill

Agent World is a way to run a small team of named agents without letting the chat model improvise who speaks next.

Think of it as a traffic controller:

- `agent-world.yaml` says who the agents are and what order they should work in.
- `scripts/agent-world-router.js` reads that file, remembers the conversation, and decides the next step.
- The host executor runs one returned instruction at a time.
- Agents can ask the host to do real work, such as reading files, writing files, or running tests.

The point is control. The workflow lives in a file, not in the assistant's memory.

## What This Is For

Use this skill when you want a multi-agent workflow that is explicit and repeatable.

For example, an app-building workflow might be:

1. `@pm` turns the user's request into a short brief.
2. `@architect` designs the smallest workable approach.
3. `@dev` asks the host to make code changes.
4. `@qa` and `@sec` review the result.
5. `@pm` gives the final answer.

The agents do not directly run shell commands or edit files. They request host actions, and the host decides whether to perform them.

## Files In This Skill

- `SKILL.md`: instructions for Codex when it acts as the Agent World host executor.
- `scripts/agent-world-router.js`: the router that loads the world, tracks state, and returns the next instruction.
- `agent-world.example.yaml`: a sample world definition with product, architecture, implementation, QA, and security agents.
- `tests/agent-world-router.test.js`: router tests.

## How It Works

Agent World runs inside an agent app such as Codex. Codex is still the model doing the thinking and writing. The router script decides which agent prompt Codex should use next.

Example flow:

1. The human asks Codex: `Build an Electron app`.
2. This skill tells Codex to send that exact message to `scripts/agent-world-router.js`.
3. The router reads `agent-world.yaml`, sees that the workflow starts with `@pm`, and returns a dynamic instruction containing the `@pm` system prompt, workflow step, and conversation context.
4. Codex follows that instruction and writes one message as `@pm`, such as a short product brief ending with:

   ```text
   @architect
   Please design the smallest workable version.
   ```

5. Codex sends the `@pm` response back to the router.
6. The router sees the paragraph-start `@architect` mention, checks the workflow edge, loads the `@architect` system prompt, and returns a new dynamic instruction for Codex.
7. Codex now writes one message as `@architect`, usually handing off to `@dev`.
8. The same loop continues: router chooses the next agent, Codex executes that one agent turn, then the response goes back to the router.

When an agent needs real work, like file edits or tests, it does not do that work directly. It emits a host action request. The router returns `host_action`, Codex performs the approved work using normal tools, and the result goes back into the router.

The router can return five result types:

- `agent_instruction`: Codex should run one turn as the selected agent.
- `host_action`: Codex may perform real host work requested by an agent.
- `blocked`: the workflow cannot continue without user or config intervention.
- `done`: Codex should return the final answer to the human.
- `idle`: nothing is waiting.

`blocked` is deliberate. It is what happens when the router refuses to guess, for example after an off-edge handoff, a turn-limit stop, or invalid routing state. The host should report the block and stop the loop instead of choosing a fallback agent.

The important rule: Codex does not pick the next agent. Codex always sends the latest message to the router and follows the one instruction the router returns.

## Quick Start

1. Install this skill in an agent app, such as Codex.

2. Create an `agent-world.yaml` file in your project.

   You can start by copying `agent-world.example.yaml` and editing the agents, prompts, and workflow.

3. Ask the agent app for the work you want:

   ```text
   Build an Electron app.
   ```

The skill should route the request through the router script. Codex will then run the first selected agent, send that agent's response back to the router, and continue through the workflow.

## The Short Version

Agent World turns a loose multi-agent conversation into a controlled workflow.

The YAML file defines the team and path. The router remembers state and chooses the next step. The host executes only what the router returns.
