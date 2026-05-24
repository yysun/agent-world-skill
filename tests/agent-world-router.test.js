const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..');
const router = path.join(skillRoot, 'scripts', 'agent-world-router.js');

function makeWorld(options = {}) {
  const turnLimit = options.turnLimit || 12;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-router-test-'));
  fs.writeFileSync(path.join(dir, 'agent-world.yaml'), `
world:
  id: test-world
  name: test-world
  stopToken: "<world>pass</world>"
  turnLimit: ${turnLimit}

workflow:
  type: dag
  entry: requirements
  entryAgent: pm
  enforceEdges: true
  nodes:
    requirements:
      agent: pm
      instruction: Write a brief and hand off.
    architecture:
      agent: architect
      instruction: Design and hand off.
    implementation:
      agent: dev
      instruction: Request implementation host work.
    qa_review:
      agent: qa
      instruction: Review quality.
    security_review:
      agent: sec
      instruction: Review security.
    final:
      agent: pm
      requires: [qa_review, security_review]
      instruction: Finish after both reviews.
  edges:
    requirements: [architecture]
    architecture: [implementation]
    implementation: [qa_review, security_review]
    qa_review: [final]
    security_review: [final]
    final: []

agents:
  pm:
    role: product_manager
    systemPrompt: |
      You are @pm in the test world.
  architect:
    role: software_architect
    systemPrompt: |
      You are @architect in the test world.
  dev:
    role: implementation_engineer
    systemPrompt: |
      You are @dev in the test world.
  qa:
    role: qa_reviewer
    systemPrompt: |
      You are @qa in the test world.
  sec:
    role: security_reviewer
    systemPrompt: |
      You are @sec in the test world.
`);
  return {
    cwd: dir,
    statePath: path.join(dir, '.state', 'router-state.json')
  };
}

function run(world, args, input = '') {
  const env = {
    ...process.env,
    AGENT_WORLD_STATE: world.statePath
  };
  delete env.AGENT_WORLD_CONFIG;

  const result = spawnSync(process.execPath, [router, ...args], {
    cwd: world.cwd,
    input,
    env,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout);
  return JSON.parse(result.stdout);
}

test('unit: loads agent-world.yaml from cwd and returns the configured entry agent', () => {
  const world = makeWorld();

  const reset = run(world, ['reset']);
  assert.equal(fs.realpathSync(reset.configPath), fs.realpathSync(path.join(world.cwd, 'agent-world.yaml')));

  const next = run(world, ['user', '--stdin'], 'build an electron app');
  assert.equal(next.type, 'agent_instruction');
  assert.equal(next.world, 'test-world');
  assert.equal(next.agent, 'pm');
  assert.equal(next.role, 'product_manager');
  assert.equal(next.workflow.node, 'requirements');
  assert.deepEqual(next.workflow.next.map(item => item.node), ['architecture']);
  assert.match(next.systemPrompt, /@pm in the test world/);
  assert.equal(next.responseContract.completeByRunning, 'node "$ROUTER" complete --turn turn_0001 --stdin');
});

test('targeted: routes through DAG and waits for both review lanes before final PM', () => {
  const world = makeWorld();

  run(world, ['reset']);
  let output = run(world, ['user', '--stdin'], 'build an electron app');
  assert.equal(output.agent, 'pm');
  assert.equal(output.workflow.node, 'requirements');

  output = run(world, ['complete', '--turn', 'turn_0001', '--stdin'], `[STATE=requirements]

@architect
Please design.`);
  assert.equal(output.agent, 'architect');
  assert.equal(output.workflow.node, 'architecture');

  output = run(world, ['complete', '--turn', 'turn_0002', '--stdin'], `[STATE=architecture]

@dev
Please implement.`);
  assert.equal(output.agent, 'dev');
  assert.equal(output.workflow.node, 'implementation');

  output = run(world, ['complete', '--turn', 'turn_0003', '--stdin'], `[STATE=implementation_ready]

@qa
Please review.

@sec
Please review.`);
  assert.equal(output.agent, 'qa');
  assert.equal(output.workflow.node, 'qa_review');

  output = run(world, ['complete', '--turn', 'turn_0004', '--stdin'], `[STATE=qa_review_complete]

@pm
QA approved.`);
  assert.equal(output.agent, 'sec');
  assert.equal(output.workflow.node, 'security_review');

  output = run(world, ['complete', '--turn', 'turn_0005', '--stdin'], `[STATE=security_review_complete]

@pm
Security approved.`);
  assert.equal(output.agent, 'pm');
  assert.equal(output.workflow.node, 'final');
  assert.deepEqual(output.workflow.next, []);
});

test('targeted: host actions round-trip back to the requesting agent and workflow node', () => {
  const world = makeWorld();

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\nPlease design.');
  run(world, ['complete', '--turn', 'turn_0002', '--stdin'], '@dev\nPlease implement.');

  const action = run(world, ['complete', '--turn', 'turn_0003', '--stdin'], `Need host work.

\`\`\`agent-world-host-action
{
  "kind": "file_write_batch",
  "reason": "Create files",
  "approval": "required",
  "payload": {
    "files": [
      {"path": "package.json", "content": "{}"}
    ]
  }
}
\`\`\``);

  assert.equal(action.type, 'host_action');
  assert.equal(action.requestedBy, 'dev');
  assert.equal(action.workflowNode, 'implementation');
  assert.equal(action.kind, 'file_write_batch');
  assert.equal(action.payload.files[0].path, 'package.json');

  const next = run(world, ['complete', '--action', action.actionId, '--stdin'], '{"status":"succeeded","summary":"created files"}');
  assert.equal(next.type, 'agent_instruction');
  assert.equal(next.agent, 'dev');
  assert.equal(next.reason, 'host_action_result');
  assert.equal(next.workflow.node, 'implementation');
});

test('regression: paragraph mentions inside fenced code do not route', () => {
  const world = makeWorld();

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  const output = run(world, ['complete', '--turn', 'turn_0001', '--stdin'], `Do not route this example.

\`\`\`text
@architect
This is inside a code fence.
\`\`\``);

  assert.equal(output.type, 'idle');
});

test('regression: human paragraph mention maps to the matching workflow node', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], '@architect\nPlease design directly.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'architect');
  assert.equal(output.reason, 'human_mention_workflow_node');
  assert.equal(output.workflow.node, 'architecture');
});

