/*
  Router test coverage for Agent World.

  Recent changes:
  - Uses JSON world config and external prompt files.
  - Added file-based request/result handoff coverage.
  - Added coverage for documented @mention normalization and world tags.
  - DAG edge enforcement remains the compatibility boundary for routed mentions.
  - Generated handoff files now live under .agent-world/handoffs subfolders.
  - Covers per-agent context scopes, isolation, limits, defaults, and generation policy.
  - skillRoot now resolves into skills/agent-world/ after the skill-restructure move.
*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..', 'skills', 'agent-world');
const router = path.join(skillRoot, 'scripts', 'agent-world-router.js');
let handoffCounter = 0;

function testHandoffName(kind) {
  handoffCounter += 1;
  const stamp = `20260102T030405${String(handoffCounter).padStart(3, '0')}Z`;
  if (kind === 'request') return `.agent-world/handoffs/requests/request-${stamp}.json`;
  return `.agent-world/handoffs/responses/result-${stamp}.json`;
}

function writePromptFiles(worldDir, prompts) {
  const promptsDir = path.join(worldDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const [name, content] of Object.entries(prompts)) {
    fs.writeFileSync(path.join(promptsDir, `${name}.md`), content);
  }
}

function writeWorldJson(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function configuredContextScope(options, agentId) {
  if (!options.contextScopes || !Object.hasOwn(options.contextScopes, agentId)) return {};
  return { contextScope: options.contextScopes[agentId] };
}

function makeWorld(options = {}) {
  const turnLimit = options.turnLimit || 12;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-router-test-'));
  const worldDir = path.join(dir, '.agent-world');
  const configPath = path.join(worldDir, 'world.json');
  fs.mkdirSync(worldDir, { recursive: true });
  writePromptFiles(worldDir, {
    pm: 'You are @pm in the test world.',
    architect: 'You are @architect in the test world.',
    dev: 'You are @dev in the test world.',
    qa: 'You are @qa in the test world.',
    sec: 'You are @sec in the test world.'
  });
  writeWorldJson(configPath, {
    world: {
      id: 'test-world',
      name: 'test-world',
      stopToken: '<world>pass</world>',
      turnLimit,
      ...(options.mainAgent ? { mainAgent: options.mainAgent } : {})
    },
    workflow: {
      type: 'sequential-pipeline',
      entry: 'requirements',
      entryAgent: 'pm',
      enforceEdges: true,
      nodes: {
        requirements: {
          agent: 'pm',
          instruction: 'Write a brief and hand off.'
        },
        architecture: {
          agent: 'architect',
          instruction: 'Design and hand off.'
        },
        implementation: {
          agent: 'dev',
          instruction: 'Request implementation host work.'
        },
        qa_review: {
          agent: 'qa',
          instruction: 'Review quality.'
        },
        security_review: {
          agent: 'sec',
          instruction: 'Review security.'
        },
        final: {
          agent: 'pm',
          requires: ['qa_review', 'security_review'],
          instruction: 'Finish after both reviews.'
        }
      },
      edges: {
        requirements: ['architecture'],
        architecture: options.architectureCanReturnToRequirements ? ['implementation', 'requirements'] : ['implementation'],
        implementation: ['qa_review', 'security_review'],
        qa_review: ['final'],
        security_review: ['final'],
        final: []
      }
    },
    agents: {
      pm: {
        role: 'product_manager',
        promptPath: 'prompts/pm.md',
        ...configuredContextScope(options, 'pm')
      },
      architect: {
        ...(options.displayNames ? { name: 'Software Architect' } : {}),
        role: 'software_architect',
        promptPath: 'prompts/architect.md',
        ...configuredContextScope(options, 'architect')
      },
      dev: {
        role: 'implementation_engineer',
        promptPath: 'prompts/dev.md',
        ...configuredContextScope(options, 'dev')
      },
      qa: {
        role: 'qa_reviewer',
        promptPath: 'prompts/qa.md',
        ...configuredContextScope(options, 'qa')
      },
      sec: {
        role: 'security_reviewer',
        promptPath: 'prompts/sec.md',
        ...configuredContextScope(options, 'sec')
      }
    }
  });
  return {
    cwd: dir,
    configPath,
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
  const requestName = options.requestName || testHandoffName('request');
  const resultName = options.resultName || testHandoffName('result');
  const requestPath = path.join(world.cwd, requestName);
  const resultPath = path.join(world.cwd, resultName);
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(requestPath, JSON.stringify({
    configPath: world.configPath,
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
  assert.match(path.relative(world.cwd, requestPath), /^\.agent-world\/handoffs\/requests\/request-\d{8}T\d{9}Z\.json$/);
  assert.match(path.relative(world.cwd, resultPath), /^\.agent-world\/handoffs\/responses\/result-\d{8}T\d{9}Z\.json$/);
  return {
    stdout: result.stdout,
    requestPath,
    resultPath,
    result: JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  };
}

function runFileWithDefaultResult(world, request) {
  const requestPath = path.join(world.cwd, testHandoffName('request'));
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, JSON.stringify({
    configPath: world.configPath,
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
  const resultPath = path.join(world.cwd, '.agent-world', 'handoffs', 'responses', match[1]);
  assert.ok(fs.existsSync(resultPath));
  return {
    stdout: result.stdout,
    requestPath,
    resultPath,
    result: JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  };
}

function makeInvalidWorld(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-invalid-config-test-'));
  const worldDir = path.join(dir, '.agent-world');
  const configPath = path.join(worldDir, 'world.json');
  fs.mkdirSync(worldDir, { recursive: true });
  writePromptFiles(worldDir, {
    pm: 'PM'
  });
  writeWorldJson(configPath, config);
  return {
    cwd: dir,
    configPath,
    statePath: path.join(dir, '.state', 'router-state.json')
  };
}

function makeRawConfigWorld(rawConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-world-raw-config-test-'));
  const worldDir = path.join(dir, '.agent-world');
  const configPath = path.join(worldDir, 'world.json');
  fs.mkdirSync(worldDir, { recursive: true });
  fs.writeFileSync(configPath, rawConfig);
  return {
    cwd: dir,
    configPath,
    statePath: path.join(dir, '.state', 'router-state.json')
  };
}

function assertInvalidConfig(config, expectedMessage) {
  const world = makeInvalidWorld(config);
  const result = runRaw(world, ['reset']);
  assert.notEqual(result.status, 0, result.stdout);
  const error = JSON.parse(result.stderr);
  assert.equal(error.type, 'error');
  assert.match(error.error, /Invalid Agent World config/);
  assert.match(error.error, expectedMessage);
}

test('config loading: rejects non-JSON world config', () => {
  const world = makeRawConfigWorld('workflow:\n  entry: start\n');
  const result = runRaw(world, ['reset']);
  assert.notEqual(result.status, 0, result.stdout);
  const error = JSON.parse(result.stderr);
  assert.equal(error.type, 'error');
  assert.match(error.error, /Invalid Agent World JSON config/);
});

test('unit: loads .agent-world/world.json from cwd and returns the configured entry agent', () => {
  const world = makeWorld();

  const reset = run(world, ['reset']);
  assert.equal(fs.realpathSync(reset.configPath), fs.realpathSync(world.configPath));

  const next = run(world, ['user', '--stdin'], 'build an electron app');
  assert.equal(next.type, 'agent_instruction');
  assert.equal(next.world, 'test-world');
  assert.equal(next.agent, 'pm');
  assert.equal(next.role, 'product_manager');
  assert.equal(next.contextScope, 'global');
  assert.equal(next.routedFrom.sender, 'human');
  assert.equal(next.routedFrom.content, 'build an electron app');
  assert.equal(next.workflow.node, 'requirements');
  assert.deepEqual(next.workflow.next.map(item => item.node), ['architecture']);
  assert.match(next.systemPrompt, /@pm in the test world/);
  assert.match(next.responseContract.completeByRunning, /^node "\$ROUTER" file --request \.agent-world\/handoffs\/requests\/request-\d{8}T\d{9}Z-turn-turn_0001\.json --result \.agent-world\/handoffs\/responses\/result-\d{8}T\d{9}Z-turn-turn_0001\.json$/);
  assert.match(next.responseContract.requestPath, /^\.agent-world\/handoffs\/requests\/request-\d{8}T\d{9}Z-turn-turn_0001\.json$/);
  assert.match(next.responseContract.resultPath, /^\.agent-world\/handoffs\/responses\/result-\d{8}T\d{9}Z-turn-turn_0001\.json$/);
  assert.deepEqual(next.responseContract.requestJson, {
    command: 'complete',
    turnId: 'turn_0001',
    content: 'one markdown message as @pm'
  });
});

test('config schema: contextScope accepts only global and agent with a global default', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'world.schema.json'), 'utf8'));
  const contextScope = schema.$defs.agent.properties.contextScope;

  assert.deepEqual(contextScope.enum, ['global', 'agent']);
  assert.equal(contextScope.default, 'global');
});

test('config validation: rejects an unsupported agent contextScope', () => {
  assertInvalidConfig({
    workflow: {
      entry: 'start',
      entryAgent: 'pm',
      nodes: {
        start: { agent: 'pm' }
      },
      edges: {
        start: []
      }
    },
    agents: {
      pm: {
        promptPath: 'prompts/pm.md',
        contextScope: 'causal'
      }
    }
  }, /agents\.pm\.contextScope must be one of: global, agent/);
});

test('generation policy: all nine built-in patterns assign valid context scopes to every sample agent', () => {
  const initReference = fs.readFileSync(path.join(skillRoot, 'init-agent-world.md'), 'utf8');
  const match = initReference.match(/<!-- context-scope-defaults:start -->\s*```json\s*([\s\S]*?)```\s*<!-- context-scope-defaults:end -->/);
  assert.ok(match, 'missing machine-checkable context scope defaults');
  const defaults = JSON.parse(match[1]);
  const expectedDefaults = {
    broadcast: { broadcaster: 'agent', researcher: 'agent', critic: 'agent', planner: 'agent', collector: 'global' },
    'direct-handoff': { sender: 'agent', receiver: 'agent' },
    'multi-agent-fan-out': { lead: 'agent', qa: 'agent', security: 'agent', collector: 'global' },
    'fan-in-collector': { researcher: 'agent', analyst: 'agent', collector: 'global' },
    'sequential-pipeline': { intake: 'agent', architect: 'agent', builder: 'agent', reviewer: 'agent', final: 'global' },
    'intent-router': { router: 'agent', docs: 'agent', code: 'agent', ops: 'agent' },
    'fsm-state-token': { state_router: 'global', planner: 'agent', executor: 'agent', reviewer: 'global' },
    'debate-ping-pong-loop': { pro: 'agent', con: 'agent', judge: 'global' },
    'orchestrator-worker': { orchestrator: 'global', worker_a: 'agent', worker_b: 'agent', synthesizer: 'global' }
  };

  assert.deepEqual(defaults, expectedDefaults);

  const example = JSON.parse(fs.readFileSync(path.join(skillRoot, 'world.example.json'), 'utf8'));
  assert.deepEqual(Object.fromEntries(
    Object.entries(example.agents).map(([agentId, agent]) => [agentId, agent.contextScope])
  ), {
    pm: 'global',
    architect: 'agent',
    dev: 'agent',
    qa: 'agent',
    sec: 'agent'
  });
});

test('context scope: isolated reviewers exclude sibling and upstream messages while the global collector sees both branches', () => {
  const world = makeWorld({
    contextScopes: {
      pm: 'global',
      qa: 'agent',
      sec: 'agent'
    }
  });

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'private-original-request');
  run(world, ['complete', '--turn', 'turn_0001', '--stdin'], '@architect\narchitecture-request');
  run(world, ['complete', '--turn', 'turn_0002', '--stdin'], '@dev\nimplementation-request');
  const qa = run(world, ['complete', '--turn', 'turn_0003', '--stdin'], '@qa\nshared-review-request\n\n@sec\nshared-review-request');

  assert.equal(qa.contextScope, 'agent');
  assert.equal(qa.routedFrom.sender, 'dev');
  assert.equal(qa.routedFrom.content, '@qa\nshared-review-request\n\n@sec\nshared-review-request');
  assert.deepEqual(qa.context.map(message => message.sender), ['dev']);
  assert.doesNotMatch(qa.hostInstruction, /private-original-request|architecture-request|implementation-request/);

  const sec = run(world, ['complete', '--turn', qa.turnId, '--stdin'], '@pm\nqa-sibling-result');
  assert.equal(sec.agent, 'sec');
  assert.equal(sec.contextScope, 'agent');
  assert.deepEqual(sec.context.map(message => message.sender), ['dev']);
  assert.doesNotMatch(sec.hostInstruction, /qa-sibling-result|private-original-request/);

  const final = run(world, ['complete', '--turn', sec.turnId, '--stdin'], '@pm\nsecurity-sibling-result');
  assert.equal(final.agent, 'pm');
  assert.equal(final.contextScope, 'global');
  assert.match(final.hostInstruction, /qa-sibling-result/);
  assert.match(final.hostInstruction, /security-sibling-result/);
});

test('context scope: agent reserves an old routedFrom slot ahead of 17 latest own messages', () => {
  const world = makeWorld({
    contextScopes: {
      pm: 'agent'
    }
  });

  run(world, ['reset']);
  run(world, ['user', '--stdin'], 'old-routed-from-source');
  const state = JSON.parse(fs.readFileSync(world.statePath, 'utf8'));
  for (let index = 1; index <= 18; index += 1) {
    const suffix = String(index).padStart(2, '0');
    state.counters.message += 1;
    state.messages.push({
      id: `message_${String(state.counters.message).padStart(4, '0')}`,
      runId: state.currentRunId,
      sender: 'pm',
      content: `pm-message-${suffix}`,
      metadata: {},
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      processedForRouting: true
    });
  }
  fs.writeFileSync(world.statePath, JSON.stringify(state, null, 2));

  const output = run(world, ['next']);

  assert.equal(output.agent, 'pm');
  assert.equal(output.contextScope, 'agent');
  assert.equal(output.context.length, 18);
  assert.deepEqual(output.context.map(message => message.content), [
    'old-routed-from-source',
    ...Array.from({ length: 17 }, (_, index) => `pm-message-${String(index + 2).padStart(2, '0')}`)
  ]);
});

test('context scope: global and agent both exclude messages from previous runs', () => {
  for (const scope of ['global', 'agent']) {
    const world = makeWorld({ contextScopes: { pm: scope } });
    run(world, ['reset']);
    const first = run(world, ['user', '--stdin'], `old-request-${scope}`);
    run(world, ['complete', '--turn', first.turnId, '--stdin'], `old-response-${scope} <world>pass</world>`);

    const next = run(world, ['user', '--stdin'], `new-request-${scope}`);
    assert.equal(next.contextScope, scope);
    assert.deepEqual(next.context.map(message => message.content), [`new-request-${scope}`]);
    assert.doesNotMatch(next.hostInstruction, new RegExp(`old-(request|response)-${scope}`));
  }
});

test('unit: file handoff writes user result to timestamped .agent-world handoff response and keeps stdout status-only', () => {
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

test('unit: file handoff defaults result output to timestamped .agent-world handoff response file', () => {
  const world = makeWorld();

  const output = runFileWithDefaultResult(world, {
    command: 'user',
    content: 'build an electron app'
  });

  assert.equal(output.result.type, 'agent_instruction');
  assert.match(path.relative(world.cwd, output.requestPath), /^\.agent-world\/handoffs\/requests\/request-\d{8}T\d{9}Z\.json$/);
  assert.match(path.relative(world.cwd, output.resultPath), /^\.agent-world\/handoffs\/responses\/result-\d{8}T\d{9}Z\.json$/);
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

test('targeted: host actions round-trip back to an agent-scoped requester and workflow node', () => {
  const world = makeWorld({ contextScopes: { dev: 'agent' } });

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
  assert.equal(next.contextScope, 'agent');
  assert.deepEqual(next.context.map(message => message.sender), ['dev', 'host']);
  assert.match(next.hostInstruction, /created files/);
  assert.doesNotMatch(next.hostInstruction, /build an electron app/);
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
  assertInvalidConfig({
    workflow: {
      entry: 'missing',
      nodes: {
        start: {
          agent: 'pm'
        }
      },
      edges: {
        start: []
      }
    },
    agents: {
      pm: {
        promptPath: 'prompts/pm.md'
      }
    }
  }, /workflow\.entry "missing" does not match a workflow node/);
});

test('config validation: rejects missing node agent', () => {
  assertInvalidConfig({
    workflow: {
      entry: 'start',
      nodes: {
        start: {
          instruction: 'Missing agent.'
        }
      },
      edges: {
        start: []
      }
    },
    agents: {
      pm: {
        promptPath: 'prompts/pm.md'
      }
    }
  }, /workflow\.nodes\.start is missing agent/);
});

test('config validation: rejects edge to missing node', () => {
  assertInvalidConfig({
    workflow: {
      entry: 'start',
      nodes: {
        start: {
          agent: 'pm'
        }
      },
      edges: {
        start: ['missing']
      }
    },
    agents: {
      pm: {
        promptPath: 'prompts/pm.md'
      }
    }
  }, /workflow\.edges\.start references missing target node "missing"/);
});

test('config validation: rejects node agent missing from agents', () => {
  assertInvalidConfig({
    workflow: {
      entry: 'start',
      nodes: {
        start: {
          agent: 'missing_agent'
        }
      },
      edges: {
        start: []
      }
    },
    agents: {
      pm: {
        promptPath: 'prompts/pm.md'
      }
    }
  }, /workflow\.nodes\.start\.agent "missing_agent" is not defined in agents/);
});

test('config validation: rejects requires missing node', () => {
  assertInvalidConfig({
    workflow: {
      entry: 'final',
      nodes: {
        final: {
          agent: 'pm',
          requires: ['missing']
        }
      },
      edges: {
        final: []
      }
    },
    agents: {
      pm: {
        promptPath: 'prompts/pm.md'
      }
    }
  }, /workflow\.nodes\.final\.requires references missing node "missing"/);
});

test('config validation: rejects agents without promptPath', () => {
  assertInvalidConfig({
    workflow: {
      entry: 'start',
      nodes: {
        start: {
          agent: 'pm'
        }
      },
      edges: {
        start: []
      }
    },
    agents: {
      pm: {}
    }
  }, /agents\.pm is missing promptPath/);
});
