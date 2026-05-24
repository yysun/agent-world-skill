/*
  End-to-end mention routing coverage for the Agent World router CLI.

  These tests drive the router as a separate process with a real temporary
  agent-world.yaml and persisted state file. They verify complete routing
  outcomes instead of only parser-level behavior.
*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..');
const router = path.join(skillRoot, 'scripts', 'agent-world-router.js');

function makeWorld(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-mention-e2e-'));
  const enforceEdges = options.enforceEdges === false ? 'false' : 'true';
  const humanEdges = options.humanEdges ? `    human: ${options.humanEdges}\n` : '';
  const architectureEdges = options.architectureCanReturnToIntake ? '[implementation, intake]' : '[implementation]';
  fs.writeFileSync(path.join(dir, 'agent-world.yaml'), `
world:
  id: mention-e2e
  name: mention-e2e
  stopToken: "${options.stopToken || '<world>pass</world>'}"
  turnLimit: 20
${options.mainAgent ? `  mainAgent: ${options.mainAgent}\n` : ''}

workflow:
  type: dag
  entry: intake
  entryAgent: pm
  enforceEdges: ${enforceEdges}
  nodes:
    intake:
      agent: pm
      instruction: Clarify the request.
    architecture:
      agent: architect
      instruction: Design the routing flow.
    implementation:
      agent: dev
      instruction: Request host work, then fan out to reviewers.
    qa_review:
      agent: qa
      instruction: Review correctness.
    security_review:
      agent: sec
      instruction: Review security.
    final:
      agent: pm
      requires: [qa_review, security_review]
      instruction: Finish after both reviews.
  edges:
${humanEdges}    intake: [architecture]
    architecture: ${architectureEdges}
    implementation: [qa_review, security_review]
    qa_review: [final]
    security_review: [final]
    final: []

agents:
  pm:
    name: Coordinator
    role: controller
    systemPrompt: |
      You are @Coordinator.
  architect:
    name: Madame Pedagogue
    role: architect
    systemPrompt: |
      You are @Madame Pedagogue.
  dev:
    name: Build Dev
    role: developer
    systemPrompt: |
      You are @Build Dev.
  qa:
    name: Review Captain
    role: qa
    systemPrompt: |
      You are @Review Captain.
  sec:
    name: Security Chief
    role: security
    systemPrompt: |
      You are @Security Chief.
`);
  return {
    cwd: dir,
    statePath: path.join(dir, '.state', 'router-state.json')
  };
}

function run(world, args, input = '') {
  const result = spawnSync(process.execPath, [router, ...args], {
    cwd: world.cwd,
    env: {
      ...process.env,
      AGENT_WORLD_STATE: world.statePath
    },
    input,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout);
  return JSON.parse(result.stdout);
}

function startImplementation(world) {
  run(world, ['reset']);
  let output = run(world, ['user', '--stdin'], 'Start at intake.');
  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], '@Madame Pedagogue\nDesign.');
  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], '@Build Dev\nImplement.');
  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.workflow.node, 'implementation');
  return output;
}

test('e2e: normalized mentions drive a full DAG run through host work, fan-out, join, and completion', () => {
  const world = makeWorld();

  run(world, ['reset']);
  let output = run(world, ['user', '--stdin'], `hello @Madame Pedagogue
Design this directly.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Madame Pedagogue');
  assert.equal(output.workflow.node, 'architecture');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], `Example mention that must not route:

\`\`\`text
@Coordinator
\`\`\`

This mid-text @Coordinator should not route either.

hi @Build Dev
Please implement.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Build Dev');
  assert.equal(output.workflow.node, 'implementation');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], `Implementation needs real host work.

@Review Captain
Do not route until host work is done.

\`\`\`agent-world-host-action
{
  "kind": "shell",
  "reason": "Run generated checks",
  "approval": "required",
  "payload": {
    "command": "node --version"
  }
}
\`\`\``);

  assert.equal(output.type, 'host_action');
  assert.equal(output.requestedBy, 'dev');
  assert.equal(output.workflowNode, 'implementation');

  output = run(world, ['complete', '--action', output.actionId, '--stdin'], '{"status":"succeeded","summary":"node version checked"}');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Build Dev');
  assert.equal(output.reason, 'host_action_result');
  assert.equal(output.workflow.node, 'implementation');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], `@Build Dev
Ignore this self mention.

<world>TO:Review Captain, Security Chief</world>
Review the implementation.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Review Captain');
  assert.equal(output.workflow.node, 'qa_review');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], `to @Coordinator
QA approved.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Security Chief');
  assert.equal(output.workflow.node, 'security_review');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], `hello @Coordinator
Security approved.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Coordinator');
  assert.equal(output.workflow.node, 'final');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], `@Madame Pedagogue

Final summary. <world>PASS</world>`);

  assert.equal(output.type, 'done');
  assert.equal(output.final, 'Final summary. <world>PASS</world>');
});

test('e2e: world mainAgent handles human no-mention entry through the DAG', () => {
  const world = makeWorld({ mainAgent: 'architect' });

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], 'Design this without an explicit mention.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Madame Pedagogue');
  assert.equal(output.reason, 'human_mention_workflow_node');
  assert.equal(output.workflow.node, 'architecture');
});

test('e2e: normalized off-edge display-name mention is blocked by DAG enforcement', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start at intake.');
  const blocked = run(world, ['complete', '--turn', start.turnId, '--stdin'], `hello @Build Dev
Skip architecture.`);

  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.code, 'workflow_edge_blocked');
  assert.equal(blocked.sourceAgent, 'pm');
  assert.equal(blocked.sourceNode, 'intake');
  assert.deepEqual(blocked.mentions, ['dev']);
  assert.deepEqual(blocked.allowedNext, ['architecture']);
});

test('e2e: completion tags stop routing before host actions are queued', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start at intake.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], `<world>DONE</world>

\`\`\`agent-world-host-action
{
  "kind": "shell",
  "reason": "This must not run",
  "approval": "required",
  "payload": {
    "command": "exit 1"
  }
}
\`\`\``);

  assert.equal(output.type, 'done');
  assert.match(output.final, /<world>DONE<\/world>/);
});

test('e2e: human no-mention falls back to workflow entry when mainAgent is absent', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], 'No mention here.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Coordinator');
  assert.equal(output.reason, 'entry_workflow_node');
  assert.equal(output.workflow.node, 'intake');
});

test('e2e: human edges restrict direct mentioned entry into a non-human node', () => {
  const world = makeWorld({ humanEdges: '[intake]' });

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], '@Madame Pedagogue\nTry to skip intake.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Coordinator');
  assert.equal(output.reason, 'entry_workflow_node');
  assert.equal(output.workflow.node, 'intake');
});

test('e2e: human edges allow direct mentioned entry when the node is listed', () => {
  const world = makeWorld({ humanEdges: '[architecture]' });

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], '@Madame Pedagogue\nDesign directly.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Madame Pedagogue');
  assert.equal(output.reason, 'human_mention_workflow_node');
  assert.equal(output.workflow.node, 'architecture');
});

test('e2e: leading whitespace before a paragraph mention still routes', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], '   @Madame Pedagogue\nDesign.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Madame Pedagogue');
  assert.equal(output.workflow.node, 'architecture');
});

test('e2e: greeting prefix with punctuation before a paragraph mention still routes', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], 'hey, @Madame Pedagogue\nDesign.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Madame Pedagogue');
  assert.equal(output.workflow.node, 'architecture');
});

test('e2e: snake-case mention resolves against normalized display name', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  const output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], '@review_captain\nReview.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Review Captain');
  assert.equal(output.workflow.node, 'qa_review');
});

test('e2e: hyphenated mention resolves against normalized display name', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  const output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], '@Security-Chief\nReview.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Security Chief');
  assert.equal(output.workflow.node, 'security_review');
});

test('e2e: space-separated display-name mention resolves through second TitleCase word', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  const output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], '@Review Captain\nReview.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Review Captain');
  assert.equal(output.workflow.node, 'qa_review');
});

test('e2e: duplicate paragraph mentions queue one turn per target node', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  let output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], `@Review Captain
First review mention.

@Review Captain
Duplicate review mention.

@Security Chief
Security mention.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Review Captain');
  assert.equal(output.workflow.node, 'qa_review');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], '@Coordinator\nQA approved.');
  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Security Chief');
  assert.equal(output.workflow.node, 'security_review');
});

test('e2e: self-only agent mention does not create a route', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], '@Coordinator\nThinking aloud.');

  assert.equal(output.type, 'idle');
});

test('e2e: mid-text mention without paragraph-start mention does not route', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], 'Please ask @Madame Pedagogue later.');

  assert.equal(output.type, 'idle');
});

test('e2e: unknown human paragraph mention falls back to workflow entry', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], '@Nobody\nStart anyway.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Coordinator');
  assert.equal(output.reason, 'entry_workflow_node');
  assert.equal(output.workflow.node, 'intake');
});

test('e2e: world TO with an invalid target ignores invalid entries and routes valid ones', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  const output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], '<world>TO:Ghost, Review Captain</world>\nReview.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Review Captain');
  assert.equal(output.workflow.node, 'qa_review');
});

test('e2e: world TO off-edge target is blocked by DAG enforcement', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const blocked = run(world, ['complete', '--turn', start.turnId, '--stdin'], '<world>TO:Build Dev</world>\nSkip design.');

  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.code, 'workflow_edge_blocked');
  assert.deepEqual(blocked.mentions, ['dev']);
  assert.deepEqual(blocked.allowedNext, ['architecture']);
});

test('e2e: join target waits when requires are not complete', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  let output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], '@Review Captain\nQA only.');
  assert.equal(output.workflow.node, 'qa_review');

  output = run(world, ['complete', '--turn', output.turnId, '--stdin'], '@Coordinator\nQA approved early.');
  assert.equal(output.type, 'idle');
});

test('e2e: enforceEdges false allows fallback agent mention routing outside the DAG', () => {
  const world = makeWorld({ enforceEdges: false });

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], '@Build Dev\nSkip design.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Build Dev');
  assert.equal(output.reason, 'agent_mention');
  assert.equal(output.workflow.node, null);
});

test('e2e: configured stopToken completes the run and strips leading mentions', () => {
  const world = makeWorld({ stopToken: '<finish/>' });

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], '@Madame Pedagogue\n\nFinished <finish/>');

  assert.equal(output.type, 'done');
  assert.equal(output.final, 'Finished <finish/>');
});

test('e2e: auto-reply routes to source agent when a return edge allows it', () => {
  const world = makeWorld({ architectureCanReturnToIntake: true });

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const architecture = run(world, ['complete', '--turn', start.turnId, '--stdin'], '@Madame Pedagogue\nDesign.');
  const output = run(world, ['complete', '--turn', architecture.turnId, '--stdin'], 'Need product clarification.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Coordinator');
  assert.equal(output.reason, 'workflow_edge');
  assert.equal(output.workflow.node, 'intake');
});

test('e2e: auto-reply does not route when the return edge is not allowed', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const architecture = run(world, ['complete', '--turn', start.turnId, '--stdin'], '@Madame Pedagogue\nDesign.');
  const output = run(world, ['complete', '--turn', architecture.turnId, '--stdin'], 'Need product clarification.');

  assert.equal(output.type, 'idle');
});

test('e2e: world STOP completion tag suppresses mention routing', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const start = run(world, ['user', '--stdin'], 'Start.');
  const output = run(world, ['complete', '--turn', start.turnId, '--stdin'], '@Madame Pedagogue\n\nStopped. <world>STOP</world>');

  assert.equal(output.type, 'done');
  assert.equal(output.final, 'Stopped. <world>STOP</world>');
});

test('e2e: world TO replaces leading mentions instead of merging with them', () => {
  const world = makeWorld();
  const implementation = startImplementation(world);

  const output = run(world, ['complete', '--turn', implementation.turnId, '--stdin'], `@Review Captain
This leading mention should be replaced.

<world>TO:Security Chief</world>
Security only.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Security Chief');
  assert.equal(output.workflow.node, 'security_review');
});