test('regression: completed workflow nodes are scoped to the current run', () => {
  const world = makeWorld();

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\nPlease design.');
  run(world, ['complete', '--turn', 'turn_0002', '--stdin'], '@dev\nPlease implement.');
  run(world, ['complete', '--turn', 'turn_0003', '--stdin'], '@qa\nPlease review.\n\n@sec\nPlease review.');
  run(world, ['complete', '--turn', 'turn_0004', '--stdin'], '@pm\nQA approved.');
  run(world, ['complete', '--turn', 'turn_0005', '--stdin'], '@pm\nSecurity approved.');
  const idle = run(world, ['complete', '--turn', 'turn_0006', '--stdin'], 'Done.');
  assert.equal(idle.type, 'idle');

  const next = run(world, ['user', '--stdin'], '@pm\nBuild a second app.');
  assert.equal(next.type, 'agent_instruction');
  assert.notEqual(next.runId, idle.runId);
  assert.equal(next.agent, 'pm');
  assert.equal(next.workflow.node, 'requirements');
});

test('regression: human mention of duplicated agent does not use stale final prerequisites', () => {
  const world = makeWorld();

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], '@pm\nBuild an Electron app.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'pm');
  assert.equal(output.reason, 'human_mention_workflow_node');
  assert.equal(output.workflow.node, 'requirements');
});

test('regression: turnLimit blocks additional agent turns in the current run', () => {
  const world = makeWorld({ turnLimit: 1 });

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  const blocked = run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\nPlease design.');

  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.code, 'turn_limit_reached');
  assert.match(blocked.reason, /turn limit 1 reached/);
  assert.equal(blocked.completedTurns, 1);
});

test('regression: off-edge agent mentions return a blocked routing result', () => {
  const world = makeWorld();

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\nPlease design.');
  run(world, ['complete', '--turn', 'turn_0002', '--stdin'], '@dev\nPlease implement.');
  run(world, ['complete', '--turn', 'turn_0003', '--stdin'], '@qa\nPlease review.');
  const blocked = run(world, ['complete', '--turn', 'turn_0004', '--stdin'], '@dev\nBlocking issue found. Please fix.');

  assert.equal(blocked.type, 'blocked');
  assert.equal(blocked.code, 'workflow_edge_blocked');
  assert.equal(blocked.sourceAgent, 'qa');
  assert.equal(blocked.sourceNode, 'qa_review');
  assert.deepEqual(blocked.mentions, ['dev']);
  assert.deepEqual(blocked.allowedNext, ['final']);
  assert.match(blocked.reason, /qa_review -> implementation/);
});
