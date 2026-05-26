/*
  Router test coverage for Agent World.

  Recent changes:
  - Added file-based request/result handoff coverage.
  - Added coverage for documented @mention normalization and world tags.
  - DAG edge enforcement remains the compatibility boundary for routed mentions.
*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..');
const router = path.join(skillRoot, 'scripts', 'agent-world-router.js');
let handoffCounter = 0;

function testHandoffName(kind) {
  handoffCounter += 1;
  return `.agent-world/${kind}-20260102T030405${String(handoffCounter).padStart(3, '0')}Z.json`;
}

function makeWorld(options = {}) {
  const turnLimit = options.turnLimit || 12;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-router-test-'));
  fs.writeFileSync(path.join(dir, 'agent-world.yaml'), `
world:
  id: test-world
  name: test-world
  stopToken: "<world>pass</world>"
  turnLimit: ${turnLimit}
${options.mainAgent ? `  mainAgent: ${options.mainAgent}\n` : ''}

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
    architecture: ${options.architectureCanReturnToRequirements ? '[implementation, requirements]' : '[implementation]'}
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
${options.displayNames ? '    name: Software Architect\n' : ''}
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

function runRaw(world, args, input = '') {
  const env = {
    ...process.env,
    AGENT_WORLD_STATE: world.statePath
  };
  delete env.AGENT_WORLD_CONFIG;

  return spawnSync(process.execPath, [router, ...args], {
    cwd: world.cwd,
    input,
    env,
    encoding: 'utf8'
  });
}

function runFile(world, request, options = {}) {
  const handoffDir = path.join(world.cwd, '.agent-world');
  fs.mkdirSync(handoffDir, { recursive: true });
  const requestName = options.requestName || testHandoffName('request');
  const resultName = options.resultName || testHandoffName('result');
  const requestPath = path.join(world.cwd, requestName);
  const resultPath = path.join(world.cwd, resultName);
  fs.writeFileSync(requestPath, JSON.stringify({
    configPath: path.join(world.cwd, 'agent-world.yaml'),
    statePath: world.statePath,
    resultPath,
    ...request
  }, null, 2));

  const result = spawnSync(process.execPath, [router, 'file', '--request', requestPath], {
    cwd: world.cwd,
    env: {
      ...process.env
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^agent-world-router: wrote result-\d{8}T\d{9}Z\.json\n$/);
  assert.equal(result.stderr, '');
  assert.ok(fs.existsSync(resultPath));
  assert.match(path.relative(world.cwd, requestPath), /^\.agent-world\/request-\d{8}T\d{9}Z\.json$/);
  assert.match(path.relative(world.cwd, resultPath), /^\.agent-world\/result-\d{8}T\d{9}Z\.json$/);
  return {
    stdout: result.stdout,
    requestPath,
    resultPath,
    result: JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  };
}

function runFileWithDefaultResult(world, request) {
  const handoffDir = path.join(world.cwd, '.agent-world');
  fs.mkdirSync(handoffDir, { recursive: true });
  const requestPath = path.join(world.cwd, testHandoffName('request'));
  fs.writeFileSync(requestPath, JSON.stringify({
    configPath: path.join(world.cwd, 'agent-world.yaml'),
    statePath: world.statePath,
    ...request
  }, null, 2));

  const result = spawnSync(process.execPath, [router, 'file', '--request', requestPath], {
    cwd: world.cwd,
    env: {
      ...process.env
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const match = result.stdout.match(/^agent-world-router: wrote (result-\d{8}T\d{9}Z\.json)\n$/);
  assert.ok(match, result.stdout);
  const resultPath = path.join(handoffDir, match[1]);
  assert.ok(fs.existsSync(resultPath));
  return {
    stdout: result.stdout,
    requestPath,
    resultPath,
    result: JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  };
}

function makeInvalidWorld(configYaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-invalid-config-test-'));
  fs.writeFileSync(path.join(dir, 'agent-world.yaml'), configYaml);
  return {
    cwd: dir,
    statePath: path.join(dir, '.state', 'router-state.json')
  };
}

function assertInvalidConfig(configYaml, expectedMessage) {
  const world = makeInvalidWorld(configYaml);
  const result = runRaw(world, ['reset']);
  assert.notEqual(result.status, 0, result.stdout);
  const error = JSON.parse(result.stderr);
  assert.equal(error.type, 'error');
  assert.match(error.error, /Invalid Agent World config/);
  assert.match(error.error, expectedMessage);
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
  assert.match(next.responseContract.completeByRunning, /^node "\$ROUTER" file --request \.agent-world\/request-\d{8}T\d{9}Z-turn-turn_0001\.json --result \.agent-world\/result-\d{8}T\d{9}Z-turn-turn_0001\.json$/);
  assert.match(next.responseContract.requestPath, /^\.agent-world\/request-\d{8}T\d{9}Z-turn-turn_0001\.json$/);
  assert.match(next.responseContract.resultPath, /^\.agent-world\/result-\d{8}T\d{9}Z-turn-turn_0001\.json$/);
  assert.deepEqual(next.responseContract.requestJson, {
    command: 'complete',
    turnId: 'turn_0001',
    content: 'one markdown message as @pm'
  });
});

test('unit: file handoff writes user result to timestamped .agent-world result and keeps stdout status-only', () => {
  const world = makeWorld();

  const output = runFile(world, {
    command: 'user',
    content: 'build an electron app'
  });

  assert.equal(output.result.type, 'agent_instruction');
  assert.equal(output.result.agent, 'pm');
  assert.equal(output.result.workflow.node, 'requirements');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(output.resultPath, 'utf8')));
  assert.doesNotMatch(output.stdout, /"type"/);
  assert.doesNotMatch(output.stdout, /agent_instruction/);
});

test('unit: file handoff defaults result output to timestamped .agent-world file', () => {
  const world = makeWorld();

  const output = runFileWithDefaultResult(world, {
    command: 'user',
    content: 'build an electron app'
  });

  assert.equal(output.result.type, 'agent_instruction');
  assert.match(path.relative(world.cwd, output.requestPath), /^\.agent-world\/request-\d{8}T\d{9}Z\.json$/);
  assert.match(path.relative(world.cwd, output.resultPath), /^\.agent-world\/result-\d{8}T\d{9}Z\.json$/);
});

test('unit: file handoff completes turns and host actions through structured files', () => {
  const world = makeWorld();

  let output = runFile(world, {
    command: 'user',
    content: 'build an electron app'
  }).result;

  output = runFile(world, {
    command: 'complete',
    turnId: output.turnId,
    content: '@architect\nPlease design.'
  }).result;
  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'architect');

  output = runFile(world, {
    command: 'complete',
    turnId: output.turnId,
    content: '@dev\nPlease implement.'
  }).result;
  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'dev');

  output = runFile(world, {
    command: 'complete',
    turnId: output.turnId,
    content: `Need host work.

\`\`\`agent-world-host-action
{
  "kind": "shell",
  "reason": "Check runtime",
  "approval": "required",
  "payload": {
    "command": "node --version"
  }
}
\`\`\``
  }).result;
  assert.equal(output.type, 'host_action');
  assert.equal(output.kind, 'shell');

  output = runFile(world, {
    command: 'complete',
    actionId: output.actionId,
    content: {
      status: 'succeeded',
      summary: 'checked runtime'
    }
  }).result;

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'dev');
  assert.equal(output.reason, 'host_action_result');
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

test('regression: normalized greeting and display-name mentions route through DAG edges', () => {
  const world = makeWorld({ displayNames: true });

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  const output = run(world, ['complete', '--turn', 'turn_0001', '--stdin'], `[STATE=requirements]

@pm
self mention should be ignored.

hello @Software Architect
Please design.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'Software Architect');
  assert.equal(output.workflow.node, 'architecture');
});

test('regression: world mainAgent is used as a human no-mention fallback inside the DAG', () => {
  const world = makeWorld({ mainAgent: 'architect' });

  run(world, ['reset']);
  const output = run(world, ['user', '--stdin'], 'please design directly');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'architect');
  assert.equal(output.reason, 'human_mention_workflow_node');
  assert.equal(output.workflow.node, 'architecture');
});

test('regression: world TO replaces leading mention targets and still fans out through DAG edges', () => {
  const world = makeWorld();

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\nPlease design.');
  run(world, ['complete', '--turn', 'turn_0002', '--stdin'], '@dev\nPlease implement.');
  const output = run(world, ['complete', '--turn', 'turn_0003', '--stdin'], `[STATE=implementation_ready]

@dev
ignore this self mention.

<world>TO:QA,sec</world>
Please review.`);

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'qa');
  assert.equal(output.workflow.node, 'qa_review');
});

test('regression: world completion tags suppress routing and strip leading mentions', () => {
  const world = makeWorld();

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  const output = run(world, ['complete', '--turn', 'turn_0001', '--stdin'], `@architect
Do not route this handoff.

Done. <world>DONE</world>`);

  assert.equal(output.type, 'done');
  assert.equal(output.final, 'Do not route this handoff.\n\nDone. <world>DONE</world>');
});

test('regression: auto-reply mentions route only when the DAG allows the source agent', () => {
  const world = makeWorld({ architectureCanReturnToRequirements: true });

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'build an electron app');
  run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\nPlease design.');
  const output = run(world, ['complete', '--turn', 'turn_0002', '--stdin'], 'I need clarification before design.');

  assert.equal(output.type, 'agent_instruction');
  assert.equal(output.agent, 'pm');
  assert.equal(output.reason, 'workflow_edge');
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

test('config validation: rejects missing entry node', () => {
  assertInvalidConfig(`
workflow:
  entry: missing
  nodes:
    start:
      agent: pm
  edges:
    start: []
agents:
  pm:
    systemPrompt: PM
`, /workflow\.entry "missing" does not match a workflow node/);
});

test('config validation: rejects missing node agent', () => {
  assertInvalidConfig(`
workflow:
  entry: start
  nodes:
    start:
      instruction: Missing agent.
  edges:
    start: []
agents:
  pm:
    systemPrompt: PM
`, /workflow\.nodes\.start is missing agent/);
});

test('config validation: rejects edge to missing node', () => {
  assertInvalidConfig(`
workflow:
  entry: start
  nodes:
    start:
      agent: pm
  edges:
    start: [missing]
agents:
  pm:
    systemPrompt: PM
`, /workflow\.edges\.start references missing target node "missing"/);
});

test('config validation: rejects node agent missing from agents', () => {
  assertInvalidConfig(`
workflow:
  entry: start
  nodes:
    start:
      agent: missing_agent
  edges:
    start: []
agents:
  pm:
    systemPrompt: PM
`, /workflow\.nodes\.start\.agent "missing_agent" is not defined in agents/);
});

test('config validation: rejects requires missing node', () => {
  assertInvalidConfig(`
workflow:
  entry: final
  nodes:
    final:
      agent: pm
      requires: [missing]
  edges:
    final: []
agents:
  pm:
    systemPrompt: PM
`, /workflow\.nodes\.final\.requires references missing node "missing"/);
});
