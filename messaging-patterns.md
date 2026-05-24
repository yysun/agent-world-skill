Agent World can do these messaging patterns today:

1. **Broadcast**
   A human/world message with no paragraph-start mention can wake all eligible active agents.

2. **Direct handoff**
   A paragraph-start mention routes to a specific agent:
   ```text
   @researcher
   Find the API behavior.
   ```

3. **Multi-agent fan-out**
   Multiple paragraph-start mentions can wake multiple lanes:
   ```text
   @security
   @performance
   Review this change from your angle.
   ```

4. **Fan-in / collector**
   Multiple agents report back to a collector agent, which merges results and returns to the human.

5. **Sequential pipeline**
   Agent A mentions Agent B, B mentions C, C returns to human. Useful for spec -> build -> test -> review.

6. **Intent router**
   One router agent classifies the request and mentions exactly one specialist.

7. **FSM / state-token workflow**
   Agents carry state in the transcript, for example `[STATE=PLAN]`, `[STATE=EXEC]`, `[STATE=REVIEW]`, then route based on that state.

8. **Debate / ping-pong loop**
   Two agents alternate with explicit mentions until a stop condition is reached.

9. **Orchestrator-worker**
   A planner/controller agent delegates execution to worker agents, then synthesizes results.

